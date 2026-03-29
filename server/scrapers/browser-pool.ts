import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { config } from '../lib/config.js';
import logger from '../lib/logger.js';

const { maxConcurrent: MAX_CONCURRENT, pageTimeoutMs: PAGE_TIMEOUT_MS, poolSlotTimeoutMs: POOL_SLOT_TIMEOUT_MS } = config.browser;

// Rotate through realistic desktop user-agents
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
];

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

let browser: Browser | null = null;
let activeContexts = 0;
const waitQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

export async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920,1080',
    ],
  });
  // Auto-cleanup on unexpected disconnect
  browser.on('disconnected', () => {
    browser = null;
    activeContexts = 0;
    // Drain wait queue so callers don't hang forever
    while (waitQueue.length > 0) {
      const entry = waitQueue.shift()!;
      entry.reject(new Error('Browser disconnected while waiting for slot'));
    }
  });
  return browser;
}

async function acquireSlot(): Promise<void> {
  if (activeContexts < MAX_CONCURRENT) {
    activeContexts++;
    return;
  }
  // Wait for a slot to free up, with a timeout to prevent hanging forever
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const idx = waitQueue.findIndex((e) => e.resolve === onReady);
      if (idx !== -1) waitQueue.splice(idx, 1);
      reject(new Error(`Browser pool slot timeout after ${POOL_SLOT_TIMEOUT_MS}ms`));
    }, POOL_SLOT_TIMEOUT_MS);

    const onReady = () => {
      clearTimeout(timeout);
      resolve();
    };
    waitQueue.push({ resolve: onReady, reject });
  });
  activeContexts++;
}

function releaseSlot(): void {
  activeContexts--;
  if (waitQueue.length > 0) {
    waitQueue.shift()!.resolve();
  }
}

// Blocked resource types and URL patterns to cut page load time and reduce fingerprint surface
const BLOCKED_RESOURCE_TYPES = new Set(['font', 'media']);
const BLOCKED_URL_PATTERNS = [
  /google-analytics\.com/,
  /googletagmanager\.com/,
  /facebook\.net\/signals/,
  /doubleclick\.net/,
  /googlesyndication\.com/,
  /adservice\.google/,
  /analytics/,
  /hotjar\.com/,
  /fullstory\.com/,
  /sentry\.io/,
  /newrelic\.com/,
];

export async function getPage(): Promise<{ context: BrowserContext; page: Page }> {
  await acquireSlot();

  const b = await getBrowser();
  const ua = pickRandom(USER_AGENTS);
  const viewport = pickRandom(VIEWPORTS);
  const context = await b.newContext({
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    userAgent: ua,
    viewport,
    deviceScaleFactor: 1,
    hasTouch: false,
    colorScheme: 'light',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(PAGE_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);

  // Block heavy/unnecessary resources
  await page.route('**/*', (route) => {
    const req = route.request();
    const type = req.resourceType();
    const url = req.url();

    if (BLOCKED_RESOURCE_TYPES.has(type)) return route.abort();
    if (BLOCKED_URL_PATTERNS.some((re) => re.test(url))) return route.abort();

    return route.continue();
  });

  // Stealth: patch navigator and chrome runtime to look like a real browser
  await page.addInitScript(() => {
    // Remove webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // Chrome runtime object (headless Chromium lacks this)
    if (!(window as any).chrome) {
      (window as any).chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    }

    // Realistic plugins array
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ],
    });

    // Languages
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

    // Platform consistency
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });

    // Hardware concurrency (real browsers report 4-16)
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

    // Spoof permissions query to avoid "notification denied" fingerprint
    const origQuery = (navigator.permissions?.query as any)?.bind(navigator.permissions);
    if (origQuery) {
      (navigator.permissions as any).query = (params: any) => {
        if (params.name === 'notifications') {
          return Promise.resolve({ state: 'prompt', onchange: null } as any);
        }
        return origQuery(params);
      };
    }

    // WebGL vendor/renderer — headless Chromium reports "Google Inc." / "ANGLE..."
    // which is normal for Chrome, but some sites check for "SwiftShader" (headless tell)
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param: number) {
      // UNMASKED_VENDOR_WEBGL
      if (param === 0x9245) return 'Google Inc. (NVIDIA)';
      // UNMASKED_RENDERER_WEBGL
      if (param === 0x9246) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return getParameter.call(this, param);
    };
  });

  return { context, page };
}

/** Jittered delay that looks like a human pause. Use instead of fixed waitForTimeout. */
export function humanDelay(minMs = 1000, maxMs = 3000): number {
  return minMs + Math.random() * (maxMs - minMs);
}

export async function closeBrowser(): Promise<void> {
  if (browser?.isConnected()) {
    await browser.close();
    browser = null;
  }
  activeContexts = 0;
  while (waitQueue.length > 0) {
    const entry = waitQueue.shift()!;
    entry.reject(new Error('Browser pool closed'));
  }
}

/**
 * Run a function with a Playwright page, with one automatic retry on navigation/timeout failures.
 * The retry gets a completely fresh browser context.
 */
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { context, page } = await getPage();
    try {
      return await fn(page);
    } catch (err: any) {
      lastError = err;
      const msg = err?.message || '';
      const isRetryable = msg.includes('Timeout') || msg.includes('timeout') ||
        msg.includes('net::ERR_') || msg.includes('Navigation failed') ||
        msg.includes('Target closed') || msg.includes('frame was detached');

      if (attempt === 0 && isRetryable) {
        logger.warn({ err: msg.slice(0, 120) }, 'Retrying after transient browser failure');
        // Brief backoff before retry
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
        continue;
      }
      throw err;
    } finally {
      releaseSlot();
      await context.close().catch(() => {});
    }
  }

  throw lastError;
}
