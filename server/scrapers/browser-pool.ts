import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function randomViewport(): { width: number; height: number } {
  const width = 1280 + Math.floor(Math.random() * 320);
  const height = 800 + Math.floor(Math.random() * 200);
  return { width, height };
}

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });
  return browser;
}

export async function getPage(): Promise<{ context: BrowserContext; page: Page }> {
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent: randomUA(),
    viewport: randomViewport(),
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  });
  const page = await context.newPage();

  // Remove webdriver flag
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  return { context, page };
}

export async function closeBrowser(): Promise<void> {
  if (browser?.isConnected()) {
    await browser.close();
    browser = null;
  }
}

export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const { context, page } = await getPage();
  try {
    return await fn(page);
  } finally {
    await context.close();
  }
}
