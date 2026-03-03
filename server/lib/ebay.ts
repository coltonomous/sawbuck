const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const BROWSE_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';

const MAX_RETRIES = 3;
const BASE_DELAY = 1000;

// Token cache — eBay tokens last 2 hours, we refresh 60s before expiry
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

function hasCredentials(): boolean {
  return Boolean(EBAY_CLIENT_ID && EBAY_CLIENT_SECRET);
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status ?? err?.statusCode;
      const isRetryable = status === 429 || (status >= 500 && status < 600);
      if (!isRetryable || attempt === MAX_RETRIES - 1) throw err;

      const delay = BASE_DELAY * Math.pow(2, attempt) + Math.random() * 1000;
      console.warn(`[ebay] Retry ${attempt + 1}/${MAX_RETRIES} after ${Math.round(delay)}ms (${status || err?.message})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Should not reach here');
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });

  if (!res.ok) {
    const body = await res.text();
    throw Object.assign(new Error(`eBay token request failed: ${res.status} ${body}`), { status: res.status });
  }

  const data = await res.json();
  cachedToken = data.access_token;
  // Refresh 60s before expiry
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;

  return cachedToken!;
}

export interface EbayBrowseItem {
  itemId: string;
  title: string;
  price: number;
  condition: string;
  itemWebUrl: string;
  imageUrl?: string;
  itemLocation?: string;
}

export interface BrowseSearchOptions {
  query: string;
  limit?: number;
  minPrice?: number;
  maxPrice?: number;
  sort?: string;
}

export async function searchEbayBrowse(options: BrowseSearchOptions): Promise<EbayBrowseItem[]> {
  if (!hasCredentials()) {
    console.warn('[ebay] EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set — Browse API disabled');
    return [];
  }

  return withRetry(async () => {
    const token = await getAccessToken();

    const params = new URLSearchParams({
      q: options.query,
      limit: String(options.limit ?? 20),
      filter: 'conditionIds:{3000},itemLocationCountry:US',
    });

    if (options.minPrice != null || options.maxPrice != null) {
      const parts: string[] = ['conditionIds:{3000}', 'itemLocationCountry:US'];
      if (options.minPrice != null) parts.push(`price:[${options.minPrice}]`);
      if (options.maxPrice != null) parts.push(`price:[..${options.maxPrice}]`);
      params.set('filter', parts.join(','));
    }

    if (options.sort) {
      params.set('sort', options.sort);
    }

    const res = await fetch(`${BROWSE_URL}?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw Object.assign(new Error(`eBay Browse API error: ${res.status} ${body}`), { status: res.status });
    }

    const data = await res.json();
    const items: EbayBrowseItem[] = [];

    for (const item of data.itemSummaries ?? []) {
      const priceVal = parseFloat(item.price?.value);
      if (isNaN(priceVal)) continue;

      items.push({
        itemId: item.itemId,
        title: item.title,
        price: priceVal,
        condition: item.condition ?? 'Used',
        itemWebUrl: item.itemWebUrl,
        imageUrl: item.thumbnailImages?.[0]?.imageUrl ?? item.image?.imageUrl,
        itemLocation: item.itemLocation ? `${item.itemLocation.city ?? ''}, ${item.itemLocation.stateOrProvince ?? ''}`.replace(/^, |, $/g, '') : undefined,
      });
    }

    console.log(`[ebay] Browse API: ${items.length} results for "${options.query}"`);
    return items;
  });
}
