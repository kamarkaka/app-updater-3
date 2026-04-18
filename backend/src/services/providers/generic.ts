import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { Page, HTTPResponse, CDPSession } from "puppeteer";
import { Application } from "../../db/schema.js";
import { getBrowser, incrementPageCount } from "../browserManager.js";
import { VersionProvider, VersionResult } from "./types.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Matches dotted versions (1.2, 1.2.3, 1.2.3.4) and "Build XXXX" patterns
// Pre-release suffix: -alpha, -beta.1, -rc, -rc.2 (not filenames like -64.zip, -install.exe)
const VERSION_REGEX = /\bv?(\d+\.\d+(?:\.\d+){0,2}(?:-(?:alpha|beta|rc|dev|pre|snapshot)(?:\.\d+)?)?)\b|\bbuild\s+(\d+)\b/gi;
const VERSION_KEYWORDS = [
  "latest",
  "current",
  "stable",
  "download",
  "version",
  "release",
];

// Date-like patterns that the version regex might match (e.g., "January 17, 2023" → "17.01")
const DATE_CONTEXT_REGEX = /(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+\d|,\s*\d{4}|\d{4}[-/]\d{2}/i;

// Product/OS/library names that precede version-like numbers — not the software's own version
const PRODUCT_PREFIX_REGEX = /(?:windows|macos|mac\s*os\s*x?|os\s*x|android|ios|ubuntu|debian|fedora|rhel|centos|geforce|radeon|intel|nvidia|amd|driver|drivers|directx|opengl|openssl|vulkan|cuda|bios|firmware|kernel|gcc|clang|llvm|cmake|qt|gtk|glibc|libssl|zlib)\s+(?:to\s+)?$/i;

// Size units that follow version-like numbers (e.g., "8.1 MB")
const SIZE_SUFFIX_REGEX = /^\s*(?:b|kb|mb|gb|tb|bytes|kib|mib|gib)\b/i;

function shouldSkipVersion(version: string, fullMatch: string, fullText: string, matchIndex: number): boolean {
  const matchEnd = matchIndex + fullMatch.length;
  const textBefore = fullText.slice(Math.max(0, matchIndex - 30), matchIndex);
  const textAfter = fullText.slice(matchEnd, matchEnd + 10);

  // Skip "0.0" — not a real software version
  if (/^0\.0(\.0)*$/.test(version)) return true;

  // Check if followed by a size unit (e.g., "8.1 MB")
  if (SIZE_SUFFIX_REGEX.test(textAfter)) return true;

  // Check if part of a range (e.g., "0.0 to 1.0", "from 1.0", "1.0 - 2.0")
  if (/^\s*(?:to|through|-)\s+\d/i.test(textAfter)) return true;
  if (/(?:from|between)\s+$/i.test(textBefore)) return true;
  if (/\d\s+(?:to|through|-)\s+$/i.test(textBefore)) return true;

  // Check if preceded by a product/OS/driver/library name
  if (PRODUCT_PREFIX_REGEX.test(textBefore)) return true;

  // Check if in a comma-separated list of OS versions (e.g., "Windows XP, Vista, 7, 8, 8.1, 10")
  if (/,\s*$/.test(textBefore) && /windows|macos|android|ios|ubuntu/i.test(fullText)) return true;

  // Check if the version is preceded by date context (e.g., "January 17.01")
  // Only check before the match — release dates AFTER the version are normal
  const major = parseInt(version.split(".")[0]);
  if (major < 100) {
    if (DATE_CONTEXT_REGEX.test(textBefore.slice(-20))) return true;
  }

  return false;
}

// Keywords that strongly indicate the actual latest version
const LATEST_KEYWORDS = ["latest", "newest", "current", "stable"];
const DOWNLOAD_EXTENSIONS =
  /\.(dmg|exe|msi|pkg|zip|tar\.gz|tar\.xz|tar\.bz2|appimage|deb|rpm|snap|flatpak|7z|rar)$/i;

const DOWNLOAD_BUTTON_TEXTS = [
  "download",
  "download now",
  "direct download",
  "free download",
  "get",
  "start download",
];

export interface VersionSuggestion {
  version: string;
  score: number;
  selector: string;
  pattern: string;
  context: string;
}

function validClasses($el: cheerio.Cheerio<any>): string[] {
  return ($el.attr("class") || "")
    .trim()
    .split(/\s+/)
    .filter((c) => c && /^[a-zA-Z_][\w-]*$/.test(c));
}

function generateSelector($: cheerio.CheerioAPI, el: Element): string {
  const tag = (el as any).tagName?.toLowerCase() || "";
  const $el = $(el);

  const id = $el.attr("id");
  if (id && /^[a-zA-Z_][\w-]*$/.test(id)) {
    if ($(`#${id}`).length === 1) return `#${id}`;
  }

  const classes = validClasses($el);
  if (classes.length > 0) {
    for (const cls of classes) {
      const sel = `${tag}.${cls}`;
      if ($(sel).length <= 5) return sel;
    }
  }

  const $parent = $el.parent();
  if ($parent.length) {
    const parentId = $parent.attr("id");
    if (parentId && /^[a-zA-Z_][\w-]*$/.test(parentId)) {
      return `#${parentId} ${tag}`;
    }
    const parentTag = ($parent[0] as any)?.tagName?.toLowerCase() || "";
    const parentClasses = validClasses($parent);
    if (parentClasses.length > 0) {
      return `${parentTag}.${parentClasses[0]} ${tag}`;
    }
  }

  return tag;
}

function generatePattern(version: string, fullMatch: string): string {
  if (/^build\s+/i.test(fullMatch)) {
    return "Build\\s+(\\d+)";
  }

  const hasV = /^v\d/i.test(fullMatch);
  const dotCount = (version.match(/\./g) || []).length;
  const hasPreRelease = /-/.test(version);

  let inner = "\\d+";
  for (let i = 0; i < dotCount; i++) {
    inner += "\\.\\d+";
  }

  if (hasPreRelease) {
    inner += "(?:-(?:alpha|beta|rc|dev|pre|snapshot)(?:\\.\\d+)?)?";
  }

  return `${hasV ? "v?" : ""}(${inner})`;
}

export function suggestVersions($: cheerio.CheerioAPI): VersionSuggestion[] {
  interface RawCandidate {
    version: string;
    score: number;
    el: Element;
    fullMatch: string;
    context: string;
  }

  const candidates: RawCandidate[] = [];

  function keywordScore($el: cheerio.Cheerio<any>): number {
    let best = 0;
    for (let i = 0; i < 3; i++) {
      const text = ($el.text() || "").toLowerCase();
      if (LATEST_KEYWORDS.some((kw) => text.includes(kw))) return 40;
      if (VERSION_KEYWORDS.some((kw) => text.includes(kw))) best = 20;
      const $parent = $el.parent();
      if ($parent.length === 0) break;
      $el = $parent;
    }
    return best;
  }

  const versionRegex = new RegExp(VERSION_REGEX.source, "gi");

  $("h1, h2, h3, h4, h5, h6, p, span, div, a, li, td, th, strong, em, b, label").each((_, el) => {
    const $el = $(el);
    const directText = $el
      .contents()
      .filter((_, node) => node.type === "text")
      .text()
      .trim();
    if (!directText) return;

    const fullText = $el.text();

    versionRegex.lastIndex = 0;
    let match;
    while ((match = versionRegex.exec(fullText)) !== null) {
      const version = match[1] || match[2];
      if (!version) continue;
      if (shouldSkipVersion(version, match[0], fullText, match.index)) continue;

      const tagName = (el as any).tagName?.toLowerCase() || "";
      const depthScore = tagName.startsWith("h") ? (7 - parseInt(tagName[1])) * 5 : 0;

      let score = depthScore;
      score += keywordScore($el);

      const matchEnd = match.index + match[0].length;
      const ctxStart = Math.max(0, match.index - 30);
      const ctxEnd = Math.min(fullText.length, matchEnd + 30);
      const context = fullText.slice(ctxStart, ctxEnd).trim();

      candidates.push({
        version,
        score,
        el: el as Element,
        fullMatch: match[0],
        context,
      });
    }
  });

  const bestByVersion = new Map<string, RawCandidate>();
  for (const c of candidates) {
    const existing = bestByVersion.get(c.version);
    if (!existing || c.score > existing.score) {
      bestByVersion.set(c.version, c);
    }
  }
  const unique = [...bestByVersion.values()];
  unique.sort((a, b) => b.score - a.score);

  return unique.map((c) => ({
    version: c.version,
    score: c.score,
    selector: generateSelector($, c.el),
    pattern: generatePattern(c.version, c.fullMatch),
    context: c.context,
  }));
}

export function extractDownloadLinks($: cheerio.CheerioAPI, baseUrl: string, selector?: string | null, pattern?: string | null): string[] {
  const links: string[] = [];

  if (selector) {
    $(selector).each((_, el) => {
      const href = $(el).attr("href");
      if (href) {
        try {
          links.push(new URL(href, baseUrl).href);
        } catch { /* skip invalid URLs */ }
      }
    });
    if (links.length > 0) {
      if (pattern) {
        const regex = new RegExp(pattern, "i");
        return links.filter((l) => regex.test(l));
      }
      return links;
    }
  }

  // Heuristic: find all links pointing to downloadable files
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const fullUrl = new URL(href, baseUrl).href;
      if (DOWNLOAD_EXTENSIONS.test(fullUrl)) {
        links.push(fullUrl);
      }
    } catch { /* skip */ }
  });

  // Also look for download-intent links (text or href suggests a download,
  // even without a file extension). These are entry points for pages like
  // SourceForge where the actual download is behind a countdown/redirect,
  // or Geeks3D where link text mentions the file type (e.g., "(ZIP)", "(SETUP)").
  // Always collect these when a download_pattern is set (the pattern might
  // target intent-based URLs like /download_thanks?target=win-x64-portable).
  if (links.length === 0 || pattern) {
    // Match file type keywords when preceded by a dot (.zip, .exe) or in parens (ZIP).
    // Excludes bare words like "MSI" (company name) from matching ".msi" (file type).
    const FILE_TYPE_HINTS = /[.(](zip|exe|msi|dmg|pkg|deb|rpm|appimage|7z|7zip)\b|\b(setup|installer|tar\.gz|tar\.xz)\b/i;
    const fileTypeLinks: string[] = [];
    const downloadTextLinks: string[] = [];

    $("a[href]").each((_, el) => {
      const $a = $(el);
      const href = $a.attr("href") || "";
      const text = ($a.text() || "").toLowerCase().trim();

      try {
        const fullUrl = new URL(href, baseUrl).href;
        // Skip links pointing to the current page or parent paths
        if (fullUrl === baseUrl || fullUrl === baseUrl + "/") return;
        const baseWithoutTrailing = baseUrl.replace(/\/$/, "");
        if (baseWithoutTrailing.startsWith(fullUrl.replace(/\/$/, ""))) return;

        if (FILE_TYPE_HINTS.test(text)) {
          fileTypeLinks.push(fullUrl);
        } else if (/\/download(?:_\w+)?(?:\/|$|\?)/i.test(href)) {
          downloadTextLinks.push(fullUrl);
        } else if (/^download( |$)/i.test(text) || /^download (now|latest)/i.test(text)) {
          // Strict match: text starts with "download", not just contains it
          // Avoids matching nav links like "Downloads", "Download Center"
          downloadTextLinks.push(fullUrl);
        }
      } catch { /* skip */ }
    });

    // When a pattern is set, include all candidates so the pattern can select the right one.
    // Otherwise prefer file-type links, fall back to download-text links.
    if (pattern) {
      links.push(...fileTypeLinks, ...downloadTextLinks);
    } else {
      links.push(...(fileTypeLinks.length > 0 ? fileTypeLinks : downloadTextLinks));
    }
  }

  if (pattern) {
    const regex = new RegExp(pattern, "i");
    return links.filter((l) => regex.test(l));
  }

  return [...new Set(links)];
}

async function resolveDownloadUrl(
  page: Page,
  initialUrl: string,
  app: Application
): Promise<string> {
  const maxDepth = app.maxNavigationDepth ?? 5;
  const timeout = (app.downloadTimeout ?? 60) * 1000;
  const startTime = Date.now();

  // Redirect Chromium downloads to a temp dir so they don't leak elsewhere.
  // We only need the URL — files here are cleaned up after interception.
  const tmpDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "app-updater-intercept-"));
  const cdp: CDPSession = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior" as any, {
    behavior: "allowAndName",
    downloadPath: tmpDownloadDir,
    eventsEnabled: true,
  });

  let resolvedUrl: string | null = null;

  // Listen for download events via response headers
  const responseHandler = (response: HTTPResponse) => {
    const headers = response.headers();
    const contentDisposition = headers["content-disposition"] || "";
    const contentType = headers["content-type"] || "";

    const isBinary =
      contentDisposition.includes("attachment") ||
      (contentType.startsWith("application/") &&
        !contentType.includes("html") &&
        !contentType.includes("json") &&
        !contentType.includes("javascript") &&
        !contentType.includes("xml"));

    if (isBinary) {
      resolvedUrl = response.url();
    }
  };
  page.on("response", responseHandler);

  // Also listen for CDP download events
  cdp.on("Browser.downloadWillBegin" as any, (event: any) => {
    resolvedUrl = event.url;
  });

  try {
    await page.goto(initialUrl, { waitUntil: "networkidle2", timeout: 30000 });

    // Strategy 1: Extract download link hrefs from the page DOM first,
    // without clicking anything. This avoids anti-bot issues entirely.
    // Wait for JS timers to inject/update download buttons (up to 5s).
    async function extractDownloadHref(): Promise<string | null> {
      const pageUrl = page.url();

      // Poll for up to 5 seconds — handles pages where JS injects buttons after a delay
      for (let attempt = 0; attempt < 5; attempt++) {
        // If CDP already intercepted an auto-download, no need to scan the DOM
        if (resolvedUrl) return null;
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));

        const appName = app.name.toLowerCase();
        const result = await page.evaluate((appNameLower: string) => {
          const links = document.querySelectorAll("a[href]");
          let fallback: string | null = null;

          for (const link of links) {
            const href = link.getAttribute("href") || "";
            const text = (link.textContent || "").trim().toLowerCase();

            if (!href || href === "#" || href.startsWith("javascript:")) continue;

            // Match links with download file extensions
            if (/\.(zip|exe|msi|dmg|pkg|deb|rpm|appimage|tar\.gz|tar\.xz|7z|rar)\b/i.test(href)) {
              // Prefer links containing the app name
              if (href.toLowerCase().includes(appNameLower) || text.includes(appNameLower)) {
                return href;
              }
              if (!fallback) fallback = href;
              continue;
            }

            // Match links whose text is primarily "download"
            if (/^(\W*download\W*(\(.*\))?\s*)$/i.test(text) || /^download\s*$/i.test(text.split("\n")[0])) {
              if (!fallback) fallback = href;
            }
          }
          // If we only have a fallback (no app-name match), check if the page
          // has form submit buttons. If it does, return null so the click-through
          // loop can handle form-based downloads (e.g., TechPowerUp mirror pages).
          if (fallback) {
            const hasFormButtons = document.querySelector('button[type="submit"], input[type="submit"]');
            if (hasFormButtons) return null;
          }
          return fallback;
        }, appName);

        if (result) {
          try { return new URL(result, pageUrl).href; } catch { /* skip */ }
        }
      }
      return null;
    }

    const hrefUrl = await extractDownloadHref();
    if (hrefUrl) {
      resolvedUrl = hrefUrl;
    }

    // Strategy 2: If no href extracted, try clicking download buttons
    // and intercepting the download via CDP.
    if (!resolvedUrl) {
      for (let depth = 0; depth < maxDepth; depth++) {
        if (resolvedUrl) break;
        if (Date.now() - startTime > timeout) break;

        const downloadSelector = app.downloadSelector;
        let clicked = false;

        if (downloadSelector) {
          try {
            await page.waitForSelector(downloadSelector, { timeout: 5000 });
            await page.click(downloadSelector);
            clicked = true;
          } catch { /* selector not found */ }
        }

        // Try form submit buttons first — they're a stronger signal than <a> tags
        // on pages with mixed content (e.g., TechPowerUp has GPU-Z form button + NVIDIA sidebar links)
        if (!clicked) {
          try {
            const appNameLower = app.name.toLowerCase();
            const submitBtns = await page.$$('button[type="submit"], input[type="submit"]');
            // Prefer submit buttons whose text contains the app name
            let fallbackBtn = null;
            for (const btn of submitBtns) {
              const btnText = await btn.evaluate((node) =>
                (node.textContent || "").trim().toLowerCase()
              );
              if (btnText.includes(appNameLower)) {
                await btn.click();
                clicked = true;
                break;
              }
              if (!fallbackBtn) fallbackBtn = btn;
            }
            if (!clicked && fallbackBtn) {
              await fallbackBtn.click();
              clicked = true;
            }
          } catch { /* no submit buttons */ }
        }

        // Then try <a> links with download text, preferring ones matching app name
        if (!clicked) {
          const appNameLower = app.name.toLowerCase();
          for (const text of DOWNLOAD_BUTTON_TEXTS) {
            try {
              const elements = await page.$$("a");
              let fallbackEl = null;
              for (const el of elements) {
                const elText = await el.evaluate((node) =>
                  (node.textContent || "").trim().toLowerCase()
                );
                if (elText.includes(text)) {
                  if (elText.includes(appNameLower)) {
                    await el.click();
                    clicked = true;
                    break;
                  }
                  if (!fallbackEl) fallbackEl = el;
                }
              }
              if (!clicked && fallbackEl) {
                await fallbackEl.click();
                clicked = true;
              }
              if (clicked) break;
            } catch { /* continue */ }
          }
        }

        if (!clicked) break;

        // Wait for navigation or download to trigger after click
        const remainingTime = Math.min(15000, timeout - (Date.now() - startTime));
        if (remainingTime <= 0) break;

        try {
          await page.waitForNavigation({ timeout: remainingTime, waitUntil: "networkidle2" });
        } catch {
          const extraWait = Math.min(10000, timeout - (Date.now() - startTime));
          if (extraWait > 0 && !resolvedUrl) {
            await new Promise((r) => setTimeout(r, extraWait));
          }
        }
      }
    }
  } finally {
    page.off("response", responseHandler);
    await cdp.detach();
    // Clean up any files Chromium saved to the temp dir
    fs.rmSync(tmpDownloadDir, { recursive: true, force: true });
  }

  if (!resolvedUrl) {
    throw new Error("Could not resolve download URL after navigation");
  }

  return resolvedUrl;
}

async function withParsedPage<T>(
  url: string,
  handler: ($: cheerio.CheerioAPI) => T | Promise<T>
): Promise<T> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  incrementPageCount();

  try {
    await page.setUserAgent(DEFAULT_USER_AGENT);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    const html = await page.content();
    const $ = cheerio.load(html);
    $("script, style, noscript").remove();
    return await handler($);
  } finally {
    await page.close();
  }
}

export const genericProvider: VersionProvider = {
  canHandle(): boolean {
    return true; // Fallback provider
  },

  async detect(app: Application): Promise<VersionResult> {
    if (!app.versionSelector || !app.versionPattern) {
      throw new Error(
        "Version selector and pattern are required for generic sources. " +
        "Use the version suggestion API to discover them."
      );
    }

    return withParsedPage(app.url, ($) => {
      const elements = $(app.versionSelector!);
      if (elements.length === 0) {
        throw new Error(
          `Version selector "${app.versionSelector}" matched no elements on the page.`
        );
      }

      let version: string | null = null;
      const regex = new RegExp(app.versionPattern!);
      elements.each((_, el) => {
        if (version) return;
        const text = $(el).text();
        const match = text.match(regex);
        if (match) {
          version = match[1] || match[0];
        }
      });

      if (!version) {
        throw new Error(
          `Version pattern "${app.versionPattern}" did not match text ` +
          `in elements selected by "${app.versionSelector}".`
        );
      }

      let downloadUrls = extractDownloadLinks(
        $,
        app.url,
        app.downloadSelector,
        app.downloadPattern
      );

      if (app.assetPattern && downloadUrls.length > 0) {
        const assetRegex = new RegExp(app.assetPattern, "i");
        const filtered = downloadUrls.filter((u) => assetRegex.test(u));
        if (filtered.length > 0) downloadUrls = filtered;
      }

      if (downloadUrls.length === 0) {
        downloadUrls = [app.url];
      }

      return { version, downloadUrls };
    });
  },
};

/**
 * Resolve a raw download link to the final direct-download URL.
 * Navigates through intermediate pages and countdown timers using Puppeteer.
 * Called at download time, NOT during version checks.
 */
export async function resolveGenericDownloadUrl(
  url: string,
  app: Application
): Promise<string> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  incrementPageCount();

  try {
    await page.setUserAgent(DEFAULT_USER_AGENT);
    return await resolveDownloadUrl(page, url, app);
  } finally {
    await page.close();
  }
}

/**
 * Load a URL in a headless browser and suggest version candidates.
 * Used by the suggestion API — not during scheduled checks.
 */
export async function suggestVersionsForUrl(url: string): Promise<VersionSuggestion[]> {
  return withParsedPage(url, ($) => suggestVersions($));
}
