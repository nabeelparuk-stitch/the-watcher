"""On-demand checkout report for a single URL (CLI + API)."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from watcher_checkout.playwright_flow import run_checkout_flow, run_checkout_page_report
from watcher_checkout.stitch_detect import STITCH_EXPRESS_SIGNATURE


def base_url_from_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if not parsed.scheme or not parsed.netloc:
        raise ValueError("URL must include scheme and host (https://…)")
    return f"{parsed.scheme}://{parsed.netloc}"


def _is_checkout_url(url: str) -> bool:
    lower = url.lower()
    return (
        "checkout.shopify.com" in lower
        or "/checkouts/" in lower
        or lower.rstrip("/").endswith("/checkout")
    )


def _verdict(stitch_top: bool | None, status: str) -> str:
    if status != "success" and stitch_top is None:
        return "Could not complete checkout check"
    if stitch_top is True:
        return "Stitch Express is the first payment method"
    if stitch_top is False:
        return "Stitch Express is NOT the first payment method"
    return "Stitch Express was not found on checkout"


def _enrich_report(
    *,
    input_url: str,
    flow: dict[str, Any],
) -> dict[str, Any]:
    stitch_top = flow.get("stitch_express_is_top")
    status = str(flow.get("status") or "failure")
    methods_raw = flow.get("payment_methods") or flow.get("payment_methods_preview")
    payment_methods: list[Any] = []
    labels: list[str] = []
    if isinstance(methods_raw, list):
        for item in methods_raw:
            if isinstance(item, dict) and item.get("label"):
                payment_methods.append(
                    {
                        "position": item.get("position") or len(payment_methods) + 1,
                        "label": str(item["label"]),
                        "is_stitch_express": bool(item.get("is_stitch_express")),
                    }
                )
                labels.append(str(item["label"]))
            elif isinstance(item, str) and item.strip():
                payment_methods.append(
                    {
                        "position": len(payment_methods) + 1,
                        "label": item.strip(),
                        "is_stitch_express": False,
                    }
                )
                labels.append(item.strip())

    return {
        "input_url": input_url,
        "status": status,
        "verdict": _verdict(
            stitch_top if isinstance(stitch_top, bool) else None, status
        ),
        "stitch_express_is_top": stitch_top,
        "stitch_express_signature": STITCH_EXPRESS_SIGNATURE,
        "first_payment_method_text": flow.get("first_payment_method_text"),
        "payment_methods": labels,
        "payment_methods_found": payment_methods,
        "stitch_index": flow.get("stitch_index"),
        "payment_method_count": flow.get("payment_method_count"),
        "step": flow.get("step"),
        "error_message": flow.get("error_message"),
        "final_url": flow.get("final_url"),
        "product_url": flow.get("product_url"),
        "duration_ms": flow.get("duration_ms"),
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


async def run_url_report(url: str, *, timeout_seconds: int = 120) -> dict[str, Any]:
    """Run checkout monitoring for one URL and return a JSON-serializable report."""
    input_url = url.strip()
    if not input_url:
        raise ValueError("URL is required")

    base_url = base_url_from_url(input_url)

    if _is_checkout_url(input_url):
        flow = await run_checkout_page_report(
            checkout_url=input_url,
            timeout_seconds=timeout_seconds,
        )
    else:
        flow = await run_checkout_flow(
            start_url=input_url,
            base_url=base_url,
            selectors=None,
            success_path_includes="checkout",
            timeout_seconds=timeout_seconds,
        )

    return _enrich_report(input_url=input_url, flow=flow)


def main() -> None:
    if len(sys.argv) < 2:
        print(
            json.dumps({"error": "usage: python -m watcher_checkout.report <url> [timeout_seconds]"}),
            file=sys.stderr,
        )
        sys.exit(2)
    url = sys.argv[1]
    timeout = int(sys.argv[2]) if len(sys.argv) > 2 else 120
    import asyncio

    try:
        report = asyncio.run(run_url_report(url, timeout_seconds=timeout))
        print(json.dumps(report))
    except Exception as e:  # noqa: BLE001
        print(
            json.dumps(
                {
                    "input_url": url,
                    "status": "failure",
                    "verdict": "Could not complete checkout check",
                    "error_message": str(e)[:2000],
                    "checked_at": datetime.now(timezone.utc).isoformat(),
                }
            )
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
