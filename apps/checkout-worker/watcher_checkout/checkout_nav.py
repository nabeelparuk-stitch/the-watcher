"""Navigate from cart / cart drawer to Shopify checkout (may need multiple clicks)."""

from __future__ import annotations

from urllib.parse import urlparse

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from watcher_checkout.checkout_advance import _payment_step_visible


def _is_cart_url(url: str) -> bool:
    path = urlparse(url).path.lower()
    return path == "/cart" or path.endswith("/cart") or "/cart/" in path


def is_real_checkout_url(url: str) -> bool:
    """True when on Shopify checkout (not the cart page)."""
    lower = url.lower()
    if "checkout.shopify.com" in lower:
        return True
    path = urlparse(url).path.lower()
    if "/checkouts/" in path:
        return True
    if path.rstrip("/") == "/checkout":
        return True
    if path.endswith("/checkout") and "/cart" not in path:
        return True
    return False


_CHECKOUT_BUTTON_SELECTORS = [
    'button:has-text("Check out")',
    'button:has-text("Checkout")',
    'a:has-text("Check out")',
    'a:has-text("Checkout")',
    'input[type="submit"][value*="Check out" i]',
    'input[type="submit"][value*="Checkout" i]',
    '[data-testid="checkout-button"]',
    '[data-testid="CartDrawer-Checkout"]',
    'form[action*="checkout"] button[type="submit"]',
    '#checkout',
    'button[name="checkout"]',
    'a[href*="/checkout"]:not([href*="/cart"])',
    'a[href*="checkout.shopify.com"]',
]


async def _click_checkout_button(page: Page, *, timeout_ms: int) -> bool:
    """Click the best visible checkout control (not view cart)."""
    for sel in _CHECKOUT_BUTTON_SELECTORS:
        try:
            loc = page.locator(sel)
            count = await loc.count()
            for i in range(min(count, 5)):
                btn = loc.nth(i)
                try:
                    if not await btn.is_visible():
                        continue
                    text = (await btn.inner_text()).strip().lower()
                    href = await btn.get_attribute("href") or ""
                    if "view cart" in text or text == "cart":
                        continue
                    if "/cart" in href.lower() and "checkout" not in href.lower():
                        continue
                    await btn.click(timeout=min(12_000, timeout_ms))
                    await page.wait_for_timeout(1800)
                    return True
                except PlaywrightTimeoutError:
                    continue
        except PlaywrightTimeoutError:
            continue

    try:
        clicked = await page.evaluate(
            """() => {
              const bad = /view cart|continue shopping|keep shopping/i;
              for (const el of document.querySelectorAll(
                "button, a, input[type='submit'], [role='button']"
              )) {
                const t = (el.innerText || el.value || "").trim();
                if (!t || bad.test(t)) continue;
                if (!/^check\\s*out$/i.test(t) && !/^checkout$/i.test(t)) continue;
                const r = el.getBoundingClientRect();
                if (r.width < 4 || r.height < 4) continue;
                if (el.disabled) continue;
                el.click();
                return true;
              }
              return false;
            }"""
        )
        if clicked:
            await page.wait_for_timeout(1800)
            return True
    except Exception:
        pass
    return False


async def _close_cart_drawer_if_blocking(page: Page) -> None:
    """Close overlay only if we need to reach a checkout button behind it — skip if checkout visible."""
    try:
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(400)
    except Exception:
        pass


async def proceed_through_cart_to_checkout(
    page: Page, base_url: str, *, timeout_ms: int = 60_000
) -> None:
    """
    From post-add-to-cart, cart drawer, or /cart page — click through to real checkout.
    Some stores need: drawer Check out → cart page → Check out again → payment checkout.
    """
    root = base_url.rstrip("/")

    try:
        await page.wait_for_load_state("domcontentloaded", timeout=min(20_000, timeout_ms))
    except PlaywrightTimeoutError:
        pass

    await page.wait_for_timeout(1500)

    if await _payment_step_visible(page) or is_real_checkout_url(page.url):
        return

    for attempt in range(6):
        if await _payment_step_visible(page):
            return
        if is_real_checkout_url(page.url) and not _is_cart_url(page.url):
            return

        clicked = await _click_checkout_button(page, timeout_ms=timeout_ms)
        if clicked:
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=15_000)
            except PlaywrightTimeoutError:
                pass
            await page.wait_for_timeout(1500)
            if await _payment_step_visible(page):
                return
            if is_real_checkout_url(page.url) and not _is_cart_url(page.url):
                return
            continue

        if _is_cart_url(page.url) or "cart" in page.url.lower():
            if await _click_checkout_button(page, timeout_ms=timeout_ms):
                continue

        if attempt >= 2:
            try:
                await page.goto(f"{root}/checkout", wait_until="domcontentloaded", timeout=20_000)
                await page.wait_for_timeout(2000)
            except PlaywrightTimeoutError:
                pass
            if await _payment_step_visible(page) or is_real_checkout_url(page.url):
                return

        await _close_cart_drawer_if_blocking(page)
        await _click_checkout_button(page, timeout_ms=timeout_ms)

    if not is_real_checkout_url(page.url) and not await _payment_step_visible(page):
        try:
            await page.goto(f"{root}/checkout", wait_until="domcontentloaded", timeout=20_000)
            await page.wait_for_timeout(2000)
            if _is_cart_url(page.url) or "/cart" in page.url.lower():
                await _click_checkout_button(page, timeout_ms=timeout_ms)
        except PlaywrightTimeoutError:
            pass
