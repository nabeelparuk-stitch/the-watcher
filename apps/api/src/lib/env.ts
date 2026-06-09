import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load apps/api/.env in dev (tsx does not load it automatically).
try {
  const envPath = resolve(process.cwd(), ".env");
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
} catch {
  /* optional .env */
}

export function loadEnv() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim() || null;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim() || null;
  const fleetEnabled = Boolean(supabaseUrl && supabaseAnonKey);

  const corsRaw = process.env.CORS_ORIGIN ?? "http://localhost:3000";
  const corsAllowAll =
    process.env.CORS_ALLOW_ALL === "true" ||
    corsRaw.trim() === "*" ||
    corsRaw.split(",").some((s) => s.trim() === "*");

  return {
    port: Number(process.env.PORT ?? "4000"),
    supabaseUrl,
    supabaseAnonKey,
    fleetEnabled,
    corsAllowAll,
    corsOrigins: corsRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "*"),
  };
}
