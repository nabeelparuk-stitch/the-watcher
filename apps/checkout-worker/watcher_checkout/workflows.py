"""Checkout sweep workflow (Temporal)."""

from __future__ import annotations

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy


@workflow.defn(name="CheckoutSweepWorkflow")
class CheckoutSweepWorkflow:
    @workflow.run
    async def run(self) -> dict:
        store_ids = await workflow.execute_activity(
            "list_checkout_store_ids",
            args=[],
            start_to_close_timeout=timedelta(seconds=60),
            retry_policy=RetryPolicy(maximum_attempts=3),
        )

        results: list[dict] = []
        for sid in store_ids:
            r = await workflow.execute_activity(
                "run_one_store_checkout",
                sid,
                start_to_close_timeout=timedelta(minutes=20),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
            results.append(r)

        return {"checked": len(results), "results": results}
