import { z } from "zod";

export const platformSchema = z.enum(["shopify", "woocommerce", "generic"]);

export const createStoreBodySchema = z.object({
  name: z.string().min(1).max(200),
  base_url: z.string().url().max(2048),
  platform: platformSchema,
  organization_id: z.string().uuid().optional(),
});

export const updateStoreBodySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    base_url: z.string().url().max(2048).optional(),
    platform: platformSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "At least one field is required",
  });

export type CreateStoreBody = z.infer<typeof createStoreBodySchema>;
export type UpdateStoreBody = z.infer<typeof updateStoreBodySchema>;
