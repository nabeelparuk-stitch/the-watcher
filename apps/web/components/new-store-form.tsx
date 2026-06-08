"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { apiBaseUrl } from "@/lib/api";

export function NewStoreForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://");
  const [platform, setPlatform] = useState("shopify");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setLoading(false);
      setMessage("You are not signed in.");
      router.push("/login");
      return;
    }

    let res: Response;
    try {
      res = await fetch(`${apiBaseUrl()}/v1/stores`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          base_url: baseUrl.trim(),
          platform,
        }),
      });
    } catch {
      setLoading(false);
      setMessage("Could not reach the API. Is it running?");
      return;
    }

    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      details?: unknown;
    };

    setLoading(false);
    if (!res.ok) {
      setMessage(payload.error ?? `Request failed (${res.status})`);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      <div className="form-field">
        <label htmlFor="name">Display name</label>
        <input
          id="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Shop"
        />
      </div>
      <div className="form-field">
        <label htmlFor="base_url">Store URL</label>
        <input
          id="base_url"
          required
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://example.com"
        />
      </div>
      <div className="form-field">
        <label htmlFor="platform">Platform</label>
        <select
          id="platform"
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
        >
          <option value="generic">Generic</option>
          <option value="shopify">Shopify</option>
          <option value="woocommerce">WooCommerce</option>
        </select>
      </div>
      {message ? <p className="error">{message}</p> : null}
      <div className="row-actions" style={{ marginTop: "1rem" }}>
        <button type="submit" className="primary" disabled={loading}>
          {loading ? "Saving…" : "Save store"}
        </button>
        <button type="button" onClick={() => router.push("/")}>
          Cancel
        </button>
      </div>
    </form>
  );
}
