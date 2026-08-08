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

# Deploy the repo's security rules to YOUR Firebase project (required once,
# and again whenever release notes say rules changed):
npm install
cp .env.selfhost .env
node tools/scripts/deploy-firestore-rules.mjs
node tools/scripts/deploy-storage-rules.mjs
node tools/scripts/deploy-database-rules.mjs

docker compose up --build
```

- **Console** (the management app) on `http://localhost:4200`
- **Tenant runtime** on `http://localhost:4500` — a specific site is served at
  `<site-subdomain>.localhost:4500`; the bare port serves the demo tenant.

:::caution Don't skip the rules deploy
A stack that boots without the security rules deployed is a stack whose data
is not protected the way the application assumes. The three scripts talk to
Firebase's rules API directly using your service-account credentials — no
`firebase login` needed. (`cp .env.selfhost .env` will overwrite an existing
`.env` — back yours up first if you develop in the same checkout.)
:::

Put your own reverse proxy (Caddy, nginx, Traefik) in front: one hostname for
the console, and your site hostnames routed to the tenant runtime.

## The full runbook

The complete, always-current runbook lives in the repository:
[`docs/SELF_HOSTING.md`](https://github.com/aglyn/aglyn/blob/main/docs/SELF_HOSTING.md).
It covers:

1. Creating your Firebase project (Auth, Firestore, Storage, Realtime
   Database, and Remote Config) and minting a service account.
2. Deploying the repo's security rules to your project with the bundled
   scripts.
3. Filling in `.env.selfhost` — which values are baked into the client at
   image-build time versus read at runtime.
4. Reverse-proxy setup for the console and the tenant runtime.

## Optional keys

The example env file carries the required Firebase blocks plus a handful of
optional integrations. The related features degrade gracefully — a missing key
disables its feature rather than breaking the stack:

| Feature | Keys |
| --- | --- |
| Billing & commerce checkout | `STRIPE_SECRET_KEY`, plus `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, and the `STRIPE_PRICE_*` price ids if you want working plan checkout — the secret key alone is not enough |
| Transactional & campaign email | `RESEND_API_KEY`, `USAGE_EMAIL_FROM` |
| AI assist | `ANTHROPIC_API_KEY` |
| Scheduled jobs (audit archival, erasure runs) | `CRON_SECRET` — the job routes stay dormant without it |

## Honest limits

| Area | Self-hosted behavior |
| --- | --- |
| Firebase | Required — Auth, Firestore, Storage, RTDB, and Remote Config run in your project. |
| Custom-domain self-service | The in-console attach flow is Vercel-specific; self-hosters attach domains at their reverse proxy instead. |
| Wildcard published-site domains | Host resolution for arbitrary public hostnames currently assumes the hosted platform — plan on per-site proxy rules rather than a single wildcard, and expect this area to improve. |
| Stripe / Resend / AI assist | Optional keys (see above); the related features degrade gracefully when absent. |
| Updates | `git pull && docker compose up --build`, re-running the rules deploy when release notes say rules changed. |
