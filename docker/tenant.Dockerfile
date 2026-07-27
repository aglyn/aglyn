# syntax=docker/dockerfile:1.7
#
# Self-hosted Aglyn tenant runtime — serves the published sites (AGL-904).
#
# Build (from the repo root):
#   docker build -f docker/tenant.Dockerfile \
#     --secret id=selfhost_env,src=.env.selfhost \
#     -t aglyn-tenant .
#
# Same pattern as docker/console.Dockerfile: the env file is a BuildKit
# secret at build time (NEXT_PUBLIC_* inlining) and runtime env everywhere
# else. See docs/SELF_HOSTING.md.

# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:24-slim AS deps
WORKDIR /workspace
ENV HUSKY=0
COPY package.json package-lock.json ./
RUN npm ci

# ── build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
ENV AGLYN_STANDALONE=1 \
    NX_DAEMON=false \
    NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=secret,id=selfhost_env,target=/workspace/.env.production \
    npx nx build tenant --prod --skip-nx-cache

# ── runner ───────────────────────────────────────────────────────────────────
FROM node:24-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=4500 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd --system aglyn && useradd --system --gid aglyn aglyn

COPY --from=build --chown=aglyn:aglyn /workspace/dist/apps/tenant/.next/standalone ./
COPY --from=build --chown=aglyn:aglyn /workspace/dist/apps/tenant/.next/static ./dist/apps/tenant/.next/static
COPY --from=build --chown=aglyn:aglyn /workspace/apps/tenant/public ./apps/tenant/public

USER aglyn
EXPOSE 4500
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then((r)=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/tenant/server.js"]
