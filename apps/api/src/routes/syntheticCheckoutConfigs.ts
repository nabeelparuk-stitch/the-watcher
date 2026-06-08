import type { FastifyInstance } from "fastify";
import { isOrgAdminOrOwner } from "../lib/orgWrite.js";
import {
  createSyntheticCheckoutConfigSchema,
  updateSyntheticCheckoutConfigSchema,
} from "../schemas/syntheticCheckoutConfig.js";

export async function syntheticCheckoutConfigsRoutes(app: FastifyInstance) {
  app.get("/synthetic-checkout-configs", async (request, reply) => {
    const q = request.query as { store_id?: string };
    let qb = request.supabaseUser
      .from("synthetic_checkout_configs")
      .select(
        "id, organization_id, store_id, enabled, start_url, selectors, success_path_includes, timeout_seconds, created_at, updated_at"
      )
      .order("created_at", { ascending: false });

    if (q.store_id) {
      qb = qb.eq("store_id", q.store_id);
    }

    const { data, error } = await qb;
    if (error) {
      return reply.status(400).send({ error: error.message });
    }
    return reply.send(data ?? []);
  });

  app.post("/synthetic-checkout-configs", async (request, reply) => {
    const parsed = createSyntheticCheckoutConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "validation_error",
        details: parsed.error.flatten(),
      });
    }
    const body = parsed.data;

    const { data: store, error: storeErr } = await request.supabaseUser
      .from("stores")
      .select("id, organization_id")
      .eq("id", body.store_id)
      .maybeSingle();

    if (storeErr) {
      return reply.status(400).send({ error: storeErr.message });
    }
    if (!store) {
      return reply.status(404).send({ error: "store_not_found" });
    }

    const canWrite = await isOrgAdminOrOwner(
      request.supabaseUser,
      request.user.id,
      store.organization_id
    );
    if (!canWrite) {
      return reply.status(403).send({ error: "forbidden" });
    }

    const selectors: Record<string, unknown> =
      body.selectors && typeof body.selectors === "object"
        ? (body.selectors as Record<string, unknown>)
        : {};

    const { data, error } = await request.supabaseUser
      .from("synthetic_checkout_configs")
      .insert({
        organization_id: store.organization_id,
        store_id: body.store_id,
        start_url: body.start_url.trim(),
        enabled: body.enabled ?? true,
        selectors,
        success_path_includes: body.success_path_includes ?? "checkout",
        timeout_seconds: body.timeout_seconds ?? 120,
      })
      .select(
        "id, organization_id, store_id, enabled, start_url, selectors, success_path_includes, timeout_seconds, created_at, updated_at"
      )
      .single();

    if (error) {
      return reply.status(400).send({ error: error.message });
    }
    return reply.status(201).send(data);
  });

  app.patch<{ Params: { configId: string } }>(
    "/synthetic-checkout-configs/:configId",
    async (request, reply) => {
      const parsed = updateSyntheticCheckoutConfigSchema.safeParse(
        request.body
      );
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }

      const { data: row, error: fetchErr } = await request.supabaseUser
        .from("synthetic_checkout_configs")
        .select("id, organization_id")
        .eq("id", request.params.configId)
        .maybeSingle();

      if (fetchErr) {
        return reply.status(400).send({ error: fetchErr.message });
      }
      if (!row) {
        return reply.status(404).send({ error: "not_found" });
      }

      const admin = await isOrgAdminOrOwner(
        request.supabaseUser,
        request.user.id,
        row.organization_id
      );
      if (!admin) {
        return reply.status(403).send({ error: "forbidden" });
      }

      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      const b = parsed.data;
      if (b.start_url !== undefined) patch.start_url = b.start_url.trim();
      if (b.enabled !== undefined) patch.enabled = b.enabled;
      if (b.success_path_includes !== undefined) {
        patch.success_path_includes = b.success_path_includes;
      }
      if (b.timeout_seconds !== undefined) {
        patch.timeout_seconds = b.timeout_seconds;
      }
      if (b.selectors !== undefined) {
        patch.selectors =
          b.selectors === null ? {} : (b.selectors as Record<string, unknown>);
      }

      const { data, error } = await request.supabaseUser
        .from("synthetic_checkout_configs")
        .update(patch)
        .eq("id", request.params.configId)
        .select(
          "id, organization_id, store_id, enabled, start_url, selectors, success_path_includes, timeout_seconds, created_at, updated_at"
        )
        .single();

      if (error) {
        return reply.status(400).send({ error: error.message });
      }
      return reply.send(data);
    }
  );

  app.delete<{ Params: { configId: string } }>(
    "/synthetic-checkout-configs/:configId",
    async (request, reply) => {
      const { data: row, error: fetchErr } = await request.supabaseUser
        .from("synthetic_checkout_configs")
        .select("id, organization_id")
        .eq("id", request.params.configId)
        .maybeSingle();

      if (fetchErr) {
        return reply.status(400).send({ error: fetchErr.message });
      }
      if (!row) {
        return reply.status(404).send({ error: "not_found" });
      }

      const admin = await isOrgAdminOrOwner(
        request.supabaseUser,
        request.user.id,
        row.organization_id
      );
      if (!admin) {
        return reply.status(403).send({ error: "forbidden" });
      }

      const { error } = await request.supabaseUser
        .from("synthetic_checkout_configs")
        .delete()
        .eq("id", request.params.configId);

      if (error) {
        return reply.status(400).send({ error: error.message });
      }
      return reply.status(204).send();
    }
  );
}
