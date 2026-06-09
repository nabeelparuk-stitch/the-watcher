import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadEnv } from "./lib/env.js";
import { registerV1Auth } from "./plugins/auth.js";
import { alertRulesRoutes } from "./routes/alertRules.js";
import { incidentsRoutes } from "./routes/incidents.js";
import { notificationChannelsRoutes } from "./routes/notificationChannels.js";
import { storesRoutes } from "./routes/stores.js";
import { checkoutReportsRoutes } from "./routes/checkoutReports.js";
import { googleSheetsRoutes } from "./routes/googleSheets.js";
import { syntheticCheckoutConfigsRoutes } from "./routes/syntheticCheckoutConfigs.js";

async function main() {
  const env = loadEnv();
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: env.corsOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
  });

  app.get("/health", async () => ({ ok: true }));

  await app.register(
    async (v1) => {
      await v1.register(checkoutReportsRoutes);
      await v1.register(googleSheetsRoutes);
    },
    { prefix: "/v1" }
  );

  if (env.fleetEnabled && env.supabaseUrl && env.supabaseAnonKey) {
    const { supabaseUrl, supabaseAnonKey } = env;
    await app.register(
      async (v1) => {
        registerV1Auth(v1, {
          supabaseUrl,
          supabaseAnonKey,
        });
        await v1.register(storesRoutes);
        await v1.register(notificationChannelsRoutes);
        await v1.register(alertRulesRoutes);
        await v1.register(incidentsRoutes);
        await v1.register(syntheticCheckoutConfigsRoutes);
      },
      { prefix: "/v1" }
    );
  } else {
    app.log.warn(
      "SUPABASE_URL / SUPABASE_ANON_KEY not set — fleet routes disabled; public checkout checker only."
    );
  }

  await app.listen({ port: env.port, host: "0.0.0.0" });
  app.log.info(`API listening on http://0.0.0.0:${env.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
