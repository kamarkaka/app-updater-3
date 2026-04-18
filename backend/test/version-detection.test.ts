import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { extractVersions } from "../src/services/providers/generic.js";

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
  nameFilter: string | null;
  fixture: string;
  requiresJs?: boolean;
  // When version detection alone picks the wrong one, the download URLs
  // contain the correct version. Simulates the cross-check in detect().
  downloadUrlVersionHint?: string;
}

const testCases: TestCase[] = JSON.parse(
  fs.readFileSync(manifestPath, "utf-8")
);

describe("Version detection", () => {
  for (const tc of testCases) {
    const testFn = tc.requiresJs ? it.skip : it;

    testFn(`detects ${tc.expectedVersion} for ${tc.name}`, () => {
      const fixturePath = path.join(FIXTURES_DIR, tc.fixture);
      if (!fs.existsSync(fixturePath)) {
        assert.fail(`fixture not found: ${tc.fixture}`);
      }

      const html = fs.readFileSync(fixturePath, "utf-8");
      const $ = cheerio.load(html);
      $("script, style, noscript").remove();

      const candidates = extractVersions($, null, null, tc.nameFilter);

      assert.ok(
        candidates.length > 0,
        `No version candidates found for ${tc.name}`
      );

      let detected = candidates[0].version;

      // Simulate the download-URL cross-check from detect():
      // if the top candidate doesn't match the version in download URLs,
      // find a candidate that does.
      if (tc.downloadUrlVersionHint && detected !== tc.expectedVersion) {
        const match = candidates.find((c) =>
          c.version === tc.downloadUrlVersionHint
        );
        if (match) detected = match.version;
      }

      assert.strictEqual(
        detected,
        tc.expectedVersion,
        `${tc.name}: expected ${tc.expectedVersion}, got ${detected} (top 5: ${candidates
          .slice(0, 5)
          .map((c) => `${c.version}[${c.score}]`)
          .join(", ")})`
      );
    });
  }
});
