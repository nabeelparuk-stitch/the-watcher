import { z } from "zod";

export const createAlertRuleSchema = z.object({
  store_id: z.string().uuid(),
  notification_channel_id: z.string().uuid(),
  failure_threshold: z.number().int().min(1).max(20).optional(),
  enabled: z.boolean().optional(),
});

export const updateAlertRuleSchema = z
  .object({
    notification_channel_id: z.string().uuid().optional(),
    failure_threshold: z.number().int().min(1).max(20).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "At least one field is required",
  });
