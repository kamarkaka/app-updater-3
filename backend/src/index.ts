import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { appConfig } from "./config.js";
import { runMigrations } from "./db/client.js";
import authPlugin from "./auth/authPlugin.js";
import authRoutes from "./routes/authRoutes.js";
import appRoutes from "./routes/appRoutes.js";
import downloadRoutes from "./routes/downloadRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import { startScheduler, stopScheduler } from "./services/scheduler.js";
import { recoverInterruptedDownloads } from "./services/downloadManager.js";
import { closeBrowser } from "./services/browserManager.js";

const fastify = Fastify({ logger: true });

async function start() {
  // Ensure data directories exist
  fs.mkdirSync(appConfig.downloadDir, { recursive: true });

  // Run DB migrations
  runMigrations();

  // Recover any interrupted downloads
  recoverInterruptedDownloads();

  // Register plugins
  await fastify.register(cookie);
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });
  await fastify.register(authPlugin);

  // Register routes
  await fastify.register(authRoutes);
  await fastify.register(appRoutes);
  await fastify.register(downloadRoutes);
  await fastify.register(settingsRoutes);

  // Serve frontend static files (production)
  const frontendDist = path.resolve(import.meta.dirname, "../../frontend/dist");
  if (fs.existsSync(frontendDist)) {
    await fastify.register(fastifyStatic, {
      root: frontendDist,
      prefix: "/",
      wildcard: false,
    });

    // SPA fallback: serve index.html for non-API routes
    fastify.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        reply.code(404).send({ error: "Not found" });
      } else {
        reply.sendFile("index.html");
      }
    });
  }

  // Start scheduler
  startScheduler();

  // Start server
  await fastify.listen({ port: appConfig.port, host: appConfig.host });
  console.log(`Server running on http://${appConfig.host}:${appConfig.port}`);
}

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down...");
  stopScheduler();
  await closeBrowser();
  await fastify.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
