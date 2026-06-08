import {
  Client,
  Connection,
  ScheduleOverlapPolicy,
} from "@temporalio/client";

async function main() {
  const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE ?? "default";
  const scheduleId =
    process.env.TEMPORAL_SCHEDULE_ID ?? "fleet-probe-sweep";

  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });

  try {
    await client.schedule.getHandle(scheduleId).describe();
    console.log(`Schedule "${scheduleId}" already exists.`);
    return;
  } catch {
    /* not found — create */
  }

  await client.schedule.create({
    scheduleId,
    spec: {
      intervals: [{ every: "30m" }],
    },
    action: {
      type: "startWorkflow",
      workflowType: "storeProbeSweepWorkflow",
      taskQueue: "watcher-probes",
      args: [],
    },
    policies: {
      overlap: ScheduleOverlapPolicy.SKIP,
    },
  });

  console.log(
    `Created schedule "${scheduleId}" (every 30m). Start the worker with task queue watcher-probes.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
