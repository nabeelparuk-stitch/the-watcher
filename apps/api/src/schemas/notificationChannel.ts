import { z } from "zod";

export const channelTypeSchema = z.enum(["slack_webhook"]);

export const createNotificationChannelSchema = z.object({
  name: z.string().min(1).max(200),
  organization_id: z.string().uuid().optional(),
  channel_type: channelTypeSchema.default("slack_webhook"),
  webhook_url: z.string().url().max(2048),
  enabled: z.boolean().optional(),
});

export const updateNotificationChannelSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    webhook_url: z.string().url().max(2048).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "At least one field is required",
  });
