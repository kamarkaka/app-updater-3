import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser } from "puppeteer";

puppeteer.use(StealthPlugin());

let browserPromise: Promise<Browser> | null = null;
let pageCount = 0;
const MAX_PAGES_BEFORE_RESTART = 50;

async function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  }) as unknown as Browser;
}

export async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const browser = await browserPromise;
    if (browser.connected && pageCount < MAX_PAGES_BEFORE_RESTART) {
      return browser;
    }
    // Stale — close and relaunch
    try { await browser.close(); } catch { /* ignore */ }
    browserPromise = null;
  }

  browserPromise = launchBrowser();
  pageCount = 0;
  return browserPromise;
}

export function incrementPageCount() {
  pageCount++;
}

export async function closeBrowser() {
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      await browser.close();
    } catch { /* ignore */ }
    browserPromise = null;
    pageCount = 0;
  }
}
