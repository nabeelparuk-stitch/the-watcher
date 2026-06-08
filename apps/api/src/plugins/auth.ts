import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createSupabaseForUser } from "../lib/supabaseUser.js";

export function registerV1Auth(
  app: FastifyInstance,
  opts: { supabaseUrl: string; supabaseAnonKey: string }
) {
  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      await reply.status(401).send({ error: "missing_bearer_token" });
      return;
    }
    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      await reply.status(401).send({ error: "missing_bearer_token" });
      return;
    }

    const supabaseUser = createSupabaseForUser(
      opts.supabaseUrl,
      opts.supabaseAnonKey,
      token
    );

    const {
      data: { user },
      error,
    } = await supabaseUser.auth.getUser(token);

    if (error || !user) {
      await reply.status(401).send({ error: "invalid_token" });
      return;
    }

    request.supabaseUser = supabaseUser;
    request.user = user;
  });
}
