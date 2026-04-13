# Sawbuck Architecture

Technical reference for the systems, data flows, and design decisions behind Sawbuck.

## System Overview

```
                          +-----------------+
                          |   React Client  |
                          |  (Vite + TW4)   |
                          +--------+--------+
                                   |
                              HTTP / WS
                                   |
                          +--------v--------+
                          |   Hono Server   |
                          |   (Node.js)     |
                          +--------+--------+
                                   |
              +--------------------+--------------------+
              |                    |                    |
     +--------v--------+  +-------v--------+  +-------v--------+
     |  PostgreSQL      |  | AWS Bedrock    |  | External APIs  |
     |  + pgvector      |  | (Converse API) |  |                |
     |                  |  |                |  | - Craigslist   |
     | - Listings       |  | - Qwen3 32B   |  | - OfferUp      |
     | - Projects       |  |   (triage)    |  | - eBay Browse  |
     | - Users/Auth     |  | - Qwen3 VL    |  | - fal.ai       |
     | - Agent Runs     |  |   235B (vision)|  +----------------+
     | - Regions        |  +----------------+
     | - Platforms      |
     | - Concept Renders|
     | - Knowledge Base |
     |   (pgvector)     |
     | - Knowledge      |
     |   Sources        |
     | - LangGraph      |
     |   Checkpoints    |
     +-----------------+
```

## Agent Pipeline (LangGraph)

The core of Sawbuck is an autonomous LangGraph pipeline that discovers, evaluates, and presents furniture flip opportunities across multiple platforms and regions. It runs on a configurable schedule (default: every 4 hours) and loops until it finds enough qualified listings or exhausts per-platform retry budgets.

### Node Graph

```
                    +-----------+
                    |   START   |
                    +-----+-----+
                          |
                          v
                +-----------------+
                | dispatchScrapes |  (fans out via LangGraph Send)
                +--------+--------+
                         |
         +---------------+---------------+
         |               |               |
    +----v-----+   +-----v----+   +------v-----+
    | scrapeOne |   | scrapeOne |   | scrapeOne  |  (1 per platform x region)
    | CL/seattle|   | CL/portland|   | OU/seattle |
    +----+-----+   +-----+----+   +------+-----+
         |               |               |
         +---------------+---------------+
                         |
                  +------v------+
                  | mergeScrapes |  (increment per-platform attempt counters)
                  +------+------+
                         |
                         v
                   +---------+
              +--->| triage  |
              |    +----+----+
              |         |
              |    +----+----+----> 0 passed + budget remains? ──> dispatchScrapes
              |    |  check   |
              |    +----+----+----> 0 passed + all exhausted? ──> summarize
              |         |
              |     passed > 0
              |         v
              |    +---------+
              |    | enrich  |  (platform-aware: groups by platform)
              |    +----+----+
              |         |
              |         v
              |    +-----------+
              |    | reconcile |  (probes CL listings only for now)
              |    +-----+-----+
              |          |
              |          v
              |    +----------+
              |    | evaluate |  (writes progress to agent_runs incrementally)
              |    +-----+----+
              |          |
              |    +-----+------+
              |    | 0 qualified|----> budget remains? ──> dispatchScrapes
              |    +-----+------+----> all exhausted? ──> summarize
              |          |
              |     qualified > 0
              |          v
              |    +------------------+
              |    | discoverKnowledge|  (RAG gap detection, queues new sources)
              |    +--------+---------+
              |             |
              |             v
              |    +-------------+
              |    | planOptions |
              |    +------+------+
              |           |
              |      +----+-----+
              |      | no FAL   |
              |      | or cap   |----> < target? ──> dispatchScrapes
              |      +----+-----+----> target met? ──> summarize
              |           |
              |       can render
              |           v
              |    +--------+
              |    | render |
              |    +---+----+
              |        |
              |   +----+------+
              |   | < target  |----> budget remains? ──> dispatchScrapes
              |   +----+------+----> all exhausted? ──> summarize
              |        |
              |   target met
              |        v
              |   +-----------+     +-----+
              +-->| summarize |---->| END |
                  +-----------+     +-----+
```

### Fan-Out Architecture

The `dispatchScrapes` node uses LangGraph's `Send` API to fan out scrape tasks. For each enabled platform that still has retry budget, it creates one `Send('scrapeOne', ...)` per region. Results merge via the `scrapedCandidates` append reducer before triage runs.

Per-platform retry budgets (`scrapeAttempts: Record<string, number>`) ensure a broken or slow platform exhausts its own budget without affecting others. Each platform also gets its own page offset, so CL can be on page 2 while OfferUp is still on page 0.

### Node Details

| Node | Model | Input | Output | Persists to DB |
|------|-------|-------|--------|----------------|
| **dispatchScrapes** | - | Enabled platforms + regions | `Send[]` (fan-out) | No |
| **scrapeOne** | - | Platform search page/API | `ScrapedCandidate[]` | No |
| **mergeScrapes** | - | Merged candidates | Per-platform attempt counts | Yes (agent_runs.scraped) |
| **triage** | Qwen3 32B | Titles + prices (batch of 5) | `TriagedCandidate[]` | Yes (agent_runs.triaged) |
| **enrich** | - | Detail page fetch (per platform) | Descriptions, images, lat/lng | No |
| **reconcile** | - | HEAD/GET requests to CL | Removal signals | Yes (status -> removed) |
| **evaluate** | Qwen3 VL 235B | Photos + listing context | Analysis, pricing, recommendation | Yes (listings, agent_runs) |
| **discoverKnowledge** | - | Qualified listing metadata | Knowledge source URLs | Yes (knowledge_sources) |
| **planOptions** | Qwen3 32B | Furniture metadata | 3 refinishing tiers | Yes (concept_renders) |
| **render** | fal.ai Flux | Furniture + option description | Concept images | Yes (concept_renders.localPath) |
| **summarize** | - | Run counters | Final run record | Yes (agent_runs) |

### Loop Behavior

The pipeline loops back to `dispatchScrapes` when fewer than `MIN_QUALIFIED_TARGET` (1) listings have qualified. Loop-back points:
- **After triage**: 0 candidates passed but at least one platform has retry budget
- **After evaluate**: 0 listings qualified this iteration but eval cap not hit and budget remains
- **After planOptions**: no FAL_KEY or render cap hit, but still under qualified target
- **After render**: target not met and caps not exhausted

`hasScrapeBudget()` checks if any enabled platform has fewer than `MAX_SCRAPE_ATTEMPTS` (3) attempts. A platform that returns 0 results still increments its counter.

Caps that prevent infinite loops:
- `MAX_SCRAPE_ATTEMPTS` = 3 per platform (search pages)
- `maxEvals` = 10 (Bedrock vision calls per run)
- `maxListingsRendered` = 5 (fal.ai renders per run)
- `MIN_QUALIFIED_TARGET` = 1 (stop early when target met)

### Incremental Progress Reporting

Each node calls `reportProgress(runId, { field: value })` after completing, which fires a non-blocking UPDATE against the `agent_runs` row. The admin UI polls every 5 seconds during active runs, so the pipeline visualization lights up nodes one by one as they finish.

### Quality Gates

```
Triage (text-only, cheap):
  is_wood_furniture? AND has_flip_potential? AND confidence >= 0.75
      | pass
Evaluate (vision, expensive):
  flip_recommendation in [strong_buy, buy]?
  AND (no eBay creds OR dealScore >= 1.3)?
      | qualified -> discoverKnowledge -> planOptions + render
      | maybe -> stays in feed as "analyzed"
      | pass -> dismissed (hidden from feed)
```

Verdict contradiction detection: if the prose verdict says "pass"/"not worth it" but the structured field returns "maybe", it's corrected to "pass" and dismissed.

## Platform Integrations

### Craigslist

```
Search Page (HTML + JSON-LD)
  |
  +-- JSON-LD (schema.org ItemList)
  |     -> title, price, images, lat/lng, location
  |
  +-- <a> tags with listing URLs
  |     -> matched to JSON-LD by normalized title
  |
  +-- Cookie Jar (persistent per process)
        -> warmed by visiting CL homepage first

Location: city subdomain (seattle.craigslist.org)
Pagination: URL fragment #search=1~list~{page}~0
Enrichment: HTML parse (#postingbody, data-latitude/longitude)
Removal: 404 or "This posting has been deleted/expired"
```

### OfferUp

```
Search API (JSON)
  |
  +-- https://offerup.com/api/search/v4/search
  |     -> lat/lng + radius, keyword "wood furniture"
  |     -> JSON response with title, price, images, location
  |
  +-- Cookie Jar (browser-like headers)

Location: lat/lng + radius from region config
Pagination: offset=page*25 query param
Enrichment: __NEXT_DATA__ JSON or meta tag fallback
Removal: 404, 410, "no longer available", "item has been sold"
```

### Anti-Blocking (shared)

- Jittered delays between requests (1.5-4s configurable)
- Daily request cap (200 default)
- Exponential backoff on errors (30s base, 10min max)
- Browser-like headers (Chrome UA, Accept, Accept-Language, Referer)
- Persistent cookie jar per platform
- CAPTCHA detection (aborts scraping for that platform)

## Dynamic Regions

Regions are stored in the `regions` DB table with name, lat/lng, radius, and an optional CL subdomain. Admin can add/edit/delete regions from the Settings UI. Each enabled region is scraped by each enabled platform on every pipeline run.

CL uses the `clSubdomain` field (e.g. "seattle" for seattle.craigslist.org). OfferUp uses the lat/lng + radius directly in its search API params.

## Data Flow: Listing Lifecycle

```
Platform Search ──scrapeOne──> ScrapedCandidate (title, price, images, location, platform)
                                 |
                              triage (is it wood furniture worth evaluating?)
                                 |
                            +----+---- no --> discarded (never enters DB)
                            |
                         enrich (fetch detail page for description, more images, lat/lng)
                            |
                         reconcile (mark 404s in existing DB listings)
                            |
                         evaluate --> INSERT listing into DB (status: analyzed)
                            |
                       +----+------- pass --> UPDATE status: dismissed
                       |    |
                       |    +------- maybe --> stays as analyzed
                       |
                    qualified (buy/strong_buy)
                       |
                    discoverKnowledge --> queue RAG sources for knowledge gaps
                       |
                    planOptions --> INSERT 3 concept_renders rows (no images yet)
                       |
                    render --> UPDATE concept_renders with localPath (image file)
```

## RAG Knowledge Base

```
                    +-------------------------------------+
                    |       Knowledge Base (pgvector)      |
                    |                                      |
                    |  +----------+  +------------------+  |
                    |  | Projects |  | Product Specs    |  |
                    |  | (flips)  |  | (Citristrip,     |  |
                    |  |          |  |  Minwax, etc)    |  |
                    |  +----------+  +------------------+  |
                    |  +----------------------------+      |
                    |  | Technique Guides            |      |
                    |  | (sanding, staining, etc)    |      |
                    |  +----------------------------+      |
                    +------------------+-------------------+
                                       |
                              embed(query) -> pgvector search
                                       |
              +------------------------+------------------------+
              |                        |                        |
     Vision Analysis          Refinishing Plans          Triage Context
     (getFullContext)          (getFullContext)          (getProjectContext)
```

### Storage

Single table: `knowledge_chunks` stores content, metadata, content hash, AND the embedding vector (384-dim pgvector column). No separate vector table. The `knowledge_vec` legacy table is automatically migrated and dropped on startup if it exists.

Sources are tracked in the `knowledge_sources` table (seeded from `sources.json` on first boot). Ingestion uses hash-based upserts: content is SHA-256 hashed, and chunks are only re-embedded when the hash changes. Deploys never wipe the knowledge base.

### Ingestion

- **Projects**: auto-ingested when a project is marked "sold"
- **Products**: fetched from manufacturer pages (Citristrip, Minwax, General Finishes, etc.)
- **Guides**: fetched from technique articles (stripping, sanding, staining, wood species profiles)
- **Auto-discovered**: the `discoverKnowledge` pipeline node identifies gaps and queues URLs from reliable domains for async ingestion

### Embedding Model

all-MiniLM-L6-v2 via `@xenova/transformers` runs on-device (no API calls). 384-dimension vectors stored as a column on `knowledge_chunks` via pgvector. First run downloads the model (~80MB) to `data/.cache/huggingface/`.

### Retrieval

`getFullContext()` queries all three chunk types in parallel:
1. Past flip outcomes (k=3)
2. Product specs (k=4)
3. Technique guides (k=3)

Results filtered by cosine distance < 1.2, formatted with section headers, and injected into the LLM prompt.

## Database Schema (Key Tables)

```
users ---------------+
  |                  |
  +-- listings ------+---> listingImages
  |   |              |---> conceptRenders (plan options + render images)
  |   |              |---> comparables (eBay pricing data)
  |   |
  |   +-- projects ---> refinishingPlans ---> materials
  |                  ---> projectPhotos
  |
  +-- sessions, accounts (better-auth)
  |
  +-- (agent-discovered listings have userId = NULL)

agent_runs ---------- pipeline run history (updated incrementally by nodes)
regions ------------- scrape target locations (admin-managed)
platform_settings --- enable/disable platforms (admin-managed)
knowledge_sources --- RAG source registry (seeded + auto-discovered)
knowledge_chunks ---- RAG chunks with content, content_hash, AND embedding vector (single table)
app_settings -------- admin-configurable key-value pairs
checkpoints --------- LangGraph state persistence (PostgresSaver)
```

## Deployment

```
GitHub Push (main) --> GitHub Actions
  |
  +-- Test job: pgvector service, schema push, vitest
  |
  +-- Deploy job:
        +-- rsync to EC2
        +-- Write secrets to .env
        +-- docker image prune + builder prune
        +-- docker compose build + up
        +-- Health check (curl /health, verifies DB connectivity)

EC2 Instance:
  +-- Caddy (reverse proxy, TLS) --> :3001
  +-- Docker: app container (Hono + Vite build)
  +-- Docker: postgres container (pgvector/pgvector:pg16)
        +-- Volume: postgres_data (persists across rebuilds)
```

### Startup Sequence

1. `entrypoint.sh`: create data dirs, run pre-push SQL migration (idempotent CREATE TABLE IF NOT EXISTS), `drizzle-kit push --force`, start server
2. Server: promote ADMIN_EMAIL user, seed platform settings + default region, bootstrap RAG (incremental sync), start image cleanup scheduler
3. If `AWS_REGION` set: start agent scheduler (first run after 10s, then every 4h)
4. Docker HEALTHCHECK: `GET /health` every 30s (checks DB connectivity, returns 503 if unreachable)

## Admin Controls

Available in Settings page (admin role required):

- **Platforms & Regions**: enable/disable platforms (CL, OfferUp), add/edit/delete scrape regions with coordinates
- **Agent Config**: model IDs, per-run caps, quality gates, scheduling, anti-blocking parameters
- **Agent Runs**: run history with error details, pipeline visualization with real-time progress (polls every 5s during active runs), manual "Run Now" trigger
- **Pipeline Visualization**: SVG graph showing fan-out from dispatch into platform x region scrape nodes, with nodes lighting up as the pipeline progresses
- **Users**: role management (user/admin), deletion
- **Bulk Actions**: select + dismiss/delete listings from the Listings tab
