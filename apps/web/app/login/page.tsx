import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "@/components/login-form";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/fleet");
  }

  return (
    <div style={{ maxWidth: 420 }}>
      <h1 style={{ marginTop: 0 }}>Sign in</h1>
      <p className="muted">
        Uses Supabase Auth. New accounts get a personal organization via DB
        trigger.
      </p>
      <div className="card">
        <LoginForm />
        <p className="muted" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
          <Link href="/">Back to checker</Link>
        </p>
      </div>
    </div>
  );
}
