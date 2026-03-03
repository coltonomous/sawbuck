# Stage 1: Build the Vite React client
FROM node:22-slim AS client-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/vite.config.ts client/tsconfig.json client/index.html ./client/
COPY client/src/ ./client/src/
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
RUN npm ci

# Install Playwright Chromium + system dependencies
RUN npx playwright install --with-deps chromium

# Copy server code
COPY server/ ./server/
COPY drizzle/ ./drizzle/
COPY drizzle.config.ts tsconfig.json ./
COPY scripts/ ./scripts/

# Copy built client from stage 1
COPY --from=client-build /app/client/dist/ ./client/dist/

# Create data directory (will be overridden by volume mount)
RUN mkdir -p /app/data/images/originals /app/data/images/resized

EXPOSE 3001

# Run migrations then start server
CMD ["sh", "-c", "npx drizzle-kit migrate && NODE_ENV=production npx tsx server/index.ts"]
