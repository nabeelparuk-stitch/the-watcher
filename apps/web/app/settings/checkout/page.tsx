import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CheckoutSettingsPanel } from "@/components/checkout-settings-panel";

export default async function CheckoutSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>Checkout monitoring</h1>
      <p className="muted">
        Configures Playwright journeys run by the{" "}
        <code>watcher-checkout</code> Temporal worker.
      </p>
      <p className="row-actions">
        <Link href="/">Fleet</Link>
        <Link href="/settings/alerts">Alerts</Link>
      </p>
      <CheckoutSettingsPanel />
    </div>
  );
}
