"""Advance Shopify checkout until the Payment step (radio methods) is visible."""

from __future__ import annotations

import re

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

_PAYMENT_VISIBLE_JS = """
() => {
  const norm = (s) => (s || "").replace(/\\s+/g, " ").trim().toLowerCase();
  const body = norm(document.body.innerText || "");
  if (!body.includes("payment")) return false;
  const stitchLike = (t) =>
    norm(t).includes("pay with apple") &&
    norm(t).includes("google") &&
    norm(t).includes("capitec") &&
    norm(t).includes("bnpl");
  for (const el of document.querySelectorAll("label, [role='radio'], div, span, p")) {
    const t = el.innerText || "";
    if (t.length > 12 && t.length < 400 && stitchLike(t)) {
      const r = el.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) return true;
    }
  }
  const radios = document.querySelectorAll('input[type="radio"]');
  let paymentRadios = 0;
  for (const r of radios) {
    const label =
      r.closest("label")?.innerText ||
      (r.id && document.querySelector(`label[for="${r.id}"]`)?.innerText) ||
      r.parentElement?.innerText ||
      "";
    if (/(payfast|payflex|payjust|float|apple|google|capitec|card|bnpl|payment)/i.test(label))
      paymentRadios++;
  }
  return paymentRadios >= 2;
}
"""

_FILL_CONTACT_JS = """
() => {
  const setVal = (el, val) => {
    if (!el || el.disabled) return false;
    if (el.value && String(el.value).trim()) return false;
    el.focus();
    el.value = val;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };
  const q = (sel) => document.querySelector(sel);
  let n = 0;
  const email = q('input[type="email"], input[name*="email" i], #email');
  if (setVal(email, "watcher.checkout@testmail.com")) n++;
  const first = q(
    'input[name*="firstName" i], input[name*="first_name" i], input[autocomplete="given-name"]'
  );
  if (setVal(first, "Test")) n++;
  const last = q(
    'input[name*="lastName" i], input[name*="last_name" i], input[autocomplete="family-name"]'
  );
  if (setVal(last, "User")) n++;
  const addr = q(
    'input[name*="address1" i], input[name*="address_1" i], input[autocomplete="address-line1"]'
  );
  if (setVal(addr, "1 Main Road")) n++;
  const city = q('input[name*="city" i], input[autocomplete="address-level2"]');
  if (setVal(city, "Cape Town")) n++;
  const zip = q(
    'input[name*="postal" i], input[name*="zip" i], input[autocomplete="postal-code"]'
  );
  if (setVal(zip, "8001")) n++;
  const phone = q('input[type="tel"], input[name*="phone" i]');
  if (setVal(phone, "0821234567")) n++;
  return n;
}
"""


async def _payment_step_visible(page: Page) -> bool:
    try:
        return bool(await page.evaluate(_PAYMENT_VISIBLE_JS))
    except Exception:
        return False


async def _scroll_to_payment(page: Page) -> None:
    try:
        await page.evaluate(
            """() => {
              const headings = Array.from(document.querySelectorAll("h2, h3, legend, [role='heading']"));
              const pay = headings.find((h) =>
                /^payment$/i.test((h.innerText || "").trim())
              );
              if (pay) pay.scrollIntoView({ block: "center" });
              else window.scrollTo(0, document.body.scrollHeight * 0.55);
            }"""
        )
    except Exception:
        pass
    await page.wait_for_timeout(800)


async def _click_continue(page: Page) -> bool:
    patterns = [
        re.compile(r"continue to payment", re.I),
        re.compile(r"continue to shipping", re.I),
        re.compile(r"^continue$", re.I),
        re.compile(r"pay now", re.I),
    ]
    for pat in patterns:
        try:
            btn = page.get_by_role("button", name=pat)
            if await btn.count() > 0:
                b = btn.first
                if await b.is_visible():
                    await b.click(timeout=8_000)
                    await page.wait_for_timeout(1500)
                    return True
        except PlaywrightTimeoutError:
            continue
    try:
        clicked = await page.evaluate(
            """() => {
              for (const b of document.querySelectorAll("button, [role='button']")) {
                const t = (b.innerText || "").trim().toLowerCase();
                if (!t) continue;
                if (
                  t === "continue" ||
                  t.includes("continue to") ||
                  t.includes("complete order")
                ) {
                  if (b.disabled) continue;
                  b.click();
                  return true;
                }
              }
              return false;
            }"""
        )
        if clicked:
            await page.wait_for_timeout(1500)
            return True
    except Exception:
        pass
    return False


async def advance_to_payment_step(page: Page, *, timeout_ms: int = 60_000) -> None:
    """
    Fill guest checkout fields and continue until payment method radios are shown
    (the screen with Pay with Apple | Google | Capitec | Card | BNPL).
    """
    try:
        await page.wait_for_load_state("domcontentloaded", timeout=min(20_000, timeout_ms))
    except PlaywrightTimeoutError:
        pass

    await page.wait_for_timeout(2000)

    if await _payment_step_visible(page):
        await _scroll_to_payment(page)
        return

    await page.evaluate(_FILL_CONTACT_JS)
    await page.wait_for_timeout(1200)

    # Country select (often required before payment methods appear)
    try:
        country = page.locator(
            'select[name*="country" i], select[autocomplete="country"]'
        ).first
        if await country.count() > 0:
            for code in ("ZA", "US", "GB"):
                try:
                    await country.select_option(value=code, timeout=3_000)
                    await page.wait_for_timeout(800)
                    break
                except PlaywrightTimeoutError:
                    continue
    except PlaywrightTimeoutError:
        pass

    await page.evaluate(_FILL_CONTACT_JS)
    await page.wait_for_timeout(800)

    for _ in range(6):
        if await _payment_step_visible(page):
            await _scroll_to_payment(page)
            return
        await _click_continue(page)
        await page.wait_for_timeout(2000)
        if await _payment_step_visible(page):
            await _scroll_to_payment(page)
            return

    await _scroll_to_payment(page)
    await page.wait_for_timeout(1500)
