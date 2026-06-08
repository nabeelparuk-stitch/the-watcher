"""Temporal activities: list stores and run one Playwright checkout."""

from __future__ import annotations

from temporalio import activity

from watcher_checkout.evaluate_checkout import evaluate_after_checkout
from watcher_checkout.playwright_flow import run_checkout_flow
from watcher_checkout.supabase_io import (
    fetch_checkout_config,
    fetch_store_for_checkout,
    get_service_client,
    insert_checkout_run,
    list_enabled_checkout_store_ids,
)


@activity.defn
async def list_checkout_store_ids() -> list[str]:
    sb = get_service_client()
    return list_enabled_checkout_store_ids(sb)


@activity.defn
async def run_one_store_checkout(store_id: str) -> dict:
    sb = get_service_client()
    cfg = fetch_checkout_config(sb, store_id)
    if not cfg:
        st_res = (
            sb.table("stores")
            .select("organization_id")
            .eq("id", store_id)
            .limit(1)
            .execute()
        )
        org_row = (st_res.data or [None])[0]
        org_id = str(org_row["organization_id"]) if org_row else None
        if org_id:
            insert_checkout_run(
                sb,
                store_id=store_id,
                organization_id=org_id,
                status="skipped",
                step="no_config",
                error_message="No enabled synthetic checkout config for this store",
                duration_ms=0,
                final_url=None,
            )
        return {"store_id": store_id, "skipped": True}

    org_id = str(cfg["organization_id"])
    stores = cfg.get("stores")
    base_url = cfg.get("resolved_base_url") or ""
    if isinstance(stores, dict):
        base_url = str(stores.get("base_url") or base_url)

    if not base_url:
        insert_checkout_run(
            sb,
            store_id=store_id,
            organization_id=org_id,
            status="failure",
            step="config",
            error_message="Store base_url missing",
            duration_ms=0,
            final_url=None,
        )
        return {"store_id": store_id, "error": "no_base_url"}

    start_url = str(cfg["start_url"])
    selectors = cfg.get("selectors") if isinstance(cfg.get("selectors"), dict) else {}
    success_path = str(cfg.get("success_path_includes") or "checkout")
    timeout_s = int(cfg.get("timeout_seconds") or 120)

    result = await run_checkout_flow(
        start_url=start_url,
        base_url=base_url,
        selectors=selectors,
        success_path_includes=success_path,
        timeout_seconds=timeout_s,
    )

    status = result["status"]
    stitch_top = result.get("stitch_express_is_top")
    first_pm = result.get("first_payment_method_text")

    insert_checkout_run(
        sb,
        store_id=store_id,
        organization_id=org_id,
        status=status,
        step=str(result["step"]),
        error_message=result.get("error_message"),
        duration_ms=int(result.get("duration_ms") or 0),
        final_url=result.get("final_url"),
        stitch_express_is_top=stitch_top if isinstance(stitch_top, bool) else None,
        first_payment_method_text=(
            str(first_pm) if isinstance(first_pm, str) and first_pm else None
        ),
    )

    store_row = fetch_store_for_checkout(sb, store_id)
    if store_row:
        await evaluate_after_checkout(
            sb,
            store_id=store_id,
            organization_id=org_id,
            store_name=str(store_row.get("name") or "Store"),
            base_url=str(store_row.get("base_url") or base_url),
            run_status=status,
            stitch_express_is_top=stitch_top if isinstance(stitch_top, bool) else None,
            error_message=result.get("error_message"),
        )

    return {"store_id": store_id, **result}
