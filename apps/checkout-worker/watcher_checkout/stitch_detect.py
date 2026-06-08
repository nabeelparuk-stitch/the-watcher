"""Detect whether Stitch Express is the first payment method on Shopify checkout."""

from __future__ import annotations

import re
from typing import Any

from playwright.async_api import Page

from watcher_checkout.checkout_advance import advance_to_payment_step

# Stitch Express labels vary by store/theme (with or without "Pay" suffix on wallet names).
STITCH_EXPRESS_SIGNATURE = (
    "Pay with Apple Pay | Google Pay | Capitec Pay | Card | BNPL"
)
STITCH_EXPRESS_SIGNATURE_ALT = (
    "Pay with Apple | Google | Capitec | Card | BNPL"
)

_PAYMENT_DETECT_JS = """
() => {
  const norm = (s) => (s || "").replace(/\\s+/g, " ").trim().toLowerCase();

  const isStitchExpress = (text) => {
    const t = norm(text);
    if (!t.includes("pay with apple")) return false;
    if (!t.includes("google")) return false;
    if (!t.includes("capitec")) return false;
    if (!t.includes("bnpl")) return false;
    return true;
  };

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0)
      return false;
    return true;
  };

  const isBillingRadio = (radio, labelText) => {
    const t = norm(labelText);
    const name = norm(radio.getAttribute("name") || "");
    if (name.includes("billing")) return true;
    if (t.includes("same as shipping")) return true;
    if (t.includes("billing address")) return true;
    if (t.includes("different address") && !t.includes("pay")) return true;
    return false;
  };

  const looksLikePaymentLabel = (text) => {
    const t = norm(text);
    if (t.length < 2 || t.length > 280) return false;
    if (isBillingRadio({ getAttribute: () => "" }, text)) return false;
    if (/pay with apple/.test(t) && /google/.test(t) && /capitec/.test(t)) return true;
    if (/^payfast$/i.test(t) || t.startsWith("payfast")) return true;
    if (/^payflex$/i.test(t) || t.startsWith("payflex")) return true;
    if (/payjustnow|pay just now/i.test(t)) return true;
    if (/^float/i.test(t) || t.includes("float:")) return true;
    if (/peach payment|peach payments/i.test(t)) return true;
    if (/^eft$/i.test(t) || t === "eft") return true;
    if (/apple pay|google pay/i.test(t)) return true;
    if (t.startsWith("pay with")) return true;
    if (/ozow|yoco|snapscan|instant eft/i.test(t)) return true;
    return false;
  };

  const isShopifyPaymentRadio = (radio) => {
    const name = norm(radio.getAttribute("name") || "");
    if (name === "basic") return true;
    const id = (radio.id || "").toLowerCase();
    return id.startsWith("basic-");
  };

  const findPaymentRoot = () => {
    for (const h of document.querySelectorAll(
      "h1, h2, h3, legend, [role='heading']"
    )) {
      const t = (h.innerText || "").trim();
      if (/^payment$/i.test(t)) {
        const section = h.closest(
          "section, fieldset, form, [class*='payment'], [data-step], [data-payment]"
        );
        if (section) return section;
      }
    }
    return (
      document.querySelector(
        '#payment, [data-checkout-payment-method-list], section[aria-label*="Payment" i], [id*="payment-method"]'
      ) || document.body
    );
  };

  const labelForPaymentRadio = (radio, root) => {
    if (!root.contains(radio)) return "";
    const id = radio.id;
    if (id) {
      const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lab) {
        const t = (lab.innerText || "").trim();
        if (t.length > 0 && t.length < 280) return t;
      }
    }
    if (radio.parentElement && radio.parentElement.tagName === "LABEL") {
      return (radio.parentElement.innerText || "").trim().slice(0, 280);
    }
    const row = radio.closest(
      '[data-radio-button-payment-method], [data-payment-method], li, [class*="payment-method"], [class*="PaymentMethod"], div[class*="payment"]'
    );
    if (row && root.contains(row)) {
      const lab = row.querySelector("label, [class*='radio__label'], [class*='label']");
      if (lab) {
        const t = (lab.innerText || "").trim();
        if (t.length > 0 && t.length < 280) return t;
      }
      const lines = (row.innerText || "")
        .split("\\n")
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        if (looksLikePaymentLabel(line)) return line;
      }
    }
    return "";
  };

  const cleanLabel = (text) => {
    const lines = (text || "").split("\\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (looksLikePaymentLabel(line))
        return line.replace(/\\s+/g, " ").trim().slice(0, 220);
    }
    return (lines[0] || text || "").replace(/\\s+/g, " ").trim().slice(0, 220);
  };

  const root = findPaymentRoot();
  const methods = [];
  const seenLabels = new Set();

  const pushMethod = (label, el) => {
    if (!label || !looksLikePaymentLabel(label)) return;
    const key = norm(label);
    if (seenLabels.has(key)) return;
    seenLabels.add(key);
    const r = (el || document.body).getBoundingClientRect();
    methods.push({
      text: label,
      top: r.top,
      left: r.left,
      isStitch: isStitchExpress(label),
    });
  };

  for (const row of root.querySelectorAll(
    '[data-radio-button-payment-method], [data-payment-method]'
  )) {
    if (!isVisible(row)) continue;
    const lines = (row.innerText || "")
      .split("\\n")
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (looksLikePaymentLabel(line)) {
        pushMethod(cleanLabel(line), row);
        break;
      }
    }
  }

  for (const radio of root.querySelectorAll(
    'input[type="radio"], [role="radio"]'
  )) {
    if (!isVisible(radio)) continue;
    const raw = labelForPaymentRadio(radio, root);
    if (!raw) continue;
    if (isBillingRadio(radio, raw)) continue;
    const label = cleanLabel(raw);
    if (!label) continue;
    if (!looksLikePaymentLabel(label) && !isShopifyPaymentRadio(radio)) continue;
    pushMethod(label, radio);
  }

  methods.sort((a, b) => a.top - b.top || a.left - b.left);

  const stitchIndex = methods.findIndex((m) => m.isStitch);
  const first = methods[0] || null;
  const payment_methods = methods.map((m, i) => ({
    position: i + 1,
    label: m.text,
    is_stitch_express: m.isStitch,
  }));

  return {
    first_payment_text: first ? first.text : null,
    stitch_express_is_top: stitchIndex === 0,
    stitch_index: stitchIndex,
    payment_method_count: methods.length,
    payment_methods,
    payment_methods_preview: payment_methods.map((m) => m.label),
  };
}
"""


def _clean_payment_label(text: str) -> str:
    if not text:
        return ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for line in lines:
        lower = line.lower()
        if any(
            k in lower
            for k in (
                "pay with",
                "payfast",
                "payflex",
                "payjust",
                "float",
                "apple",
                "google",
                "capitec",
                "bnpl",
            )
        ):
            return re.sub(r"\s+", " ", line).strip()[:220]
    return re.sub(r"\s+", " ", lines[0] if lines else text).strip()[:220]


def _build_payment_methods_list(
    raw_preview: list[Any] | None,
    *,
    stitch_index: int = -1,
) -> list[dict[str, Any]]:
    methods: list[dict[str, Any]] = []
    if not raw_preview:
        return methods
    for i, item in enumerate(raw_preview):
        if isinstance(item, dict):
            label = _clean_payment_label(str(item.get("label") or ""))
            is_stitch = bool(item.get("is_stitch_express"))
        else:
            label = _clean_payment_label(str(item))
            is_stitch = is_stitch_express_label(label)
        if not label:
            continue
        methods.append(
            {
                "position": i + 1,
                "label": label,
                "is_stitch_express": is_stitch,
            }
        )
    if stitch_index >= 0 and stitch_index < len(methods):
        for i, m in enumerate(methods):
            m["is_stitch_express"] = i == stitch_index
    return methods


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().lower()


def is_stitch_express_label(text: str) -> bool:
    t = _normalize_text(text)
    if "pay with apple" not in t:
        return False
    if "google" not in t:
        return False
    if "capitec" not in t:
        return False
    if "bnpl" not in t:
        return False
    return True


async def _wait_for_payment_methods(page: Page, *, timeout_ms: int = 20_000) -> None:
    """Wait until Shopify checkout has loaded multiple payment radios."""
    try:
        await page.wait_for_function(
            """() => {
              const norm = (s) => (s || "").replace(/\\s+/g, " ").trim().toLowerCase();
              let n = 0;
              for (const r of document.querySelectorAll('input[type="radio"]')) {
                const id = r.id;
                let t = "";
                if (id) {
                  const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
                  if (lab) t = (lab.innerText || "").trim();
                }
                if (!t) continue;
                const tl = norm(t);
                if (tl.includes("same as shipping") || tl.includes("billing address")) continue;
                if (
                  /payfast|payflex|payjust|float|peach|eft|apple pay|pay with apple|pay with|ozow|stitch/i.test(
                    tl
                  )
                )
                  n++;
              }
              return n >= 3;
            }""",
            timeout=min(timeout_ms, 25_000),
        )
    except Exception:
        pass


async def _poll_payment_detection(page: Page, *, attempts: int = 8) -> dict[str, Any]:
    """Re-scan payment methods as Shopify loads gateways asynchronously."""
    best: dict[str, Any] = {}
    best_count = 0
    last: dict[str, Any] = {}
    for _ in range(attempts):
        await _scroll_to_payment(page)
        data = await page.evaluate(_PAYMENT_DETECT_JS)
        if isinstance(data, dict):
            last = data
            count = int(data.get("payment_method_count") or 0)
            if count > best_count:
                best = data
                best_count = count
            if count >= 4:
                return data
        await page.wait_for_timeout(2000)
    return best if best_count > 0 else last


async def verify_stitch_express_first(
    page: Page, *, wait_ms: int = 8_000, timeout_ms: int = 90_000
) -> dict[str, Any]:
    """Reach payment step and return whether Stitch Express is the first option."""
    await advance_to_payment_step(page, timeout_ms=timeout_ms)
    await _scroll_to_payment(page)
    await _wait_for_payment_methods(page, timeout_ms=25_000)
    await page.wait_for_timeout(min(wait_ms, 8_000))

    try:
        await page.wait_for_load_state("networkidle", timeout=25_000)
    except Exception:
        pass

    data = await _poll_payment_detection(page, attempts=10)

    if not isinstance(data, dict):
        return _stitch_result(
            stitch_express_is_top=None,
            first_payment_method_text=None,
            stitch_index=-1,
            payment_methods=[],
            error="Payment detection returned invalid data",
        )

    count = int(data.get("payment_method_count") or 0)
    stitch_idx = int(
        data.get("stitch_index") if data.get("stitch_index") is not None else -1
    )
    methods = _build_payment_methods_list(
        data.get("payment_methods") or data.get("payment_methods_preview"),
        stitch_index=stitch_idx,
    )

    if count == 0 or stitch_idx < 0:
        # Playwright text search (handles split DOM / shadow roots)
        for pattern in (
            r"Pay with Apple \| Google \| Capitec \| Card \| BNPL",
            r"Pay with Apple Pay \| Google Pay \| Capitec Pay \| Card \| BNPL",
            r"Pay with Apple.*Google.*Capitec.*BNPL",
        ):
            loc = page.get_by_text(re.compile(pattern, re.I))
            try:
                n = await loc.count()
            except Exception:
                n = 0
            if n == 0:
                continue
            first = loc.first
            try:
                first_text = (await first.inner_text()).strip()[:500]
            except Exception:
                first_text = STITCH_EXPRESS_SIGNATURE_ALT
            all_texts: list[str] = []
            for i in range(min(n, 8)):
                try:
                    t = (await loc.nth(i).inner_text()).strip()
                    if t:
                        all_texts.append(t[:160])
                except Exception:
                    pass
            dom_methods = await _collect_payment_methods_via_dom(page)
            if dom_methods:
                is_first = dom_methods[0]["is_stitch_express"]
                return _stitch_result(
                    stitch_express_is_top=is_first,
                    first_payment_method_text=dom_methods[0]["label"],
                    stitch_index=0 if is_first else next(
                        (i for i, m in enumerate(dom_methods) if m["is_stitch_express"]),
                        -1,
                    ),
                    payment_methods=dom_methods,
                    error=None
                    if is_first
                    else (
                        "Stitch Express is not the first payment method. "
                        f"First listed: {dom_methods[0]['label'][:200]}"
                    ),
                )
            is_first = await _stitch_is_top_payment_via_dom(page)
            fallback_methods = _build_payment_methods_list(
                [_clean_payment_label(first_text)], stitch_index=0 if is_first else -1
            )
            return _stitch_result(
                stitch_express_is_top=is_first
                if is_first is not None
                else is_stitch_express_label(first_text),
                first_payment_method_text=_clean_payment_label(first_text),
                stitch_index=0 if is_first else -1,
                payment_methods=fallback_methods,
                error=None
                if (is_first or is_stitch_express_label(first_text))
                else (
                    "Stitch Express is not the first payment method. "
                    f"First visible match: {first_text[:200]}"
                ),
            )

        dom_methods = await _collect_payment_methods_via_dom(page)
        return _stitch_result(
            stitch_express_is_top=None,
            first_payment_method_text=None,
            stitch_index=-1,
            payment_methods=dom_methods,
            error=(
                "Stitch Express payment option not found on checkout. "
                f"Look for text like: {STITCH_EXPRESS_SIGNATURE_ALT!r}"
            )
            if not dom_methods
            else (
                "Stitch Express payment option not found. "
                f"Payment methods seen: {', '.join(m['label'] for m in dom_methods[:5])}"
            ),
        )

    is_top = bool(data.get("stitch_express_is_top"))
    first_text = data.get("first_payment_text")
    if not methods:
        methods = _build_payment_methods_list(
            data.get("payment_methods_preview"), stitch_index=stitch_idx
        )

    error = None
    if stitch_idx < 0:
        error = (
            "Stitch Express payment option not found on checkout. "
            f"Look for: {STITCH_EXPRESS_SIGNATURE_ALT!r}"
        )
    elif not is_top:
        top = methods[0]["label"] if methods else first_text
        error = (
            "Stitch Express is not the top payment method. "
            f"First listed: {(top or '')[:200]}"
        )

    return _stitch_result(
        stitch_express_is_top=is_top if stitch_idx >= 0 else None,
        first_payment_method_text=first_text,
        stitch_index=stitch_idx,
        payment_methods=methods,
        error=error,
    )


def _stitch_result(
    *,
    stitch_express_is_top: bool | None,
    first_payment_method_text: str | None,
    stitch_index: int,
    payment_methods: list[dict[str, Any]],
    error: str | None,
) -> dict[str, Any]:
    labels = [m["label"] for m in payment_methods]
    return {
        "stitch_express_is_top": stitch_express_is_top,
        "first_payment_method_text": first_payment_method_text,
        "stitch_index": stitch_index,
        "payment_method_count": len(payment_methods),
        "payment_methods": payment_methods,
        "payment_methods_preview": labels,
        "error": error,
    }


async def _scroll_to_payment(page: Page) -> None:
    try:
        await page.evaluate(
            """() => {
              for (const h of document.querySelectorAll("h2, h3, legend")) {
                if (/^payment$/i.test((h.innerText || "").trim())) {
                  h.scrollIntoView({ block: "start" });
                  return;
                }
              }
              window.scrollTo(0, document.body.scrollHeight * 0.5);
            }"""
        )
    except Exception:
        pass
    await page.wait_for_timeout(800)


async def _collect_payment_methods_via_dom(page: Page) -> list[dict[str, Any]]:
    await _scroll_to_payment(page)
    try:
        data = await page.evaluate(_PAYMENT_DETECT_JS)
        if isinstance(data, dict) and isinstance(data.get("payment_methods"), list):
            return data["payment_methods"]
    except Exception:
        pass
    return []


async def _stitch_is_top_payment_via_dom(page: Page) -> bool | None:
    try:
        return await page.evaluate(
            """() => {
              const norm = (s) => (s || "").replace(/\\s+/g, " ").trim().toLowerCase();
              const isStitch = (t) =>
                norm(t).includes("pay with apple") &&
                norm(t).includes("google") &&
                norm(t).includes("capitec") &&
                norm(t).includes("bnpl");
              const radios = Array.from(document.querySelectorAll('input[type="radio"]'))
                .filter((r) => {
                  const label =
                    r.closest("label")?.innerText ||
                    (r.id && document.querySelector(`label[for="${r.id}"]`)?.innerText) ||
                    "";
                  return /(pay|apple|google|capitec|payfast|payflex|float|card|bnpl)/i.test(
                    label
                  );
                })
                .map((r) => {
                  const label =
                    r.closest("label")?.innerText ||
                    (r.id && document.querySelector(`label[for="${r.id}"]`)?.innerText) ||
                    r.parentElement?.innerText ||
                    "";
                  const rect = r.getBoundingClientRect();
                  return { text: label, top: rect.top, isStitch: isStitch(label) };
                })
                .filter((x) => x.text && x.top >= 0)
                .sort((a, b) => a.top - b.top);
              if (!radios.length) return null;
              return radios[0].isStitch;
            }"""
        )
    except Exception:
        return None
