import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("user", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
});

export const sessions = sqliteTable("session", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  token: text("token").notNull().unique(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const applications = sqliteTable("application", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  sourceType: text("source_type").notNull().default("auto"),
  currentVersion: text("current_version"),
  latestVersion: text("latest_version"),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }),
  checkIntervalMinutes: integer("check_interval_minutes").default(720),
  status: text("status").notNull().default("active"),
  errorMessage: text("error_message"),

  versionSelector: text("version_selector"),
  versionPattern: text("version_pattern"),
  downloadSelector: text("download_selector"),
  downloadPattern: text("download_pattern"),
  assetPattern: text("asset_pattern"),
  maxNavigationDepth: integer("max_navigation_depth").default(5),
  downloadTimeout: integer("download_timeout").default(60),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const downloads = sqliteTable(
  "download",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    url: text("url").notNull(),
    fileName: text("file_name").notNull(),
    filePath: text("file_path"),
    totalBytes: integer("total_bytes"),
    downloadedBytes: integer("downloaded_bytes").default(0),
    status: text("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    checksum: text("checksum"),
    checksumType: text("checksum_type"),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("download_app_version_idx").on(
      table.applicationId,
      table.version
    ),
  ]
);

export type User = typeof users.$inferSelect;
export type Application = typeof applications.$inferSelect;
export type Download = typeof downloads.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type NewDownload = typeof downloads.$inferInsert;
