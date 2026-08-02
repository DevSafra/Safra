# syntax=docker/dockerfile:1.7
#
# SAFRA API — production image (M-1, provider-agnostic).
#
# Deliberately names no hosting provider. An OCI image runs on anything; only the
# pipeline that pushes and deploys it needs the provider decision, so this half of M-1
# can be finished before that decision is made.
#
# Build from the REPOSITORY ROOT, not this directory — the build needs the workspace
# manifests and the `@safra/*` packages the API depends on:
#
#   docker build -f apps/api/Dockerfile -t safra-api .
#
# Design notes:
#   - Multi-stage, so no compiler, no dev dependency and no source reaches the final
#     image. Less to patch, and nothing to read if somebody gets a shell.
#   - `pnpm deploy` produces a self-contained tree with the workspace links resolved,
#     which is the only reliable way to ship one app out of a pnpm monorepo.
#   - Runs as a non-root user with a read-only-friendly layout.
#   - No secrets, no `.env`. Configuration is injected at run time; `loadEnv` refuses
#     to boot if anything required is missing.

# ── Base ─────────────────────────────────────────────────────────────────────
# Pinned to a digest-able minor rather than `node:22`, so a rebuild months from now
# produces the same runtime. Alpine keeps the attack surface small; the one thing to
# watch is that @node-rs/argon2 ships musl builds, which it does.
FROM node:22.12-alpine AS base

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"

# Corepack pins pnpm from package.json's `packageManager`, so the image cannot drift
# from the version CI and developers use — one source of truth for the version.
#
# Corepack is updated first because the copy bundled with node:22.12 ships expired
# npm signing keys and dies with "Cannot find matching keyid" before it can resolve
# anything. Pinning pnpm in this file instead would have worked, and would have
# created a second place to remember when the version changes.
RUN npm install -g corepack@latest && corepack enable

WORKDIR /repo

# ── Dependencies ─────────────────────────────────────────────────────────────
# Manifests and the lockfile only. Copying source here would invalidate this layer on
# every code change and re-download the world on every build.
FROM base AS deps

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json           apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json        packages/db/
COPY packages/session/package.json   packages/session/

# `--frozen-lockfile` fails rather than silently resolving something new, which is the
# whole point of committing a lockfile.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ── Build ────────────────────────────────────────────────────────────────────
FROM deps AS build

COPY . .

# Scripts were skipped during install for supply-chain reasons; native modules still
# need their build step, so it is run explicitly and only for what is approved.
RUN pnpm rebuild @node-rs/argon2 sharp

RUN pnpm --filter @safra/api... build

# A pruned, self-contained tree: workspace dependencies are materialised rather than
# symlinked, and dev dependencies are dropped.
#
# `--legacy` because pnpm 10 otherwise requires `inject-workspace-packages=true` in the
# workspace config. Setting that would change how every developer's local install
# resolves `@safra/*`, to fix a problem that only exists inside this image — so the
# flag keeps the change where it belongs.
RUN pnpm --filter @safra/api --prod deploy --legacy /app

# `pnpm deploy` copies the whole package directory, TypeScript sources and build
# config included. They are dead weight at runtime and a free read of the codebase for
# anyone who gets a shell in the container, so they are removed rather than shipped.
RUN rm -rf /app/src /app/tsconfig*.json /app/Dockerfile /app/*.tsbuildinfo

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22.12-alpine AS runtime

# `tini` reaps zombies and forwards signals, so SIGTERM reaches Node and Nest's
# shutdown hooks actually run. Without an init, a rolling deploy kills connections
# mid-request instead of draining them.
RUN apk add --no-cache tini

ENV NODE_ENV=production
# Node does not see cgroup memory limits by default and will happily grow past the
# container's allowance until the kernel kills it. The orchestrator should set this to
# roughly 75% of the memory limit.
ENV NODE_OPTIONS="--max-old-space-size=768"

WORKDIR /app

# node:alpine already provides an unprivileged `node` user (uid 1000). Ownership is
# set on copy so the image needs no chown layer.
COPY --from=build --chown=node:node /app ./

USER node

EXPOSE 4000

# Liveness only — it must not touch the database or Redis. A container-level health
# check that fails on a dependency blip restarts every healthy replica at once and
# turns a recoverable incident into an outage. Readiness (`/health/ready`) is for the
# load balancer, which removes a replica from rotation instead of killing it.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
