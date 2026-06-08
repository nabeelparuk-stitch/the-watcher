"""Open or resolve Stitch Express checkout incidents after a synthetic run."""

from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

from supabase import Client


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _webhook_url_from_config(config: Any) -> str | None:
    if not config or not isinstance(config, dict):
        return None
    url = config.get("webhook_url")
    return url if isinstance(url, str) and url.startswith("http") else None


def _slack_notify_sync(webhook_url: str, text: str) -> dict[str, Any]:
    body = json.dumps({"text": text}).encode("utf-8")
    req = urllib.request.Request(
        webhook_url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return {"ok": True, "status": res.status}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")[:500]
        return {"ok": False, "status": e.code, "err": err_body}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "status": 0, "err": str(e)[:500]}


async def _slack_notify(webhook_url: str, text: str) -> dict[str, Any]:
    return await asyncio.to_thread(_slack_notify_sync, webhook_url, text)


def _log_notification(
    sb: Client,
    *,
    organization_id: str,
    incident_id: str | None,
    notification_channel_id: str | None,
    event_type: str,
    delivery_status: str,
    provider_status: int | None,
    error_message: str | None,
    payload: dict[str, Any],
) -> None:
    sb.table("notifications").insert(
        {
            "organization_id": organization_id,
            "incident_id": incident_id,
            "notification_channel_id": notification_channel_id,
            "event_type": event_type,
            "delivery_status": delivery_status,
            "provider_status": provider_status,
            "error_message": error_message,
            "payload": payload,
        }
    ).execute()


async def evaluate_after_checkout(
    sb: Client,
    *,
    store_id: str,
    organization_id: str,
    store_name: str,
    base_url: str,
    run_status: str,
    stitch_express_is_top: bool | None,
    error_message: str | None,
) -> None:
    """Flag when Stitch Express is not first; resolve when check passes."""
    if run_status == "skipped":
        return

    stitch_ok = run_status == "success" and stitch_express_is_top is True

    if stitch_ok:
        open_q = (
            sb.table("incidents")
            .select("id")
            .eq("store_id", store_id)
            .eq("kind", "stitch_checkout")
            .eq("status", "open")
            .limit(1)
            .execute()
        )
        rows = open_q.data or []
        if not rows:
            return
        incident_id = str(rows[0]["id"])

        sb.table("incidents").update(
            {
                "status": "resolved",
                "closed_at": _utc_now_iso(),
                "updated_at": _utc_now_iso(),
                "summary": "Stitch Express is the first payment method again.",
            }
        ).eq("id", incident_id).execute()

        rule = (
            sb.table("alert_rules")
            .select("notification_channel_id")
            .eq("store_id", store_id)
            .eq("enabled", True)
            .limit(1)
            .execute()
        )
        rule_rows = rule.data or []
        channel_id = (
            str(rule_rows[0]["notification_channel_id"]) if rule_rows else None
        )
        webhook = None
        if channel_id:
            ch = (
                sb.table("notification_channels")
                .select("id, config, enabled")
                .eq("id", channel_id)
                .limit(1)
                .execute()
            )
            ch_rows = ch.data or []
            if ch_rows and ch_rows[0].get("enabled"):
                webhook = _webhook_url_from_config(ch_rows[0].get("config"))

        text = (
            f"*The Watcher — Stitch Express recovered*\n"
            f"{store_name} ({base_url}): Stitch Express is the top payment method."
        )
        if not webhook:
            _log_notification(
                sb,
                organization_id=organization_id,
                incident_id=incident_id,
                notification_channel_id=channel_id,
                event_type="recovered",
                delivery_status="skipped",
                provider_status=None,
                error_message="No Slack webhook configured or channel disabled",
                payload={"text": text},
            )
            return

        result = await _slack_notify(webhook, text)
        _log_notification(
            sb,
            organization_id=organization_id,
            incident_id=incident_id,
            notification_channel_id=channel_id,
            event_type="recovered",
            delivery_status="sent" if result.get("ok") else "failed",
            provider_status=result.get("status") or None,
            error_message=result.get("err"),
            payload={"text": text},
        )
        return

    if stitch_express_is_top is not False and run_status != "failure":
        return

    summary = error_message or "Stitch Express is not the first payment method on checkout"

    existing = (
        sb.table("incidents")
        .select("id")
        .eq("store_id", store_id)
        .eq("kind", "stitch_checkout")
        .eq("status", "open")
        .limit(1)
        .execute()
    )
    existing_rows = existing.data or []
    if existing_rows:
        sb.table("incidents").update(
            {"summary": summary, "updated_at": _utc_now_iso()}
        ).eq("id", existing_rows[0]["id"]).execute()
        return

    title = f"{store_name}: Stitch Express not first on checkout"
    inc = (
        sb.table("incidents")
        .insert(
            {
                "organization_id": organization_id,
                "store_id": store_id,
                "kind": "stitch_checkout",
                "status": "open",
                "title": title,
                "summary": summary,
            }
        )
        .select("id")
        .execute()
    )
    inc_rows = inc.data or []
    if not inc_rows:
        return
    incident_id = str(inc_rows[0]["id"])

    rule = (
        sb.table("alert_rules")
        .select("notification_channel_id")
        .eq("store_id", store_id)
        .eq("enabled", True)
        .limit(1)
        .execute()
    )
    rule_rows = rule.data or []
    if not rule_rows:
        return
    channel_id = str(rule_rows[0]["notification_channel_id"])

    ch = (
        sb.table("notification_channels")
        .select("id, config, enabled")
        .eq("id", channel_id)
        .limit(1)
        .execute()
    )
    ch_rows = ch.data or []
    webhook = (
        _webhook_url_from_config(ch_rows[0].get("config"))
        if ch_rows and ch_rows[0].get("enabled")
        else None
    )
    text = f"*The Watcher — Stitch Express*\n*{title}*\n{base_url}\n{summary}"

    if not webhook:
        _log_notification(
            sb,
            organization_id=organization_id,
            incident_id=incident_id,
            notification_channel_id=channel_id,
            event_type="opened",
            delivery_status="skipped",
            provider_status=None,
            error_message="Channel missing webhook_url or disabled",
            payload={"text": text},
        )
        return

    result = await _slack_notify(webhook, text)
    _log_notification(
        sb,
        organization_id=organization_id,
        incident_id=incident_id,
        notification_channel_id=channel_id,
        event_type="opened",
        delivery_status="sent" if result.get("ok") else "failed",
        provider_status=result.get("status") or None,
        error_message=result.get("err"),
        payload={"text": text},
    )
