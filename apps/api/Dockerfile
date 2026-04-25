# Build context MUST be the monorepo root (apps/api is an npm workspace).
#   Build:   docker build -f apps/api/Dockerfile -t jadwal-api:latest .
#   Run:     docker run -p 4000:4000 --env-file .env jadwal-api:latest

# ── Stage 1: Install prod deps for the api workspace ──────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Copy lockfile + both workspace manifests. npm needs the root manifest to
# understand the workspace graph, and each workspace's package.json.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
# The web workspace manifest is needed for npm to validate the lockfile
# against the full workspace graph — we never install its deps though.
COPY apps/web/package.json ./apps/web/

# Install prod deps for the api workspace only.
# --ignore-scripts blocks postinstall scripts from transitive deps.
RUN npm ci --omit=dev --ignore-scripts --workspace=api --include-workspace-root=false

# ── Stage 2: Build ────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Full install (including dev deps) for the api workspace — needed for
# @nestjs/cli + prisma + typescript at build time.
RUN npm ci --ignore-scripts --workspace=api

# Copy api sources + prisma schema
COPY apps/api ./apps/api
COPY turbo.json ./

# Generate Prisma client + build NestJS
WORKDIR /app/apps/api
RUN npx prisma generate
RUN npm run build

# ── Stage 3: Production image ──────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Security: run as non-root user
RUN addgroup --system --gid 1001 jadwal && \
    adduser --system --uid 1001 jadwal

# Copy the workspace-aware node_modules tree from deps stage. npm workspaces
# hoists to root node_modules, with a small symlink/shim at apps/api/node_modules
# for workspace-local deps. Both are required.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules

# Copy built app + prisma client + schema
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/package.json ./

# Uploads dir for local-dev storage driver (S3 in prod skips this)
RUN mkdir -p /app/uploads && chown -R jadwal:jadwal /app/uploads /app/apps

USER jadwal
WORKDIR /app/apps/api

EXPOSE 4000

# Health check — GET /api/health returns a static string without touching
# DB/Redis. Safe for ALB target-group probes during cold-start (RDS latency
# won't flap the task). Use /api/catalog/platform-info for DEEP health
# probes (separate monitor, not the ALB liveness check).
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

CMD ["node", "dist/main.js"]
