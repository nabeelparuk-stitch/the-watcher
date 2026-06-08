"""Supabase access for the checkout worker (service role)."""

from __future__ import annotations

import os
from typing import Any

from supabase import Client, create_client


def get_service_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for the checkout worker"
        )
    return create_client(url, key)


def list_enabled_checkout_store_ids(sb: Client) -> list[str]:
    """Configs with synthetic enabled, intersected with stores that are enabled."""
    q = (
        sb.table("synthetic_checkout_configs")
        .select("store_id")
        .eq("enabled", True)
        .execute()
    )
    rows = q.data or []
    store_ids = [str(r["store_id"]) for r in rows if r.get("store_id")]
    if not store_ids:
        return []

    st = (
        sb.table("stores")
        .select("id, enabled")
        .in_("id", store_ids)
        .execute()
    )
    enabled = {
        str(r["id"])
        for r in (st.data or [])
        if r.get("enabled") is not False and r.get("id") is not None
    }
    return [sid for sid in store_ids if sid in enabled]


def fetch_checkout_config(sb: Client, store_id: str) -> dict[str, Any] | None:
    q = (
        sb.table("synthetic_checkout_configs")
        .select(
            "id, store_id, organization_id, enabled, start_url, selectors, success_path_includes, timeout_seconds, stores(base_url)"
        )
        .eq("store_id", store_id)
        .eq("enabled", True)
        .limit(1)
        .execute()
    )
    rows = q.data or []
    if not rows:
        return None
    row = rows[0]
    stores = row.get("stores")
    base_url = ""
    if isinstance(stores, dict):
        base_url = str(stores.get("base_url") or "")
    row["resolved_base_url"] = base_url
    return row


def insert_checkout_run(
    sb: Client,
    *,
    store_id: str,
    organization_id: str,
    status: str,
    step: str,
    error_message: str | None,
    duration_ms: int,
    final_url: str | None,
    stitch_express_is_top: bool | None = None,
    first_payment_method_text: str | None = None,
) -> None:
    row: dict[str, Any] = {
        "store_id": store_id,
        "organization_id": organization_id,
        "status": status,
        "step": step,
        "error_message": error_message,
        "duration_ms": duration_ms,
        "final_url": final_url,
    }
    if stitch_express_is_top is not None:
        row["stitch_express_is_top"] = stitch_express_is_top
    if first_payment_method_text is not None:
        row["first_payment_method_text"] = first_payment_method_text[:2000]
    sb.table("synthetic_checkout_runs").insert(row).execute()


def fetch_store_for_checkout(sb: Client, store_id: str) -> dict[str, Any] | None:
    q = (
        sb.table("stores")
        .select("id, name, base_url, organization_id")
        .eq("id", store_id)
        .limit(1)
        .execute()
    )
    rows = q.data or []
    return rows[0] if rows else None
