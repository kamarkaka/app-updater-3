/**
 * Fetches HTML from each app's URL using Puppeteer and saves to test/fixtures/.
 * Run with: npx tsx test/fetch-fixtures.ts
 */
import fs from "node:fs";
import path from "node:path";
import { getBrowser, incrementPageCount, closeBrowser } from "../src/services/browserManager.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "fixtures");

const apps = [
  { name: "7-zip", url: "https://www.7-zip.org/download.html", expectedVersion: "26.00" },
  { name: "amd-adrenalin", url: "https://www.amd.com/en/support/graphics/amd-radeon-6000-series/amd-radeon-6800-series/amd-radeon-rx-6800-xt", expectedVersion: "26.3.1" },
  { name: "cpu-z", url: "https://www.cpuid.com/softwares/cpu-z.html", expectedVersion: "2.19" },
  { name: "crystaldiskinfo", url: "https://sourceforge.net/projects/crystaldiskinfo/files/", expectedVersion: "9.8.0" },
  { name: "crystaldiskmark", url: "https://sourceforge.net/projects/crystaldiskmark/files/", expectedVersion: "9.0.2" },
  { name: "doublekiller", url: "https://www.bigbangenterprises.de/en/doublekiller/download.htm", expectedVersion: "1.6.2.82" },
  { name: "freecad", url: "https://www.freecad.org/downloads.php", expectedVersion: "1.1.1" },
  { name: "furmark", url: "https://geeks3d.com/furmark/downloads/", expectedVersion: "2.10.2" },
  { name: "hwmonitor", url: "https://www.cpuid.com/softwares/hwmonitor.html", expectedVersion: "1.63" },
  { name: "intellij-idea", url: "https://www.jetbrains.com/idea/download/other.html", expectedVersion: "2026.1" },
  { name: "java-jdk", url: "https://www.oracle.com/java/technologies/downloads", expectedVersion: "11.0.30" },
  { name: "memtest86", url: "https://www.memtest86.com/download.htm", expectedVersion: "11.6" },
  { name: "nginx", url: "https://nginx.org/en/download.html", expectedVersion: "1.29.8" },
  { name: "nodejs", url: "https://nodejs.org/en/download", expectedVersion: "24.15" },
  { name: "prime95", url: "https://www.mersenne.org/download/", expectedVersion: "30.19" },
  { name: "python", url: "https://www.python.org/downloads/windows/", expectedVersion: "3.14.4", nameFilter: "Python 3" },
  { name: "snappy-driver-installer", url: "https://www.glenn.delahoy.com/snappy-driver-installer-origin/", expectedVersion: "1.17.8" },
  { name: "sublime-text", url: "https://www.sublimetext.com/download", expectedVersion: "4200" },
  { name: "sumatra-pdf", url: "https://www.sumatrapdfreader.org/download-free-pdf-viewer", expectedVersion: "3.6.1" },
  { name: "gpu-z", url: "https://www.techpowerup.com/download/techpowerup-gpu-z", expectedVersion: "2.69.0" },
  { name: "ubuntu-server", url: "https://ubuntu.com/download/server", expectedVersion: "24.04.4" },
  { name: "winscp", url: "https://winscp.net/eng/downloads.php", expectedVersion: "6.5" },
];

async function main() {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  const browser = await getBrowser();

  for (const app of apps) {
    const fixturePath = path.join(FIXTURES_DIR, `${app.name}.html`);
    if (fs.existsSync(fixturePath)) {
      console.log(`[skip] ${app.name} — fixture already exists`);
      continue;
    }

    console.log(`[fetch] ${app.name} — ${app.url}`);
    const page = await browser.newPage();
    incrementPageCount();
    try {
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
      );
      await page.goto(app.url, { waitUntil: "networkidle2", timeout: 30000 });
      const html = await page.content();
      fs.writeFileSync(fixturePath, html, "utf-8");
      console.log(`[saved] ${app.name} — ${(html.length / 1024).toFixed(0)} KB`);
    } catch (err: any) {
      console.error(`[error] ${app.name} — ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await closeBrowser();

  // Write the manifest for tests
  const manifest = apps.map((a) => ({
    name: a.name,
    expectedVersion: a.expectedVersion,
    nameFilter: (a as any).nameFilter || null,
    fixture: `${a.name}.html`,
  }));
  fs.writeFileSync(
    path.join(FIXTURES_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  console.log(`\nManifest written with ${manifest.length} test cases.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
