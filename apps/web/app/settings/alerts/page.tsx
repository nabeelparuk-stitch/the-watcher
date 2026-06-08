import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AlertsSettingsPanel } from "@/components/alerts-settings-panel";

export default async function AlertsSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ marginTop: 0 }}>Alerts</h1>
      <p className="muted">
        Configure Slack webhooks and per-store thresholds. Mutations go through
        the API.
      </p>
      <p className="row-actions">
        <Link href="/incidents">Incidents</Link>
        <Link href="/">Fleet</Link>
      </p>
      <AlertsSettingsPanel />
    </div>
  );
}
