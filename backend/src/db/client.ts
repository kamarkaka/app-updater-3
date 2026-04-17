import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import { appConfig } from "../config.js";
import * as schema from "./schema.js";

const dbDir = path.dirname(appConfig.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(appConfig.dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export function runMigrations() {
  const migrationsDir = path.resolve(
    import.meta.dirname,
    "../../drizzle"
  );
  if (fs.existsSync(migrationsDir)) {
    migrate(db, { migrationsFolder: migrationsDir });
  }
}
