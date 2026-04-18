import { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, desc, asc } from "drizzle-orm";
import { db } from "../db/client.js";
import { applications, downloads } from "../db/schema.js";
import { appConfig } from "../config.js";
import { classifySource } from "../services/providers/classifier.js";
import { checkAppForUpdates, clearLatestResult } from "../services/versionChecker.js";
import { queueDownload, getActiveDownloadCount } from "../services/downloadManager.js";
import { suggestVersionsForUrl } from "../services/providers/generic.js";

const downloadStepSchema = z.object({
  selector: z.string().optional(),
  textPattern: z.string().optional(),
});

const createAppSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.string().url(),
  sourceType: z.enum(["auto", "github", "gitlab", "generic"]).default("auto"),
  checkIntervalMinutes: z.number().int().min(1).optional(),
  versionSelector: z.string().optional(),
  versionPattern: z.string().optional(),
  assetPattern: z.string().optional(),
  downloadUrl: z.string().url().optional(),
  downloadSteps: z.array(downloadStepSchema).optional(),
});

const updateAppSchema = createAppSchema.partial().extend({
  status: z.enum(["active", "paused"]).optional(),
});

function canAutoDownload(app: { sourceType: string; downloadSteps: string | null; downloadUrl: string | null }, hasDownloadUrls: boolean): boolean {
  return hasDownloadUrls || (app.sourceType !== "github" && (!!app.downloadSteps || !!app.downloadUrl));
}

export default async function appRoutes(fastify: FastifyInstance) {
  // List all apps
  fastify.get("/api/apps", async () => {
    const apps = db
      .select()
      .from(applications)
      .orderBy(asc(applications.name))
      .all();
    return apps;
  });

  // Get single app with recent downloads
  fastify.get<{ Params: { id: string } }>("/api/apps/:id", async (request, reply) => {
    const id = parseInt(request.params.id);
    const app = db.select().from(applications).where(eq(applications.id, id)).get();
    if (!app) return reply.code(404).send({ error: "Not found" });

    const appDownloads = db
      .select()
      .from(downloads)
      .where(eq(downloads.applicationId, id))
      .orderBy(desc(downloads.createdAt))
      .limit(20)
      .all();

    return { ...app, downloads: appDownloads };
  });

  // Suggest version candidates for a URL (runs heuristic detection)
  fastify.post("/api/apps/suggest", async (request) => {
    const { url } = z.object({ url: z.string().url() }).parse(request.body);
    const suggestions = await suggestVersionsForUrl(url);
    return suggestions;
  });

  // Create app
  fastify.post("/api/apps", async (request, reply) => {
    const body = createAppSchema.parse(request.body);

    const sourceType = body.sourceType === "auto" ? classifySource(body.url) : body.sourceType;

    if (sourceType !== "github" && (!body.versionSelector || !body.versionPattern)) {
      return reply.code(400).send({
        error: "Version selector and pattern are required for non-GitHub sources. Use POST /api/apps/suggest to discover them.",
      });
    }

    const app = db
      .insert(applications)
      .values({
        ...body,
        sourceType,
        checkIntervalMinutes: body.checkIntervalMinutes ?? appConfig.checkIntervalMinutes,
        downloadSteps: body.downloadSteps ? JSON.stringify(body.downloadSteps) : undefined,
      })
      .returning()
      .get();

    return app;
  });

  // Update app
  fastify.put<{ Params: { id: string } }>("/api/apps/:id", async (request, reply) => {
    const id = parseInt(request.params.id);
    const existing = db.select().from(applications).where(eq(applications.id, id)).get();
    if (!existing) return reply.code(404).send({ error: "Not found" });

    const body = updateAppSchema.parse(request.body);

    const sourceType =
      body.sourceType === "auto" && body.url
        ? classifySource(body.url)
        : body.sourceType ?? existing.sourceType;

    const updated = db
      .update(applications)
      .set({
        ...body,
        sourceType,
        downloadSteps: body.downloadSteps !== undefined ? JSON.stringify(body.downloadSteps) : undefined,
        updatedAt: new Date(),
      })
      .where(eq(applications.id, id))
      .returning()
      .get();

    return updated;
  });

  // Delete app
  fastify.delete<{ Params: { id: string } }>("/api/apps/:id", async (request, reply) => {
    const id = parseInt(request.params.id);
    const existing = db.select().from(applications).where(eq(applications.id, id)).get();
    if (!existing) return reply.code(404).send({ error: "Not found" });

    db.delete(applications).where(eq(applications.id, id)).run();
    clearLatestResult(id);
    return { ok: true };
  });

  // Check all active apps and auto-download updates
  fastify.post("/api/apps/check-all", async () => {
    const allApps = db.select().from(applications).where(eq(applications.status, "active")).all();
    const results: { id: number; name: string; version?: string; hasUpdate?: boolean; error?: string }[] = [];

    for (const app of allApps) {
      try {
        const result = await checkAppForUpdates(app);
        results.push({ id: app.id, name: app.name, version: result.version, hasUpdate: result.hasUpdate });

        if (result.hasUpdate && canAutoDownload(app, result.downloadUrls.length > 0) && getActiveDownloadCount() < appConfig.maxConcurrentDownloads) {
          const freshApp = db.select().from(applications).where(eq(applications.id, app.id)).get();
          if (freshApp) {
            try { await queueDownload(freshApp); } catch { /* logged elsewhere */ }
          }
        }
      } catch (err: any) {
        results.push({ id: app.id, name: app.name, error: err.message });
      }
    }

    return { checked: results.length, results };
  });

  // Trigger manual version check
  fastify.post<{ Params: { id: string } }>("/api/apps/:id/check", async (request, reply) => {
    const id = parseInt(request.params.id);
    const app = db.select().from(applications).where(eq(applications.id, id)).get();
    if (!app) return reply.code(404).send({ error: "Not found" });

    try {
      const result = await checkAppForUpdates(app);
      return result;
    } catch (err: any) {
      db.update(applications)
        .set({ status: "error", errorMessage: err.message, updatedAt: new Date() })
        .where(eq(applications.id, id))
        .run();
      return reply.code(500).send({ error: err.message });
    }
  });

  // Trigger manual download of latest version
  fastify.post<{ Params: { id: string } }>("/api/apps/:id/download", async (request, reply) => {
    const id = parseInt(request.params.id);
    const app = db.select().from(applications).where(eq(applications.id, id)).get();
    if (!app) return reply.code(404).send({ error: "Not found" });

    if (!app.latestVersion) {
      return reply.code(400).send({ error: "No version detected yet. Run a check first." });
    }

    try {
      const download = await queueDownload(app);
      return download;
    } catch (err: any) {
      request.log.error(err, "Download failed");
      return reply.code(500).send({ error: err.message });
    }
  });
}
