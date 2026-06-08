import type { FastifyInstance } from "fastify";
import { getGoogleSheetsConfig } from "../lib/googleSheets.js";

export async function googleSheetsRoutes(app: FastifyInstance) {
  app.get("/google-sheets/status", async (_request, reply) => {
    return reply.send(getGoogleSheetsConfig());
  });
}
