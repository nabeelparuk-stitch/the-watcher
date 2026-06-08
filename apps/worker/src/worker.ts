import path from "node:path";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";

async function run() {
  const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE ?? "default";

  const connection = await NativeConnection.connect({ address });
  const workflowsPath = path.join(__dirname, "workflows.ts");

  const worker = await Worker.create({
    workflowsPath,
    activities,
    taskQueue: "watcher-probes",
    connection,
    namespace,
  });

  await worker.run();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
