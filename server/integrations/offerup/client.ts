/**
 * Shared OfferUp HTTP client with persistent cookie jar.
 * Similar pattern to the CL client — browser-like headers and session persistence.
 */

import logger from '../../lib/logger.js';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/html, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

const cookies = new Map<string, string>();

function parseCookies(setCookieHeaders: string[]): void {
  for (const header of setCookieHeaders) {
    const parts = header.split(';')[0];
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

export async function offerUpFetch(url: string, options?: {
  timeout?: number;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}): Promise<Response> {
  const headers: Record<string, string> = { ...BROWSER_HEADERS, ...options?.headers };
  const cookie = cookieHeader();
  if (cookie) headers['Cookie'] = cookie;

  const res = await fetch(url, {
    method: options?.method ?? 'GET',
    headers,
    body: options?.body,
    signal: AbortSignal.timeout(options?.timeout ?? 15_000),
  });

  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    parseCookies(setCookies);
    logger.debug({ count: setCookies.length }, 'OfferUp client: stored cookies');
  }

  return res;
}

export async function warmCookies(): Promise<void> {
  if (cookies.size > 0) return;
  try {
    const res = await offerUpFetch('https://offerup.com/');
    await res.text();
    logger.info({ cookies: cookies.size }, 'OfferUp client: cookie jar warmed');
  } catch (err) {
    logger.warn({ error: String(err) }, 'OfferUp client: failed to warm cookies (non-fatal)');
  }
}
