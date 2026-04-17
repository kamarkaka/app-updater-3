# App Updater - Implementation Plan

## 1. Overview

A self-hosted, single-user webapp that monitors software applications for updates and downloads new versions automatically. The user provides a URL (download page or git repo) for each application, and the system intelligently detects versions, compares them, and downloads updates with resumable transfer support.

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     React Frontend                      │
│  ┌──────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │  Login   │ │  Dashboard   │ │  App Detail / Form   │ │
│  └──────────┘ └──────────────┘ └──────────────────────┘ │
└──────────────────────┬──────────────────────────────────┘
                       │ REST API (JSON)
┌──────────────────────▼──────────────────────────────────┐
│                   Fastify Backend (TypeScript)           │
│                                                         │
│  ┌─────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │  Auth   │  │  App CRUD API    │  │  Download API  │  │
│  └─────────┘  └──────────────────┘  └────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Background Scheduler                │   │
│  │  ┌────────────────────┐  ┌─────────────────────┐ │   │
│  │  │ Version Detection  │  │  Download Manager   │ │   │
│  │  │  ┌──────────────┐  │  │  - HTTP Range resume│ │   │
│  │  │  │ GitHub API   │  │  │  - Progress tracking│ │   │
│  │  │  │ GitLab API   │  │  │  - Retry logic      │ │   │
│  │  │  │ Puppeteer    │  │  │                     │ │   │
│  │  │  └──────────────┘  │  └─────────────────────┘ │   │
│  │  └────────────────────┘                          │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │                 SQLite Database                   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## 3. Tech Stack

| Layer            | Technology                         | Rationale                                                          |
| ---------------- | ---------------------------------- | ------------------------------------------------------------------ |
| Backend          | Fastify + TypeScript               | Fast, plugin-based, great TS support, shared language with frontend |
| Frontend         | React 18 + Vite + TypeScript       | Standard choice, good interactivity for progress/status UIs        |
| Database         | SQLite via better-sqlite3          | Zero setup, single-file, perfect for single-user                   |
| ORM              | Drizzle ORM                        | Lightweight, type-safe, SQL-like, built-in migration tooling       |
| Migrations       | Drizzle Kit                        | Integrated with Drizzle ORM                                        |
| Scheduler        | node-cron                          | Simple, in-process, no external deps                               |
| Web Scraping     | puppeteer-extra + stealth plugin   | Handles bot detection, JS-rendered pages, CAPTCHAs                 |
| HTML Parsing     | Cheerio                            | Fast HTML parsing for extracting versions/links from page content  |
| HTTP Client      | Built-in fetch (undici)            | Streaming downloads, Range header support, no extra dependency     |
| Auth             | bcryptjs + session cookie          | Simple, no JWT complexity needed for single-user                   |
| Validation       | Zod                                | Runtime type validation, pairs well with TypeScript                |
| Styling          | Tailwind CSS                       | Utility-first, fast to build clean UIs                             |

### Environment Variables

| Variable           | Default                  | Description                                       |
| ------------------ | ------------------------ | ------------------------------------------------- |
| `PORT`             | `3000`                   | Server listen port                                |
| `DATA_DIR`         | `/data`                  | Root directory for DB and downloads (mount point)  |
| `DOWNLOAD_DIR`     | `${DATA_DIR}/downloads`  | Where downloaded files are stored                 |
| `DB_PATH`          | `${DATA_DIR}/app-updater.db` | SQLite database file path                     |
| `SECRET_KEY`       | *(required)*             | Session signing secret                            |
| `GITHUB_TOKEN`     | *(optional)*             | GitHub personal access token for higher rate limits |
| `CHECK_INTERVAL`   | `360`                    | Default check interval in minutes                 |
| `MAX_CONCURRENT_DL`| `2`                      | Max simultaneous downloads                        |

In Docker, the user mounts a single host directory to `DATA_DIR` (default `/data`). Both the database and all downloads live under this mount, so everything persists across container restarts. The user can also set `DOWNLOAD_DIR` separately if they want downloads on a different volume.

```yaml
# docker-compose.yml example
services:
  app-updater:
    image: app-updater
    ports:
      - "3000:3000"
    volumes:
      - ./app-data:/data                    # DB + downloads
      # OR split mounts:
      # - ./app-data:/data                  # DB only
      # - /nas/downloads:/downloads         # downloads on NAS
    environment:
      - SECRET_KEY=change-me
      # - DOWNLOAD_DIR=/downloads           # only if using split mount
      # - GITHUB_TOKEN=ghp_...
```

## 4. Data Model

Drizzle ORM schema (maps to SQLite):

```typescript
// schema.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("user", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
});

export const applications = sqliteTable("application", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  sourceType: text("source_type").notNull().default("auto"), // 'github', 'gitlab', 'generic', 'auto'
  currentVersion: text("current_version"),
  latestVersion: text("latest_version"),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }),
  checkIntervalMinutes: integer("check_interval_minutes").default(360),
  status: text("status").default("active"), // 'active', 'paused', 'error'
  errorMessage: text("error_message"),

  // optional overrides for scraping (generic sources)
  versionSelector: text("version_selector"),   // CSS selector to locate version text
  versionPattern: text("version_pattern"),     // regex to extract version from text
  downloadSelector: text("download_selector"), // CSS selector to locate download link/button (used for both link extraction AND click-through navigation)
  downloadPattern: text("download_pattern"),   // regex/glob to filter download URLs
  assetPattern: text("asset_pattern"),         // pattern to pick the right asset, e.g. "linux.*amd64"
  maxNavigationDepth: integer("max_navigation_depth").default(5), // max intermediate pages to click through
  downloadTimeout: integer("download_timeout").default(60),       // seconds to wait for download to trigger (covers countdown timers)

  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const downloads = sqliteTable("download", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  url: text("url").notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path"),               // final location on disk
  totalBytes: integer("total_bytes"),         // from Content-Length
  downloadedBytes: integer("downloaded_bytes").default(0),
  status: text("status").default("pending"), // 'pending','downloading','paused','completed','failed'
  errorMessage: text("error_message"),
  checksum: text("checksum"),                // expected hash if available
  checksumType: text("checksum_type"),       // 'sha256', 'md5'
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
```

## 5. Core Systems

### 5.1 Version Detection

This is the central intelligence of the app. A provider-based architecture with automatic source classification and a fallback to configurable scraping.

**Flow:**

```
URL provided by user
        │
        ▼
┌───────────────────┐
│ Source Classifier  │──── Analyze URL hostname/path patterns
└────────┬──────────┘
         │
   ┌─────┼──────────────────┐
   ▼     ▼                  ▼
GitHub  GitLab         Generic Web
API     API            (Puppeteer)
   │     │                  │
   └─────┼──────────────────┘
         ▼
  VersionResult {
    version: string
    downloadUrls: string[]
    publishedAt?: Date
    changelog?: string
  }
```

**Provider interface:**

```typescript
interface VersionResult {
  version: string;
  downloadUrls: string[];
  publishedAt?: Date;
  changelog?: string;
}

interface VersionProvider {
  canHandle(url: string): boolean;
  detect(url: string, config: AppConfig): Promise<VersionResult>;
}
```

**GitHub provider** (API-based, no browser needed):
- Parse `owner/repo` from URL variants (`github.com/owner/repo`, `/releases`, `/tags`)
- Call `GET https://api.github.com/repos/{owner}/{repo}/releases/latest`
- If no releases exist, fall back to `GET .../tags` and pick the first
- Extract version from tag name (strip `v` prefix)
- Collect release asset URLs; filter by `asset_pattern` if provided
- Respect rate limits (unauthenticated: 60 req/hr; allow optional token config)

**Generic web provider** (Puppeteer + Cheerio):

The generic provider handles two distinct tasks: **version detection** (scraping the page for version info) and **download URL resolution** (navigating through intermediate pages and timers to capture the real download URL).

#### Step 1: Version Detection

1. Launch Puppeteer with `puppeteer-extra` and the `stealth` plugin to bypass bot detection
2. Navigate to the URL, wait for page to settle (`networkidle2` or a configurable wait)
3. Extract the fully-rendered HTML from the page
4. Parse with Cheerio for structured extraction:
   - **Version extraction** — priority order:
     - User-provided `versionSelector` + `versionPattern` (if configured)
     - Search for semver-like patterns (`\bv?\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?\b`) near keywords like "latest", "current", "download", "version", "release"
     - Score candidates by proximity to these keywords and by heading level
   - **Download link extraction** — priority order:
     - User-provided `downloadSelector` + `downloadPattern`
     - Find all `<a href>` pointing to known binary extensions: `.dmg`, `.exe`, `.msi`, `.pkg`, `.zip`, `.tar.gz`, `.tar.xz`, `.tar.bz2`, `.AppImage`, `.deb`, `.rpm`, `.snap`, `.flatpak`
     - Filter by `assetPattern` if provided
     - Rank by proximity to the detected version string in the DOM

#### Step 2: Download URL Resolution

Many download pages don't link directly to the file — they require clicking through intermediate pages, and some sites (e.g., SourceForge, MEGA) enforce a countdown timer before the download auto-starts. The goal of this step is to **resolve the final direct download URL** so it can be handed to our download manager (which handles resumable transfers).

**Approach: CDP download interception**

1. Use Chrome DevTools Protocol (`Page.setDownloadBehavior`) to prevent the browser from actually saving files — we only want to capture the URL
2. Register listeners:
   - `Page.downloadWillBegin` (CDP) — fires when a download is triggered, provides the final URL
   - `page.on('response')` — watch for responses with `content-disposition: attachment` or binary content types as a fallback
3. Navigate to the download link found in Step 1
4. **Click-through loop** (max depth: 5 clicks, total timeout: 60s):
   - Look for a clickable download trigger on the current page, using (in priority order):
     - User-provided `downloadSelector`
     - Buttons/links matching text heuristics: "Download", "Download Now", "Direct Download", "Free Download", "Get", "Start Download"
     - Links whose `href` contains known binary extensions
   - Click the element and wait for one of:
     - **Download interception fires** → we have the final URL, done
     - **Page navigates** → we're on an intermediate page, repeat the loop
     - **Neither after 15s** → the page may have a countdown timer, keep waiting up to 60s total for a download event
5. Once the final download URL is captured, cancel any browser-initiated download and pass the URL to the download manager

**Why intercept instead of letting Puppeteer download?**
- Our download manager supports HTTP Range (resume), progress tracking, retries, and checksum verification
- Puppeteer's built-in download has none of that
- We only need the browser to *navigate* — the actual file transfer is a simple HTTP GET

6. Close the page (reuse browser instance across checks to save memory)

**Puppeteer lifecycle management:**
- Maintain a single long-lived browser instance, launched on server start
- Reuse across scraping jobs to avoid repeated cold starts (~2s each)
- Restart on crash or after a configurable number of pages (e.g., 50) to prevent memory leaks
- Shut down cleanly on server stop

**Version comparison:**

```typescript
function compareVersions(current: string, latest: string): number {
  // Returns: positive if latest > current, 0 if equal, negative if latest < current
  // Supports:
  //   - Semantic versions: 1.2.3, 1.2.3-beta.1
  //   - Two-part: 1.2
  //   - v-prefixed: v1.2.3
  //   - Date-based: 2024.01.15
  // Uses semver library with fallback to localeCompare
}
```

### 5.2 Download Manager

Handles downloading files with resume capability and progress tracking.

**Key behaviors:**
- Downloads go to `${DOWNLOAD_DIR}/{app_name}/` (configurable via env, default `/data/downloads`)
- In-progress files use a `.part` suffix; renamed on completion
- Resume: read `downloadedBytes` from DB, send `Range: bytes={downloadedBytes}-` header
- If server doesn't support Range (no `Accept-Ranges` header), restart from zero
- Stream to disk in chunks using Node.js streams, update `downloadedBytes` in DB periodically (every ~1 MB or 5 seconds)
- On completion: verify checksum if available, update `application.currentVersion`, remove `.part` suffix
- Retry on transient failures (network errors, 5xx) with exponential backoff, max 3 retries
- Concurrent download limit: configurable (default 2)

**Resumability guarantee:**
- On app startup, scan for downloads with status `downloading` → set to `paused`
- User or scheduler can resume paused downloads
- The `.part` file on disk + `downloadedBytes` in DB form the resume checkpoint

### 5.3 Scheduler

Uses `node-cron` running inside the Fastify process.

- **Global check job**: runs at a configurable interval (default: every 6 hours)
- On each tick:
  1. Query all applications where `status = 'active'` and `lastCheckedAt + checkInterval < now`
  2. For each, run the version detection provider
  3. Update `latestVersion` and `lastCheckedAt`
  4. If `latestVersion != currentVersion`, create a download record with status `pending`
  5. Process pending downloads (up to concurrency limit)
- Manual check: user can trigger an immediate check via API for a single app

## 6. API Design

### Auth

| Method | Endpoint            | Description                     |
| ------ | ------------------- | ------------------------------- |
| POST   | `/api/auth/login`   | Login; sets session cookie      |
| POST   | `/api/auth/logout`  | Clears session cookie           |
| GET    | `/api/auth/me`      | Returns current user (or 401)   |

### Applications

| Method | Endpoint                   | Description                        |
| ------ | -------------------------- | ---------------------------------- |
| GET    | `/api/apps`                | List all monitored apps            |
| POST   | `/api/apps`                | Add a new app                      |
| GET    | `/api/apps/{id}`           | Get app details + recent downloads |
| PUT    | `/api/apps/{id}`           | Update app configuration           |
| DELETE | `/api/apps/{id}`           | Remove app and its downloads       |
| POST   | `/api/apps/{id}/check`     | Trigger immediate version check    |
| POST   | `/api/apps/{id}/download`  | Trigger manual download of latest  |

### Downloads

| Method | Endpoint                      | Description                 |
| ------ | ----------------------------- | --------------------------- |
| GET    | `/api/downloads`              | List downloads (filterable) |
| GET    | `/api/downloads/{id}`         | Get download detail         |
| POST   | `/api/downloads/{id}/pause`   | Pause an active download    |
| POST   | `/api/downloads/{id}/resume`  | Resume a paused download    |
| DELETE | `/api/downloads/{id}`         | Cancel and delete download  |

### Settings

| Method | Endpoint          | Description                              |
| ------ | ----------------- | ---------------------------------------- |
| GET    | `/api/settings`   | Get global settings (check interval etc) |
| PUT    | `/api/settings`   | Update global settings                   |

## 7. Frontend

### Pages

1. **Login** `/login` — username/password form, redirects to dashboard on success
2. **Dashboard** `/` — grid of app cards showing name, current vs latest version, status badge, last checked time
3. **Add App** `/apps/new` — form with URL input (auto-detects source type), name, optional advanced overrides (selectors, patterns)
4. **App Detail** `/apps/:id` — full info, version history (from download records), edit/delete actions, manual check/download buttons
5. **Downloads** `/downloads` — table of all downloads with progress bars, pause/resume/cancel controls

### Key Components

- `AppCard` — compact app summary with status badge (up-to-date / update available / downloading / error)
- `AppForm` — reusable add/edit form; shows detected source type from URL
- `DownloadProgress` — progress bar with speed, ETA, pause/resume
- `StatusBadge` — colored indicator
- `ConfirmDialog` — for destructive actions (delete app)

### Status Polling

- Dashboard polls `GET /api/apps` every 10 seconds to refresh statuses
- Download progress polls `GET /api/downloads/{id}` every 2 seconds while active
- Alternative: WebSocket for real-time updates (optional enhancement)

## 8. Authentication

Keep it simple — no OAuth, no JWT rotation, no external identity providers.

- On first run, if no user exists, show a setup page to create username + password
- Password hashed with bcryptjs
- Login creates a server-side session: random token stored in DB, sent as `HttpOnly`, `SameSite=Strict` cookie
- All `/api/*` routes (except `/api/auth/login`) require valid session
- Session expiry: 7 days, refreshed on activity
- Frontend: if any API call returns 401, redirect to `/login`

## 9. Project Structure

```
app-updater/
├── plan/
│   └── plan.md
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                     # Fastify app entry, plugin registration, static serving
│       ├── config.ts                    # Environment config with defaults
│       ├── db/
│       │   ├── client.ts               # better-sqlite3 + Drizzle setup
│       │   ├── schema.ts               # Drizzle table definitions
│       │   └── migrate.ts              # Run migrations on startup
│       ├── auth/
│       │   ├── auth.ts                 # Password hashing, session management
│       │   └── authPlugin.ts           # Fastify plugin: session cookie check on /api/*
│       ├── routes/
│       │   ├── authRoutes.ts
│       │   ├── appRoutes.ts
│       │   ├── downloadRoutes.ts
│       │   └── settingsRoutes.ts
│       └── services/
│           ├── scheduler.ts            # node-cron setup, check job
│           ├── downloadManager.ts      # Streaming download with resume
│           ├── versionChecker.ts       # Orchestrates provider selection + comparison
│           ├── versionCompare.ts       # Version parsing and comparison logic
│           ├── browserManager.ts       # Puppeteer lifecycle (launch, reuse, restart)
│           └── providers/
│               ├── types.ts            # VersionProvider interface, VersionResult type
│               ├── github.ts           # GitHub Releases/Tags API
│               ├── gitlab.ts           # GitLab Releases API
│               └── generic.ts          # Puppeteer + Cheerio scraping
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/
│       │   └── client.ts              # Fetch wrapper, 401 redirect
│       ├── pages/
│       │   ├── Login.tsx
│       │   ├── Dashboard.tsx
│       │   ├── AppDetail.tsx
│       │   ├── AppForm.tsx
│       │   └── Downloads.tsx
│       ├── components/
│       │   ├── AppCard.tsx
│       │   ├── DownloadProgress.tsx
│       │   ├── StatusBadge.tsx
│       │   └── Layout.tsx
│       └── types/
│           └── index.ts               # Shared TypeScript types
├── Dockerfile
├── docker-compose.yml
└── .env.example                       # SECRET_KEY, DOWNLOAD_DIR, GITHUB_TOKEN, etc.
# At runtime (inside container, mounted from host):
# /data/app-updater.db                 # SQLite database
# /data/downloads/                     # Downloaded files organized by app name
```

## 10. Implementation Phases

### Phase 1 — Foundation

Set up the project skeleton and core backend.

- [ ] Initialize TypeScript project with Fastify, Drizzle ORM, better-sqlite3
- [ ] Define Drizzle schema and set up auto-migration on startup
- [ ] Implement config loading from `.env`
- [ ] Implement auth: user creation (first-run), login/logout, session plugin
- [ ] Implement app CRUD route handlers
- [ ] Write basic tests for auth and CRUD

### Phase 2 — Version Detection

Build the provider system and version comparison logic.

- [ ] Define `VersionProvider` interface and `VersionResult` type
- [ ] Implement GitHub provider (releases API, tags fallback, asset filtering)
- [ ] Set up `browserManager.ts` — Puppeteer lifecycle (launch, reuse, graceful shutdown)
- [ ] Implement generic web provider using Puppeteer + Cheerio (version regex, download link extraction)
- [ ] Implement URL classifier (auto-detect source type from URL)
- [ ] Implement version comparison (semver library with fallback)
- [ ] Add `POST /api/apps/{id}/check` endpoint
- [ ] Write tests with mocked HTTP responses

### Phase 3 — Download Manager

Build resumable download support.

- [ ] Implement streaming download with Node.js fetch + fs streams
- [ ] Add HTTP Range header support for resume
- [ ] Track progress in DB, update periodically
- [ ] Handle `.part` file lifecycle (create -> write -> rename)
- [ ] Add checksum verification (when available from provider)
- [ ] Implement pause/resume/cancel route handlers
- [ ] Recovery on startup: mark interrupted downloads as paused
- [ ] Write tests for resume and failure scenarios

### Phase 4 — Scheduler

Wire up periodic checking and automatic downloads.

- [ ] Set up node-cron scheduled job
- [ ] Implement the periodic check job (iterate apps, detect versions, queue downloads)
- [ ] Respect per-app `checkIntervalMinutes`
- [ ] Process download queue with concurrency limit
- [ ] Add settings routes for global check interval

### Phase 5 — Frontend

Build the React UI.

- [ ] Scaffold Vite + React + TypeScript project
- [ ] Set up Tailwind CSS
- [ ] Build API client with fetch wrapper and 401 handling
- [ ] Build Login page
- [ ] Build Dashboard with AppCard grid and status badges
- [ ] Build Add/Edit App form with URL auto-detection feedback
- [ ] Build App Detail page with download history
- [ ] Build Downloads page with progress bars and controls
- [ ] Configure Vite proxy for dev; Fastify static file serving for prod

### Phase 6 — Polish & Deployment

- [ ] Add first-run setup flow (create initial user)
- [ ] Error handling and user-friendly error messages
- [ ] Add GitLab provider
- [ ] Dockerfile (multi-stage: build frontend, then bundle into a `node:20-bookworm` image with Chromium deps for Puppeteer) + docker-compose with volume mount for `/data`
- [ ] Basic logging (pino, built into Fastify)
- [ ] Manual end-to-end test with real applications (e.g., a GitHub repo, a generic download page behind bot detection)
