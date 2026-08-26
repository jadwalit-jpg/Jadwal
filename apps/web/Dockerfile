# syntax=docker/dockerfile:1.7
# Build context MUST be the monorepo root (apps/web is an npm workspace).
#   Build:   docker build -f apps/web/Dockerfile \
#              --build-arg NEXT_PUBLIC_API_URL=https://api.jadwal.qa/api \
#              -t jadwal-web:latest .
#   Run:     docker run -p 3000:3000 jadwal-web:latest
#
# `# syntax` line above enables BuildKit features. Lets us use
# `--mount=type=cache` on RUN steps so npm's download cache persists
# between builds. Speeds up CI's `npm ci` step from ~60s to ~10s on
# warm cache. Same effect locally if you rebuild the image.
#
# All FROM lines pin `--platform=linux/amd64` so we always produce an
# amd64 image regardless of the host arch — matters when developers on
# Apple Silicon Macs build locally; ECS Fargate runs amd64 by default.

# ── Stage 1: Install prod deps for the web workspace ──────────────
FROM --platform=linux/amd64 node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS deps
WORKDIR /app

# Copy lockfile + both workspace manifests. npm needs them all to resolve
# the workspace graph even though we only want web's deps.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/

# Install prod deps for the web workspace only.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --workspace=web --include-workspace-root=false

# ── Stage 2: Build ────────────────────────────────────────────────
FROM --platform=linux/amd64 node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS builder
WORKDIR /app

# node:22-alpine ships yarn 1.22.x. Next.js 15.5+'s lockfile-patching
# step calls `yarn config get registry` to detect the package manager
# and then trips on the corepack-style `"packageManager": "npm@11.6.2"`
# we declare in root package.json (yarn 1.x parses the value as
# "yarn@npm@11.6.2" and aborts). We use npm exclusively, so strip
# yarn before npm install so Next never finds it. Same defense as
# the runner stage (line 80) which already strips npm/yarn for the
# same Trivy-CVE reason.
RUN rm -f /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/

# Full install (dev deps needed for next build + tailwind + postcss).
# Scripts ENABLED in this builder stage so platform-specific native
# binaries (notably `lightningcss-linux-x64-musl.node` used by Tailwind
# v4 + Next.js's font subsystem) get installed via their postinstall
# hooks. Without this, `next build` aborts with
# "Cannot find module '../lightningcss.linux-x64-musl.node'".
# Security posture: this is only the BUILDER stage, which is thrown
# away after producing the standalone bundle. The runner stage at the
# bottom still uses `--ignore-scripts` to harden the production image.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace=web

# Copy web sources + turbo manifest (Next.js outputFileTracingRoot needs
# the monorepo root to correctly trace cross-workspace imports).
COPY apps/web ./apps/web
COPY turbo.json ./

# NEXT_PUBLIC_* vars must be set at BUILD time (baked into the bundle).
# Passed via --build-arg from CI or docker-compose.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# VAPID public key — published to the browser so it can register a
# pushManager subscription. NOT a secret (it's the public half of the
# keypair); the corresponding private key stays in the API's SSM
# SecureString and is never exposed to the client. Empty value at build
# time = push UI silently disables (push-notifications.ts returns
# 'unsupported').
ARG NEXT_PUBLIC_VAPID_KEY
ENV NEXT_PUBLIC_VAPID_KEY=$NEXT_PUBLIC_VAPID_KEY

# CloudFront / CDN base URL for uploaded user content. Baked into the bundle
# so middleware.ts CSP and next.config.ts remotePatterns both allow this
# origin for <Image> rendering. Empty = no CDN whitelisted (dev / no-CDN).
ARG NEXT_PUBLIC_CDN_URL
ENV NEXT_PUBLIC_CDN_URL=$NEXT_PUBLIC_CDN_URL

# Site URL used by Next.js metadataBase. Without this, the bundle ships
# with the localhost fallback in src/app/layout.tsx, which means OpenGraph
# image URLs resolve to 127.0.0.1 — link unfurlers (WhatsApp, Twitter,
# Slack, iMessage) cannot fetch them, and previews fall back to a Next.js
# default placeholder. Set to https://jadwal.qa in prod via GH Variable.
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

# API_PROXY_TARGET — required by next.config.ts in production. Server-side
# only (not baked into the client bundle); used at runtime by Next.js's
# rewrite() to forward /api/* to the API container. Build still needs it
# present because next.config.ts validates it during `next build`.
ARG API_PROXY_TARGET
ENV API_PROXY_TARGET=$API_PROXY_TARGET

WORKDIR /app/apps/web
RUN npm run build

# ── Stage 3: Production image ──────────────────────────────────────
# Next.js standalone output produces a minimal server.js + only the
# node_modules files actually imported at runtime.
FROM --platform=linux/amd64 node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS runner
WORKDIR /app

ENV NODE_ENV=production

# Patch the base image's OpenSSL (libcrypto3/libssl3): node:22-alpine pins an
# older Alpine whose openssl carries CVE-2026-45447 (HIGH, fixed in 3.5.7-r0),
# which the deploy's Trivy CRITICAL,HIGH gate blocks on. Upgrade just these two
# packages (runner stage only — this is the image that ships + gets scanned).
#
# APK_SECURITY_BUST exists because `--no-cache` above clears APK's package
# INDEX cache, NOT Docker's LAYER cache. The deploy workflow builds with
# `cache-from: type=gha`, and this RUN's cache key never changed — so buildx
# replayed a layer built long before, and the image kept shipping whatever
# openssl was current back then. That is how this line was added for
# CVE-2026-45447 (fixed in 3.5.7-r0) and then CVE-2026-14456 (fixed in
# 3.5.8-r0) silently blocked EVERY deploy on 2026-08-26 while the Dockerfile
# looked correct.
#
# The workflow passes the commit sha, so the upgrade genuinely re-runs on
# every build. Cost: a few seconds and one uncached layer. The alternative is
# rediscovering this by hand the next time an OpenSSL CVE lands.
ARG APK_SECURITY_BUST=dev
RUN echo "apk security upgrade (bust=${APK_SECURITY_BUST})" \
 && apk upgrade --no-cache libcrypto3 libssl3

# Security: non-root user
RUN addgroup --system --gid 1001 jadwal && \
    adduser --system --uid 1001 jadwal

# Strip the npm CLI shipped with the node:22-alpine base image. The
# runtime never calls npm (entrypoint is `node server.js` from Next.js
# standalone output), and npm's bundled transitive deps include
# picomatch 4.0.3 which trips Trivy with CVE-2026-33671. Removing npm
# eliminates the false-positive cleanly.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg

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
  CMD wget -qO- http://localhost:3000/health || exit 1
# /health is a tiny App Router route (apps/web/src/app/health/route.ts)
# that returns the static string "ok" with `dynamic = 'force-static'`. No
# SSR, no DB / no API calls / no rewrites — probe resolves in microseconds.
# Probing / instead would trigger a full home-page render every 30 s × N
# tasks, which is wasteful at scale and can flap during cold-start when
# the home page is paying its first-render cost. The probe is liveness-
# only — it confirms the Node process is up and accepting connections,
# nothing else. Deep readiness (is the upstream API alive?) belongs in a
# separate monitor, not the ALB target group.

# Next.js standalone server entrypoint. With monorepo outputFileTracingRoot,
# the server.js lives inside apps/web/ in the standalone bundle.
WORKDIR /app/apps/web
CMD ["node", "server.js"]
