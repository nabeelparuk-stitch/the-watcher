import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type FleetRow = {
  store_id: string;
  organization_id: string;
  store_name: string;
  platform: string;
  base_url: string;
  enabled: boolean;
  last_checked_at: string | null;
  last_status: string | null;
  last_http_status: number | null;
  last_duration_ms: number | null;
  last_error: string | null;
  last_region: string | null;
  open_incident_id: string | null;
  open_incident_status: string | null;
  open_incident_opened_at: string | null;
  open_incident_title: string | null;
  last_synthetic_status: string | null;
  last_synthetic_step: string | null;
  last_synthetic_error: string | null;
  last_synthetic_at: string | null;
  last_synthetic_final_url: string | null;
  last_stitch_express_is_top: boolean | null;
  last_first_payment_method_text: string | null;
  open_stitch_incident_id: string | null;
  open_stitch_incident_title: string | null;
  open_stitch_incident_opened_at: string | null;
};

function stitchLabel(isTop: boolean | null, step: string | null) {
  if (isTop === true) return "First";
  if (isTop === false) return "Not first";
  if (step === "stitch_not_found") return "Not found";
  return "—";
}

function statusClass(status: string | null) {
  if (!status) return "status-none";
  if (status === "success") return "status-success";
  if (status === "failure") return "status-failure";
  return "status-degraded";
}

export default async function FleetPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/fleet");
  }

  const { data: rows, error } = await supabase
    .from("fleet_status")
    .select("*")
    .order("store_name", { ascending: true });

  if (error) {
    return (
      <div className="card">
        <p className="error">Could not load fleet: {error.message}</p>
        <p className="muted">
          Confirm migrations are applied and RLS grants include{" "}
          <code>fleet_status</code>.
        </p>
      </div>
    );
  }

  const fleet = (rows ?? []) as FleetRow[];

  return (
    <div>
      <h1 style={{ margin: "0 0 0.25rem", fontSize: "1.5rem" }}>Fleet</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Scheduled monitoring for your stores (optional; requires sign-in).
      </p>
      <p className="row-actions" style={{ marginBottom: "1rem" }}>
        <Link href="/">Check a URL</Link>
        <Link href="/incidents">Incidents</Link>
        <Link href="/settings/alerts">Alert settings</Link>
        <Link href="/settings/checkout">Checkout</Link>
      </p>

      {fleet.length === 0 ? (
        <div className="card">
          <p>No stores yet.</p>
          <p className="muted">
            Add a Shopify store and configure a product URL under Checkout settings.
            The checkout worker will verify Stitch Express is listed first.
          </p>
          <p style={{ marginTop: "1rem" }}>
            <Link href="/stores/new" className="btn primary">
              Add your first store
            </Link>
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Store</th>
                <th>Platform</th>
                <th>URL</th>
                <th>Last check</th>
                <th>Details</th>
                <th>Uptime</th>
                <th>Stitch Express</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {fleet.map((row) => (
                <tr key={row.store_id}>
                  <td>
                    <span
                      className={`status-dot ${statusClass(row.last_status)}`}
                      title={row.last_status ?? "no data"}
                    />
                    {row.last_status ?? "—"}
                  </td>
                  <td>
                    <strong>{row.store_name}</strong>
                    {!row.enabled && (
                      <span className="muted"> (paused)</span>
                    )}
                  </td>
                  <td>{row.platform}</td>
                  <td style={{ wordBreak: "break-all" }}>{row.base_url}</td>
                  <td className="muted">
                    {row.last_checked_at
                      ? new Date(row.last_checked_at).toLocaleString()
                      : "—"}
                    {row.last_region ? (
                      <div style={{ fontSize: "0.75rem" }}>
                        region: {row.last_region}
                      </div>
                    ) : null}
                  </td>
                  <td className="muted">
                    {row.last_http_status != null
                      ? `HTTP ${row.last_http_status}`
                      : "—"}
                    {row.last_duration_ms != null ? (
                      <div style={{ fontSize: "0.75rem" }}>
                        {row.last_duration_ms} ms
                      </div>
                    ) : null}
                    {row.last_error ? (
                      <div className="error" style={{ marginTop: "0.35rem" }}>
                        {row.last_error}
                      </div>
                    ) : null}
                  </td>
                  <td className="muted">
                    {row.open_incident_id ? (
                      <>
                        <span className="error">{row.open_incident_title}</span>
                        <div style={{ fontSize: "0.75rem" }}>
                          {row.open_incident_opened_at
                            ? new Date(
                                row.open_incident_opened_at
                              ).toLocaleString()
                            : ""}
                        </div>
                        <Link href="/incidents">View</Link>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="muted">
                    {row.open_stitch_incident_id ? (
                      <>
                        <span className="error">
                          {row.open_stitch_incident_title}
                        </span>
                        <div style={{ fontSize: "0.75rem" }}>
                          {row.open_stitch_incident_opened_at
                            ? new Date(
                                row.open_stitch_incident_opened_at
                              ).toLocaleString()
                            : ""}
                        </div>
                        <Link href="/incidents">View</Link>
                      </>
                    ) : row.last_synthetic_at ? (
                      <>
                        <span
                          className={
                            row.last_stitch_express_is_top === true
                              ? ""
                              : "error"
                          }
                        >
                          {stitchLabel(
                            row.last_stitch_express_is_top,
                            row.last_synthetic_step
                          )}
                        </span>
                        <div style={{ fontSize: "0.75rem" }}>
                          {row.last_synthetic_step}
                        </div>
                        <div style={{ fontSize: "0.72rem" }}>
                          {new Date(row.last_synthetic_at).toLocaleString()}
                        </div>
                        {row.last_first_payment_method_text ? (
                          <div
                            className="muted"
                            style={{ fontSize: "0.72rem", marginTop: "0.25rem" }}
                          >
                            Top:{" "}
                            {row.last_first_payment_method_text.slice(0, 80)}
                            {row.last_first_payment_method_text.length > 80
                              ? "…"
                              : ""}
                          </div>
                        ) : null}
                        {row.last_synthetic_error ? (
                          <div className="error" style={{ marginTop: "0.25rem" }}>
                            {row.last_synthetic_error.slice(0, 120)}
                            {row.last_synthetic_error.length > 120 ? "…" : ""}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <Link href={`/stores/${row.store_id}/edit`}>Edit</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
