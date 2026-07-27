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
# (--env-file / compose env_file) for the server-side secrets.
#
# See docs/SELF_HOSTING.md for the full runbook.

# ── deps: install the workspace once ─────────────────────────────────────────
FROM node:24-slim AS deps
WORKDIR /workspace
# husky's prepare hook needs a git repo; HUSKY=0 turns it into a no-op.
ENV HUSKY=0
COPY package.json package-lock.json ./
RUN npm ci

# ── build: nx production build with standalone output ────────────────────────
FROM deps AS build
COPY . .
ENV AGLYN_STANDALONE=1 \
    NX_DAEMON=false \
    NEXT_TELEMETRY_DISABLED=1
# Next.js loads .env.production during a production build; the secret mount
# surfaces the self-host env there for NEXT_PUBLIC_* inlining only.
RUN --mount=type=secret,id=selfhost_env,target=/workspace/.env.production \
    npx nx build console --prod --skip-nx-cache

# ── runner: standalone server, no node_modules install ───────────────────────
FROM node:24-slim AS runner
ENV NODE_ENV=production \
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
