# syntax=docker/dockerfile:1.7
#
# Self-hosted Aglyn console (AGL-904).
#
# Build (from the repo root):
#   docker build -f docker/console.Dockerfile \
#     --secret id=selfhost_env,src=.env.selfhost \
#     -t aglyn-console .
#
# The env file is mounted as a BuildKit secret so Next.js can inline the
# NEXT_PUBLIC_* client config at build time WITHOUT the file (or your keys)
# ending up in an image layer. The same file is passed again at runtime
# (compose `env_file`) for the server-side secrets.
#
# Use compose, not `docker run --env-file`. Compose strips surrounding quotes
# from a value; `docker run --env-file` does NOT, so FIREBASE_PRIVATE_KEY —
# which the template quotes, and must, because `set -a && source .env` in the
# setup steps eats the `\n` escapes otherwise — arrives with literal quote
# characters. The Admin SDK then throws `Failed to parse private key` under an
# OpenSSL `DECODER routines::unsupported` stack at module evaluation, the
# console serves pages anyway, and `/api/health` answers 500 rather than the
# 503 it should (AGL-2443).
#
# See docs/SELF_HOSTING.md for the full runbook.

# ── deps: install the workspace once ─────────────────────────────────────────
FROM node:24-slim AS deps
WORKDIR /workspace
# husky's prepare hook needs a git repo; HUSKY=0 turns it into a no-op.
ENV HUSKY=0
# .npmrc carries `legacy-peer-deps=true`, and WITHOUT it `npm ci` resolves a
# peer-inclusive ideal tree that the lockfile does not encode and exits
# EUSAGE ("can only install packages when your package.json and
# package-lock.json ... are in sync"). Omitting it here failed EVERY
# `docker compose up --build` at the first build step (AGL-2423). The build
# stage's `COPY . .` brings it, but that is after this install.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# ── build: nx production build with standalone output ────────────────────────
FROM deps AS build
COPY . .
# Which build this is, so the container can say so (AGL-2091).
#
# `/api/health` reports `commit`, and it read VERCEL_GIT_COMMIT_SHA — unset in
# every container, so a self-hosted install answered `"commit": null` and its
# operator had no way to state what they were running when reporting a bug.
# Pass it at build time:
#
#   COMMIT_REF=$(git rev-parse HEAD) docker compose up --build
#
# Optional. Left empty the health body reports `commit: null` honestly rather
# than inventing an id, and `version` still answers from package.json, which
# needs no argument at all.
ARG COMMIT_REF=""
ENV AGLYN_STANDALONE=1 \
    COMMIT_REF=${COMMIT_REF} \
    NX_DAEMON=false \
    NEXT_TELEMETRY_DISABLED=1
# Next.js loads .env.production during a production build; the secret mount
# surfaces the self-host env there for NEXT_PUBLIC_* inlining only.
RUN --mount=type=secret,id=selfhost_env,target=/workspace/.env.production \
    npx nx build console --prod --skip-nx-cache

# ── runner: standalone server, no node_modules install ───────────────────────
FROM node:24-slim AS runner
ARG COMMIT_REF=""
LABEL org.opencontainers.image.title="Aglyn console" \
      org.opencontainers.image.source="https://github.com/aglyn/aglyn" \
      org.opencontainers.image.revision="${COMMIT_REF}"
# AGLYN_STANDALONE marks "this is a deployment" for code that used to key off
# Vercel's own variable (AGL-2221). It is set in the build stage too, but ENV
# does not cross a stage boundary and the middleware reads it at REQUEST time,
# not at build time — so setting it only there left `isDeployedRuntime()` false
# in every shipped container and the AGL-2177 host-resolution fix inert. A
# visitor to a self-hosted site fell through to the console redirect.
ENV AGLYN_STANDALONE=1 \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=4200 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd --system aglyn && useradd --system --gid aglyn aglyn

# Standalone layout (traced from the workspace root): the server entry lives at
# apps/console/server.js and resolves its distDir to ../../dist/apps/console/.next,
# so static assets and public files are grafted into those exact paths.
COPY --from=build --chown=aglyn:aglyn /workspace/dist/apps/console/.next/standalone ./
COPY --from=build --chown=aglyn:aglyn /workspace/dist/apps/console/.next/static ./dist/apps/console/.next/static
COPY --from=build --chown=aglyn:aglyn /workspace/apps/console/public ./apps/console/public

USER aglyn
EXPOSE 4200
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then((r)=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/console/server.js"]
