import { BaseScraper, type ScrapedListing, type ScraperConfig } from './base-scraper.js';
import { withPage } from './browser-pool.js';
import type { Page, Response } from 'playwright';

export class MercariScraper extends BaseScraper {
  platform = 'mercari' as const;

  async scrape(config: ScraperConfig): Promise<ScrapedListing[]> {
    const params = new URLSearchParams({
      keyword: config.searchTerm,
      status: 'on_sale',
      sortBy: 'created_time',
      order: 'desc',
    });
    if (config.minPrice) params.set('minPrice', config.minPrice.toString());
    if (config.maxPrice) params.set('maxPrice', config.maxPrice.toString());

    const searchUrl = `https://www.mercari.com/search/?${params}`;
    console.log(`[mercari] Scraping: ${searchUrl}`);

    return withPage(async (page) => {
      // Cloudflare's challenge JS needs resources the default route handler blocks
      await page.unrouteAll({ behavior: 'wait' });

      const searchData = await this.waitForSearchApi(page, searchUrl);
      if (!searchData) {
        throw new Error('Timeout waiting for Mercari search data — Cloudflare may have blocked this session');
      }

      const items = searchData.data?.search?.itemsList ?? [];
      console.log(`[mercari] ${items.length} items (${searchData.data?.search?.count ?? 0} total)`);

      const listings: ScrapedListing[] = [];
      for (const item of items) {
        if (!item.id || !item.name) continue;

        const imageUrls: string[] = [];
        for (const photo of item.photos ?? []) {
          const url = photo.imageUrl || photo.thumbnail;
          if (url) imageUrls.push(url);
        }

        const descParts: string[] = [];
        if (item.description) descParts.push(item.description);
        if (item.itemCondition?.name) descParts.push(`Condition: ${item.itemCondition.name}`);
        if (item.brand?.name) descParts.push(`Brand: ${item.brand.name}`);
        if (item.color?.name) descParts.push(`Color: ${item.color.name}`);

        listings.push({
          externalId: item.id,
          platform: 'mercari',
          url: `https://www.mercari.com/us/item/${item.id}/`,
          title: item.name,
          description: descParts.length > 0 ? descParts.join('\n') : undefined,
          askingPrice: typeof item.price === 'number' ? item.price / 100 : undefined, // cents → dollars
          imageUrls: [...new Set(imageUrls)],
        });
      }

      return listings;
    });
  }

  /**
   * Navigate and intercept Mercari's searchFacetQuery GraphQL response.
   * Cloudflare challenge takes 30-60s to clear, after which the Next.js app
   * fires the real API request. Returns null if the data never arrives.
   */
  private waitForSearchApi(page: Page, url: string): Promise<any> {
    let resolved = false;

    return new Promise<any>((resolve) => {
      const onResponse = async (response: Response) => {
        if (resolved) return;
        const reqUrl = response.url();
        if (response.status() !== 200 || !reqUrl.includes('/v1/api')) return;

        const isSearch = reqUrl.includes('searchFacetQuery') || response.request().method() === 'POST';
        if (!isSearch) return;

        try {
          const json = await response.json();
          if (json?.data?.search?.itemsList) {
            resolved = true;
            resolve(json);
          }
        } catch {}
      };

      page.on('response', onResponse);

      // Kick off navigation then poll until the API data shows up or we time out.
      // domcontentloaded is intentional — networkidle never fires because of tracking requests.
      page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

      const poll = async () => {
        const deadline = Date.now() + 60000;
        while (!resolved && Date.now() < deadline) {
          await page.waitForTimeout(2000);
        }
        if (!resolved) resolve(null);
      };
      poll();
    });
  }
}
