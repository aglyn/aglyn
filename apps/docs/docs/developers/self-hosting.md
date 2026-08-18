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

npm install
cp .env.selfhost .env    # the setup scripts read .env

# 1. Security rules — who may read and write.
node tools/scripts/deploy-firestore-rules.mjs
node tools/scripts/deploy-storage-rules.mjs
node tools/scripts/deploy-database-rules.mjs

# 2. Firestore indexes — whether the reads work at all.
npx firebase login
npx firebase deploy --only firestore:indexes \
  --project "$FIREBASE_PROJECT_ID" --config cloud/firebase.json

# 3. TTL policies — what stops the write-forever collections growing forever.
set -a && source .env && set +a
node tools/scripts/set-firestore-ttl.mjs

docker compose up --build
```

- **Console** (the management app) on `http://localhost:4200`
- **Tenant runtime** on `http://localhost:4500` — a specific site is served at
  `<site-subdomain>.localhost:4500`; the bare port serves the demo tenant.

:::caution Don't skip any of the three
A stack that boots without the **rules** deployed is a stack whose data is not
protected the way the application assumes. The rules scripts talk to Firebase's
API directly with your service-account credentials — no `firebase login`
needed.

Skipping the **indexes** is the one that bites first: the repo carries 44
composite indexes and 23 single-field overrides, and without them queries throw
`FAILED_PRECONDITION` while the overrides that exempt the large Besigner
`nodes` blobs from indexing are missing — so Firestore tries to index them and
can reject the write. Saving a screen is among the first things to break.
Index builds are asynchronous: `deploy` returning is not "ready".

Skipping the **TTL policies** costs you nothing on day one and grows forever
after it — rate-limit windows, per-day analytics counters and media tombstones
are reaped by nothing else.

(`cp .env.selfhost .env` will overwrite an existing `.env` — back yours up
first if you develop in the same checkout.)
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

## Who runs this install

Two values are **not optional** in the way the keys below are, because leaving
them out changes what your users and third parties are told about who is
responsible for your site:

```bash
NEXT_PUBLIC_OPERATOR_NAME=Bramble Studio GmbH
NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL=hello@bramble.example
```

They name you on the public abuse intake (`/api/report-abuse`), the §512
counter-notice intake (`/api/counter-notice`), the lockdown 503, the media
quarantine notice and the sanctions 451. These pages ship with the software and
the first two are unauthenticated — a copyright holder or a browser vendor can
reach them without an account.

There is deliberately **no fallback to Aglyn's addresses**. Earlier builds
hardcoded them, which meant a self-hosted deployment published a DMCA intake
directing statutory notices to Aglyn — about content Aglyn does not host and
cannot remove. Unset now renders an explicit "not configured" state instead.

Because these are `NEXT_PUBLIC_*`, they are compiled into the client bundles.
Set them before `docker compose build`, not just before `up`.

### Your DMCA position is your own

The counter-notice flow, the 10–14 business-day put-back clock and the
repeat-infringer strike ledger all work on your install. Aglyn's designated
agent registration does not extend to you: §512(c)(2) makes registering an
agent with the U.S. Copyright Office a *precondition* of the safe harbour
rather than a formality.

So `NEXT_PUBLIC_OPERATOR_DMCA_AGENT_*` defaults to unset, unset means the
product claims nothing, and `NEXT_PUBLIC_OPERATOR_DMCA_AGENT_REGISTERED` must
be exactly `true` before anything states a registration. Naming an agent never
implies one.

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
| Legal pages & clickwrap | The signup checkbox links **Aglyn LLC's** Terms and Privacy and records acceptance against Aglyn's document hashes. Nothing breaks, but the agreement is ours, not yours, and is not yet configurable. Replace it before running this for anyone but yourself. |
| Abuse & support contact | The public abuse-report form and several error screens print `support@aglyn.com`, not yet configurable — so abuse and DMCA notices about *your* deployment would be directed to Aglyn. |
| Marketplace | Visible by default, but backed by Aglyn's Stripe Connect platform. Browsing works; purchase and payout onboarding explain themselves only after a click. Turn `release_marketplace` off in Remote Config if you don't want it. |
| Wildcard published-site domains | Host resolution for arbitrary public hostnames currently assumes the hosted platform — plan on per-site proxy rules rather than a single wildcard, and expect this area to improve. |
| Stripe / Resend / AI assist | Optional keys (see above); the related features degrade gracefully when absent. |
| Operator identity | Set `NEXT_PUBLIC_OPERATOR_NAME` and `NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL` — the public abuse and §512 intakes name them, there is no Aglyn fallback, and unset renders "not configured". Baked in at image build time. |
| DMCA designated agent | Not inherited from Aglyn. Register your own with the U.S. Copyright Office; the product asserts a registration only when you set `NEXT_PUBLIC_OPERATOR_DMCA_AGENT_REGISTERED=true`. |
| Legal documents | Signup still clickwraps your users to Aglyn LLC's Terms, hash-pinned to snapshots in the repository. `NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN` records your own legal origin but does not yet retarget the acceptance flow. |
| Documentation citations | AI-assist citations deep-link to `docs.aglyn.com` unless `NEXT_PUBLIC_DOCS_ORIGIN` names your own build. |
| Updates | `git pull && docker compose up --build`, re-running the rules deploy when `CHANGELOG.md` records a rules change. Releases are `v<semver>` git tags; `git describe --tags --match 'v*'` tells you which one you are on. |
