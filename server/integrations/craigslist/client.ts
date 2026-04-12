/**
 * Shared Craigslist HTTP client with persistent cookie jar.
 *
 * CL flags clients that never send cookies back — maintaining a session
 * across requests makes the traffic pattern look more like a browser.
 */

import logger from '../../lib/logger.js';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
};

// Module-level cookie jar — persists across requests within a process lifecycle
const cookies = new Map<string, string>();

function parseCookies(setCookieHeaders: string[]): void {
  for (const header of setCookieHeaders) {
    const parts = header.split(';')[0]; // ignore attributes (path, domain, etc.)
    const [name, ...valueParts] = parts.split('=');
    if (name && valueParts.length > 0) {
      cookies.set(name.trim(), valueParts.join('=').trim());
    }
  }
}

function cookieHeader(): string | undefined {
  if (cookies.size === 0) return undefined;
  return Array.from(cookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/**
 * Fetch a CL page with browser-like headers and cookie persistence.
 * Automatically stores and sends cookies across requests.
 */
export async function clFetch(url: string, options?: { timeout?: number; referer?: string }): Promise<Response> {
  const headers: Record<string, string> = { ...BROWSER_HEADERS };
  const cookie = cookieHeader();
  if (cookie) headers['Cookie'] = cookie;
  if (options?.referer) headers['Referer'] = options.referer;

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(options?.timeout ?? 15_000),
  });

  // Store any cookies CL sends back
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    parseCookies(setCookies);
    logger.debug({ count: setCookies.length }, 'CL client: stored cookies');
  }

  return res;
}

/**
 * Warm the cookie jar by visiting the CL homepage.
 * Call once before a scraping session to establish a "session."
 */
export async function warmCookies(city: string): Promise<void> {
  if (cookies.size > 0) return; // already warm
  try {
    const res = await clFetch(`https://${city}.craigslist.org/`);
    await res.text(); // consume body
    logger.info({ cookies: cookies.size }, 'CL client: cookie jar warmed');
  } catch (err) {
    logger.warn({ error: String(err) }, 'CL client: failed to warm cookies (non-fatal)');
  }
}
