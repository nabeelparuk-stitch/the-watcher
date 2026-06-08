import { z } from "zod";

export const updateIncidentSchema = z.object({
  status: z.enum(["acknowledged", "resolved"]),
});
