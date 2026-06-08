import type { FastifyInstance } from "fastify";
import { resolveWriteOrganizationId } from "../lib/organization.js";
import {
  createStoreBodySchema,
  updateStoreBodySchema,
} from "../schemas/store.js";

export async function storesRoutes(app: FastifyInstance) {
  app.post("/stores", async (request, reply) => {
    const parsed = createStoreBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "validation_error",
        details: parsed.error.flatten(),
      });
    }

    const body = parsed.data;
    const org = await resolveWriteOrganizationId(
      request.supabaseUser,
      request.user.id,
      body.organization_id
    );

    if (!org.ok) {
      return reply.status(org.status).send({ error: org.message });
    }

    const { data, error } = await request.supabaseUser
      .from("stores")
      .insert({
        organization_id: org.organizationId,
        name: body.name.trim(),
        base_url: body.base_url.trim(),
        platform: body.platform,
        enabled: true,
      })
      .select("id, organization_id, name, platform, base_url, enabled, created_at")
      .single();

    if (error) {
      request.log.error(error, "store insert failed");
      return reply.status(400).send({ error: error.message });
    }

    return reply.status(201).send(data);
  });

  app.patch<{ Params: { storeId: string } }>("/stores/:storeId", async (request, reply) => {
    const { storeId } = request.params;
    const parsed = updateStoreBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "validation_error",
        details: parsed.error.flatten(),
      });
    }

    const body = parsed.data;

    const { data: existing, error: fetchError } = await request.supabaseUser
      .from("stores")
      .select("id")
      .eq("id", storeId)
      .maybeSingle();

    if (fetchError) {
      request.log.error(fetchError, "store fetch failed");
      return reply.status(400).send({ error: fetchError.message });
    }
    if (!existing) {
      return reply.status(404).send({ error: "store_not_found" });
    }

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.base_url !== undefined) patch.base_url = body.base_url.trim();
    if (body.platform !== undefined) patch.platform = body.platform;
    if (body.enabled !== undefined) patch.enabled = body.enabled;

    const { data, error } = await request.supabaseUser
      .from("stores")
      .update(patch)
      .eq("id", storeId)
      .select("id, organization_id, name, platform, base_url, enabled, created_at")
      .single();

    if (error) {
      request.log.error(error, "store update failed");
      return reply.status(400).send({ error: error.message });
    }

    return reply.send(data);
  });
}
