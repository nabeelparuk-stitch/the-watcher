import type { FastifyInstance } from "fastify";
import { isOrgAdminOrOwner } from "../lib/orgWrite.js";
import {
  createAlertRuleSchema,
  updateAlertRuleSchema,
} from "../schemas/alertRule.js";

export async function alertRulesRoutes(app: FastifyInstance) {
  app.get("/alert-rules", async (request, reply) => {
    const q = request.query as { store_id?: string };
    let qb = request.supabaseUser
      .from("alert_rules")
      .select(
        "id, organization_id, store_id, notification_channel_id, failure_threshold, enabled, created_at"
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

  app.post("/alert-rules", async (request, reply) => {
    const parsed = createAlertRuleSchema.safeParse(request.body);
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

    const { data: channel, error: chErr } = await request.supabaseUser
      .from("notification_channels")
      .select("id, organization_id")
      .eq("id", body.notification_channel_id)
      .maybeSingle();

    if (chErr) {
      return reply.status(400).send({ error: chErr.message });
    }
    if (!channel) {
      return reply.status(404).send({ error: "channel_not_found" });
    }
    if (channel.organization_id !== store.organization_id) {
      return reply
        .status(400)
        .send({ error: "channel_store_organization_mismatch" });
    }

    const { data, error } = await request.supabaseUser
      .from("alert_rules")
      .insert({
        organization_id: store.organization_id,
        store_id: body.store_id,
        notification_channel_id: body.notification_channel_id,
        failure_threshold: body.failure_threshold ?? 2,
        enabled: body.enabled ?? true,
      })
      .select(
        "id, organization_id, store_id, notification_channel_id, failure_threshold, enabled, created_at"
      )
      .single();

    if (error) {
      return reply.status(400).send({ error: error.message });
    }
    return reply.status(201).send(data);
  });

  app.patch<{ Params: { ruleId: string } }>(
    "/alert-rules/:ruleId",
    async (request, reply) => {
      const parsed = updateAlertRuleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }

      const { data: row, error: fetchErr } = await request.supabaseUser
        .from("alert_rules")
        .select("id, organization_id, store_id")
        .eq("id", request.params.ruleId)
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

      if (parsed.data.notification_channel_id) {
        const { data: channel, error: chErr } = await request.supabaseUser
          .from("notification_channels")
          .select("organization_id")
          .eq("id", parsed.data.notification_channel_id)
          .maybeSingle();
        if (chErr || !channel) {
          return reply.status(400).send({ error: "channel_not_found" });
        }
        if (channel.organization_id !== row.organization_id) {
          return reply
            .status(400)
            .send({ error: "channel_store_organization_mismatch" });
        }
      }

      const patch: Record<string, unknown> = {};
      if (parsed.data.notification_channel_id !== undefined) {
        patch.notification_channel_id = parsed.data.notification_channel_id;
      }
      if (parsed.data.failure_threshold !== undefined) {
        patch.failure_threshold = parsed.data.failure_threshold;
      }
      if (parsed.data.enabled !== undefined) {
        patch.enabled = parsed.data.enabled;
      }

      const { data, error } = await request.supabaseUser
        .from("alert_rules")
        .update(patch)
        .eq("id", request.params.ruleId)
        .select(
          "id, organization_id, store_id, notification_channel_id, failure_threshold, enabled, created_at"
        )
        .single();

      if (error) {
        return reply.status(400).send({ error: error.message });
      }
      return reply.send(data);
    }
  );

  app.delete<{ Params: { ruleId: string } }>(
    "/alert-rules/:ruleId",
    async (request, reply) => {
      const { data: row, error: fetchErr } = await request.supabaseUser
        .from("alert_rules")
        .select("id, organization_id")
        .eq("id", request.params.ruleId)
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
        .from("alert_rules")
        .delete()
        .eq("id", request.params.ruleId);

      if (error) {
        return reply.status(400).send({ error: error.message });
      }
      return reply.status(204).send();
    }
  );
}
