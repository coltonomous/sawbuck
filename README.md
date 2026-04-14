# Sawbuck

**Buy low. Sand. Sell high.**

AI-powered furniture flipping. An autonomous agent scrapes Craigslist and OfferUp across multiple regions, evaluates flip potential with AI vision analysis, generates refinishing concepts, and surfaces only the best deals.

## What It Does

- **Multi-Platform Agent** — LangGraph pipeline fans out across enabled platforms (Craigslist, OfferUp) and regions using the `Send` API. Each platform has its own retry budget and page offset. Triage, evaluation, and rendering are shared across all sources.
- **Dynamic Regions** — Add and manage scrape regions from the admin UI. Each region has coordinates and a radius. CL uses city subdomains, OfferUp uses lat/lng search.
- **Vision Analysis** — Sends listing photos to AI for furniture type/style identification, condition scoring (1-10), wood species detection, and a blunt profit verdict.
- **Refinishing Concepts** — Generates "before vs. after" concept images at varying difficulty levels (quick clean, sand and refinish, full transformation) with cost/time estimates.
- **eBay Pricing** — Pulls active comparables via eBay Browse API, applies IQR outlier filtering and condition-adjusted median pricing with a 15% active-listing discount, calculates deal score.
- **Self-Growing Knowledge Base (RAG)** — On-device embeddings (all-MiniLM-L6-v2) with pgvector. Past flips, product specs, and technique guides ground AI analysis in real data. Knowledge gap detection automatically queues new sources when the agent encounters unfamiliar furniture types. Hash-based upserts mean deploys never wipe the knowledge base.
- **Refinishing Plans** — Detailed step-by-step instructions with product recommendations, time/cost estimates (generated on-demand when user selects a concept).
- **Project Tracking** — Full lifecycle from acquisition through refinishing to sale, with before/during/after photos and ROI calculations.
- **Pipeline Visualization** — Live SVG graph in the admin panel shows the fan-out structure and lights up nodes as the pipeline progresses, with real-time polling during active runs.
- **User Preferences** — Location radius, budget, shop space, experience level, and style preferences filter the shared deal feed per-user.
- **Auto-Analyze on Import** — Imported listings automatically run vision analysis and pricing in the background.
- **Smart Defaults** — Concept difficulty pre-selected based on user experience level. All 3 plans + renders generated automatically for qualified listings.
- **Per-User Dismissals** — Dismissing a listing only affects your feed, not other users.
- **Analytics (Admin)** — Deal flow metrics, profit tracking, platform performance.

## Tech Stack

| Layer | Tech |
|-------|------|
| Server | Hono, Node.js, TypeScript |
| Database | PostgreSQL via Drizzle ORM |
| Agent Pipeline | LangGraph with Send-based fan-out |
| AI Models | Qwen3 VL 235B + Qwen3 32B via AWS Bedrock |
| Image Generation | fal.ai (Flux) |
| Embeddings | all-MiniLM-L6-v2 via @xenova/transformers (on-device, 384-dim) |
| Vector Search | pgvector |
| eBay API | Browse API v1 (OAuth) |
| Client | React 19, Vite, Tailwind CSS v4 |
| Maps | Leaflet / react-leaflet |
| Auth | better-auth (email/password + Google OAuth) |

## Setup

```bash
git clone https://github.com/coltonomous/sawbuck.git
cd sawbuck
cp .env.example .env
# Edit .env with your credentials
```

### Docker (recommended)

```bash
docker compose up --build -d
```

Starts PostgreSQL (with pgvector) and the app. On first boot:
- Schema is created automatically via `drizzle-kit push`
- Default platform settings and region are seeded
- RAG knowledge base bootstraps (downloads embedding model ~80MB)
- Agent scheduler starts after 10s (if `AWS_REGION` is set)

### Local development

```bash
# Start Postgres
docker compose up -d postgres

# Install deps and push schema
npm install
DATABASE_URL=postgresql://postgres:sawbuck@localhost:5432/sawbuck npx drizzle-kit push --force

# Start dev servers (API :3001 + Vite :5173)
npm run dev
```

## Configuration

### Secrets (`.env` file or GitHub repo secrets)

| Variable | Required | Description |
|----------|----------|-------------|
| `AWS_REGION` | Yes | AWS region for Bedrock (e.g. `us-west-2`) |
| `AWS_ACCESS_KEY_ID` | If not using IAM role | Bedrock credentials |
| `AWS_SECRET_ACCESS_KEY` | If not using IAM role | Bedrock credentials |
| `BETTER_AUTH_SECRET` | Yes | Auth encryption key (32+ chars) |
| `FAL_KEY` | Optional | fal.ai API key for concept renders |
| `EBAY_CLIENT_ID` | Optional | eBay Browse API credentials |
| `EBAY_CLIENT_SECRET` | Optional | eBay Browse API credentials |
| `GOOGLE_CLIENT_ID` | Optional | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Optional | Google OAuth |

### Platforms and regions (admin UI)

Platforms (Craigslist, OfferUp) can be enabled/disabled from the Settings page. Regions are managed there too, each with a name, coordinates, radius, and optional CL subdomain.

### Agent config (admin UI, no deploy needed)

All pipeline parameters are stored in the database and editable from the admin Settings page. Changes take effect on the next pipeline run.

| Setting | Default | Description |
|---------|---------|-------------|
| `agent.triage_model` | `qwen.qwen3-32b-v1:0` | Bedrock model ID for triage |
| `agent.eval_model` | `qwen.qwen3-vl-235b-a22b` | Bedrock model ID for vision eval |
| `agent.max_triages` | `50` | Max listings to triage per run |
| `agent.max_evals` | `10` | Max listings to evaluate per run |
| `agent.max_renders` | `5` | Max listings to render concepts for |
| `agent.run_interval_ms` | `14400000` | Run interval (4 hours) |
| `agent.target_city` | `seattle` | Legacy CL city (use regions instead) |
| `agent.triage_threshold` | `0.75` | Min confidence to pass triage |
| `agent.deal_score_threshold` | `1.3` | Min deal score to qualify |

Settings can also be set via `AGENT_*` env vars as initial defaults before the DB is populated.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start server + client in dev mode |
| `npm run build` | Build client for production |
| `npm start` | Run production server |
| `npm test` | Run test suite |
| `npm run agent` | Run agent pipeline once (manual trigger) |
| `npm run db:push` | Push schema to database |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run ingest` | Populate RAG knowledge base |
| `npm run cleanup:images` | Run image retention cleanup |

## Agent Pipeline

```
dispatchScrapes (fans out via Send)
  |
  +-- scrapeOne (CL/seattle) --+
  +-- scrapeOne (CL/portland) -+--> mergeScrapes
  +-- scrapeOne (OU/seattle) --+
  |
  v
triage (Qwen batch) --> [retry if 0 pass, per-platform budget] -->
enrich (fetch detail pages, grouped by platform) -->
evaluate (Qwen VL vision + eBay pricing) -->
  +-- pass -> dismissed
  +-- maybe -> stays in feed
  +-- buy/strong_buy -> discoverKnowledge -> planOptions -> render
      [loop if < target qualified]
--> summarize
```

- Fans out scrape tasks across all enabled platforms and regions in parallel
- Each platform has its own retry budget (3 pages) and page offset
- Deduplicates against DB and within retries (no wasted triage tokens)
- Incremental progress: each node writes its counts to `agent_runs` as it finishes, and the admin UI polls every 5s to update the pipeline visualization in real time
- Stale listing detection: enrichment detects 404s and deletion notices; reconcile runs independently every 6 hours (not in the pipeline)
- Knowledge gap detection: after evaluation, the pipeline checks if the RAG knowledge base covers the furniture types it found and queues new sources if not
- Config refreshed from DB before each run

For detailed architecture diagrams and data flows, see [docs/architecture.md](docs/architecture.md).

## Listing Lifecycle

| Status | Set by | Meaning |
|--------|--------|---------|
| `new` | Scrape/import | Just discovered, not yet analyzed |
| `analyzed` | Vision analysis | AI analysis complete |
| `watching` | User | Bookmarked for later |
| `acquired` | Project creation | User bought the piece |
| `dismissed` | User or agent | Not interested (pass verdict) |
| `removed` | Reconcile node | Source listing confirmed gone (404 or deletion notice) |

Removed listings are excluded from the browse feed but remain accessible by direct URL. Users can still create projects from removed listings (the seller took it down after selling to you). Image cleanup treats `removed` the same as `dismissed`.

## Project Structure

```
server/
  agents/               # LangGraph pipeline: graph, nodes, state, config, scheduler, progress
  integrations/         # Platform integrations (Craigslist, OfferUp) + registry
  analysis/             # Vision analysis, pricing, refinishing plans
  rag/                  # Knowledge base: embeddings, pgvector store, retrieval, worker
  routes/               # API route handlers
  lib/                  # Bedrock client, eBay API, utilities
  images/               # Download, resize, cleanup pipeline
  db/                   # Drizzle schema and Postgres connection
client/
  src/
    pages/              # Dashboard, Listings, Projects, Analytics, Settings
    components/         # UI components (PipelineGraph, RefinishingPlan, etc.)
    api.ts              # API client
shared/
  constants.ts          # Enums and display constants shared between server and client
  types.ts              # Interfaces shared across the API boundary
scripts/                # CLI utilities (agent runner, ingest, cleanup, migrations)
```
