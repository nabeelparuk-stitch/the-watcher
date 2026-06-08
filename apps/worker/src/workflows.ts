import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./activities";

const { runFleetProbeOnce } = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  retry: {
    initialInterval: "10s",
    maximumAttempts: 3,
  },
});

export async function storeProbeSweepWorkflow(): Promise<void> {
  await runFleetProbeOnce();
}
