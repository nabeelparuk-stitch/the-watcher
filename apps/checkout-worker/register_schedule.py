"""Create a Temporal schedule for CheckoutSweepWorkflow (idempotent)."""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import timedelta

from dotenv import load_dotenv
from temporalio.client import (
    Client,
    Schedule,
    ScheduleActionStartWorkflow,
    ScheduleIntervalSpec,
    ScheduleSpec,
)


async def _main() -> None:
    load_dotenv()
    address = os.environ.get("TEMPORAL_ADDRESS", "127.0.0.1:7233")
    namespace = os.environ.get("TEMPORAL_NAMESPACE", "default")
    schedule_id = os.environ.get("CHECKOUT_SCHEDULE_ID", "checkout-sweep")
    task_queue = os.environ.get("CHECKOUT_TASK_QUEUE", "watcher-checkout")
    hours = float(os.environ.get("CHECKOUT_SCHEDULE_HOURS", "6"))
    every = max(0.25, hours)
    interval_seconds = int(every * 3600)

    client = await Client.connect(address, namespace=namespace)
    handle = client.get_schedule_handle(schedule_id)

    action = ScheduleActionStartWorkflow(
        "CheckoutSweepWorkflow",
        args=[],
        task_queue=task_queue,
    )
    spec = ScheduleSpec(
        intervals=[ScheduleIntervalSpec(every=timedelta(seconds=interval_seconds))]
    )

    try:
        await handle.describe()
    except Exception:
        await client.create_schedule(
            schedule_id, Schedule(action=action, spec=spec)
        )
        print(
            f'Created schedule "{schedule_id}" (every {every}h). '
            f"Worker task queue: {task_queue}."
        )
    else:
        print(
            f'Schedule "{schedule_id}" already exists. '
            f"Delete it in Temporal UI/CLI to recreate with new timing."
        )


if __name__ == "__main__":
    try:
        asyncio.run(_main())
    except Exception as e:  # noqa: BLE001
        print(e, file=sys.stderr)
        sys.exit(1)
