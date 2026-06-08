import { createClient } from "@supabase/supabase-js";
import { evaluateAfterProbe } from "./evaluateProbe.js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for worker"
    );
  }
  return createClient(url, key);
}

export async function runFleetProbeOnce(): Promise<{ probed: number }> {
  const supabase = getSupabase();
  const { data: stores, error } = await supabase
    .from("stores")
    .select("id, base_url, enabled, organization_id, name")
    .eq("enabled", true);

  if (error) {
    throw error;
  }

  const region = process.env.PROBE_REGION ?? "default";
  let probed = 0;

  for (const store of stores ?? []) {
    const start = Date.now();
    let probeStatus: "success" | "failure" | "degraded" = "failure";
    let errorMessage: string | null = null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(store.base_url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "TheWatcher/1.0 (+https://github.com)",
          Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        },
      });
      clearTimeout(timeout);
      const durationMs = Date.now() - start;
      const ok = res.ok;
      probeStatus = ok
        ? "success"
        : res.status >= 500
          ? "failure"
          : "degraded";
      errorMessage = ok ? null : `HTTP ${res.status}`;

      const { error: insertError } = await supabase.from("probe_runs").insert({
        store_id: store.id,
        region,
        status: probeStatus,
        http_status: res.status,
        duration_ms: durationMs,
        error_message: errorMessage,
      });

      if (insertError) {
        throw insertError;
      }
      probed += 1;
    } catch (e: unknown) {
      const durationMs = Date.now() - start;
      const message = e instanceof Error ? e.message : String(e);
      probeStatus = "failure";
      errorMessage = message;
      const { error: insertError } = await supabase.from("probe_runs").insert({
        store_id: store.id,
        region,
        status: "failure",
        http_status: null,
        duration_ms: durationMs,
        error_message: message,
      });
      if (insertError) {
        throw insertError;
      }
      probed += 1;
    }

    await evaluateAfterProbe(supabase, {
      storeId: store.id,
      organizationId: store.organization_id,
      storeName: store.name,
      baseUrl: store.base_url,
      probeStatus,
      errorMessage,
    });
  }

  return { probed };
}
