import fs from "node:fs";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { applications, downloads, Application, Download } from "../db/schema.js";
import { appConfig } from "../config.js";
import { getLatestResult, checkAppForUpdates } from "./versionChecker.js";
import { resolveGenericDownloadUrl } from "./providers/generic.js";

// Track active download abort controllers
const activeDownloads = new Map<number, AbortController>();

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").toLowerCase();
}

function getDownloadDir(appName: string): string {
  const dir = path.join(appConfig.downloadDir, sanitizeName(appName));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function queueDownload(app: Application): Promise<Download> {
  let result = getLatestResult(app.id);

  // If no cached result (e.g. server restarted since last check), re-run detection
  if (!result || result.downloadUrls.length === 0) {
    await checkAppForUpdates(app);
    result = getLatestResult(app.id);
  }

  if (!result || result.downloadUrls.length === 0) {
    throw new Error("No download URL found for this application.");
  }

  const url = result.downloadUrls[0];
  const fileName = decodeURIComponent(path.basename(new URL(url).pathname)) || `${app.name}-${result.version}`;
  const dir = getDownloadDir(app.name);
  const filePath = path.join(dir, fileName);

  // Check if download already exists for this version
  const existing = db
    .select()
    .from(downloads)
    .where(
      and(
        eq(downloads.applicationId, app.id),
        eq(downloads.version, result.version)
      )
    )
    .get();

  if (existing) {
    if (existing.status === "completed") {
      throw new Error(`Version ${result.version} already downloaded`);
    }
    // Resume existing download
    resumeDownload(existing.id);
    return existing;
  }

  const download = db
    .insert(downloads)
    .values({
      applicationId: app.id,
      version: result.version,
      url,
      fileName,
      filePath,
      status: "pending",
    })
    .returning()
    .get();

  // Start download in background
  startDownload(download.id);

  return download;
}

async function startDownload(downloadId: number) {
  const download = db
    .select()
    .from(downloads)
    .where(eq(downloads.id, downloadId))
    .get();
  if (!download) return;

  const controller = new AbortController();
  activeDownloads.set(downloadId, controller);

  db.update(downloads)
    .set({ status: "downloading", startedAt: new Date() })
    .where(eq(downloads.id, downloadId))
    .run();

  try {
    // For generic sources, resolve the raw page link to a direct download URL
    let downloadUrl = download.url;
    const app = db
      .select()
      .from(applications)
      .where(eq(applications.id, download.applicationId))
      .get();
    if (app && app.sourceType === "generic") {
      try {
        downloadUrl = await resolveGenericDownloadUrl(download.url, app);
        db.update(downloads)
          .set({ url: downloadUrl })
          .where(eq(downloads.id, downloadId))
          .run();
      } catch {
        // Fall back to the original URL
      }
    }

    const partPath = download.filePath + ".part";
    let downloadedBytes = download.downloadedBytes ?? 0;

    // Check if partial file exists and matches DB state
    if (fs.existsSync(partPath)) {
      const stat = fs.statSync(partPath);
      downloadedBytes = Math.min(downloadedBytes, stat.size);
    } else {
      downloadedBytes = 0;
    }

    const headers: Record<string, string> = {
      "User-Agent": "app-updater/1.0",
    };

    if (downloadedBytes > 0) {
      headers.Range = `bytes=${downloadedBytes}-`;
    }

    const response = await fetch(downloadUrl, {
      headers,
      signal: controller.signal,
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // If server doesn't support Range, restart
    if (downloadedBytes > 0 && response.status !== 206) {
      downloadedBytes = 0;
    }

    const contentLength = response.headers.get("content-length");
    let totalBytes = download.totalBytes;
    if (contentLength) {
      totalBytes =
        downloadedBytes > 0
          ? downloadedBytes + parseInt(contentLength)
          : parseInt(contentLength);
    }

    if (totalBytes) {
      db.update(downloads)
        .set({ totalBytes })
        .where(eq(downloads.id, downloadId))
        .run();
    }

    fs.mkdirSync(path.dirname(partPath), { recursive: true });

    const fileStream = fs.createWriteStream(partPath, {
      flags: downloadedBytes > 0 ? "a" : "w",
    });

    const body = response.body;
    if (!body) throw new Error("No response body");

    let lastDbUpdate = Date.now();
    const reader = body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const canContinue = fileStream.write(value);
        if (!canContinue) {
          await new Promise<void>((r) => fileStream.once("drain", r));
        }
        downloadedBytes += value.byteLength;

        // Update DB every ~1MB or 5 seconds
        if (
          downloadedBytes - (download.downloadedBytes ?? 0) > 1048576 ||
          Date.now() - lastDbUpdate > 5000
        ) {
          db.update(downloads)
            .set({ downloadedBytes })
            .where(eq(downloads.id, downloadId))
            .run();
          lastDbUpdate = Date.now();
        }
      }
    } finally {
      fileStream.end();
    }

    await new Promise<void>((resolve, reject) => {
      fileStream.on("finish", resolve);
      fileStream.on("error", reject);
    });

    // Move .part to final path
    if (download.filePath) {
      fs.renameSync(partPath, download.filePath);
    }

    // Mark completed
    db.update(downloads)
      .set({
        status: "completed",
        downloadedBytes,
        completedAt: new Date(),
      })
      .where(eq(downloads.id, downloadId))
      .run();

    // Update application's current version
    db.update(applications)
      .set({ currentVersion: download.version, updatedAt: new Date() })
      .where(eq(applications.id, download.applicationId))
      .run();
  } catch (err: any) {
    if (err.name === "AbortError") {
      // Paused by user
      db.update(downloads)
        .set({ status: "paused" })
        .where(eq(downloads.id, downloadId))
        .run();
    } else {
      db.update(downloads)
        .set({ status: "failed", errorMessage: err.message })
        .where(eq(downloads.id, downloadId))
        .run();
    }
  } finally {
    activeDownloads.delete(downloadId);
  }
}

export function pauseDownload(downloadId: number) {
  const controller = activeDownloads.get(downloadId);
  if (controller) {
    controller.abort();
  }
  // Final DB state set in the catch block of startDownload
}

export function resumeDownload(downloadId: number) {
  // Re-read download state to get current downloadedBytes
  const download = db
    .select()
    .from(downloads)
    .where(eq(downloads.id, downloadId))
    .get();
  if (!download) return;

  startDownload(downloadId);
}

export async function cancelDownload(downloadId: number) {
  // Abort if active
  const controller = activeDownloads.get(downloadId);
  if (controller) {
    controller.abort();
  }

  const download = db
    .select()
    .from(downloads)
    .where(eq(downloads.id, downloadId))
    .get();

  if (download?.filePath) {
    fs.rmSync(download.filePath + ".part", { force: true });
    fs.rmSync(download.filePath, { force: true });
  }

  db.delete(downloads).where(eq(downloads.id, downloadId)).run();
}

export function recoverInterruptedDownloads() {
  // On startup, mark any "downloading" entries as "paused"
  db.update(downloads)
    .set({ status: "paused" })
    .where(eq(downloads.status, "downloading"))
    .run();
}

export function getActiveDownloadCount(): number {
  return activeDownloads.size;
}
