"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { apiBaseUrl } from "@/lib/api";

type Channel = {
  id: string;
  name: string;
  enabled: boolean;
  organization_id: string;
};

type Rule = {
  id: string;
  store_id: string;
  notification_channel_id: string;
  failure_threshold: number;
  enabled: boolean;
};

type Store = { id: string; name: string };

export function AlertsSettingsPanel() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setMessage(null);
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setLoading(false);
      return;
    }
    const auth = { Authorization: `Bearer ${session.access_token}` };
    const base = apiBaseUrl();

    const [chRes, rRes, sRes] = await Promise.all([
      fetch(`${base}/v1/notification-channels`, { headers: auth }),
      fetch(`${base}/v1/alert-rules`, { headers: auth }),
      supabase.from("stores").select("id, name").order("name"),
    ]);

    if (!chRes.ok) {
      setMessage(`Channels: ${chRes.status}`);
    } else {
      setChannels((await chRes.json()) as Channel[]);
    }
    if (!rRes.ok) {
      setMessage((m) => (m ? `${m}; ` : "") + `Rules: ${rRes.status}`);
    } else {
      setRules((await rRes.json()) as Rule[]);
    }
    if (sRes.error) {
      setMessage((m) => (m ? `${m}; ` : "") + sRes.error.message);
    } else {
      setStores((sRes.data ?? []) as Store[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function getToken() {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  async function createChannel(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    const fd = new FormData(e.currentTarget);
    const token = await getToken();
    if (!token) return;
    const res = await fetch(`${apiBaseUrl()}/v1/notification-channels`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: String(fd.get("ch_name") ?? "").trim(),
        webhook_url: String(fd.get("webhook_url") ?? "").trim(),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setMessage(body.error ?? `Create channel failed (${res.status})`);
      return;
    }
    e.currentTarget.reset();
    await load();
  }

  async function createRule(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    const fd = new FormData(e.currentTarget);
    const token = await getToken();
    if (!token) return;
    const threshold = Number(fd.get("threshold") ?? 2);
    const res = await fetch(`${apiBaseUrl()}/v1/alert-rules`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        store_id: String(fd.get("store_id")),
        notification_channel_id: String(fd.get("channel_id")),
        failure_threshold: Number.isFinite(threshold) ? threshold : 2,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setMessage(body.error ?? `Create rule failed (${res.status})`);
      return;
    }
    await load();
  }

  async function deleteChannel(id: string) {
    const token = await getToken();
    if (!token) return;
    await fetch(`${apiBaseUrl()}/v1/notification-channels/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    await load();
  }

  async function deleteRule(id: string) {
    const token = await getToken();
    if (!token) return;
    await fetch(`${apiBaseUrl()}/v1/alert-rules/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    await load();
  }

  if (loading) {
    return <p className="muted">Loading…</p>;
  }

  return (
    <div>
      {message ? <p className="error">{message}</p> : null}

      <h2 style={{ fontSize: "1.1rem", marginTop: "1.5rem" }}>
        Slack webhooks
      </h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Incoming webhook URL from Slack (channel settings → Integrations).
      </p>
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <form onSubmit={createChannel}>
          <div className="form-field">
            <label htmlFor="ch_name">Label</label>
            <input id="ch_name" name="ch_name" required placeholder="#alerts" />
          </div>
          <div className="form-field">
            <label htmlFor="webhook_url">Webhook URL</label>
            <input
              id="webhook_url"
              name="webhook_url"
              type="url"
              required
              placeholder="https://hooks.slack.com/services/…"
            />
          </div>
          <button type="submit" className="primary">
            Add channel
          </button>
        </form>
        <ul style={{ marginTop: "1rem", paddingLeft: "1.25rem" }}>
          {channels.map((c) => (
            <li key={c.id} style={{ marginBottom: "0.35rem" }}>
              {c.name} {!c.enabled ? "(off)" : ""}
              <button
                type="button"
                style={{ marginLeft: "0.5rem", fontSize: "0.8rem" }}
                onClick={() => void deleteChannel(c.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <h2 style={{ fontSize: "1.1rem" }}>Alert rules</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        One rule per store. After this many <strong>consecutive</strong> failed
        or degraded probes, an incident opens and Slack is notified. Success
        clears the streak and resolves an open incident.
      </p>
      <div className="card">
        <form onSubmit={createRule}>
          <div className="form-field">
            <label htmlFor="store_id">Store</label>
            <select id="store_id" name="store_id" required>
              <option value="">Select…</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="channel_id">Notify via</label>
            <select id="channel_id" name="channel_id" required>
              <option value="">Select…</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="threshold">Consecutive failures</label>
            <input
              id="threshold"
              name="threshold"
              type="number"
              min={1}
              max={20}
              defaultValue={2}
            />
          </div>
          <button type="submit" className="primary">
            Save rule
          </button>
        </form>
        <ul style={{ marginTop: "1rem", paddingLeft: "1.25rem" }}>
          {rules.map((r) => (
            <li key={r.id} style={{ marginBottom: "0.35rem" }}>
              {stores.find((s) => s.id === r.store_id)?.name ?? "Store"}{" "}
              → threshold {r.failure_threshold} {!r.enabled ? "(off)" : ""}
              <button
                type="button"
                style={{ marginLeft: "0.5rem", fontSize: "0.8rem" }}
                onClick={() => void deleteRule(r.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
