import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser } from "puppeteer";

puppeteer.use(StealthPlugin());

let browser: Browser | null = null;
let pageCount = 0;
const MAX_PAGES_BEFORE_RESTART = 50;

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected && pageCount < MAX_PAGES_BEFORE_RESTART) {
    return browser;
  }

  if (browser) {
    try {
      await browser.close();
    } catch {
      // ignore
    }
  }

  browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  }) as unknown as Browser;
  pageCount = 0;

  return browser;
}

export function incrementPageCount() {
  pageCount++;
}

export async function closeBrowser() {
  if (browser) {
    try {
      await browser.close();
    } catch {
      // ignore
    }
    browser = null;
    pageCount = 0;
  }
}
