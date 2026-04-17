import { FastifyInstance } from "fastify";
import { z } from "zod";
import { appConfig } from "../config.js";
import { reschedule } from "../services/scheduler.js";

const updateSettingsSchema = z.object({
  checkIntervalMinutes: z.number().int().min(1).optional(),
  maxConcurrentDownloads: z.number().int().min(1).max(10).optional(),
});

export default async function settingsRoutes(fastify: FastifyInstance) {
  fastify.get("/api/settings", async () => {
    return {
      checkIntervalMinutes: appConfig.checkIntervalMinutes,
      maxConcurrentDownloads: appConfig.maxConcurrentDownloads,
      downloadDir: appConfig.downloadDir,
    };
  });

  fastify.put("/api/settings", async (request) => {
    const body = updateSettingsSchema.parse(request.body);

    if (body.checkIntervalMinutes !== undefined) {
      appConfig.checkIntervalMinutes = body.checkIntervalMinutes;
      reschedule();
    }
    if (body.maxConcurrentDownloads !== undefined) {
      appConfig.maxConcurrentDownloads = body.maxConcurrentDownloads;
    }

    return {
      checkIntervalMinutes: appConfig.checkIntervalMinutes,
      maxConcurrentDownloads: appConfig.maxConcurrentDownloads,
      downloadDir: appConfig.downloadDir,
    };
  });
}
