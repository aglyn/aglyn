---
sidebar_position: 2
title: Self-hosting
description: Run the whole Aglyn platform on your own infrastructure with Docker — your own Firebase project, your own domains, your own keys.
---

# Self-hosting Aglyn

Aglyn is Apache-2.0 and the whole platform is public on GitHub. You can run
it yourself with Docker on any infrastructure — a cloud VM, a VPS, or bare
metal.

:::note What self-hosting v1 means
You run the **same code** Aglyn's cloud runs, pointed at **your own Firebase
project** (Google account required — the free tier is fine to start) plus
your own Stripe and Resend keys. A fully vendor-neutral backend that removes
the Firebase dependency is a separate roadmap track.
:::

## The short version

```bash
git clone https://github.com/aglyn/aglyn
cd aglyn
cp .env.selfhost.example .env.selfhost   # fill in your Firebase project + secrets
docker compose up --build
```

- **Console** (the management app) on `http://localhost:4200`
- **Tenant runtime** (serves your published sites) on `http://localhost:4500`

Put your own reverse proxy (Caddy, nginx, Traefik) in front: one hostname for
the console, a wildcard domain routed to the tenant runtime for published
sites.

## The full runbook

The complete, always-current runbook lives in the repository:
[`docs/SELF_HOSTING.md`](https://github.com/aglyn/aglyn/blob/main/docs/SELF_HOSTING.md).
It covers:

1. Creating your Firebase project (Auth, Firestore, Storage, Realtime
   Database) and minting a service account.
2. Deploying the repo's security rules to your project with the bundled
   scripts.
3. Filling in `.env.selfhost` — which values are baked into the client at
   image-build time versus read at runtime.
4. Reverse-proxy and wildcard-DNS setup for published sites and custom
   domains.

## Honest limits

| Area | Self-hosted behavior |
| --- | --- |
| Firebase | Required — Auth, Firestore, Storage, RTDB, and Remote Config run in your project. |
| Custom-domain self-service | The in-console attach flow is Vercel-specific; self-hosters attach domains at their reverse proxy instead. |
| Stripe / Resend / AI assist | Optional keys; the related features degrade gracefully when absent. |
| Updates | `git pull && docker compose up --build`, re-running the rules deploy when release notes say rules changed. |
