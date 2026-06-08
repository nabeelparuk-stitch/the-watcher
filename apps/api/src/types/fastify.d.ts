import type { SupabaseClient, User } from "@supabase/supabase-js";

declare module "fastify" {
  interface FastifyRequest {
    /** Supabase client scoped to the caller's JWT (RLS applies). */
    supabaseUser: SupabaseClient;
    user: User;
  }
}
