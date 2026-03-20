# Stage 1: Build the Vite React client
FROM node:22-slim AS client-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/vite.config.ts client/tsconfig.json client/index.html ./client/
COPY client/public/ ./client/public/
COPY client/src/ ./client/src/
COPY shared/ ./shared/
RUN npm ci --ignore-scripts
RUN cd client && npx vite build

# Stage 2: Production server
FROM node:22-slim AS production

# Install build tools for native modules (sharp, better-sqlite3)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install production deps + native modules
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install drizzle-kit

# Install Playwright Chromium + system dependencies
# Retry Playwright download — CDN can be flaky on EC2
RUN npx playwright install --with-deps chromium || \
    (sleep 5 && npx playwright install --with-deps chromium) || \
    (sleep 10 && npx playwright install --with-deps chromium)

# Copy server code
COPY server/ ./server/
COPY drizzle/ ./drizzle/
COPY drizzle.config.ts tsconfig.json ./
COPY scripts/ ./scripts/

# Copy built client from stage 1
COPY --from=client-build /app/client/dist/ ./client/dist/
COPY shared/ ./shared/

# Create data directory (will be overridden by volume mount)
RUN mkdir -p /app/data/images/originals /app/data/images/resized

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

RUN addgroup --system app && adduser --system --home /home/app --ingroup app app && \
    chown -R app:app /app

# Entrypoint: fix data dir permissions (bind mount may be root-owned), then drop to app user
COPY --chmod=755 entrypoint.sh ./
ENTRYPOINT ["./entrypoint.sh"]
