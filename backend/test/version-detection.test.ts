import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { suggestVersions } from "../src/services/providers/generic.js";

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
  }
});
