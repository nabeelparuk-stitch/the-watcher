import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createSupabaseForUser(
  supabaseUrl: string,
  supabaseAnonKey: string,
  accessToken: string
): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
