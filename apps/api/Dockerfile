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
#   1. Dev tools (`prisma` CLI, `typescript`, their bin shims). Kept as
#      belt-and-braces. NOTE: this list used to be described as devDeps
#      that workspace hoisting drags in past `--omit=dev`. That was a
#      misdiagnosis. The `npm ci --omit=dev` above yields 312 packages
#      with no typescript and no puppeteer; it was the sharp reinstall
#      below that re-hydrated EVERY workspace's dev tree (946 packages,
#      incl. @lhci/cli -> lighthouse -> puppeteer-core -> extract-zip,
#      which is where the extract-zip HIGH CVE in the api image came
#      from). Root-caused and fixed by adding `--omit=dev` to that
#      command; these rm's only ever removed two of the ~600 strays.
#   2. TypeScript declaration files (.d.ts) and source maps (*.map) —
#      useless at runtime, just disk weight.
#   3. Per-package docs (README, LICENSE, CHANGELOG, etc.) and test
#      fixtures (test/, __tests__/, examples/) shipped inside packages.
#      No runtime path reads them; pure shipping cost.
# Combined: ~150-200 MB drop on the final image with zero behaviour change.
#
# sharp determinism: `sharp`'s native runtime lives in a NESTED optional dep
# (sharp → @img/sharp-linuxmusl-x64 [the .node addon] → @img/sharp-libvips-
# linuxmusl-x64 [the libvips-cpp.so]). `npm ci` intermittently drops that
# optional-of-optional (npm/cli#4828), worsened by the shared BuildKit npm
# cache below — so the SAME lockfile non-deterministically produces a bootable
# image on one run and one that dies with `ERR_DLOPEN_FAILED: libvips-cpp.so`
# on the next (which then fails the ECS rollout + auto-rollbacks). We defeat
# the coin-flip by explicitly re-installing sharp FOR the target platform
# (--os/--cpu/--libc pinned to this stage's linux/musl/x64), which forces npm
# to resolve + place the matching @img libvips binary. Version is read from the
# already-installed sharp so this never drifts from the lockfile; --no-save
# --no-package-lock leaves the manifest/lockfile untouched; --ignore-scripts
# keeps the no-arbitrary-scripts posture (the binary ships prebuilt, no script
# needed). The runner stage adds a build-time `require('sharp')` smoke test so
# a bad image can never again pass CI silently.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --workspace=api --include-workspace-root=false \
 && SHARP_VER="$(node -p "require('/app/node_modules/sharp/package.json').version")" \
 && npm install --prefix /tmp/sharpfix --no-save --no-package-lock --include=optional --ignore-scripts \
      --os=linux --cpu=x64 --libc=musl "sharp@${SHARP_VER}" \
 && rm -rf node_modules/sharp node_modules/@img \
 && cp -R /tmp/sharpfix/node_modules/sharp node_modules/ \
 && cp -R /tmp/sharpfix/node_modules/@img node_modules/ \
 && rm -rf /tmp/sharpfix \
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

# Patch the base image's OpenSSL (libcrypto3/libssl3): node:22-alpine pins an
# older Alpine whose openssl carries CVE-2026-45447 (HIGH, fixed in 3.5.7-r0),
# which the deploy's Trivy CRITICAL,HIGH gate blocks on. Upgrade just these two
# packages (runner stage only — this is the image that ships + gets scanned).
RUN apk upgrade --no-cache libcrypto3 libssl3

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

# Build-time sharp smoke test — FAIL THE BUILD, not the prod rollout, if the
# native libvips binary is missing/unloadable in the assembled image. Before
# this guard a coin-flip `npm ci` (see deps stage) could ship an image that
# only crashed at ECS startup with ERR_DLOPEN_FAILED, tripping the deployment
# circuit breaker + an auto-rollback to the previous task-def. This turns that
# into a fast, loud, pre-push CI failure.
# NOTE on the version read: sharp 0.35 removed "./package.json" from its
# package `exports`, so the bare specifier `require('sharp/package.json')`
# now throws ERR_PACKAGE_PATH_NOT_EXPORTED and would fail this very build.
# A filesystem path is not subject to `exports`, so read it that way.
RUN node -e "const s=require('sharp'); if(!s||!s.format){throw new Error('sharp.format missing')} const v=require('/app/node_modules/sharp/package.json').version; console.log('[build] sharp OK v'+v)"

# Build-time RUNTIME DEPENDENCY check. The sharp probe above proves ONE
# package loads; it says nothing about the rest of the tree. A deploy was
# lost to exactly that gap: an image built, passed the sharp smoke test,
# shipped, and then every task died at boot with
#   Error: Cannot find module 'express'
# because a dependency-pruning change removed production packages. ECS
# circuit-breakered and rolled back, so production stayed up and the only
# visible symptom was a deploy that would not finish.
#
# This asserts that EVERY package in apps/api dependencies actually
# resolves inside the assembled image, which is the invariant that was
# silently broken. Resolution (not import) is deliberate: it is cheap,
# needs no env vars or database, and cannot be fooled by a package whose
# side effects happen to be lazy.
# @types/* are excluded: they are declarations only, contribute no runtime
# module, and are legitimately absent from a --omit=dev tree. (They sit in
# `dependencies` rather than `devDependencies` in the manifest, which is a
# separate pre-existing tidy-up, not a packaging fault.)
RUN node -e "\
const deps = Object.keys(require('/app/apps/api/package.json').dependencies || {}).filter(d => !d.startsWith('@types/'));\
const missing = deps.filter(d => { try { require.resolve(d, { paths: ['/app/apps/api', '/app'] }); return false; } catch (e) { return e.code === 'MODULE_NOT_FOUND'; } });\
if (missing.length) { console.error('[build] FATAL missing runtime deps: ' + missing.join(', ')); process.exit(1); }\
console.log('[build] all ' + deps.length + ' runtime deps resolve');"

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

# `nest build` (without a nest-cli.json) compiles via tsc which preserves
# the src/ subdirectory in the output. So src/main.ts -> dist/src/main.js,
# not dist/main.js. Add a nest-cli.json with `sourceRoot: src` to flatten,
# or — as we do here — point CMD at the actual output path. Same path
# used by package.json's start:prod (which has the same issue tracked).
CMD ["node", "dist/src/main.js"]
