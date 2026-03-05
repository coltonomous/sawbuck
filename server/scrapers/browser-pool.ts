import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const MAX_CONCURRENT = 3;
const PAGE_TIMEOUT_MS = 45_000;

let browser: Browser | null = null;
let activeContexts = 0;
const waitQueue: Array<() => void> = [];

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
  // Auto-cleanup on unexpected disconnect
  browser.on('disconnected', () => {
    browser = null;
    activeContexts = 0;
    // Drain wait queue so callers don't hang forever
    while (waitQueue.length > 0) {
      waitQueue.shift()!();
    }
  });
  return browser;
}

async function acquireSlot(): Promise<void> {
  if (activeContexts < MAX_CONCURRENT) {
    activeContexts++;
    return;
  }
  // Wait for a slot to free up
  await new Promise<void>((resolve) => {
    waitQueue.push(resolve);
  });
  activeContexts++;
}

function releaseSlot(): void {
  activeContexts--;
  if (waitQueue.length > 0) {
    waitQueue.shift()!();
  }
}

export async function getPage(): Promise<{ context: BrowserContext; page: Page }> {
  await acquireSlot();

  const b = await getBrowser();
  const context = await b.newContext({
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(PAGE_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);

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
  activeContexts = 0;
  while (waitQueue.length > 0) {
    waitQueue.shift()!();
  }
}

export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const { context, page } = await getPage();
  try {
    return await fn(page);
  } finally {
    releaseSlot();
    await context.close().catch(() => {});
  }
}
