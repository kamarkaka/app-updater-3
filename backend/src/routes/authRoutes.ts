import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  authenticateUser,
  createUser,
  destroySession,
  hasUsers,
} from "../auth/auth.js";
import { appConfig } from "../config.js";

const credentialsSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(4).max(200),
});

export default async function authRoutes(fastify: FastifyInstance) {
  // Check if initial setup is needed
  fastify.get("/api/auth/status", async () => {
    return { needsSetup: !hasUsers() };
  });

  // First-run setup: create initial user
  fastify.post("/api/auth/setup", async (request, reply) => {
    if (hasUsers()) {
      return reply.code(400).send({ error: "User already exists" });
    }

    const body = credentialsSchema.parse(request.body);
    await createUser(body.username, body.password);

    const token = await authenticateUser(body.username, body.password);
    reply.setCookie("session", token!, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: appConfig.sessionMaxAgeDays * 24 * 60 * 60,
    });
    return { ok: true };
  });

  fastify.post("/api/auth/login", async (request, reply) => {
    const body = credentialsSchema.parse(request.body);
    const token = await authenticateUser(body.username, body.password);

    if (!token) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    reply.setCookie("session", token, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: appConfig.sessionMaxAgeDays * 24 * 60 * 60,
    });
    return { ok: true };
  });

  fastify.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies?.session;
    if (token) {
      destroySession(token);
    }
    reply.clearCookie("session", { path: "/" });
    return { ok: true };
  });

  fastify.get("/api/auth/me", async (request, reply) => {
    if (!request.userId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return { userId: request.userId };
  });
}
