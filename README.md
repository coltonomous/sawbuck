# Sawbuck

Find underpriced furniture on Craigslist, OfferUp, Mercari, and eBay. Analyze condition and value with Claude's vision API. Plan refinishing projects, source materials, and track profit from acquisition to sale.

## What It Does

- **Deal Finder** — scrapes listing platforms on a schedule, deduplicates across sources, filters irrelevant results, and surfaces the best deals by price-to-value ratio
- **Vision Analysis** — sends listing photos to Claude for furniture type/style identification, condition scoring, wood species detection, and a blunt profit verdict on whether refinishing is worth the effort
- **eBay Comparables** — pulls sold comps via Playwright scraper with CAPTCHA detection and multi-query fallback, supplements with eBay Browse API active listings when blocked. Pricing engine blends sold and active data with source-aware weighting
- **Refinishing Plans** — generates step-by-step refinishing instructions with specific product recommendations, realistic time/cost estimates, and expected resale prices
- **Materials Sourcing** — builds shopping lists with links to Amazon, Home Depot, and Lowe's
- **Project Tracking** — tracks the full lifecycle from acquisition through refinishing to sale, with before/during/after photos and ROI calculations
- **Analytics** — dashboard with deal flow metrics, profit tracking, and platform performance

## Tech Stack

| Layer | Tech |
|-------|------|
| Server | Hono, Node.js, TypeScript |
| Database | SQLite via Drizzle ORM |
| Scraping | Playwright (browser pool) |
| AI | Claude Sonnet (vision + text) |
| eBay API | Browse API v1 (OAuth client credentials) |
| Client | React 19, Vite, Tailwind CSS v4 |
| Maps | Leaflet / react-leaflet |
| Charts | Recharts |

## Setup

```bash
git clone https://github.com/coltonomous/furniture_flipper.git
cd furniture_flipper # repo name stays as-is
npm install
npx playwright install chromium
```

Create a `.env` file:

```
ANTHROPIC_API_KEY=sk-ant-...

# Optional — enables eBay Browse API for active listing comps
# Register at https://developer.ebay.com to get credentials
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
```

Initialize the database and run migrations:

```bash
npm run db:migrate
npm run init
```

## Development

```bash
npm run dev
```

Starts the API server on `:3001` and Vite dev server on `:5173` concurrently.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start server + client in dev mode |
| `npm run build` | Build client for production |
| `npm start` | Run production server |
| `npm run scrape` | Run all active scrapers once |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run test:scraper` | Test scraper manually |
| `npm run test:vision` | Test vision analysis manually |

## Docker

```bash
docker compose up --build
```

Serves the production build on `:3001`. Listing images and the SQLite database persist in `./data/`.

## API Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/listings` | List all scraped listings |
| GET | `/api/listings/:id` | Listing detail with images and analysis |
| POST | `/api/listings/:id/analyze` | Run Claude vision analysis |
| POST | `/api/listings/:id/pricing` | Calculate pricing from comps |
| POST | `/api/comparables/search` | Search eBay sold + active comps |
| GET | `/api/comparables/:listingId` | Get stored comps for a listing |
| GET | `/api/scrapers/status` | Platform settings and search configs |
| POST | `/api/scrapers/run` | Trigger a scrape run |
| GET/POST | `/api/projects` | Project CRUD |
| GET | `/api/stats` | Dashboard analytics |

## How Pricing Works

1. Searches eBay for sold comparables using multi-query strategy (style+type, wood+type, type alone, title keywords)
2. If the Playwright scraper is blocked (CAPTCHA/redirect), falls back to eBay Browse API active listings
3. Calculates blended median: sold-only if >= 3 sold comps, 70/30 sold/active blend if both, active-only discounted 15%
4. Applies condition multiplier: score of 8 = baseline, each point below -10%, each point above +5%
5. Deal score = estimated value / asking price

## Project Structure

```
server/
  index.ts              # Hono server entry
  db/                   # Drizzle schema and connection
  routes/               # API route handlers
  scrapers/             # Platform scrapers + manager
  analysis/             # Vision, pricing, refinishing, sourcing
  lib/                  # Claude client, eBay API client
  images/               # Download + resize pipeline
client/
  src/
    pages/              # Dashboard, Listings, Settings, Projects, Analytics
    components/         # ComparablesList, RefinishingPlan, ROICalculator, etc.
    api.ts              # API client
scripts/                # CLI utilities (init, cron, test helpers)
drizzle/                # SQL migrations
```
