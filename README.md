# Sawbuck

**Buy low. Sand. Sell high.**

AI-powered furniture flipping — an autonomous agent discovers underpriced wood furniture on Craigslist, evaluates flip potential with AI vision analysis, generates refinishing concepts, and surfaces only the best deals.

## What It Does

- **Autonomous Agent** — LangGraph pipeline runs on a schedule: discovers listings via Craigslist RSS, triages with Qwen (batch classification), evaluates with AI vision analysis, generates concept renders via fal.ai, and writes results to a shared feed
- **Vision Analysis** — sends listing photos to AI for furniture type/style identification, condition scoring (1-10), wood species detection, and a blunt profit verdict
- **Refinishing Concepts** — generates "before vs. after" concept images at varying difficulty levels (quick clean, sand & refinish, full transformation) with cost/time estimates
- **eBay Pricing** — pulls active comparables via eBay Browse API, applies condition-adjusted blended median pricing, calculates deal score
- **User Preferences** — location radius, budget, shop space, experience level, and style preferences filter the shared deal feed per-user
- **Refinishing Plans** — detailed step-by-step instructions with product recommendations, time/cost estimates (generated on-demand when user selects a concept)
- **Project Tracking** — full lifecycle from acquisition through refinishing to sale, with before/during/after photos and ROI calculations
- **Knowledge Base (RAG)** — on-device embeddings (all-MiniLM-L6-v2) with pgvector. Past flips, product specs, and technique guides ground AI analysis in real data
- **Analytics** — deal flow metrics, profit tracking, platform performance

## Tech Stack

| Layer | Tech |
|-------|------|
| Server | Hono, Node.js, TypeScript |
| Database | PostgreSQL via Drizzle ORM |
| Agent Pipeline | LangGraph (@langchain/langgraph) |
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

### Agent config (admin UI, no deploy needed)

All pipeline parameters are stored in the database and editable from the admin Settings page. Changes take effect on the next pipeline run.

| Setting | Default | Description |
|---------|---------|-------------|
| `agent.triage_model` | `qwen.qwen3-32b` | Bedrock model ID for triage |
| `agent.eval_model` | `qwen.qwen3-vl-235b-a22b` | Bedrock model ID for vision eval |
| `agent.max_triages` | `50` | Max listings to triage per run |
| `agent.max_evals` | `10` | Max listings to evaluate per run |
| `agent.max_renders` | `5` | Max listings to render concepts for |
| `agent.run_interval_ms` | `14400000` | Run interval (4 hours) |
| `agent.target_city` | `seattle` | Craigslist city |
| `agent.triage_threshold` | `0.6` | Min confidence to pass triage |
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
scrape (CL RSS) → triage (Qwen batch) → [retry if 0 pass] →
enrich (fetch detail pages) → evaluate (Qwen VL vision + eBay pricing) →
planOptions (refinishing summaries) → render (fal.ai concepts) → summarize
```

- Retries vary CL subcategory on each attempt (all → by-owner → by-dealer)
- Deduplicates against DB and within retries (no wasted triage tokens)
- Agent-discovered listings visible to all users, filtered by preferences
- Config refreshed from DB before each run

## Project Structure

```
server/
  agents/               # LangGraph pipeline: graph, nodes, state, config, scheduler
  integrations/         # Platform integrations (Craigslist RSS + fetch)
  analysis/             # Vision analysis, pricing, refinishing plans
  rag/                  # Knowledge base: embeddings, pgvector store, retrieval
  routes/               # API route handlers
  lib/                  # Bedrock client, eBay API, utilities
  images/               # Download, resize, cleanup pipeline
  db/                   # Drizzle schema and Postgres connection
client/
  src/
    pages/              # Dashboard, Listings, Projects, Analytics, Settings
    components/         # UI components
    api.ts              # API client
shared/                 # Constants shared between server and client
scripts/                # CLI utilities (agent runner, ingest, cleanup)
```
