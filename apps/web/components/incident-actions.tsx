"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { apiBaseUrl } from "@/lib/api";

type Props = {
  incidentId: string;
  status: string;
};

export function IncidentActions({ incidentId, status }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function patch(next: "acknowledged" | "resolved") {
    setMessage(null);
    setLoading(next);
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setLoading(null);
      router.push("/login");
      return;
    }
    let res: Response;
    try {
      res = await fetch(`${apiBaseUrl()}/v1/incidents/${incidentId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: next }),
      });
    } catch {
      setLoading(null);
      setMessage("Could not reach the API.");
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setLoading(null);
    if (!res.ok) {
      setMessage(body.error ?? `Failed (${res.status})`);
      return;
    }
    router.refresh();
  }

  if (status !== "open") {
    return <span className="muted">{status}</span>;
  }

  return (
    <div>
      <div className="row-actions" style={{ marginTop: "0.25rem" }}>
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => patch("acknowledged")}
        >
          {loading === "acknowledged" ? "…" : "Acknowledge"}
        </button>
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => patch("resolved")}
        >
          {loading === "resolved" ? "…" : "Resolve"}
        </button>
      </div>
      {message ? <p className="error" style={{ marginTop: "0.35rem" }}>{message}</p> : null}
    </div>
  );
}
