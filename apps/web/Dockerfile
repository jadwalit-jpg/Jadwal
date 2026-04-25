# Build context MUST be the monorepo root (apps/web is an npm workspace).
#   Build:   docker build -f apps/web/Dockerfile \
#              --build-arg NEXT_PUBLIC_API_URL=https://api.jadwal.com/api \
#              -t jadwal-web:latest .
#   Run:     docker run -p 3000:3000 jadwal-web:latest

# ── Stage 1: Install prod deps for the web workspace ──────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Copy lockfile + both workspace manifests. npm needs them all to resolve
# the workspace graph even though we only want web's deps.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/

# Install prod deps for the web workspace only.
RUN npm ci --omit=dev --ignore-scripts --workspace=web --include-workspace-root=false

# ── Stage 2: Build ────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/

# Full install (dev deps needed for next build + tailwind + postcss).
RUN npm ci --ignore-scripts --workspace=web

# Copy web sources + turbo manifest (Next.js outputFileTracingRoot needs
# the monorepo root to correctly trace cross-workspace imports).
COPY apps/web ./apps/web
COPY turbo.json ./

# NEXT_PUBLIC_* vars must be set at BUILD time (baked into the bundle).
# Passed via --build-arg from CI or docker-compose.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

WORKDIR /app/apps/web
RUN npm run build

# ── Stage 3: Production image ──────────────────────────────────────
# Next.js standalone output produces a minimal server.js + only the
# node_modules files actually imported at runtime.
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Security: non-root user
RUN addgroup --system --gid 1001 jadwal && \
    adduser --system --uid 1001 jadwal

# Copy the standalone build output. `outputFileTracingRoot` = monorepo root,
# so the standalone bundle lives at apps/web/.next/standalone/apps/web/.
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static

USER jadwal

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

# Next.js standalone server entrypoint. With monorepo outputFileTracingRoot,
# the server.js lives inside apps/web/ in the standalone bundle.
WORKDIR /app/apps/web
CMD ["node", "server.js"]
