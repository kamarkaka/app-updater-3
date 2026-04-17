import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { validateSession, hasUsers } from "./auth.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: number;
  }
}

async function authPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest("userId", undefined);

  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for login, setup, and static files
    if (
      request.url === "/api/auth/login" ||
      request.url === "/api/auth/setup" ||
      request.url === "/api/auth/status" ||
      !request.url.startsWith("/api/")
    ) {
      return;
    }

    const token = request.cookies?.session;
    if (!token) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    const session = validateSession(token);
    if (!session) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    request.userId = session.userId;
  });
}

export default fp(authPlugin);
