import type { FastifyInstance } from "fastify";
import { resolveWriteOrganizationId } from "../lib/organization.js";
import { isOrgAdminOrOwner } from "../lib/orgWrite.js";
import {
  createNotificationChannelSchema,
  updateNotificationChannelSchema,
} from "../schemas/notificationChannel.js";

export async function notificationChannelsRoutes(app: FastifyInstance) {
  app.get("/notification-channels", async (request, reply) => {
    const q = request.query as { organization_id?: string };
    let qb = request.supabaseUser
      .from("notification_channels")
      .select("id, organization_id, name, channel_type, enabled, created_at")
      .order("created_at", { ascending: false });

    if (q.organization_id) {
      qb = qb.eq("organization_id", q.organization_id);
    }

    const { data, error } = await qb;
    if (error) {
      return reply.status(400).send({ error: error.message });
    }
    return reply.send(data ?? []);
  });

  app.post("/notification-channels", async (request, reply) => {
    const parsed = createNotificationChannelSchema.safeParse(request.body);
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

    const config = { webhook_url: body.webhook_url };
    const { data, error } = await request.supabaseUser
      .from("notification_channels")
      .insert({
        organization_id: org.organizationId,
        name: body.name.trim(),
        channel_type: body.channel_type,
        config,
        enabled: body.enabled ?? true,
      })
      .select("id, organization_id, name, channel_type, enabled, created_at")
      .single();

    if (error) {
      return reply.status(400).send({ error: error.message });
    }
    return reply.status(201).send(data);
  });

  app.patch<{ Params: { channelId: string } }>(
    "/notification-channels/:channelId",
    async (request, reply) => {
      const parsed = updateNotificationChannelSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          details: parsed.error.flatten(),
        });
      }

      const { data: row, error: fetchErr } = await request.supabaseUser
        .from("notification_channels")
        .select("id, organization_id, config")
        .eq("id", request.params.channelId)
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

      const patch: Record<string, unknown> = {};
      if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim();
      if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;

      if (parsed.data.webhook_url !== undefined) {
        const prev =
          row.config && typeof row.config === "object"
            ? (row.config as Record<string, unknown>)
            : {};
        patch.config = { ...prev, webhook_url: parsed.data.webhook_url };
      }

      const { data, error } = await request.supabaseUser
        .from("notification_channels")
        .update(patch)
        .eq("id", request.params.channelId)
        .select("id, organization_id, name, channel_type, enabled, created_at")
        .single();

      if (error) {
        return reply.status(400).send({ error: error.message });
      }
      return reply.send(data);
    }
  );

  app.delete<{ Params: { channelId: string } }>(
    "/notification-channels/:channelId",
    async (request, reply) => {
      const { data: row, error: fetchErr } = await request.supabaseUser
        .from("notification_channels")
        .select("id, organization_id")
        .eq("id", request.params.channelId)
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
        .from("notification_channels")
        .delete()
        .eq("id", request.params.channelId);

      if (error) {
        return reply.status(400).send({ error: error.message });
      }
      return reply.status(204).send();
    }
  );
}
