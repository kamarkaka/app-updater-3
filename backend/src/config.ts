import { config } from "dotenv";
import path from "node:path";

config();

const dataDir = process.env.DATA_DIR || "./data";

export const appConfig = {
  port: parseInt(process.env.PORT || "3000", 10),
  host: process.env.HOST || "0.0.0.0",
  dataDir,
  downloadDir: process.env.DOWNLOAD_DIR || path.join(dataDir, "downloads"),
  dbPath: process.env.DB_PATH || path.join(dataDir, "app-updater.db"),
  secretKey: process.env.SECRET_KEY || "change-me-in-production",
  githubToken: process.env.GITHUB_TOKEN || "",
  checkIntervalMinutes: parseInt(process.env.CHECK_INTERVAL || "360", 10),
  maxConcurrentDownloads: parseInt(process.env.MAX_CONCURRENT_DL || "2", 10),
  sessionMaxAgeDays: 7,
};
