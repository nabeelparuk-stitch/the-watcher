import type { SupabaseClient } from "@supabase/supabase-js";

type ProbeStatus = "success" | "failure" | "degraded";

function isBad(status: ProbeStatus): boolean {
  return status !== "success";
}

async function countConsecutiveBadRuns(
  supabase: SupabaseClient,
  storeId: string
): Promise<number> {
  const { data: runs, error } = await supabase
    .from("probe_runs")
    .select("status")
    .eq("store_id", storeId)
    .order("checked_at", { ascending: false })
    .limit(50);

  if (error || !runs?.length) {
    return 0;
  }

  let n = 0;
  for (const row of runs) {
    const st = row.status as ProbeStatus;
    if (!isBad(st)) break;
    n += 1;
  }
  return n;
}

async function slackNotify(
  webhookUrl: string,
  text: string
): Promise<{ ok: boolean; status: number; err?: string }> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, status: res.status, err: t.slice(0, 500) };
    }
    return { ok: true, status: res.status };
  } catch (e: unknown) {
    return {
      ok: false,
      status: 0,
      err: e instanceof Error ? e.message : String(e),
    };
  }
}

function webhookUrlFromConfig(config: unknown): string | null {
  if (!config || typeof config !== "object") return null;
  const url = (config as { webhook_url?: string }).webhook_url;
  return typeof url === "string" && url.startsWith("http") ? url : null;
}

async function logNotification(
  supabase: SupabaseClient,
  row: {
    organization_id: string;
    incident_id: string | null;
    notification_channel_id: string | null;
    event_type: "opened" | "recovered" | "test";
    delivery_status: "pending" | "sent" | "failed" | "skipped";
    provider_status: number | null;
    error_message: string | null;
    payload: Record<string, unknown>;
  }
) {
  await supabase.from("notifications").insert(row);
}

export async function evaluateAfterProbe(
  supabase: SupabaseClient,
  input: {
    storeId: string;
    organizationId: string;
    storeName: string;
    baseUrl: string;
    probeStatus: ProbeStatus;
    errorMessage: string | null;
  }
): Promise<void> {
  const {
    storeId,
    organizationId,
    storeName,
    baseUrl,
    probeStatus,
    errorMessage,
  } = input;

  if (probeStatus === "success") {
    const { data: open } = await supabase
      .from("incidents")
      .select("id")
      .eq("store_id", storeId)
      .eq("kind", "uptime")
      .eq("status", "open")
      .maybeSingle();

    if (!open) return;

    await supabase
      .from("incidents")
      .update({
        status: "resolved",
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        summary: "Probe succeeded — store responding again.",
      })
      .eq("id", open.id);

    const { data: rule } = await supabase
      .from("alert_rules")
      .select("notification_channel_id")
      .eq("store_id", storeId)
      .eq("enabled", true)
      .maybeSingle();

    const channelId = rule?.notification_channel_id ?? null;
    let webhook: string | null = null;
    if (channelId) {
      const { data: ch } = await supabase
        .from("notification_channels")
        .select("id, config, enabled")
        .eq("id", channelId)
        .maybeSingle();
      if (ch?.enabled) webhook = webhookUrlFromConfig(ch.config);
    }

    const text = `*The Watcher — recovered*\n${storeName} (${baseUrl}) is responding again.`;

    if (!webhook) {
      await logNotification(supabase, {
        organization_id: organizationId,
        incident_id: open.id,
        notification_channel_id: channelId,
        event_type: "recovered",
        delivery_status: "skipped",
        provider_status: null,
        error_message: "No Slack webhook configured or channel disabled",
        payload: { text },
      });
      return;
    }

    const result = await slackNotify(webhook, text);
    await logNotification(supabase, {
      organization_id: organizationId,
      incident_id: open.id,
      notification_channel_id: channelId,
      event_type: "recovered",
      delivery_status: result.ok ? "sent" : "failed",
      provider_status: result.status || null,
      error_message: result.err ?? null,
      payload: { text },
    });
    return;
  }

  const badCount = await countConsecutiveBadRuns(supabase, storeId);
  const { data: rule, error: ruleErr } = await supabase
    .from("alert_rules")
    .select("id, failure_threshold, notification_channel_id")
    .eq("store_id", storeId)
    .eq("enabled", true)
    .maybeSingle();

  if (ruleErr || !rule) return;
  if (badCount < rule.failure_threshold) return;

  const summary =
    errorMessage ??
    (probeStatus === "degraded" ? "Degraded probe result" : "Probe failed");

  const { data: existing } = await supabase
    .from("incidents")
    .select("id")
    .eq("store_id", storeId)
    .eq("kind", "uptime")
    .eq("status", "open")
    .maybeSingle();

  if (existing) {
    await supabase
      .from("incidents")
      .update({
        summary,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return;
  }

  const title = `${storeName} appears down`;
  const { data: incident, error: incErr } = await supabase
    .from("incidents")
    .insert({
      organization_id: organizationId,
      store_id: storeId,
      kind: "uptime",
      status: "open",
      title,
      summary,
    })
    .select("id")
    .single();

  if (incErr || !incident) {
    return;
  }

  const { data: ch } = await supabase
    .from("notification_channels")
    .select("id, config, enabled")
    .eq("id", rule.notification_channel_id)
    .maybeSingle();

  const webhook = ch?.enabled ? webhookUrlFromConfig(ch.config) : null;
  const text = `*The Watcher — incident opened*\n*${title}*\n${baseUrl}\n${summary}`;

  if (!webhook) {
    await logNotification(supabase, {
      organization_id: organizationId,
      incident_id: incident.id,
      notification_channel_id: rule.notification_channel_id,
      event_type: "opened",
      delivery_status: "skipped",
      provider_status: null,
      error_message: "Channel missing webhook_url or disabled",
      payload: { text },
    });
    return;
  }

  const result = await slackNotify(webhook, text);
  await logNotification(supabase, {
    organization_id: organizationId,
    incident_id: incident.id,
    notification_channel_id: rule.notification_channel_id,
    event_type: "opened",
    delivery_status: result.ok ? "sent" : "failed",
    provider_status: result.status || null,
    error_message: result.err ?? null,
    payload: { text },
  });
}
