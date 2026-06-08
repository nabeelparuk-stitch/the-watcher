"""Shopify checkout flow: product → cart → checkout → Stitch Express position check."""

from __future__ import annotations

import time
from typing import Any

from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright

from watcher_checkout.checkout_nav import is_real_checkout_url, proceed_through_cart_to_checkout
from watcher_checkout.shopify_nav import is_cart_url, is_product_url, navigate_to_product
from watcher_checkout.stitch_detect import STITCH_EXPRESS_SIGNATURE, verify_stitch_express_first
from watcher_checkout.variant_select import select_product_variants


def _merge_stitch(flow: dict[str, Any], stitch: dict[str, Any]) -> dict[str, Any]:
    methods = stitch.get("payment_methods")
    preview = stitch.get("payment_methods_preview")
    if isinstance(methods, list) and methods:
        flow["payment_methods"] = methods
        flow["payment_methods_preview"] = [
            m.get("label", m) if isinstance(m, dict) else str(m) for m in methods
        ]
    elif isinstance(preview, list):
        flow["payment_methods_preview"] = preview
        flow["payment_methods"] = preview
    else:
        flow["payment_methods"] = []
        flow["payment_methods_preview"] = []
    flow["stitch_index"] = stitch.get("stitch_index")
    flow["payment_method_count"] = stitch.get("payment_method_count")
    return flow


def _sel(selectors: dict[str, Any] | None, key: str) -> str | None:
    if not selectors or not isinstance(selectors, dict):
        return None
    v = selectors.get(key)
    return v if isinstance(v, str) and v.strip() else None


async def run_checkout_flow(
    *,
    start_url: str,
    base_url: str,
    selectors: dict[str, Any] | None,
    success_path_includes: str,
    timeout_seconds: int,
) -> dict[str, Any]:
    timeout_ms = max(5_000, min(timeout_seconds * 1000, 600_000))
    started = time.monotonic()
    step = "init"
    final_url = ""
    stitch_express_is_top: bool | None = None
    first_payment_method_text: str | None = None
    stitch_meta: dict[str, Any] = {}
    product_url: str | None = None

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            try:
                context = await browser.new_context(
                    user_agent="TheWatcherCheckout/1.0 (Shopify Stitch Express monitor)"
                )
                page = await context.new_page()
                page.set_default_timeout(timeout_ms)

                await page.goto(start_url, wait_until="domcontentloaded")
                step = "landed"
                final_url = page.url

                if not is_product_url(page.url) and not is_cart_url(page.url):
                    step = "find_product"
                    product_url = await navigate_to_product(
                        page, base_url, timeout_ms=timeout_ms
                    )
                    final_url = product_url
                    step = "on_product"
                elif is_product_url(page.url):
                    product_url = page.url

                clicked = is_cart_url(page.url)
                if not clicked:
                    step = "select_variants"
                    variant_custom = _sel(selectors, "variantOption")
                    await select_product_variants(
                        page,
                        custom_selector=variant_custom,
                        timeout_ms=min(30_000, timeout_ms),
                    )

                    add_custom = _sel(selectors, "addToCart")
                    if add_custom:
                        await page.click(add_custom, timeout=min(30_000, timeout_ms))
                        clicked = True
                    else:
                        candidates = [
                            'button[name="add"]',
                            'input[name="add"]',
                            '[data-testid="add-to-cart-button"]',
                            'button[data-add-to-cart]',
                            'button:has-text("Add to cart")',
                            'button:has-text("Add to Cart")',
                            'input[type="submit"][value*="Add"]',
                        ]
                        for sel in candidates:
                            loc = page.locator(sel).first
                            try:
                                if await loc.count() > 0:
                                    await loc.wait_for(state="visible", timeout=8_000)
                                    await loc.click(timeout=15_000)
                                    clicked = True
                                    break
                            except PlaywrightTimeoutError:
                                continue

                    if not clicked:
                        raise RuntimeError(
                            "No add-to-cart control matched on the product page. "
                            "The store theme may need custom selectors."
                        )

                    step = "add_to_cart"
                    await page.wait_for_timeout(1200)
                else:
                    step = "on_cart"

                step = "go_to_checkout"
                checkout_custom = _sel(selectors, "checkoutLink")
                if checkout_custom:
                    await page.click(checkout_custom, timeout=min(30_000, timeout_ms))
                    await page.wait_for_timeout(1500)
                elif not (
                    is_real_checkout_url(page.url) and not is_cart_url(page.url)
                ):
                    await proceed_through_cart_to_checkout(
                        page, base_url, timeout_ms=timeout_ms
                    )

                step = "reached_checkout"
                final_url = page.url
                needle = success_path_includes.lower()
                hay = (final_url + (await page.title())).lower()
                if needle not in hay and needle not in (await page.content()).lower()[:80_000]:
                    raise RuntimeError(
                        f"Checkout assertion failed: expected '{success_path_includes}' in page URL or content, url={final_url}"
                    )

                step = "verify_stitch_express"
                stitch = await verify_stitch_express_first(
                    page, timeout_ms=min(90_000, timeout_ms)
                )
                stitch_meta = stitch
                stitch_express_is_top = stitch.get("stitch_express_is_top")
                first_payment_method_text = stitch.get("first_payment_method_text")
                stitch_err = stitch.get("error")

                if stitch_express_is_top is None:
                    step = "stitch_not_found"
                    raise RuntimeError(stitch_err or "Could not verify Stitch Express on checkout")

                if not stitch_express_is_top:
                    step = "stitch_not_first"
                    raise RuntimeError(
                        stitch_err
                        or (
                            "Stitch Express is not the first payment method. "
                            f"Expected signature: {STITCH_EXPRESS_SIGNATURE}"
                        )
                    )

                duration_ms = int((time.monotonic() - started) * 1000)
                result = _merge_stitch(
                    {
                        "status": "success",
                        "step": "stitch_first",
                        "error_message": None,
                        "final_url": final_url,
                        "duration_ms": duration_ms,
                        "stitch_express_is_top": True,
                        "first_payment_method_text": first_payment_method_text,
                        "product_url": product_url,
                    },
                    stitch_meta,
                )
                return result
            finally:
                await browser.close()
    except Exception as e:  # noqa: BLE001 — surface any failure to the run log
        duration_ms = int((time.monotonic() - started) * 1000)
        return _merge_stitch(
            {
                "status": "failure",
                "step": step,
                "error_message": str(e)[:2000],
                "final_url": final_url,
                "duration_ms": duration_ms,
                "stitch_express_is_top": stitch_express_is_top,
                "first_payment_method_text": first_payment_method_text,
                "product_url": product_url,
            },
            stitch_meta,
        )


async def run_checkout_page_report(
    *,
    checkout_url: str,
    timeout_seconds: int,
) -> dict[str, Any]:
    """Verify Stitch Express when the user supplies a checkout URL directly."""
    timeout_ms = max(5_000, min(timeout_seconds * 1000, 600_000))
    started = time.monotonic()
    step = "init"
    final_url = ""
    stitch_express_is_top: bool | None = None
    first_payment_method_text: str | None = None
    stitch_meta: dict[str, Any] = {}

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            try:
                context = await browser.new_context(
                    user_agent="TheWatcherCheckout/1.0 (Shopify Stitch Express monitor)"
                )
                page = await context.new_page()
                page.set_default_timeout(timeout_ms)

                await page.goto(checkout_url, wait_until="domcontentloaded")
                step = "reached_checkout"
                final_url = page.url

                stitch = await verify_stitch_express_first(
                    page, timeout_ms=min(90_000, timeout_ms)
                )
                stitch_meta = stitch
                stitch_express_is_top = stitch.get("stitch_express_is_top")
                first_payment_method_text = stitch.get("first_payment_method_text")
                stitch_err = stitch.get("error")

                if stitch_express_is_top is None:
                    step = "stitch_not_found"
                    raise RuntimeError(stitch_err or "Could not verify Stitch Express on checkout")

                if not stitch_express_is_top:
                    step = "stitch_not_first"
                    raise RuntimeError(
                        stitch_err
                        or (
                            "Stitch Express is not the first payment method. "
                            f"Expected signature: {STITCH_EXPRESS_SIGNATURE}"
                        )
                    )

                duration_ms = int((time.monotonic() - started) * 1000)
                return _merge_stitch(
                    {
                        "status": "success",
                        "step": "stitch_first",
                        "error_message": None,
                        "final_url": final_url,
                        "duration_ms": duration_ms,
                        "stitch_express_is_top": True,
                        "first_payment_method_text": first_payment_method_text,
                    },
                    stitch_meta,
                )
            finally:
                await browser.close()
    except Exception as e:  # noqa: BLE001
        duration_ms = int((time.monotonic() - started) * 1000)
        return _merge_stitch(
            {
                "status": "failure",
                "step": step,
                "error_message": str(e)[:2000],
                "final_url": final_url,
                "duration_ms": duration_ms,
                "stitch_express_is_top": stitch_express_is_top,
                "first_payment_method_text": first_payment_method_text,
            },
            stitch_meta,
        )
