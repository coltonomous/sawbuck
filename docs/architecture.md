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
     | - Listings       |  | - Qwen3 32B   |  | - eBay Browse  |
     | - Projects       |  |   (triage)    |  | - fal.ai       |
     | - Users/Auth     |  | - Qwen3 VL    |  +----------------+
     | - Agent Runs     |  |   235B (vision)|
     | - Concept Renders|  +----------------+
     | - Knowledge Base |
     |   (pgvector)     |
     | - LangGraph      |
     |   Checkpoints    |
     +-----------------+
```

## Agent Pipeline (LangGraph)

The core of Sawbuck is an autonomous LangGraph pipeline that discovers, evaluates, and presents furniture flip opportunities. It runs on a configurable schedule (default: every 4 hours) and loops until it finds enough qualified listings.

### Node Graph

```
                    +-------+
                    | START |
                    +---+---+
                        |
                        v
                   +---------+
              +--->| scrape  |<---------------------------+
              |    +----+----+                            |
              |         |                                 |
              |         v                                 |
              |    +---------+                            |
              |    | triage  |                            |
              |    +----+----+                            |
              |         |                                 |
              |    +---------+----> 0 passed + retries    |
              |    | (check) |      remain? ──────────────+
              |    +---------+----> 0 passed + exhausted? ──> summarize
              |         |                                 |
              |     passed > 0                            |
              |         v                                 |
              |    +---------+                            |
              |    | enrich  |                            |
              |    +----+----+                            |
              |         |                                 |
              |         v                                 |
              |    +-----------+                          |
              |    | reconcile |                          |
              |    +-----+-----+                         |
              |          |                                |
              |          v                                |
              |    +----------+                           |
              |    | evaluate |                           |
              |    +-----+----+                           |
              |          |                                |
              |    +-----+------+                         |
              |    | 0 qualified|----> under caps? ───────+
              |    +-----+------+----> caps hit? ──> summarize
              |          |                                |
              |     qualified > 0                         |
              |          v                                |
              |    +-------------+                        |
              |    | planOptions |                        |
              |    +------+------+                        |
              |           |                               |
              |           v                               |
              |    +--------+                             |
              |    | render |                             |
              |    +---+----+                             |
              |        |                                  |
              |   +----+-----+                            |
              |   | < 3      |                            |
              |   | rendered |----> under caps? ──────────+
              |   +----+-----+----> caps hit? ──> summarize
              |        |
              |   3+ rendered
              |        v
              |   +-----------+     +-----+
              +-->| summarize |---->| END |
                  +-----------+     +-----+
```

### Node Details

| Node | Model | Input | Output | Persists to DB |
|------|-------|-------|--------|----------------|
| **scrape** | - | CL search page (HTML) | `ScrapedCandidate[]` | No (in-memory) |
| **triage** | Qwen3 32B | Titles + prices (batch of 10) | `TriagedCandidate[]` | No |
| **enrich** | - | Detail page HTML fetch | Descriptions, images, lat/lng | No |
| **reconcile** | - | HEAD/GET requests to CL | Removal signals | Yes (status → removed) |
| **evaluate** | Qwen3 VL 235B | Photos + listing context | Analysis, pricing, recommendation | Yes (listings table) |
| **planOptions** | Qwen3 32B | Furniture metadata | 3 refinishing tiers | Yes (concept_renders) |
| **render** | fal.ai Flux | Furniture + option description | Concept images | Yes (concept_renders.localPath) |
| **summarize** | - | Run counters | Run record | Yes (agent_runs) |

### Loop Behavior

The pipeline loops back to scrape when:
- **After triage**: 0 candidates passed but scrape attempts remain (tries next CL page)
- **After evaluate**: 0 listings qualified but eval cap not hit (tries next page)
- **After render**: fewer than 3 listings rendered and caps not exhausted

Caps that prevent infinite loops:
- `MAX_SCRAPE_ATTEMPTS` = 5 (CL search pages)
- `maxEvals` = 10 (Bedrock vision calls per run)
- `maxListingsRendered` = 5 (fal.ai renders per run)
- `MIN_QUALIFIED_TARGET` = 3 (stop early when target met)

### Quality Gates

```
Triage (text-only, cheap):
  is_wood_furniture? AND has_flip_potential? AND confidence >= 0.6
      ↓ pass
Evaluate (vision, expensive):
  flip_recommendation in [strong_buy, buy]?
  AND (no eBay creds OR dealScore >= 1.3)?
      ↓ qualified → planOptions + render
      ↓ maybe → stays in feed as "analyzed"
      ↓ pass → dismissed (hidden from feed)
```

Verdict contradiction detection: if the prose verdict says "pass"/"not worth it" but the structured field returns "maybe", it's corrected to "pass" and dismissed.

## Data Flow: Listing Lifecycle

```
CL Search Page ──scrape──> ScrapedCandidate (title, price, images, location)
                              |
                           triage (is it wood furniture worth evaluating?)
                              |
                         ┌────┴─── no ──> discarded (never enters DB)
                         |
                      enrich (fetch detail page for description, more images, lat/lng)
                         |
                      reconcile (mark 404s in existing DB listings)
                         |
                      evaluate ──> INSERT listing into DB (status: analyzed)
                         |
                    ┌────┴──── pass ──> UPDATE status: dismissed
                    |    |
                    |    └──── maybe ──> stays as analyzed
                    |
                 qualified (buy/strong_buy)
                    |
                 planOptions ──> INSERT 3 concept_renders rows (no images yet)
                    |
                 render ──> UPDATE concept_renders with localPath (image file)
```

## RAG Knowledge Base

```
                    ┌─────────────────────────────────┐
                    │       Knowledge Base (pgvector)  │
                    │                                  │
                    │  ┌──────────┐  ┌──────────────┐ │
                    │  │ Projects │  │ Product Specs │ │
                    │  │ (flips)  │  │ (Citristrip,  │ │
                    │  │          │  │  Minwax, etc) │ │
                    │  └──────────┘  └──────────────┘ │
                    │  ┌──────────────────────────┐   │
                    │  │ Technique Guides          │   │
                    │  │ (sanding, staining, etc)  │   │
                    │  └──────────────────────────┘   │
                    └──────────────┬──────────────────┘
                                   │
                          embed(query) → pgvector search
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
     Vision Analysis      Refinishing Plans      Triage Context
     (getFullContext)      (getFullContext)      (getProjectContext)
```

### Ingestion Sources

- **Projects**: auto-ingested when a project is marked "sold" (purchase price, materials, hours, sale price, ROI)
- **Products**: fetched from product pages listed in `server/rag/sources.json` (Citristrip, Minwax, Howard, etc.)
- **Guides**: fetched from technique guides listed in `server/rag/sources.json`

### Embedding Model

all-MiniLM-L6-v2 via `@xenova/transformers` — runs on-device (no API calls). 384-dimension vectors stored in pgvector. First run downloads ~80MB model to `data/.cache/huggingface/`.

### Retrieval

`getFullContext()` queries all three chunk types in parallel:
1. Past flip outcomes (k=3) — "a similar oak dresser sold for $340"
2. Product specs (k=4) — "Citristrip: apply thick coat, wait 30 min"
3. Technique guides (k=3) — "for pine, use pre-stain conditioner"

Results filtered by cosine distance < 1.2, formatted with section headers, and injected into the LLM prompt.

## Craigslist Integration

```
Search Page (HTML)
  │
  ├── JSON-LD (schema.org ItemList)
  │     → title, price, images, lat/lng, location
  │
  ├── <a> tags with listing URLs
  │     → matched to JSON-LD by normalized title
  │
  └── Cookie Jar (persistent per process)
        → warmed by visiting CL homepage first
        → sent on all subsequent requests
        → reduces bot detection risk
```

### Anti-Blocking

- Jittered delays between requests (1.5-4s configurable)
- Daily request cap (200 default)
- Exponential backoff on errors (30s base, 10min max)
- Browser-like headers (Chrome UA, Accept, Accept-Language, Referer chain)
- Persistent cookie jar across all CL requests
- CAPTCHA detection (aborts run if detected)

## Database Schema (Key Tables)

```
users ──────────┐
  │              │
  ├── listings ──┤──> listingImages
  │   │          │──> conceptRenders (plan options + render images)
  │   │          │──> comparables (eBay pricing data)
  │   │          │
  │   └── projects ──> refinishingPlans ──> materials
  │                ──> projectPhotos
  │
  ├── sessions, accounts (better-auth)
  │
  └── (agent-discovered listings have userId = NULL)

agent_runs ──── pipeline run history
app_settings ── admin-configurable key-value pairs
knowledge_chunks + knowledge_vec ── RAG (pgvector)
checkpoints ── LangGraph state persistence (PostgresSaver)
```

## Deployment

```
GitHub Push (main) ──> GitHub Actions
  │
  ├── Test job: pgvector service, schema push, vitest
  │
  └── Deploy job:
        ├── rsync to EC2
        ├── Write secrets to .env
        ├── docker image prune + builder prune
        ├── docker compose build + up
        ├── Health check (curl /health)
        └── RAG ingest (products + guides)

EC2 Instance:
  ├── Caddy (reverse proxy, TLS) ──> :3001
  ├── Docker: app container (Hono + Vite build)
  └── Docker: postgres container (pgvector/pgvector:pg16)
        └── Volume: postgres_data
```

### Startup Sequence

1. `entrypoint.sh`: create data dirs, `drizzle-kit push --force`, start server
2. Server: promote ADMIN_EMAIL user, bootstrap RAG, start image cleanup scheduler
3. If `AWS_REGION` set: start agent scheduler (first run after 10s, then every 4h)
4. Docker HEALTHCHECK: `curl /health` every 30s

## Admin Controls

Available in Settings page (admin role required):

- **Agent Config**: model IDs, per-run caps, quality gates, scheduling, anti-blocking
- **Users**: role management (user/admin), deletion
- **Agent Runs**: history with error details, manual "Run Now" trigger
- **Bulk Actions**: select + dismiss/delete listings from the Listings tab
