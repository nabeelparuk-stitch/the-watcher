import { z } from "zod";

export const createSyntheticCheckoutConfigSchema = z.object({
  store_id: z.string().uuid(),
  start_url: z.string().url().max(2048),
  enabled: z.boolean().optional(),
  selectors: z.record(z.string(), z.unknown()).optional(),
  success_path_includes: z.string().min(1).max(200).optional(),
  timeout_seconds: z.number().int().min(30).max(600).optional(),
});

export const updateSyntheticCheckoutConfigSchema = z
  .object({
    start_url: z.string().url().max(2048).optional(),
    enabled: z.boolean().optional(),
    selectors: z.record(z.string(), z.unknown()).nullable().optional(),
    success_path_includes: z.string().min(1).max(200).optional(),
    timeout_seconds: z.number().int().min(30).max(600).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "At least one field is required",
  });
