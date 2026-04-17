import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as cheerio from "cheerio";
import type { Page, HTTPResponse, CDPSession } from "puppeteer";
import { Application } from "../../db/schema.js";
import { getBrowser, incrementPageCount } from "../browserManager.js";
import { VersionProvider, VersionResult } from "./types.js";
import { compareVersions } from "../versionCompare.js";

const VERSION_REGEX = /\bv?(\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?)\b/g;
const VERSION_KEYWORDS = [
  "latest",
  "current",
  "stable",
  "download",
  "version",
  "release",
];
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

interface VersionCandidate {
  version: string;
  score: number;
}

function extractVersions($: cheerio.CheerioAPI, selector?: string | null, pattern?: string | null): VersionCandidate[] {
  const candidates: VersionCandidate[] = [];

  // If user provided a selector + pattern, use those
  if (selector) {
    const elements = $(selector);
    elements.each((_, el) => {
      const text = $(el).text();
      const regex = pattern ? new RegExp(pattern) : VERSION_REGEX;
      const match = text.match(regex);
      if (match) {
        candidates.push({ version: match[1] || match[0], score: 100 });
      }
    });
    if (candidates.length > 0) return candidates;
  }

  // Heuristic: find version strings near keywords
  // Check the element itself, parent, and grandparent for keyword proximity,
  // since version text is often in a sibling/child of the keyword element.
  function hasNearbyKeyword($el: cheerio.Cheerio<any>): boolean {
    for (let i = 0; i < 3; i++) {
      const text = ($el.text() || "").toLowerCase();
      if (VERSION_KEYWORDS.some((kw) => text.includes(kw))) return true;
      const $parent = $el.parent();
      if ($parent.length === 0) break;
      $el = $parent;
    }
    return false;
  }

  $("h1, h2, h3, h4, h5, h6, p, span, div, a, li, td, th, strong, em, b, label").each((_, el) => {
    const $el = $(el);
    // Only process leaf-level text (elements with direct text content)
    const directText = $el
      .contents()
      .filter((_, node) => node.type === "text")
      .text()
      .trim();
    if (!directText) return;

    const fullText = $el.text();
    const regex = new RegExp(VERSION_REGEX.source, "g");
    let match;
    while ((match = regex.exec(fullText)) !== null) {
      const tagName = (el as any).tagName?.toLowerCase() || "";
      const depthScore = tagName.startsWith("h") ? (7 - parseInt(tagName[1])) * 5 : 0;

      let score = depthScore;
      if (hasNearbyKeyword($el)) score += 20;

      candidates.push({ version: match[1], score });
    }
  });

  // Deduplicate, then among keyword-adjacent candidates pick the highest version
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if (seen.has(c.version)) return false;
    seen.add(c.version);
    return true;
  });

  // Partition: candidates near keywords vs not
  const nearKeyword = unique.filter((c) => c.score > 0);
  const rest = unique.filter((c) => c.score === 0);

  // Sort each group by version descending (highest version first)
  const sortByVersion = (a: VersionCandidate, b: VersionCandidate) =>
    compareVersions(a.version, b.version);

  nearKeyword.sort(sortByVersion);
  rest.sort(sortByVersion);

  return [...nearKeyword, ...rest];
}

function extractDownloadLinks($: cheerio.CheerioAPI, baseUrl: string, selector?: string | null, pattern?: string | null): string[] {
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

    if (
      contentDisposition.includes("attachment") ||
      contentType === "application/octet-stream" ||
      contentType === "application/zip" ||
      contentType === "application/x-gzip" ||
      contentType === "application/x-tar"
    ) {
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

    for (let depth = 0; depth < maxDepth; depth++) {
      if (resolvedUrl) break;
      if (Date.now() - startTime > timeout) break;

      // Look for download button/link
      const downloadSelector = app.downloadSelector;
      let clicked = false;

      if (downloadSelector) {
        try {
          await page.waitForSelector(downloadSelector, { timeout: 5000 });
          await page.click(downloadSelector);
          clicked = true;
        } catch { /* selector not found */ }
      }

      if (!clicked) {
        // Try heuristic text matching
        for (const text of DOWNLOAD_BUTTON_TEXTS) {
          try {
            const elements = await page.$$(`a, button, input[type="submit"]`);
            for (const el of elements) {
              const elText = await el.evaluate((node) =>
                (node.textContent || "").trim().toLowerCase()
              );
              if (elText.includes(text)) {
                await el.click();
                clicked = true;
                break;
              }
            }
            if (clicked) break;
          } catch { /* continue */ }
        }
      }

      if (!clicked) {
        // Try links with download extensions
        const links = await page.$$("a[href]");
        for (const link of links) {
          const href = await link.evaluate((el) => el.getAttribute("href") || "");
          if (DOWNLOAD_EXTENSIONS.test(href)) {
            resolvedUrl = new URL(href, page.url()).href;
            break;
          }
        }
        if (resolvedUrl) break;
      }

      // Wait for navigation or download to trigger
      const remainingTime = Math.min(15000, timeout - (Date.now() - startTime));
      if (remainingTime <= 0) break;

      try {
        await page.waitForNavigation({ timeout: remainingTime, waitUntil: "networkidle2" });
      } catch {
        // No navigation happened — might be a timer-based download
        // Wait a bit more for the download event
        const extraWait = Math.min(10000, timeout - (Date.now() - startTime));
        if (extraWait > 0 && !resolvedUrl) {
          await new Promise((r) => setTimeout(r, extraWait));
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

export const genericProvider: VersionProvider = {
  canHandle(): boolean {
    return true; // Fallback provider
  },

  async detect(app: Application): Promise<VersionResult> {
    const browser = await getBrowser();
    const page = await browser.newPage();
    incrementPageCount();

    try {
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
      );

      await page.goto(app.url, { waitUntil: "networkidle2", timeout: 30000 });
      const html = await page.content();
      const $ = cheerio.load(html);

      // Step 1: Extract version
      const versionCandidates = extractVersions(
        $,
        app.versionSelector,
        app.versionPattern
      );

      if (versionCandidates.length === 0) {
        throw new Error("No version found on page");
      }

      const version = versionCandidates[0].version;

      // Step 2: Extract download links from initial page
      let downloadUrls = extractDownloadLinks(
        $,
        app.url,
        app.downloadSelector,
        app.downloadPattern
      );

      // Filter by asset pattern
      if (app.assetPattern && downloadUrls.length > 0) {
        const regex = new RegExp(app.assetPattern, "i");
        const filtered = downloadUrls.filter((u) => regex.test(u));
        if (filtered.length > 0) downloadUrls = filtered;
      }

      return { version, downloadUrls };
    } finally {
      await page.close();
    }
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
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    return await resolveDownloadUrl(page, url, app);
  } finally {
    await page.close();
  }
}
