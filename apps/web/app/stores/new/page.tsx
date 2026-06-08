import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewStoreForm } from "@/components/new-store-form";

export default async function NewStorePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <h1 style={{ marginTop: 0 }}>Add store</h1>
      <p className="muted">
        Creates a store via the <strong>API</strong> using your session (RLS
        still applies on insert).
      </p>
      <div className="card">
        <NewStoreForm />
      </div>
      <p className="muted" style={{ marginTop: "1rem" }}>
        <Link href="/">← Fleet</Link>
      </p>
    </div>
  );
}
