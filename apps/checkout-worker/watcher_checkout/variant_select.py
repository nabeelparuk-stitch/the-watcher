"""Select Shopify product variant options (dropdowns, radios, swatches) before add to cart."""

from __future__ import annotations

from typing import Any

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

_SELECT_VARIANTS_JS = """
() => {
  const form =
    document.querySelector(
      'form[action*="/cart/add"], product-form, .product-form, [data-type="add-to-cart-form"], #AddToCartForm'
    ) || document;

  const isPlaceholder = (text, value) => {
    const t = (text || "").trim().toLowerCase();
    const v = (value || "").trim();
    if (!v) return true;
    return (
      /^(select|choose|pick|please|--| -)/i.test(t) ||
      t.includes("select a ") ||
      t.includes("choose a ")
    );
  };

  let changed = 0;

  for (const sel of form.querySelectorAll("select")) {
    const opts = Array.from(sel.options);
    if (opts.length <= 1) continue;

    let pick = null;
    for (const opt of opts) {
      if (opt.disabled) continue;
      if (isPlaceholder(opt.textContent, opt.value)) continue;
      pick = opt;
      break;
    }
    if (!pick) {
      pick = opts.find((o) => !o.disabled && o.value && !isPlaceholder(o.textContent, o.value));
    }
    if (!pick && opts.length > 1) {
      pick = opts.find((o) => !o.disabled && o.value) || opts[1];
    }
    if (pick && sel.value !== pick.value) {
      sel.value = pick.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      changed++;
    }
  }

  const radioNames = new Set();
  for (const inp of form.querySelectorAll('input[type="radio"][name]')) {
    if (!inp.disabled) radioNames.add(inp.name);
  }
  for (const name of radioNames) {
    const group = form.querySelectorAll(
      `input[type="radio"][name="${name.replace(/"/g, '\\\\"')}"]`
    );
    const first = Array.from(group).find((r) => !r.disabled && r.value);
    if (first && !first.checked) {
      first.click();
      first.dispatchEvent(new Event("change", { bubbles: true }));
      changed++;
    }
  }

  // Swatch / pill buttons (common in Dawn and custom themes)
  for (const fieldset of form.querySelectorAll(
    "fieldset[data-index], fieldset.product-form__input, .variant-input-wrap"
  )) {
    const btn = fieldset.querySelector(
      'input[type="radio"]:not(:disabled), button[data-value]:not([disabled]), [data-option-value]:not([disabled])'
    );
    if (btn && btn.type === "radio" && !btn.checked) {
      btn.click();
      changed++;
    } else if (btn && btn.tagName === "BUTTON" && !btn.classList.contains("selected")) {
      btn.click();
      changed++;
    }
  }

  return changed;
}
"""


async def select_product_variants(
    page: Page,
    *,
    custom_selector: str | None = None,
    timeout_ms: int = 15_000,
) -> int:
    """
    Pick the first valid value for each variant option so Add to cart can work.
    Returns how many controls were changed.
    """
    await page.wait_for_timeout(600)

    changed = await page.evaluate(_SELECT_VARIANTS_JS)
    if not isinstance(changed, int):
        changed = 0

    # Playwright native select_option (handles some themes JS doesn't)
    scope = (
        custom_selector
        if custom_selector
        else 'form[action*="/cart/add"] select, product-form select, .product-form select, variant-selects select'
    )
    loc = page.locator(scope)
    try:
        n = await loc.count()
    except PlaywrightTimeoutError:
        n = 0

    for i in range(n):
        sel = loc.nth(i)
        try:
            if not await sel.is_visible():
                continue
            options = sel.locator("option")
            opt_count = await options.count()
            if opt_count <= 1:
                continue
            for j in range(opt_count):
                opt = options.nth(j)
                value = await opt.get_attribute("value")
                text = (await opt.inner_text()).strip()
                disabled = await opt.get_attribute("disabled")
                if disabled is not None:
                    continue
                if not value or not value.strip():
                    continue
                lower = text.lower()
                if any(
                    lower.startswith(p)
                    for p in ("select", "choose", "pick", "please", "--")
                ):
                    continue
                await sel.select_option(value=value, timeout=min(8_000, timeout_ms))
                changed += 1
                break
        except PlaywrightTimeoutError:
            continue

    # shopify-variant-selector web component (shadow DOM) — click first available option
    try:
        wc_changed = await page.evaluate(
            """() => {
              let n = 0;
              for (const host of document.querySelectorAll("shopify-variant-selector")) {
                const root = host.shadowRoot;
                if (!root) continue;
                for (const sel of root.querySelectorAll("select")) {
                  const opts = Array.from(sel.options);
                  const pick = opts.find(o => !o.disabled && o.value);
                  if (pick && sel.value !== pick.value) {
                    sel.value = pick.value;
                    sel.dispatchEvent(new Event("change", { bubbles: true }));
                    n++;
                  }
                }
              }
              return n;
            }"""
        )
        if isinstance(wc_changed, int):
            changed += wc_changed
    except Exception:
        pass

    if changed > 0:
        await page.wait_for_timeout(900)

    await _wait_for_add_to_cart_ready(page, timeout_ms=timeout_ms)
    return changed


async def _wait_for_add_to_cart_ready(page: Page, *, timeout_ms: int) -> None:
    """Wait until the main add-to-cart control is enabled (variants resolved)."""
    wait_ms = min(12_000, timeout_ms)
    try:
        await page.wait_for_function(
            """() => {
              const btns = document.querySelectorAll(
                'button[name="add"], input[name="add"], [data-add-to-cart], button[type="submit"][name="add"]'
              );
              for (const b of btns) {
                const r = b.getBoundingClientRect();
                if (r.width < 2 || r.height < 2) continue;
                if (b.disabled || b.getAttribute("aria-disabled") === "true") continue;
                if ((b.innerText || "").toLowerCase().includes("sold out")) continue;
                return true;
              }
              return document.querySelectorAll('form[action*="/cart/add"] select[name="id"] option:not([disabled])').length > 0;
            }""",
            timeout=wait_ms,
        )
    except PlaywrightTimeoutError:
        pass
