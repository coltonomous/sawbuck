# Stage 1: Build the Vite React client
FROM node:22-slim AS client-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/vite.config.ts client/tsconfig.json client/index.html ./client/
COPY client/public/ ./client/public/
COPY client/src/ ./client/src/
COPY shared/ ./shared/
RUN npm ci --ignore-scripts
ARG VITE_CDN_DOMAIN
ENV VITE_CDN_DOMAIN=$VITE_CDN_DOMAIN
RUN cd client && npx vite build

# Stage 2: Production server
FROM node:22-slim AS production

# Install build tools for native modules (sharp)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install production deps + native modules
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install drizzle-kit

# Cache HuggingFace models in the data volume so they persist across rebuilds
ENV HF_HOME=/app/data/.cache/huggingface

# Copy server code
COPY server/ ./server/
COPY drizzle/ ./drizzle/
COPY drizzle.config.ts tsconfig.json ./
COPY scripts/ ./scripts/

# Copy built client from stage 1
COPY --from=client-build /app/client/dist/ ./client/dist/
COPY shared/ ./shared/

# Create data directory for HuggingFace model cache
RUN mkdir -p /app/data

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

RUN addgroup --system app && adduser --system --home /home/app --ingroup app app && \
    chown -R app:app /app

# Entrypoint runs as root to fix bind-mount permissions, then drops to app user via su
COPY --chmod=755 entrypoint.sh ./
ENTRYPOINT ["./entrypoint.sh"]
