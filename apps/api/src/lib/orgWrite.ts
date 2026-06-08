import type { SupabaseClient } from "@supabase/supabase-js";

export async function isOrgAdminOrOwner(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("organization_members")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) return false;
  return data.role === "owner" || data.role === "admin";
}
