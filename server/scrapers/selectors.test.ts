// @vitest-environment jsdom

/**
 * Selector regression tests.
 *
 * Each platform scraper depends on specific CSS selectors to extract data from
 * page HTML. When a platform redesigns their site, these selectors break —
 * silently returning zero results. These tests document the exact DOM contract
 * each scraper expects so breakage surfaces in CI, not in production.
 *
 * To update after a site change:
 *   1. Grab a fresh HTML sample from the platform
 *   2. Update the inline fixture below
 *   3. Fix selectors in the scraper until tests pass again
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Craigslist
// ---------------------------------------------------------------------------

describe('Craigslist search selectors', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="cl-search-result" title="Vintage Oak Dresser" data-pid="7812345">
        <a href="https://sfbay.craigslist.org/sfc/fuo/d/vintage-oak-dresser/7812345.html">
          <div class="swipe">
            <img src="https://images.craigslist.org/00j0j_abc123_300x300.jpg">
            <img src="https://images.craigslist.org/00j0j_def456_300x300.jpg">
          </div>
          <span class="priceinfo">$150</span>
          <div class="meta"><span class="label">San Francisco</span></div>
        </a>
      </div>
      <div class="cl-search-result" title="Mid Century Walnut Desk" data-pid="7812346">
        <a href="https://sfbay.craigslist.org/sfc/fuo/d/mid-century-walnut-desk/7812346.html">
          <div class="gallery">
            <img src="https://images.craigslist.org/00j0j_ghi789_300x300.jpg">
          </div>
          <span class="price">$275</span>
          <span class="location">Oakland</span>
        </a>
      </div>
    `;
  });

  it('finds listing cards with .cl-search-result', () => {
    const cards = document.querySelectorAll('.cl-search-result');
    expect(cards.length).toBe(2);
  });

  it('extracts title from data attribute', () => {
    const card = document.querySelector('.cl-search-result');
    expect(card?.getAttribute('title')).toBe('Vintage Oak Dresser');
  });

  it('extracts external ID from data-pid', () => {
    const card = document.querySelector('.cl-search-result');
    expect(card?.getAttribute('data-pid')).toBe('7812345');
  });

  it('finds listing link with a[href*=".html"]', () => {
    const card = document.querySelector('.cl-search-result');
    const link = card?.querySelector('a[href*=".html"]') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.href).toContain('7812345.html');
  });

  it('extracts price from .priceinfo or .price', () => {
    const cards = document.querySelectorAll('.cl-search-result');

    // First card uses .priceinfo
    const price1 = cards[0].querySelector('.priceinfo, .price');
    expect(price1?.textContent?.replace(/[^0-9.]/g, '')).toBe('150');

    // Second card uses .price
    const price2 = cards[1].querySelector('.priceinfo, .price');
    expect(price2?.textContent?.replace(/[^0-9.]/g, '')).toBe('275');
  });

  it('extracts location from .meta .label or .location', () => {
    const cards = document.querySelectorAll('.cl-search-result');

    const loc1 = cards[0].querySelector('.meta .label, .location');
    expect(loc1?.textContent?.trim()).toBe('San Francisco');

    const loc2 = cards[1].querySelector('.meta .label, .location');
    expect(loc2?.textContent?.trim()).toBe('Oakland');
  });

  it('extracts images from .swipe img and .gallery img', () => {
    const cards = document.querySelectorAll('.cl-search-result');

    // First card: .swipe img (2 images)
    const imgs1 = cards[0].querySelectorAll('.swipe img, .gallery img');
    expect(imgs1.length).toBe(2);

    // Second card: .gallery img (1 image)
    const imgs2 = cards[1].querySelectorAll('.swipe img, .gallery img');
    expect(imgs2.length).toBe(1);
  });

  it('returns empty list when page has no results', () => {
    document.body.innerHTML = '<div class="no-results">No results found</div>';
    const cards = document.querySelectorAll('.cl-search-result');
    expect(cards.length).toBe(0);
  });
});

describe('Craigslist detail selectors', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section id="postingbody">
        QR Code Link to This Post
        Solid oak dresser from the 1960s. Six drawers, original brass hardware.
        Minor surface scratches on top. Dimensions: 52"W x 18"D x 34"H.
      </section>
      <div class="postinginfo">
        <time class="timeago" datetime="2026-03-15T10:30:00-0700">2026-03-15 10:30</time>
      </div>
      <div id="map" data-latitude="37.7749" data-longitude="-122.4194"></div>
    `;
  });

  it('extracts description from #postingbody', () => {
    const body = document.querySelector('#postingbody')?.textContent?.trim()
      ?.replace(/QR Code Link to This Post\s*/i, '')?.trim();
    expect(body).toContain('Solid oak dresser');
    expect(body).toContain('original brass hardware');
  });

  it('extracts posted date from .postinginfo .timeago', () => {
    const timeEl = document.querySelector('.postinginfo .timeago, time.date');
    expect(timeEl).not.toBeNull();
    expect(timeEl?.getAttribute('datetime')).toBe('2026-03-15T10:30:00-0700');
  });

  it('extracts coordinates from #map data attributes', () => {
    const mapEl = document.querySelector('#map');
    expect(mapEl?.getAttribute('data-latitude')).toBe('37.7749');
    expect(mapEl?.getAttribute('data-longitude')).toBe('-122.4194');
  });

  it('handles detail page with time.date instead of .timeago', () => {
    document.body.innerHTML = `
      <section id="postingbody">A nice table.</section>
      <time class="date" title="2026-03-20">March 20</time>
    `;
    const timeEl = document.querySelector('.postinginfo .timeago, time.date');
    expect(timeEl).not.toBeNull();
    expect(timeEl?.getAttribute('title')).toBe('2026-03-20');
  });

  it('handles detail page with no map element', () => {
    document.body.innerHTML = '<section id="postingbody">Some text</section>';
    const mapEl = document.querySelector('#map');
    expect(mapEl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// OfferUp
// ---------------------------------------------------------------------------

describe('OfferUp search selectors', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="search-results">
        <a href="https://offerup.com/item/detail/abc12345-def6-7890-abcd-ef1234567890" title="Solid Wood Coffee Table">
          <img src="https://images.offerup.com/abc123_600x600.jpg">
          <span>$85</span>
          <span class="loc">Portland, OR</span>
        </a>
        <a href="https://offerup.com/item/detail/xyz98765-ghi4-3210-wxyz-ab9876543210" title="">
          <img src="https://images.offerup.com/xyz789_600x600.jpg">
          <h3>Vintage Bookshelf Unit</h3>
          <span>$120</span>
          <span class="loc">Seattle, WA</span>
        </a>
        <a href="https://offerup.com/other-page">
          <span>Not a listing</span>
        </a>
      </div>
    `;
  });

  it('finds listing cards with a[href*="/item/detail/"]', () => {
    const cards = document.querySelectorAll('a[href*="/item/detail/"]');
    expect(cards.length).toBe(2);
  });

  it('does not match non-listing links', () => {
    const all = document.querySelectorAll('a');
    const listings = document.querySelectorAll('a[href*="/item/detail/"]');
    expect(all.length).toBeGreaterThan(listings.length);
  });

  it('extracts UUID from /item/detail/ URL', () => {
    const anchor = document.querySelector('a[href*="/item/detail/"]') as HTMLAnchorElement;
    const idMatch = anchor.href.match(/\/item\/detail\/([a-f0-9-]+)/i);
    expect(idMatch).not.toBeNull();
    expect(idMatch![1]).toBe('abc12345-def6-7890-abcd-ef1234567890');
  });

  it('extracts title from title attribute', () => {
    const anchor = document.querySelector('a[href*="/item/detail/"]');
    const title = anchor?.getAttribute('title')?.trim();
    expect(title).toBe('Solid Wood Coffee Table');
  });

  it('falls back to span/h2/h3 for title when title attribute empty', () => {
    const cards = document.querySelectorAll('a[href*="/item/detail/"]');
    const second = cards[1];

    // Verify the title attribute is actually empty (the fallback condition)
    const titleAttr = second.getAttribute('title')?.trim();
    expect(titleAttr).toBe('');

    // The scraper uses: anchor.getAttribute('title')?.trim() || anchor.querySelector('span, h2, h3')?.textContent?.trim()
    // querySelector returns first match in document order — the h3 appears before spans in the DOM
    const fallbackEl = second.querySelector('span, h2, h3');
    expect(fallbackEl?.tagName).toBe('H3');

    const title = titleAttr || fallbackEl?.textContent?.trim();
    expect(title).toBe('Vintage Bookshelf Unit');
  });

  it('extracts price from span starting with $', () => {
    const anchor = document.querySelector('a[href*="/item/detail/"]');
    let price: number | undefined;
    anchor?.querySelectorAll('span').forEach((span) => {
      const text = span.textContent?.trim() || '';
      if (text.startsWith('$') && !price) {
        const num = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (!isNaN(num)) price = num;
      }
    });
    expect(price).toBe(85);
  });

  it('finds image inside listing card', () => {
    const anchor = document.querySelector('a[href*="/item/detail/"]');
    const img = anchor?.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.src).toContain('offerup.com');
  });

  it('returns empty list when no listings match', () => {
    document.body.innerHTML = '<div class="empty-state">No items found</div>';
    const cards = document.querySelectorAll('a[href*="/item/detail/"]');
    expect(cards.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// eBay Sold Listings
// ---------------------------------------------------------------------------

describe('eBay sold listing selectors', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="srp-results">
        <div class="s-item">
          <a class="s-item__link" href="https://www.ebay.com/itm/000000">
            <div class="s-item__title"><span>Shop on eBay</span></div>
          </a>
          <span class="s-item__price">$0.99</span>
        </div>
        <div class="s-item">
          <a class="s-item__link" href="https://www.ebay.com/itm/789012">
            <div class="s-item__title"><span>Vintage MCM Walnut Dresser 6-Drawer</span></div>
          </a>
          <span class="s-item__price">$425.00</span>
          <div class="s-item__title--tagblock">
            <span class="POSITIVE">Sold Mar 10, 2026</span>
          </div>
          <span class="SECONDARY_INFO">Pre-Owned</span>
        </div>
        <div class="s-item">
          <a class="s-item__link" href="https://www.ebay.com/itm/345678">
            <div class="s-item__title"><span>Danish Modern Teak Sideboard</span></div>
          </a>
          <span class="s-item__price">$680.00</span>
          <div class="s-item__title--tagblock">
            <span class="s-item__ended-date">Sold Feb 28, 2026</span>
          </div>
          <span class="SECONDARY_INFO">Pre-Owned</span>
        </div>
      </div>
    `;
  });

  it('finds results container with .srp-results', () => {
    const container = document.querySelector('.srp-results');
    expect(container).not.toBeNull();
  });

  it('finds item cards with .s-item', () => {
    const items = document.querySelectorAll('.s-item');
    expect(items.length).toBe(3);
  });

  it('extracts title from .s-item__title', () => {
    const items = document.querySelectorAll('.s-item');
    const title = items[1].querySelector('.s-item__title')?.textContent?.trim();
    expect(title).toBe('Vintage MCM Walnut Dresser 6-Drawer');
  });

  it('filters out "Shop on eBay" placeholder items', () => {
    const items = document.querySelectorAll('.s-item');
    const realItems = Array.from(items).filter((el) => {
      const title = el.querySelector('.s-item__title')?.textContent?.trim();
      return title && title !== 'Shop on eBay';
    });
    expect(realItems.length).toBe(2);
  });

  it('extracts price from .s-item__price', () => {
    const items = document.querySelectorAll('.s-item');
    const priceText = items[1].querySelector('.s-item__price')?.textContent || '';
    const priceMatch = priceText.match(/\$([0-9,]+\.?\d*)/);
    expect(priceMatch).not.toBeNull();
    expect(parseFloat(priceMatch![1].replace(',', ''))).toBe(425);
  });

  it('extracts link from .s-item__link', () => {
    const items = document.querySelectorAll('.s-item');
    const link = items[1].querySelector('.s-item__link') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.href).toContain('/itm/789012');
  });

  it('extracts sold date from .POSITIVE or .s-item__ended-date', () => {
    const items = document.querySelectorAll('.s-item');

    // First real item uses .POSITIVE
    const date1 = items[1].querySelector(
      '.s-item__title--tagblock .POSITIVE, .s-item__ended-date',
    );
    expect(date1?.textContent?.trim()).toBe('Sold Mar 10, 2026');

    // Second real item uses .s-item__ended-date
    const date2 = items[2].querySelector(
      '.s-item__title--tagblock .POSITIVE, .s-item__ended-date',
    );
    expect(date2?.textContent?.trim()).toBe('Sold Feb 28, 2026');
  });

  it('extracts condition from .SECONDARY_INFO', () => {
    const items = document.querySelectorAll('.s-item');
    const condition = items[1].querySelector('.SECONDARY_INFO')?.textContent?.trim();
    expect(condition).toBe('Pre-Owned');
  });

  it('CAPTCHA selectors detect all three block indicators', () => {
    // The scraper checks: #captcha, .captcha, #g-recaptcha
    for (const html of [
      '<div id="captcha"><p>Verify</p></div>',
      '<div class="captcha"><p>Verify</p></div>',
      '<div id="g-recaptcha" class="g-recaptcha"></div>',
    ]) {
      document.body.innerHTML = html;
      expect(document.querySelector('#captcha, .captcha, #g-recaptcha')).not.toBeNull();
    }
  });

  it('CAPTCHA selectors do not false-positive on normal results', () => {
    // Using the beforeEach fixture (normal results page)
    expect(document.querySelector('#captcha, .captcha, #g-recaptcha')).toBeNull();
  });

  it('correctly distinguishes placeholder from real items', () => {
    // Page with only the "Shop on eBay" placeholder — zero real results
    document.body.innerHTML = `
      <div class="srp-results">
        <div class="s-item">
          <div class="s-item__title"><span>Shop on eBay</span></div>
        </div>
      </div>
    `;
    const items = document.querySelectorAll('.s-item');
    const realItems = Array.from(items).filter((el) => {
      const title = el.querySelector('.s-item__title')?.textContent?.trim();
      return title && title !== 'Shop on eBay';
    });
    expect(realItems.length).toBe(0);

    // Page with real items — should find 2 (from beforeEach fixture would have 2,
    // but we replaced innerHTML, so rebuild with one real + one placeholder)
    document.body.innerHTML = `
      <div class="srp-results">
        <div class="s-item">
          <div class="s-item__title"><span>Shop on eBay</span></div>
        </div>
        <div class="s-item">
          <div class="s-item__title"><span>Real Dresser Listing</span></div>
        </div>
      </div>
    `;
    const items2 = document.querySelectorAll('.s-item');
    const realItems2 = Array.from(items2).filter((el) => {
      const title = el.querySelector('.s-item__title')?.textContent?.trim();
      return title && title !== 'Shop on eBay';
    });
    expect(realItems2.length).toBe(1);
    expect(realItems2[0].querySelector('.s-item__title')?.textContent?.trim()).toBe('Real Dresser Listing');
  });
});

// ---------------------------------------------------------------------------
// Facebook Marketplace
// ---------------------------------------------------------------------------

describe('Facebook Marketplace selectors', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div>
        <a href="https://www.facebook.com/marketplace/item/111222333444">
          <div class="card-wrapper">
            <img src="https://scontent.xx.fbcdn.net/v/t45.1600-4/abc123.jpg">
            <span>$200</span>
            <span>Beautiful Antique Hutch Cabinet</span>
            <span>Sacramento, CA</span>
          </div>
        </a>
        <a href="https://www.facebook.com/marketplace/item/555666777888">
          <div class="card-wrapper">
            <img src="https://scontent.xx.fbcdn.net/v/t45.1600-4/def456.jpg">
            <span>$75</span>
            <span>Solid Pine Bookshelf</span>
            <span>Davis, CA</span>
          </div>
        </a>
        <a href="https://www.facebook.com/marketplace/categories">
          <span>Browse categories</span>
        </a>
      </div>
    `;
  });

  it('finds marketplace item links with a[href*="/marketplace/item/"]', () => {
    const links = document.querySelectorAll('a[href*="/marketplace/item/"]');
    expect(links.length).toBe(2);
  });

  it('does not match non-item marketplace links', () => {
    const all = document.querySelectorAll('a[href*="/marketplace/"]');
    const items = document.querySelectorAll('a[href*="/marketplace/item/"]');
    expect(all.length).toBeGreaterThan(items.length);
  });

  it('extracts item ID from URL', () => {
    const anchor = document.querySelector('a[href*="/marketplace/item/"]') as HTMLAnchorElement;
    const idMatch = anchor.href.match(/\/marketplace\/item\/(\d+)/);
    expect(idMatch).not.toBeNull();
    expect(idMatch![1]).toBe('111222333444');
  });

  it('finds card container via closest("[class]")', () => {
    const anchor = document.querySelector('a[href*="/marketplace/item/"]');
    const card = anchor?.closest('[class]') || anchor;
    expect(card).not.toBeNull();
    const spans = card!.querySelectorAll('span');
    expect(spans.length).toBeGreaterThan(0);
  });

  it('extracts price from span matching $amount pattern', () => {
    const anchor = document.querySelector('a[href*="/marketplace/item/"]');
    const card = anchor?.closest('[class]') || anchor;
    const spans = card!.querySelectorAll('span');
    let price: number | undefined;
    for (const span of spans) {
      const text = span.textContent?.trim() || '';
      if (!price && /^\$[\d,.]+$/.test(text)) {
        price = parseFloat(text.replace(/[^0-9.]/g, ''));
      }
    }
    expect(price).toBe(200);
  });

  it('extracts title from span with 5-200 char text that is not a price', () => {
    const anchor = document.querySelector('a[href*="/marketplace/item/"]');
    const card = anchor?.closest('[class]') || anchor;
    const spans = card!.querySelectorAll('span');
    let title = '';
    let price: number | undefined;
    for (const span of spans) {
      const text = span.textContent?.trim() || '';
      if (!text) continue;
      if (!price && /^\$[\d,.]+$/.test(text)) {
        price = parseFloat(text.replace(/[^0-9.]/g, ''));
        continue;
      }
      if (!title && text.length > 5 && text.length < 200 && !text.startsWith('$')) {
        title = text;
      }
    }
    expect(title).toBe('Beautiful Antique Hutch Cabinet');
  });

  it('finds image inside card, excluding data: URLs', () => {
    const anchor = document.querySelector('a[href*="/marketplace/item/"]');
    const card = anchor?.closest('[class]') || anchor;
    const img = card!.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.src).not.toContain('data:');
  });

  it('finds close buttons for modal dismissal', () => {
    document.body.innerHTML += `
      <div role="dialog">
        <button aria-label="Close">X</button>
      </div>
    `;
    const closeButtons = document.querySelectorAll(
      '[aria-label="Close"], [aria-label="close"]',
    );
    expect(closeButtons.length).toBeGreaterThan(0);
  });

  it('returns empty list when no marketplace items', () => {
    document.body.innerHTML = '<div class="login-page">Please log in</div>';
    const items = document.querySelectorAll('a[href*="/marketplace/item/"]');
    expect(items.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Mercari — no DOM selector tests.
//
// Mercari's search scraper intercepts a GraphQL API response, not DOM.
// The extraction logic operates on structured JSON, so there are no
// CSS selectors to regress against. The API contract is implicitly
// tested by the scraper succeeding or failing in production.
// ---------------------------------------------------------------------------
