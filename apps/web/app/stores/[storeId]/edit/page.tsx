import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EditStoreForm } from "@/components/edit-store-form";

type Props = { params: Promise<{ storeId: string }> };

export default async function EditStorePage({ params }: Props) {
  const { storeId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: store, error } = await supabase
    .from("stores")
    .select("id, name, base_url, platform, enabled")
    .eq("id", storeId)
    .maybeSingle();

  if (error) {
    return (
      <div className="card">
        <p className="error">{error.message}</p>
        <Link href="/">Fleet</Link>
      </div>
    );
  }

  if (!store) {
    notFound();
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <h1 style={{ marginTop: 0 }}>Edit store</h1>
      <p className="muted">
        Updates via <strong>PATCH /v1/stores/:id</strong> (RLS on update).
      </p>
      <div className="card">
        <EditStoreForm store={store} />
      </div>
      <p className="muted" style={{ marginTop: "1rem" }}>
        <Link href="/">← Fleet</Link>
      </p>
    </div>
  );
}
