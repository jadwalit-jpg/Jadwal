# syntax=docker/dockerfile:1.7
# Build context MUST be the monorepo root (apps/api is an npm workspace).
#   Build:   docker build -f apps/api/Dockerfile -t jadwal-api:latest .
#   Run:     docker run -p 4000:4000 --env-file .env jadwal-api:latest
#
# `# syntax` line above enables BuildKit features. Lets us use
# `--mount=type=cache` on RUN steps so the npm download cache persists
# between builds — local rebuild after a code change drops from ~60s to
# ~10s on the install step. Same speedup applies in CI when GitHub
# Actions caches the BuildKit cache between runs.
#
# All FROM lines pin `--platform=linux/amd64` so we always produce an
# amd64 image regardless of the host arch (matters when developers on
# Apple Silicon Macs build locally — without the pin Docker would build
# arm64 and ECS Fargate would refuse to run it with "exec format error").

# ── Stage 1: Install prod deps for the api workspace ──────────────
FROM --platform=linux/amd64 node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS deps
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
#
# After install we aggressively prune the node_modules tree before it gets
# COPYed into the runner stage. Three things we strip:
#   1. Dev tools that npm workspace hoisting drags in from apps/web
#      (`prisma` CLI, `typescript`, their associated bin shims). These
#      are devDependencies in apps/api but `--omit=dev` doesn't catch
#      them when they're hoisted from another workspace.
#   2. TypeScript declaration files (.d.ts) and source maps (*.map) —
#      useless at runtime, just disk weight.
#   3. Per-package docs (README, LICENSE, CHANGELOG, etc.) and test
#      fixtures (test/, __tests__/, examples/) shipped inside packages.
#      No runtime path reads them; pure shipping cost.
# Combined: ~150-200 MB drop on the final image with zero behaviour change.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --workspace=api --include-workspace-root=false \
 && rm -rf node_modules/prisma node_modules/.bin/prisma \
           node_modules/typescript node_modules/.bin/tsc node_modules/.bin/tsserver \
           apps/api/node_modules/prisma apps/api/node_modules/typescript \
 && find node_modules apps/api/node_modules -type f \( \
        -name "*.d.ts" -o -name "*.map" -o \
        -name "LICENSE*" -o -name "CHANGELOG*" -o \
        -name "*.md" -o -name "README*" -o \
        -name ".npmignore" -o -name ".eslintrc*" \
      \) -delete 2>/dev/null \
 && find node_modules apps/api/node_modules -type d \( \
        -name "test" -o -name "tests" -o -name "__tests__" -o \
        -name "docs" -o -name "examples" -o -name ".github" \
      \) -prune -exec rm -rf {} + 2>/dev/null || true

# ── Stage 2: Build ────────────────────────────────────────────────
FROM --platform=linux/amd64 node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Full install (including dev deps) — needed for @nestjs/cli, prisma, and
# typescript at build time. NOTE: we deliberately omit `--workspace=api`
# here. With the workspace flag, npm hoists @prisma/client to root
# /app/node_modules but doesn't symlink it into apps/api/node_modules,
# and Prisma 7's generator (used by the next RUN below) does NOT
# traverse upward beyond the workspace's local node_modules. Skipping
# the flag installs the full workspace graph with proper hoisting that
# `npx prisma generate` can resolve. Builder stage size is throwaway —
# only the runner stage's pruned /app/node_modules ships.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts

# Copy api sources + prisma schema
COPY apps/api ./apps/api
COPY turbo.json ./

# Generate Prisma client + build NestJS
WORKDIR /app/apps/api
RUN npx prisma generate
RUN npm run build

# ── Stage 3: Production image ──────────────────────────────────────
FROM --platform=linux/amd64 node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS runner
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

# Strip the npm CLI shipped with the node:22-alpine base image. The
# runtime never calls npm (entrypoint is `node dist/main.js`), and npm's
# bundled transitive deps include picomatch 4.0.3 which trips Trivy with
# CVE-2026-33671. Removing npm eliminates the false-positive cleanly
# instead of carrying a Trivy ignore-list entry.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg

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
