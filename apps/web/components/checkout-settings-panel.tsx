"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { apiBaseUrl } from "@/lib/api";

type Config = {
  id: string;
  store_id: string;
  enabled: boolean;
  start_url: string;
  success_path_includes: string;
  timeout_seconds: number;
  selectors: Record<string, unknown>;
};

type Store = { id: string; name: string };

export function CheckoutSettingsPanel() {
  const [configs, setConfigs] = useState<Config[]>([]);
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

    const [cfgRes, sRes] = await Promise.all([
      fetch(`${base}/v1/synthetic-checkout-configs`, { headers: auth }),
      supabase.from("stores").select("id, name").order("name"),
    ]);

    if (!cfgRes.ok) {
      setMessage(`Configs: ${cfgRes.status}`);
    } else {
      setConfigs((await cfgRes.json()) as Config[]);
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

  async function createConfig(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    const fd = new FormData(e.currentTarget);
    const token = await getToken();
    if (!token) return;

    let selectors: Record<string, unknown> | undefined;
    const rawSel = String(fd.get("selectors_json") ?? "").trim();
    if (rawSel) {
      try {
        selectors = JSON.parse(rawSel) as Record<string, unknown>;
      } catch {
        setMessage("Selectors must be valid JSON.");
        return;
      }
    }

    const res = await fetch(`${apiBaseUrl()}/v1/synthetic-checkout-configs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        store_id: String(fd.get("store_id")),
        start_url: String(fd.get("start_url")).trim(),
        enabled: fd.get("enabled") === "on",
        success_path_includes:
          String(fd.get("success_path_includes") ?? "checkout").trim() ||
          "checkout",
        timeout_seconds: Number(fd.get("timeout_seconds") ?? 120),
        selectors,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setMessage(body.error ?? `Create failed (${res.status})`);
      return;
    }
    e.currentTarget.reset();
    await load();
  }

  async function deleteConfig(id: string) {
    const token = await getToken();
    if (!token) return;
    await fetch(`${apiBaseUrl()}/v1/synthetic-checkout-configs/${id}`, {
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

      <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>Shopify checkout monitor</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Playwright opens a Shopify product (<code>start_url</code>), adds to cart,
        and opens checkout. It verifies <strong>Stitch Express</strong> is the
        first payment method (text: Pay with Apple Pay | Google Pay | Capitec Pay
        | Card | BNPL). Use <code>selectors.addToCart</code> /{" "}
        <code>selectors.checkoutLink</code> if autodetection fails.
      </p>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <form onSubmit={createConfig}>
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
            <label htmlFor="start_url">Start URL (product page)</label>
            <input
              id="start_url"
              name="start_url"
              type="url"
              required
              placeholder="https://shop.example/products/test-item"
            />
          </div>
          <div className="form-field">
            <label htmlFor="success_path_includes">Success substring</label>
            <input
              id="success_path_includes"
              name="success_path_includes"
              defaultValue="checkout"
              placeholder="checkout"
            />
            <span className="muted" style={{ fontSize: "0.75rem" }}>
              Asserted against final URL / page text.
            </span>
          </div>
          <div className="form-field">
            <label htmlFor="timeout_seconds">Timeout (seconds)</label>
            <input
              id="timeout_seconds"
              name="timeout_seconds"
              type="number"
              min={30}
              max={600}
              defaultValue={120}
            />
          </div>
          <div className="form-field">
            <label
              htmlFor="enabled"
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <input
                id="enabled"
                name="enabled"
                type="checkbox"
                defaultChecked
                style={{ width: "auto" }}
              />
              Enabled for Temporal checkout worker
            </label>
          </div>
          <div className="form-field">
            <label htmlFor="selectors_json">Selectors JSON (optional)</label>
            <textarea
              id="selectors_json"
              name="selectors_json"
              rows={4}
              placeholder='{"addToCart": "[data-add-to-cart]", "checkoutLink": "a[href*=\\"checkout\\"]"}'
              style={{
                width: "100%",
                fontFamily: "monospace",
                fontSize: "0.85rem",
              }}
            />
          </div>
          <button type="submit" className="primary">
            Save config
          </button>
        </form>
      </div>

      <h2 style={{ fontSize: "1.1rem" }}>Existing configs</h2>
      <ul style={{ paddingLeft: "1.25rem" }}>
        {configs.length === 0 ? (
          <li className="muted">None yet.</li>
        ) : (
          configs.map((c) => (
            <li key={c.id} style={{ marginBottom: "0.75rem" }}>
              <strong>{stores.find((s) => s.id === c.store_id)?.name ?? "Store"}</strong>{" "}
              {!c.enabled ? <span className="muted">(off)</span> : null}
              <div
                className="muted"
                style={{ fontSize: "0.8rem", wordBreak: "break-all" }}
              >
                {c.start_url}
              </div>
              <button
                type="button"
                style={{ marginTop: "0.35rem", fontSize: "0.8rem" }}
                onClick={() => void deleteConfig(c.id)}
              >
                Remove
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
