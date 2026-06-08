"""Navigate from a Shopify store entry URL to a purchasable product page."""

from __future__ import annotations

import json
from collections import deque
from urllib.parse import urljoin, urlparse

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

_MAX_COLLECTION_PAGES = 12
_NAV_TIMEOUT_MS = 25_000


def _path(url: str) -> str:
    return urlparse(url).path.lower()


def _same_store(base_url: str, href: str) -> bool:
    try:
        return urlparse(href).netloc == urlparse(base_url).netloc
    except Exception:
        return False


def is_product_url(url: str) -> bool:
    path = _path(url)
    if "/products/" not in path:
        return False
    parts = [p for p in path.split("/") if p]
    try:
        idx = parts.index("products")
        return idx + 1 < len(parts) and parts[idx + 1] not in ("", ".", "all")
    except ValueError:
        return False


def is_collection_url(url: str) -> bool:
    path = _path(url)
    return "/collections/" in path and not is_product_url(url)


def is_cart_url(url: str) -> bool:
    return "/cart" in _path(url)


_FIND_PRODUCT_HREFS_JS = """
() => {
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity) > 0;
  };
  const productHandle = (href) => {
    try {
      const u = new URL(href, window.location.href);
      const m = u.pathname.match(/\\/products\\/([^/?#]+)/);
      return m && m[1] && m[1] !== "all" ? m[1] : null;
    } catch {
      return null;
    }
  };
  const seen = new Set();
  const out = [];
  for (const a of document.querySelectorAll('a[href*="/products/"]')) {
    const href = a.href;
    if (!href || !productHandle(href)) continue;
    const handle = productHandle(href);
    if (seen.has(handle)) continue;
    if (!isVisible(a)) continue;
    seen.add(handle);
    const r = a.getBoundingClientRect();
    out.push({ href, top: r.top, left: r.left });
  }
  out.sort((a, b) => a.top - b.top || a.left - b.left);
  return out.map((x) => x.href);
}
"""


_FIND_COLLECTION_HREFS_JS = """
() => {
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity) > 0;
  };
  const collectionPath = (href) => {
    try {
      const u = new URL(href, window.location.href);
      const m = u.pathname.match(/\\/collections\\/([^/?#]+)/);
      if (!m || !m[1]) return null;
      const slug = m[1].toLowerCase();
      if (["all", "frontpage", "vendors", "types"].includes(slug)) return null;
      return u.href.split("?")[0];
    } catch {
      return null;
    }
  };
  const seen = new Set();
  const out = [];
  for (const a of document.querySelectorAll('a[href*="/collections/"]')) {
    const href = a.href;
    const canon = collectionPath(href);
    if (!canon || seen.has(canon)) continue;
    if (!isVisible(a)) continue;
    seen.add(canon);
    out.push(canon);
  }
  return out;
}
"""


async def _goto(page: Page, url: str, *, timeout_ms: int) -> bool:
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=min(_NAV_TIMEOUT_MS, timeout_ms))
        return True
    except PlaywrightTimeoutError:
        return False


async def _first_product_href_on_page(page: Page) -> str | None:
    hrefs = await page.evaluate(_FIND_PRODUCT_HREFS_JS)
    if isinstance(hrefs, list) and hrefs:
        return str(hrefs[0])
    return None


async def _collection_hrefs_on_page(page: Page, base_url: str) -> list[str]:
    raw = await page.evaluate(_FIND_COLLECTION_HREFS_JS)
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for h in raw:
        if isinstance(h, str) and _same_store(base_url, h):
            out.append(h.split("?")[0])
    return out


async def _product_from_shopify_json(page: Page, base_url: str) -> str | None:
    """Use Shopify's public JSON endpoints (most reliable on modern themes)."""
    root = base_url.rstrip("/")
    endpoints = [
        f"{root}/products.json?limit=10",
        f"{root}/collections/all/products.json?limit=10",
    ]
    request = page.context.request
    for url in endpoints:
        try:
            resp = await request.get(url, timeout=_NAV_TIMEOUT_MS)
            if resp.status != 200:
                continue
            data = await resp.json()
            products = data.get("products")
            if not isinstance(products, list):
                continue
            for item in products:
                if not isinstance(item, dict):
                    continue
                handle = item.get("handle")
                if isinstance(handle, str) and handle.strip():
                    return f"{root}/products/{handle.strip()}"
        except (PlaywrightTimeoutError, json.JSONDecodeError, OSError, ValueError):
            continue
    return None


async def _product_from_collections_json(page: Page, base_url: str) -> str | None:
    root = base_url.rstrip("/")
    try:
        resp = await page.context.request.get(
            f"{root}/collections.json?limit=50", timeout=_NAV_TIMEOUT_MS
        )
        if resp.status != 200:
            return None
        data = await resp.json()
        collections = data.get("collections")
        if not isinstance(collections, list):
            return None
        for col in collections:
            if not isinstance(col, dict):
                continue
            handle = col.get("handle")
            if not isinstance(handle, str) or not handle.strip():
                continue
            slug = handle.strip()
            if slug.lower() in ("frontpage",):
                continue
            prod_url = f"{root}/collections/{slug}/products.json?limit=5"
            try:
                pr = await page.context.request.get(prod_url, timeout=_NAV_TIMEOUT_MS)
                if pr.status != 200:
                    continue
                pdata = await pr.json()
                products = pdata.get("products")
                if isinstance(products, list) and products:
                    h = products[0].get("handle") if isinstance(products[0], dict) else None
                    if isinstance(h, str) and h:
                        return f"{root}/products/{h}"
            except (PlaywrightTimeoutError, json.JSONDecodeError, OSError, ValueError):
                continue
    except (PlaywrightTimeoutError, json.JSONDecodeError, OSError, ValueError):
        return None
    return None


async def _open_product(page: Page, href: str, *, timeout_ms: int) -> str | None:
    if not await _goto(page, href, timeout_ms=timeout_ms):
        return None
    if is_product_url(page.url):
        return page.url
    inner = await _first_product_href_on_page(page)
    if inner and await _goto(page, inner, timeout_ms=timeout_ms) and is_product_url(page.url):
        return page.url
    return None


async def _browse_collections(
    page: Page, base_url: str, seed_urls: list[str], *, timeout_ms: int
) -> str | None:
    """BFS: visit collection pages until we find a product link."""
    queue: deque[str] = deque()
    seen: set[str] = set()

    for u in seed_urls:
        if u not in seen:
            seen.add(u)
            queue.append(u)

    visited = 0
    while queue and visited < _MAX_COLLECTION_PAGES:
        coll_url = queue.popleft()
        visited += 1
        if not await _goto(page, coll_url, timeout_ms=timeout_ms):
            continue

        product_href = await _first_product_href_on_page(page)
        if product_href:
            opened = await _open_product(page, product_href, timeout_ms=timeout_ms)
            if opened:
                return opened

        for link in await _collection_hrefs_on_page(page, base_url):
            if link not in seen:
                seen.add(link)
                queue.append(link)

    return None


async def navigate_to_product(page: Page, base_url: str, *, timeout_ms: int) -> str:
    """
    From store homepage, collection, or catalog page — reach a product PDP.
    Returns the product URL.
    """
    if is_product_url(page.url):
        return page.url

    # 1) Shopify JSON APIs (fast, works when theme hides products on home)
    for getter in (_product_from_shopify_json, _product_from_collections_json):
        href = await getter(page, base_url)
        if href:
            opened = await _open_product(page, href, timeout_ms=timeout_ms)
            if opened:
                return opened

    # 2) Product link on current page (home may feature one product)
    on_page = await _first_product_href_on_page(page)
    if on_page:
        opened = await _open_product(page, on_page, timeout_ms=timeout_ms)
        if opened:
            return opened

    root = base_url.rstrip("/")
    collection_seeds: list[str] = []

    # 3) Known catalog URLs
    for path in (
        "/collections/all",
        "/collections",
        "/pages/shop",
        "/pages/catalog",
        "/pages/store",
    ):
        collection_seeds.append(root + path)

    # 4) Collection links from homepage / nav
    collection_seeds.extend(await _collection_hrefs_on_page(page, base_url))

    # 5) "Shop" / catalog links in header nav
    shop_href = await page.evaluate(
        """() => {
          const words = /^(shop|store|catalog|products|all products|browse)$/i;
          for (const a of document.querySelectorAll(
            'nav a, header a, [role="navigation"] a, a[href*="/collections"]'
          )) {
            const t = (a.innerText || "").trim();
            const h = a.href || "";
            if (!h) continue;
            if (words.test(t) || /\\/collections\\/all/.test(h)) {
              const r = a.getBoundingClientRect();
              if (r.width > 4 && r.height > 4) return h;
            }
          }
          return null;
        }"""
    )
    if isinstance(shop_href, str) and _same_store(base_url, shop_href):
        collection_seeds.append(shop_href.split("?")[0])

    # Dedupe seeds, prefer /collections/all first
    deduped: list[str] = []
    seen_seed: set[str] = set()
    for u in sorted(set(collection_seeds), key=lambda x: (0 if "/collections/all" in x else 1, x)):
        if u not in seen_seed:
            seen_seed.add(u)
            deduped.append(u)

    found = await _browse_collections(page, base_url, deduped, timeout_ms=timeout_ms)
    if found:
        return found

    # 6) Re-load home and one more pass (lazy-loaded grids)
    if await _goto(page, root, timeout_ms=timeout_ms):
        await page.wait_for_timeout(1500)
        on_page = await _first_product_href_on_page(page)
        if on_page:
            opened = await _open_product(page, on_page, timeout_ms=timeout_ms)
            if opened:
                return opened
        found = await _browse_collections(
            page,
            base_url,
            await _collection_hrefs_on_page(page, base_url),
            timeout_ms=timeout_ms,
        )
        if found:
            return found

    raise RuntimeError(
        "Could not find a product page. The store may password-protect the catalog, "
        "use a non-standard structure, or block automated browsing. "
        "Try a direct product URL if available."
    )
