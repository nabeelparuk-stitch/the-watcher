import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { IncidentActions } from "@/components/incident-actions";

type StoreEmbed = { name: string; base_url: string } | null;

type IncidentRow = {
  id: string;
  store_id: string;
  kind: string;
  status: string;
  title: string;
  summary: string | null;
  opened_at: string;
  closed_at: string | null;
  acknowledged_at: string | null;
  stores: StoreEmbed | StoreEmbed[] | null;
};

function storeLabel(row: IncidentRow): string {
  const s = row.stores;
  if (!s) return "Store";
  if (Array.isArray(s)) {
    const x = s[0];
    return x ? `${x.name}` : "Store";
  }
  return `${s.name}`;
}

function storeUrl(row: IncidentRow): string | null {
  const s = row.stores;
  if (!s) return null;
  if (Array.isArray(s)) {
    const x = s[0];
    return x?.base_url ?? null;
  }
  return s.base_url;
}

export default async function IncidentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: rows, error } = await supabase
    .from("incidents")
    .select(
      `
      id,
      store_id,
      kind,
      status,
      title,
      summary,
      opened_at,
      closed_at,
      acknowledged_at,
      stores ( name, base_url )
    `
    )
    .order("opened_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <div className="card">
        <p className="error">{error.message}</p>
        <p className="muted">Apply latest Supabase migrations.</p>
      </div>
    );
  }

  const incidents = (rows ?? []) as IncidentRow[];

  return (
    <div>
      <h1 style={{ margin: "0 0 0.25rem", fontSize: "1.5rem" }}>Incidents</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Uptime incidents open when HTTP probes fail; Stitch Express incidents open
        when checkout monitoring finds Stitch is not the first payment method.
      </p>
      <p className="row-actions">
        <Link href="/settings/alerts">Alert settings</Link>
        <Link href="/">Fleet</Link>
      </p>

      {incidents.length === 0 ? (
        <div className="card">
          <p>No incidents yet.</p>
          <p className="muted">
            Add a Slack channel and an alert rule for a store, then let probes
            fail past the threshold.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Kind</th>
                <th>Store</th>
                <th>Title</th>
                <th>Opened</th>
                <th>Summary</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((row) => (
                <tr key={row.id}>
                  <td>{row.status}</td>
                  <td className="muted">
                    {row.kind === "stitch_checkout" ? "Stitch Express" : row.kind}
                  </td>
                  <td>
                    <strong>{storeLabel(row)}</strong>
                    {storeUrl(row) ? (
                      <div
                        className="muted"
                        style={{ fontSize: "0.8rem", wordBreak: "break-all" }}
                      >
                        {storeUrl(row)}
                      </div>
                    ) : null}
                  </td>
                  <td>{row.title}</td>
                  <td className="muted">
                    {new Date(row.opened_at).toLocaleString()}
                  </td>
                  <td className="muted" style={{ maxWidth: 280 }}>
                    {row.summary ?? "—"}
                  </td>
                  <td>
                    <IncidentActions incidentId={row.id} status={row.status} />
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
