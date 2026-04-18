# Version Detection Logic: Deep Review

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Entry Points and Trigger Mechanisms](#2-entry-points-and-trigger-mechanisms)
3. [Provider Selection and Source Classification](#3-provider-selection-and-source-classification)
4. [GitHub Provider](#4-github-provider)
5. [Generic Provider (Web Scraping)](#5-generic-provider-web-scraping)
6. [Version Extraction Heuristics (Core Algorithm)](#6-version-extraction-heuristics-core-algorithm)
7. [False Positive Filtering](#7-false-positive-filtering)
8. [Version Scoring System](#8-version-scoring-system)
9. [Download URL Extraction](#9-download-url-extraction)
10. [Version-to-Download Cross-Checking](#10-version-to-download-cross-checking)
11. [Version Comparison](#11-version-comparison)
12. [Download URL Resolution (Post-Detection)](#12-download-url-resolution-post-detection)
13. [User-Configurable Overrides](#13-user-configurable-overrides)
14. [Data Flow Summary](#14-data-flow-summary)
15. [Issues, Edge Cases, and Improvement Opportunities](#15-issues-edge-cases-and-improvement-opportunities)

---

## 1. Architecture Overview

The version detection system follows a **provider-based architecture** with two concrete providers:

```
versionChecker.ts          -- orchestrator: selects provider, runs detection, persists results
  |
  +-- providers/
  |     +-- types.ts       -- VersionProvider interface & VersionResult type
  |     +-- classifier.ts  -- URL-based source type classification
  |     +-- github.ts      -- GitHub API-based detection (releases + tags)
  |     +-- generic.ts     -- Headless-browser scraping with heuristic extraction
  |
  +-- versionCompare.ts    -- semver-based version comparison with fallback
  +-- browserManager.ts    -- Puppeteer browser pool (stealth plugin)
  +-- scheduler.ts         -- Cron-based periodic check cycle
```

Key design principle: **two-phase detection**. Version detection (which version exists) is separated from download resolution (getting the final binary URL). Detection happens during checks; download URL resolution happens lazily at download time, only for the generic provider.

---

## 2. Entry Points and Trigger Mechanisms

Version detection is triggered through two paths:

### 2a. Scheduled Check Cycle (`scheduler.ts`)

- A cron job runs at a global interval (`CHECK_INTERVAL`, default 720 minutes = 12 hours).
- `runCheckCycle()` iterates all `status="active"` applications.
- Per-app throttling: skips apps whose `lastCheckedAt` + per-app `checkIntervalMinutes` hasn't elapsed.
- On update found, auto-queues a download if `activeDownloads < maxConcurrentDownloads`.

### 2b. Manual Check (`POST /api/apps/:id/check`)

- User-initiated via the UI's "Check Now" button.
- Calls `checkAppForUpdates(app)` directly, bypassing the interval throttle.
- On failure, sets the app to `status="error"` with the error message.

### 2c. Implicit Re-detection (`downloadManager.ts:queueDownload`)

- If the in-memory `latestResults` cache is empty (e.g., server restarted), `queueDownload` re-runs `checkAppForUpdates` to populate it before downloading.

---

## 3. Provider Selection and Source Classification

### Classification (`classifier.ts`)

URL-based classification at app creation/update time:

| Hostname Pattern               | Result     |
|--------------------------------|------------|
| `github.com`, `www.github.com` | `"github"` |
| `gitlab.com`, `www.gitlab.com` | `"gitlab"` |
| Everything else                | `"generic"`|
| Invalid URL (parse error)      | `"generic"`|

**Note:** GitLab is classified but has **no dedicated provider** -- it falls through to the generic provider. This is a classification without a handler.

### Provider Selection (`versionChecker.ts:getProvider`)

Runtime provider selection follows this priority:

1. **Explicit match:** If `app.sourceType === "github"`, use `githubProvider`.
2. **Explicit match:** If `app.sourceType === "generic"`, use `genericProvider`.
3. **Auto-detect:** Iterate providers and call `provider.canHandle(url)`.
   - `githubProvider.canHandle` checks if `parseGitHubRepo(url)` succeeds.
   - `genericProvider.canHandle` always returns `true` (fallback).
4. **Final fallback:** `genericProvider`.

**Flow for `sourceType="auto"`:**
When the user sets source type to "auto" (the default), `classifySource` runs at app creation/update in `appRoutes.ts` and **overwrites** the stored `sourceType`. So by the time `getProvider` runs, `sourceType` is already resolved to `"github"`, `"gitlab"`, or `"generic"` -- the auto-detect loop in `getProvider` only activates if `sourceType` is something unexpected.

**Flow for `sourceType="gitlab"`:**
Falls through both explicit checks, hits the auto-detect loop, `githubProvider.canHandle` returns false for gitlab.com, `genericProvider.canHandle` returns true. Result: **generic provider** handles GitLab URLs.

---

## 4. GitHub Provider

**File:** `providers/github.ts`

### 4a. URL Parsing

`parseGitHubRepo(url)` extracts `owner` and `repo` from the URL pathname. Handles:
- `https://github.com/owner/repo`
- `https://github.com/owner/repo/releases`
- `https://github.com/owner/repo/releases/tag/v1.0`
- `https://github.com/owner/repo/tags`

Rejects URLs with fewer than 2 path segments (e.g., `https://github.com/owner`).

### 4b. Detection Strategy

Two-step approach with fallback:

**Step 1: Latest Release API**
```
GET https://api.github.com/repos/{owner}/{repo}/releases/latest
```
- Uses `app.githubToken` for authentication if configured (avoids rate limits).
- Extracts `tag_name` as the version string.
- Extracts `assets[].browser_download_url` as download URLs.
- Extracts `published_at` and `body` (changelog).
- Filters assets through `app.assetPattern` if set.

**Step 2: Tags Fallback** (if releases API returns non-200)
```
GET https://api.github.com/repos/{owner}/{repo}/tags?per_page=1
```
- Takes the first (most recent) tag's `name` as the version.
- Constructs tarball and zipball URLs from the tag name.
- No changelog available from tags.

### 4c. Asset Filtering

`filterAssets(urls, pattern)` applies a user-provided regex (case-insensitive) to filter download URLs. Returns all URLs if no pattern is set or if the regex is invalid.

### 4d. Limitations

- **Pre-releases:** The `/releases/latest` endpoint skips pre-releases and drafts. If the only releases are pre-releases, it falls back to tags. This is usually desirable but not configurable.
- **Tag ordering:** The tags API returns tags in reverse chronological order by default, but this is by creation date, not semver. A tag `v1.0` created after `v2.0` would be returned first. This is a GitHub API behavior, not a bug in this code.
- **No pagination:** Only checks the single latest release / first tag. Cannot skip specific releases.

---

## 5. Generic Provider (Web Scraping)

**File:** `providers/generic.ts`

This is the most complex component. It handles arbitrary websites by:

1. Loading the page in a headless browser (Puppeteer with stealth plugin)
2. Parsing HTML with Cheerio
3. Extracting version candidates via heuristics
4. Extracting download links via heuristics
5. Cross-checking versions against download URLs

### 5a. Browser Setup

- Uses `puppeteer-extra` with `StealthPlugin` to avoid bot detection.
- Browser instance is pooled and restarted after 50 page loads (`MAX_PAGES_BEFORE_RESTART`).
- User-agent is set to a realistic Chrome 131 string.
- Pages are loaded with `waitUntil: "networkidle2"` (no more than 2 network connections for 500ms).
- 30-second timeout on navigation.
- `<script>`, `<style>`, `<noscript>` elements are stripped before analysis.

### 5b. Detection Pipeline

```
page.goto(url)
     |
     v
cheerio.load(html)
     |
     +---> extractVersions() --> version candidates (scored)
     |
     +---> extractDownloadLinks() --> download URL candidates
     |
     v
cross-check: align version with download URLs
     |
     v
apply assetPattern filter
     |
     v
return { version, downloadUrls }
```

---

## 6. Version Extraction Heuristics (Core Algorithm)

**Function:** `extractVersions($, selector?, pattern?, nameFilter?)`

### 6a. User-Override Path (Priority)

If `versionSelector` is provided:
1. Select elements matching the CSS selector.
2. Apply `versionPattern` (or default `VERSION_REGEX`) to the element text.
3. Return matches with score 100 (highest priority).
4. **If matches are found, skip heuristic detection entirely.**

### 6b. Heuristic Path

When no selector is provided (or selector yields no matches):

**Step 1: Element Scanning**

Scans these HTML elements: `h1, h2, h3, h4, h5, h6, p, span, div, a, li, td, th, strong, em, b, label`.

For each element:
- Extracts **direct text content** (text nodes only, not child element text) -- used for existence check.
- Extracts **full text** (including descendants) -- used for regex matching and name filtering.
- If `nameFilter` is set, skips elements whose full text doesn't contain the filter string (case-insensitive).

**Step 2: Regex Matching**

The core regex `VERSION_REGEX`:
```
/\bv?(\d+\.\d+(?:\.\d+){0,2}(?:-(?:alpha|beta|rc|dev|pre|snapshot)(?:\.\d+)?)?)\b|\bbuild\s+(\d+)\b/gi
```

This matches:
- `1.2`, `1.2.3`, `1.2.3.4` (2-4 dotted numeric segments)
- Optional `v` prefix: `v1.2.3`
- Pre-release suffixes: `-alpha`, `-beta.1`, `-rc`, `-rc.2`, `-dev`, `-pre`, `-snapshot`
- `Build XXXX` patterns (common in some software)
- Word-boundary anchored (`\b`) to avoid matching inside longer strings

**Does NOT match:**
- Date-based versions like `2024.01.15` (the regex itself would match, but filtering may catch it)
- CalVer with month names
- Single-number versions like `42`
- Versions with non-standard separators like `1_2_3`
- Hash-based versions like `abc1234`

**Step 3: False Positive Filtering**

Each match passes through `shouldSkipVersion()` (detailed in section 7).

**Step 4: Scoring**

Each surviving candidate receives a composite score (detailed in section 8).

**Step 5: Deduplication and Sorting**

- Deduplicates by version string, keeping the highest-scoring occurrence.
- Sorts by score descending.
- Within the same score, preserves page order (first occurrence wins).

---

## 7. False Positive Filtering

**Function:** `shouldSkipVersion(version, fullMatch, fullText, matchIndex)`

Examines a 30-character window before and 10-character window after the match. Filters out:

| Filter | Example Caught | Logic |
|--------|---------------|-------|
| Zero versions | `0.0`, `0.0.0` | Regex: `/^0\.0(\.0)*$/` |
| Size units | `8.1 MB`, `2.4 GB` | Looks for `B`, `KB`, `MB`, `GB`, `TB`, `KiB`, `MiB`, `GiB` after match |
| Range expressions | `0.0 to 1.0`, `from 1.0` | Detects `to`, `through`, `-` after, or `from`, `between` before |
| OS/product versions | `Windows 10`, `macOS 14.1`, `OpenSSL 3.0` | 30+ product/OS names in `PRODUCT_PREFIX_REGEX` |
| OS version lists | `Vista, 7, 8, 8.1, 10` | Comma-preceded number + page mentions Windows/macOS/etc. |
| Date-adjacent | `January 17.01` | Date month names within 20 chars before match (only for major version < 100) |

**Notable gaps in filtering:**
- Doesn't filter IP addresses (`192.168.1.1`)
- Doesn't filter CSS/font sizes (`font-size: 1.2`)
- Doesn't filter coordinates or mathematical values
- Date filtering only checks text *before* the match, not structured date patterns
- The major < 100 check for date filtering means versions like `2024.1.1` bypass date filtering

---

## 8. Version Scoring System

Each version candidate is assigned a score composed of:

### 8a. Heading Depth Score (0-30 points)

```
h1 = (7-1) * 5 = 30 points
h2 = (7-2) * 5 = 25 points
h3 = (7-3) * 5 = 20 points
...
h6 = (7-6) * 5 = 5 points
non-heading = 0 points
```

Rationale: versions in higher-level headings are more likely to be the main product version.

### 8b. Keyword Proximity Score (0-40 points)

Checks the element, its parent, and grandparent (3 levels up) for keyword matches:

| Keywords Found | Score |
|---------------|-------|
| `latest`, `newest`, `current`, `stable` | 40 points |
| `latest`, `current`, `stable`, `download`, `version`, `release` | 20 points |
| None | 0 points |

**Note:** There's overlap between `LATEST_KEYWORDS` and `VERSION_KEYWORDS`. The function checks `LATEST_KEYWORDS` first and returns 40 immediately, so `latest`, `current`, `stable` always score 40, not 20.

### 8c. User Selector Score

If the user provides a `versionSelector` and it matches, those candidates score **100 points**, effectively overriding all heuristic candidates.

### 8d. Scoring Implications

- Maximum heuristic score: 30 (h1) + 40 (keyword) = **70 points**
- A version in an `<h1>` near "Latest version" scores 70
- A version in a `<p>` near "Download" scores 20
- A version in a `<span>` with no keywords scores 0

**Tie-breaking:** page order (first occurrence). This means for pages listing multiple versions, the topmost version with the highest score wins.

---

## 9. Download URL Extraction

**Function:** `extractDownloadLinks($, baseUrl, selector?, pattern?)`

### 9a. User-Override Path

If `downloadSelector` is provided:
1. Select elements matching the CSS selector.
2. Extract `href` attributes, resolving relative URLs against `baseUrl`.
3. If `downloadPattern` is set, filter by regex.
4. **If matches found, skip heuristic detection.**

### 9b. Heuristic Path

**Phase 1: Extension-based detection**

Scans all `<a href>` elements. Matches URLs ending with common download extensions:
```
.dmg, .exe, .msi, .pkg, .zip, .tar.gz, .tar.xz, .tar.bz2,
.appimage, .deb, .rpm, .snap, .flatpak, .7z, .rar
```

**Phase 2: Intent-based detection** (runs if Phase 1 found nothing, or if `downloadPattern` is set)

Two sub-categories:

1. **File-type hint links:** Link text contains file type keywords in dot-prefix or parenthesized form (`.zip`, `(ZIP)`, `(SETUP)`). This avoids false positives like "MSI" as a company name.

2. **Download-text links:** Links where:
   - The `href` path contains `/download` (e.g., `/download_thanks?target=...`)
   - The link text starts with "download" (strict: must be at start, avoids nav links like "Downloads Center")

**Phase 3: Pattern filtering**

When `downloadPattern` is set, all candidates (extension + intent) are pooled and filtered by regex. Otherwise, extension matches take priority over intent matches.

### 9c. Self-link exclusion

Intent-based links are checked to avoid pointing back to the current page or parent paths. This prevents circular references.

---

## 10. Version-to-Download Cross-Checking

After extracting versions and download URLs independently, the generic provider performs a cross-check (`generic.ts:detect`, lines 509-525):

```
if downloadUrls contain the detected version string:
    filter downloadUrls to only those containing the version
else:
    iterate version candidates (by score order)
    find the first candidate whose version appears in any download URL
    if found: use that candidate as the version, filter URLs to match
```

**Purpose:** Resolves conflicts between the heuristic version detector and actual download file names. Download URLs are treated as the ground truth because they represent what will actually be served.

**Example scenario:**
- Page heading says "Latest: 4.2.1"
- Download links point to `app-4.2.0-setup.exe`
- Cross-check corrects version to `4.2.0` (assuming it appeared as a lower-scored candidate)

**Limitation:** If the detected version is `4.2.1` but download URLs use a different format like `app-421-setup.exe` (no dots), the substring match fails and the cross-check doesn't fire.

---

## 11. Version Comparison

**File:** `versionCompare.ts`

### 11a. `compareVersions(current, latest)`

1. **Fast path:** exact string equality returns 0.
2. **Semver coercion:** Uses `semver.coerce()` to parse both strings. This is very permissive:
   - `"v1.2.3-beta"` -> `1.2.3`
   - `"version 4.5"` -> `4.5.0`
   - `"Build 1234"` -> `1234.0.0`
3. **Semver comparison:** If both coerce successfully, uses `semver.compare()`.
4. **Fallback:** If either fails to coerce (shouldn't happen often with the regex above), uses `String.localeCompare()` with `numeric: true`. This gives lexicographic comparison that understands numeric ordering (e.g., "10" > "9").

### 11b. `isNewer(current, latest)`

- If `current` is `null` (no known version), any version is considered newer.
- Otherwise, delegates to `compareVersions` and checks for positive result.

### 11c. Coercion Implications

`semver.coerce()` is **lossy**:
- Pre-release suffixes are stripped: `1.2.3-alpha` and `1.2.3` coerce to the same value and compare as equal. The system won't detect `1.2.3` as an update over `1.2.3-alpha`.
- Build metadata is stripped.
- Only the first 3 numeric segments are kept: `1.2.3.4` becomes `1.2.3`, so `1.2.3.4` and `1.2.3.5` compare as equal.

---

## 12. Download URL Resolution (Post-Detection)

**Function:** `resolveGenericDownloadUrl()` in `generic.ts`

This runs at **download time**, not during version checks. Only used for generic-source apps. The goal is to turn an intermediate page URL (e.g., a SourceForge download page with a countdown timer) into the final direct binary URL.

### 12a. Strategy 1: DOM href extraction (no clicks)

Polls the page for up to 5 seconds (handles JS-injected buttons):
- Looks for `<a href>` with downloadable file extensions.
- Prefers links containing the app name.
- Falls back to links whose text is primarily "download".
- Checks for form submit buttons -- if present, defers to Strategy 2 (form-based downloads).

### 12b. Strategy 2: Click-through navigation

If no href was extracted:
- Loops up to `maxNavigationDepth` times (default 5).
- Click priority: user-provided `downloadSelector` > form submit buttons > anchor links with download text.
- After each click, waits for navigation or download event.
- Captures download via two mechanisms:
  - **HTTP response interception:** Watches for responses with `Content-Disposition: attachment` or binary content types.
  - **CDP download events:** Uses Chrome DevTools Protocol `Browser.downloadWillBegin` event.

### 12c. Temp download directory

Downloads are intercepted in a temp directory to prevent files from leaking to the user's filesystem. The temp directory is cleaned up in a `finally` block.

### 12d. Timeout

Overall timeout: `app.downloadTimeout * 1000` (default 60 seconds). Individual navigation steps are capped at 15 seconds or remaining time, whichever is less.

---

## 13. User-Configurable Overrides

Users can configure these per-application fields to override heuristic detection:

| Field | Purpose | Used By |
|-------|---------|---------|
| `nameFilter` | Only consider version text near elements containing this string | `extractVersions()` |
| `versionSelector` | CSS selector to locate the version element | `extractVersions()` |
| `versionPattern` | Regex to extract version from selected element text | `extractVersions()` |
| `downloadSelector` | CSS selector for download links | `extractDownloadLinks()`, `resolveDownloadUrl()` |
| `downloadPattern` | Regex to filter extracted download URLs | `extractDownloadLinks()` |
| `assetPattern` | Regex to filter GitHub release assets or final download URLs | `githubProvider.detect()`, `genericProvider.detect()` |
| `maxNavigationDepth` | Max click-through attempts during download resolution | `resolveDownloadUrl()` |
| `downloadTimeout` | Seconds before giving up on download resolution | `resolveDownloadUrl()` |

**Override precedence:** Selector/pattern overrides short-circuit heuristic detection. If a selector is provided and matches, heuristics are skipped entirely. If a selector is provided but matches nothing, heuristics run as fallback.

---

## 14. Data Flow Summary

```
App Created (URL + sourceType)
  |
  +-- classifySource(url) --> sourceType stored in DB
  |
  v
Check Triggered (scheduled or manual)
  |
  +-- getProvider(app) --> githubProvider or genericProvider
  |
  v
provider.detect(app)
  |
  +-- [GitHub path]:
  |     API call -> releases/latest or tags
  |     -> { version, downloadUrls, changelog }
  |
  +-- [Generic path]:
  |     Puppeteer loads page
  |     Cheerio parses HTML
  |     extractVersions() -> scored candidates
  |     extractDownloadLinks() -> URL candidates
  |     cross-check versions vs URLs
  |     -> { version, downloadUrls }
  |
  v
VersionResult cached in latestResults Map
  |
  v
isNewer(currentVersion, result.version)
  |
  +-- true: hasUpdate=true, scheduler may auto-queue download
  +-- false: hasUpdate=false
  |
  v
DB updated: latestVersion, lastCheckedAt, status="active"
  |
  v
[If download triggered]:
  queueDownload(app)
    |
    +-- [Generic source]: resolveGenericDownloadUrl()
    |     Puppeteer navigates/clicks through to final URL
    |
    +-- fetch(finalUrl) -> stream to disk
    |
    v
  DB updated: currentVersion = latestVersion
```

---

## 15. Issues, Edge Cases, and Improvement Opportunities

### Critical Issues

1. **Semver coercion loses pre-release ordering** (`versionCompare.ts:10-11`)
   - `semver.coerce("1.2.3-beta")` -> `1.2.3`. This means `1.2.3` is NOT detected as newer than `1.2.3-beta`. Users tracking pre-release channels will miss the stable release.
   - **Fix:** Use `semver.parse()` or `semver.valid()` before coercion to preserve pre-release data when present.

2. **Four-segment versions compare as equal** (`versionCompare.ts:10-11`)
   - `semver.coerce("1.2.3.4")` -> `1.2.3`. Both `1.2.3.4` and `1.2.3.5` coerce to `1.2.3` and compare equal.
   - Apps using 4-segment versioning (e.g., Chrome, many Windows apps) will miss updates.
   - **Fix:** Detect 4-segment versions and fall through to `localeCompare` instead of semver.

3. **`db.update()` not awaited** (`versionChecker.ts:50-59`)
   - The database update after a check runs synchronously (Drizzle with better-sqlite3 is synchronous), so this works by accident. But the code calls `.run()` without `await`, which is misleading and fragile if the DB driver ever changes.

4. **Race condition in latestResults cache** (`versionChecker.ts:31`)
   - `latestResults` is an in-memory `Map`. If the server restarts between a check and a download, the cache is lost. `downloadManager.ts` handles this with a re-check, but the double-fetch wastes time and browser resources.

### Moderate Issues

5. **GitLab classification without handler** (`classifier.ts:7-9`)
   - `classifySource` returns `"gitlab"` but no GitLab provider exists. These apps fall through to the generic provider via the auto-detect loop in `getProvider`. This works but is confusing -- the user sees "GitLab" as the source type but gets generic web scraping.

6. **`unused urlVersionRegex` variable** (`generic.ts:518`)
   - `const urlVersionRegex = new RegExp(VERSION_REGEX.source, "gi");` is declared but never used in the cross-check block.

7. **Version regex doesn't anchor pre-release to dotted versions** (`generic.ts:13`)
   - The pre-release suffix `(-alpha|-beta|...)` is inside the main capture group with the dotted version. This means "Build 1234" matches via the second alternative but can't have a pre-release suffix, which is correct. However, a standalone string like `"-alpha.1"` won't match (no leading digits), so this is benign.

8. **`nameFilter` applies to full element text, not just nearby text** (`generic.ts:130`)
   - The filter checks if the element's full text (including all descendants) contains the filter string. On pages with deep DOM nesting, a top-level `<div>` will match because it contains everything. This reduces the filter's effectiveness for large container elements.

9. **Download URL fallback to app URL** (`generic.ts:538-539`)
   - If no download URLs are found, the system falls back to using the app's page URL itself. This means `resolveGenericDownloadUrl` will later navigate to the same page and try to click through. This works for sites with JavaScript-driven downloads but can lead to infinite loops on static pages.

### Minor Issues / Improvement Ideas

10. **No caching of GitHub API responses**
    - Each check makes 1-2 API calls. With many GitHub-sourced apps, this could hit rate limits (60/hour unauthenticated, 5000/hour with token).

11. **Generic provider opens a new browser page per check**
    - The browser pool restarts after 50 pages. High-frequency checks with many generic apps could cause frequent browser restarts. Each restart is expensive (~1-2 seconds).

12. **No retry logic for transient failures**
    - Network errors, rate limits, and timeouts fail the entire check. No automatic retry with backoff.

13. **The scoring system doesn't consider version magnitude**
    - A version `99.0.0` in a low-scoring position beats `1.0.0` in a high-scoring position only through score. But on a changelog page, higher version numbers should generally be preferred even with lower positional scores.

14. **No heading hierarchy awareness**
    - The scoring considers individual heading level but not whether a version is under a "Latest Release" heading vs. a "System Requirements" heading. Semantic sections would improve accuracy.

15. **Download extension list inconsistency**
    - `generic.ts:DOWNLOAD_EXTENSIONS` and `downloadManager.ts:DOWNLOAD_EXTENSIONS_SIMPLE` have slightly different extension sets. `DOWNLOAD_EXTENSIONS` in generic.ts includes `.flatpak` while `DOWNLOAD_EXTENSIONS_SIMPLE` in downloadManager.ts includes `.snap`, `.flatpak`, `.bin`, `.iso`, `.img`.

16. **`extractDownloadLinks` returns duplicates in edge cases**
    - Extension-based links are deduplicated with `new Set()` at the end, but intent-based links pushed in the `if (pattern)` branch can duplicate extension-based links that were already in `links[]`.

17. **IP address false positives in version detection**
    - The version regex would match `192.168.1.1` as version `192.168.1.1`. No filter exists for IP-address-like patterns. Adding a filter for `\d+\.\d+\.\d+\.\d+` where all segments are 0-255 would help.

18. **CSS property values could match** 
    - Although `<style>` tags are removed, inline styles like `style="width: 1.5"` could still have their text content match the version regex if the element is scanned. The direct-text check mitigates this for most cases.
