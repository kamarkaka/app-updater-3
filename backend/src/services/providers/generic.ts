import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { Page, CDPSession } from "puppeteer";
import { Application } from "../../db/schema.js";
import { getBrowser, incrementPageCount } from "../browserManager.js";
import { VersionProvider, VersionResult, DownloadStep } from "./types.js";

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

      return { version, downloadUrls: [] };
    });
  },
};

/**
 * Follow user-defined download steps to resolve a download URL.
 * Each step clicks a matching element; CDP Fetch intercepts binary responses.
 */
export async function resolveDownloadWithSteps(
  appUrl: string,
  steps: DownloadStep[]
): Promise<string> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  incrementPageCount();

  try {
    await page.setUserAgent(DEFAULT_USER_AGENT);

    const cdp: CDPSession = await page.createCDPSession();
    await cdp.send("Fetch.enable" as any, {
      patterns: [{ requestStage: "Response", resourceType: "Document" }],
    });

    let resolvedUrl: string | null = null;

    cdp.on("Fetch.requestPaused" as any, async (event: any) => {
      if (resolvedUrl) {
        await cdp.send("Fetch.continueRequest" as any, {
          requestId: event.requestId,
        }).catch(() => {});
        return;
      }

      const headers: Record<string, string> = {};
      for (const h of event.responseHeaders || []) {
        headers[h.name.toLowerCase()] = h.value;
      }

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
        resolvedUrl = event.request.url;
        await cdp.send("Fetch.failRequest" as any, {
          requestId: event.requestId,
          reason: "Aborted",
        }).catch(() => {});
      } else {
        await cdp.send("Fetch.continueRequest" as any, {
          requestId: event.requestId,
        }).catch(() => {});
      }
    });

    try {
      await page.goto(appUrl, { waitUntil: "networkidle2", timeout: 30000 });

      // Wait briefly for auto-triggered downloads (e.g., direct binary URLs)
      if (!resolvedUrl && steps.length === 0) {
        await new Promise((r) => setTimeout(r, 3000));
      }

      for (let i = 0; i < steps.length; i++) {
        if (resolvedUrl) break;

        const step = steps[i];
        let clicked = false;

        // Try CSS selector first
        if (step.selector) {
          try {
            await page.waitForSelector(step.selector, { timeout: 10000 });
            await page.click(step.selector);
            clicked = true;
          } catch { /* selector not found or not clickable */ }
        }

        // Fall back to (or combine with) text pattern matching
        if (!clicked && step.textPattern) {
          const pattern = step.textPattern;
          clicked = await page.evaluate((pat: string) => {
            const regex = new RegExp(pat, "i");
            const candidates = document.querySelectorAll("a, button, input[type=submit], [role=button]");
            for (const el of candidates) {
              const text = (el.textContent || "").trim();
              if (regex.test(text)) {
                (el as HTMLElement).click();
                return true;
              }
            }
            return false;
          }, pattern);
        }

        if (!clicked) {
          throw new Error(
            `Download step ${i + 1} did not match any element. ` +
            `Selector: ${step.selector || "(none)"}, ` +
            `Text pattern: ${step.textPattern || "(none)"}`
          );
        }

        // Wait for navigation or download after click
        if (!resolvedUrl) {
          try {
            await page.waitForNavigation({ timeout: 15000, waitUntil: "networkidle2" });
          } catch {
            // Navigation might not happen (e.g., JS-triggered download)
            // Wait briefly for CDP to catch the download
            if (!resolvedUrl) {
              await new Promise((r) => setTimeout(r, 3000));
            }
          }
        }
      }
    } finally {
      await cdp.send("Fetch.disable" as any).catch(() => {});
      await cdp.detach();
    }

    if (!resolvedUrl) {
      throw new Error("Download steps completed but no download was triggered.");
    }

    return resolvedUrl;
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
