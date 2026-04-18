import cron from "node-cron";
import { eq, and, lt, or, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { applications } from "../db/schema.js";
import { appConfig } from "../config.js";
import { checkAppForUpdates } from "./versionChecker.js";
import { queueDownload, getActiveDownloadCount } from "./downloadManager.js";

let task: cron.ScheduledTask | null = null;

function intervalToCron(minutes: number): string {
  if (minutes < 60) return `*/${minutes} * * * *`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `0 */${hours} * * *`;
  return `0 0 */${Math.floor(hours / 24)} * *`;
}

async function runCheckCycle() {
  console.log("[scheduler] Starting check cycle");

  const now = new Date();
  const apps = db.select().from(applications).where(eq(applications.status, "active")).all();

  for (const app of apps) {
    // Check if enough time has passed since last check
    const intervalMs = (app.checkIntervalMinutes ?? appConfig.checkIntervalMinutes) * 60 * 1000;
    if (app.lastCheckedAt && now.getTime() - app.lastCheckedAt.getTime() < intervalMs) {
      continue;
    }

    try {
      console.log(`[scheduler] Checking ${app.name}...`);
      const result = await checkAppForUpdates(app);

      const canDownload = result.downloadUrls.length > 0 || (app.sourceType !== "github" && (!!app.downloadSteps || !!app.downloadUrl));
      if (result.hasUpdate && canDownload) {
        console.log(
          `[scheduler] Update found for ${app.name}: ${app.currentVersion ?? "none"} -> ${result.version}`
        );

        if (getActiveDownloadCount() < appConfig.maxConcurrentDownloads) {
          // Re-read app to get updated latestVersion
          const freshApp = db
            .select()
            .from(applications)
            .where(eq(applications.id, app.id))
            .get();
          if (freshApp) {
            try {
              await queueDownload(freshApp);
            } catch (err: any) {
              console.error(`[scheduler] Download queue failed for ${app.name}: ${err.message}`);
            }
          }
        }
      }
    } catch (err: any) {
      console.error(`[scheduler] Check failed for ${app.name}: ${err.message}`);
    }
  }

  console.log("[scheduler] Check cycle complete");
}

export function startScheduler() {
  const cronExpr = intervalToCron(appConfig.checkIntervalMinutes);
  console.log(`[scheduler] Starting with cron: ${cronExpr} (every ${appConfig.checkIntervalMinutes} min)`);

  task = cron.schedule(cronExpr, () => {
    runCheckCycle().catch((err) =>
      console.error("[scheduler] Unhandled error in check cycle:", err)
    );
  });
}

export function stopScheduler() {
  if (task) {
    task.stop();
    task = null;
  }
}

export function reschedule() {
  stopScheduler();
  startScheduler();
}
