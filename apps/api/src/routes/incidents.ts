import type { FastifyInstance } from "fastify";
import { updateIncidentSchema } from "../schemas/incident.js";

export async function incidentsRoutes(app: FastifyInstance) {
  app.get("/incidents", async (request, reply) => {
    const q = request.query as { status?: string };
    let qb = request.supabaseUser
      .from("incidents")
      .select(
        `
        id,
        organization_id,
        store_id,
        kind,
        status,
        title,
        summary,
        opened_at,
        closed_at,
        acknowledged_at,
        updated_at,
        stores ( name, base_url )
      `
      )
      .order("opened_at", { ascending: false })
      .limit(100);

    if (q.status && q.status !== "all") {
      qb = qb.eq("status", q.status);
    }

    const { data, error } = await qb;
    if (error) {
      return reply.status(400).send({ error: error.message });
    }
    return reply.send(data ?? []);
  });

  app.patch<{ Params: { incidentId: string } }>(
    "/incidents/:incidentId",
    async (request, reply) => {
      const parsed = updateIncidentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }

      const { data: row, error: fetchErr } = await request.supabaseUser
        .from("incidents")
        .select("id, status")
        .eq("id", request.params.incidentId)
        .maybeSingle();

      if (fetchErr) {
        return reply.status(400).send({ error: fetchErr.message });
      }
      if (!row) {
        return reply.status(404).send({ error: "not_found" });
      }

      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {
        status: parsed.data.status,
        updated_at: now,
      };

      if (parsed.data.status === "acknowledged") {
        patch.acknowledged_at = now;
      }
      if (parsed.data.status === "resolved") {
        patch.closed_at = now;
      }

      const { data, error } = await request.supabaseUser
        .from("incidents")
        .update(patch)
        .eq("id", request.params.incidentId)
        .select(
          "id, organization_id, store_id, kind, status, title, summary, opened_at, closed_at, acknowledged_at, updated_at"
        )
        .single();

      if (error) {
        return reply.status(400).send({ error: error.message });
      }
      return reply.send(data);
    }
  );
}
