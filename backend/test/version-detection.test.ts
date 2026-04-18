import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import {
  suggestVersions,
  extractDownloadLinks,
} from "../src/services/providers/generic.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "fixtures");
const manifestPath = path.join(FIXTURES_DIR, "manifest.json");

if (!fs.existsSync(manifestPath)) {
  console.error(
    "No test fixtures found. Run `npm run test:fetch-fixtures` first."
  );
  process.exit(1);
}

interface TestCase {
  name: string;
  expectedVersion: string;
  fixture: string;
  url: string;
}

const testCases: TestCase[] = JSON.parse(
  fs.readFileSync(manifestPath, "utf-8")
);

/**
 * Uses the suggestion engine to find versions, then cross-checks with
 * download URLs (mimicking the old heuristic flow) to pick the best match.
 */
function detectVersion(
  $: cheerio.CheerioAPI,
  url: string
): string | null {
  const suggestions = suggestVersions($);
  if (suggestions.length === 0) return null;

  let version = suggestions[0].version;

  const downloadUrls = extractDownloadLinks($, url);
  if (downloadUrls.length > 0) {
    const versionInUrl = downloadUrls.some((u) => u.includes(version));
    if (!versionInUrl) {
      for (const s of suggestions) {
        if (downloadUrls.some((u) => u.includes(s.version))) {
          version = s.version;
          break;
        }
      }
    }
  }

  return version;
}

describe("Version suggestion", () => {
  for (const tc of testCases) {
    it(`suggests ${tc.expectedVersion} for ${tc.name}`, () => {
      const fixturePath = path.join(FIXTURES_DIR, tc.fixture);
      if (!fs.existsSync(fixturePath)) {
        assert.fail(`fixture not found: ${tc.fixture}`);
      }

      const html = fs.readFileSync(fixturePath, "utf-8");
      const $ = cheerio.load(html);
      $("script, style, noscript").remove();

      const suggestions = suggestVersions($);
      const versions = suggestions.map((s) => s.version);

      assert.ok(
        versions.includes(tc.expectedVersion),
        `${tc.name}: expected ${tc.expectedVersion} in suggestions, got [${versions.slice(0, 10).join(", ")}]`
      );
    });

    it(`detects ${tc.expectedVersion} for ${tc.name} (with download cross-check)`, () => {
      const fixturePath = path.join(FIXTURES_DIR, tc.fixture);
      if (!fs.existsSync(fixturePath)) {
        assert.fail(`fixture not found: ${tc.fixture}`);
      }

      const html = fs.readFileSync(fixturePath, "utf-8");
      const $ = cheerio.load(html);
      $("script, style, noscript").remove();

      const detected = detectVersion($, tc.url);

      assert.ok(detected, `No version detected for ${tc.name}`);

      assert.strictEqual(
        detected,
        tc.expectedVersion,
        `${tc.name}: expected ${tc.expectedVersion}, got ${detected}`
      );
    });
  }
});
