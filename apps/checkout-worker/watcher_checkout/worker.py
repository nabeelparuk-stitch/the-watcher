"""Run the Temporal checkout worker."""

from __future__ import annotations

import asyncio
import os

from dotenv import load_dotenv
from temporalio.client import Client
from temporalio.worker import Worker

from watcher_checkout.activities import (
    list_checkout_store_ids,
    run_one_store_checkout,
)
from watcher_checkout.workflows import CheckoutSweepWorkflow


async def _run() -> None:
    load_dotenv()
    address = os.environ.get("TEMPORAL_ADDRESS", "127.0.0.1:7233")
    namespace = os.environ.get("TEMPORAL_NAMESPACE", "default")
    task_queue = os.environ.get("CHECKOUT_TASK_QUEUE", "watcher-checkout")

    client = await Client.connect(address, namespace=namespace)
    worker = Worker(
        client,
        task_queue=task_queue,
        workflows=[CheckoutSweepWorkflow],
        activities=[list_checkout_store_ids, run_one_store_checkout],
    )
    await worker.run()


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
