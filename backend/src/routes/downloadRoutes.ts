import { FastifyInstance } from "fastify";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { downloads } from "../db/schema.js";
import {
  pauseDownload,
  resumeDownload,
  cancelDownload,
} from "../services/downloadManager.js";

export default async function downloadRoutes(fastify: FastifyInstance) {
  // List all downloads
  fastify.get("/api/downloads", async () => {
    return db
      .select()
      .from(downloads)
      .orderBy(desc(downloads.createdAt))
      .all();
  });

  // Get single download
  fastify.get<{ Params: { id: string } }>("/api/downloads/:id", async (request, reply) => {
    const id = parseInt(request.params.id);
    const download = db.select().from(downloads).where(eq(downloads.id, id)).get();
    if (!download) return reply.code(404).send({ error: "Not found" });
    return download;
  });

  // Pause download
  fastify.post<{ Params: { id: string } }>("/api/downloads/:id/pause", async (request, reply) => {
    const id = parseInt(request.params.id);
    const download = db.select().from(downloads).where(eq(downloads.id, id)).get();
    if (!download) return reply.code(404).send({ error: "Not found" });

    if (download.status !== "downloading") {
      return reply.code(400).send({ error: "Download is not active" });
    }

    pauseDownload(id);
    return { ok: true };
  });

  // Resume download
  fastify.post<{ Params: { id: string } }>("/api/downloads/:id/resume", async (request, reply) => {
    const id = parseInt(request.params.id);
    const download = db.select().from(downloads).where(eq(downloads.id, id)).get();
    if (!download) return reply.code(404).send({ error: "Not found" });

    if (download.status !== "paused" && download.status !== "failed") {
      return reply.code(400).send({ error: "Download cannot be resumed" });
    }

    resumeDownload(id);
    return { ok: true };
  });

  // Cancel and delete download
  fastify.delete<{ Params: { id: string } }>("/api/downloads/:id", async (request, reply) => {
    const id = parseInt(request.params.id);
    const download = db.select().from(downloads).where(eq(downloads.id, id)).get();
    if (!download) return reply.code(404).send({ error: "Not found" });

    await cancelDownload(id);
    return { ok: true };
  });
}
