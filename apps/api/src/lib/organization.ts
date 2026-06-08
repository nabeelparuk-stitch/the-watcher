import type { SupabaseClient } from "@supabase/supabase-js";

export type ResolveOrgResult =
  | { ok: true; organizationId: string }
  | { ok: false; status: 400 | 403; message: string };

/**
 * Picks an org the user may write stores to (owner/admin).
 * If organizationId is passed, it must match a membership with that role.
 */
export async function resolveWriteOrganizationId(
  supabase: SupabaseClient,
  userId: string,
  organizationId?: string
): Promise<ResolveOrgResult> {
  const { data: memberships, error } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)
    .in("role", ["owner", "admin"]);

  if (error) {
    return {
      ok: false,
      status: 403,
      message: error.message,
    };
  }

  const rows = memberships ?? [];
  if (rows.length === 0) {
    return {
      ok: false,
      status: 403,
      message: "No organization with store write access.",
    };
  }

  if (organizationId) {
    const allowed = rows.some((r) => r.organization_id === organizationId);
    if (!allowed) {
      return {
        ok: false,
        status: 403,
        message: "Not allowed to create stores in this organization.",
      };
    }
    return { ok: true, organizationId };
  }

  if (rows.length > 1) {
    return {
      ok: false,
      status: 400,
      message:
        "organization_id is required when you belong to more than one writable organization.",
    };
  }

  return { ok: true, organizationId: rows[0].organization_id };
}
