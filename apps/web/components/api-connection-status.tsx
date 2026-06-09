"use client";

import { useEffect, useState } from "react";

type Health = {
  ok: boolean;
  apiUrl?: string;
  error?: string;
  status?: number;
};

export function ApiConnectionStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/backend-health");
        const data = (await res.json()) as Health;
        if (!cancelled) setHealth(data);
      } catch {
        if (!cancelled) {
          setHealth({
            ok: false,
            error: "Could not run API health check from this deployment.",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <p className="muted" style={{ fontSize: "0.85rem", margin: "0 0 1rem" }}>
        Checking API connection…
      </p>
    );
  }

  if (!health) return null;

  if (health.ok) {
    return (
      <p
        style={{
          fontSize: "0.85rem",
          margin: "0 0 1rem",
          color: "var(--success)",
        }}
      >
        API connected
        {health.apiUrl ? (
          <span className="muted" style={{ display: "block", fontSize: "0.8rem" }}>
            {health.apiUrl}
          </span>
        ) : null}
      </p>
    );
  }

  return (
    <div
      className="card"
      style={{
        marginBottom: "1rem",
        borderColor: "var(--danger)",
        fontSize: "0.85rem",
      }}
    >
      <p style={{ margin: "0 0 0.35rem", fontWeight: 600, color: "var(--danger)" }}>
        API not reachable — reports will fail
      </p>
      <p className="muted" style={{ margin: 0 }}>
        {health.error}
      </p>
      {health.apiUrl ? (
        <p className="muted" style={{ margin: "0.5rem 0 0", wordBreak: "break-all" }}>
          Configured API: {health.apiUrl}
        </p>
      ) : null}
      <p className="muted" style={{ margin: "0.5rem 0 0" }}>
        Deploy the API on Railway (see docs/DEPLOY.md), set{" "}
        <code>NEXT_PUBLIC_API_URL</code> on Vercel, set{" "}
        <code>CORS_ALLOW_ALL=true</code> on the API, then redeploy both.
      </p>
    </div>
  );
}
