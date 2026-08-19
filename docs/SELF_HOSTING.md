# Self-hosting Aglyn

Run the entire Aglyn platform — the console and the tenant runtime that serves
your published sites — on your own infrastructure with Docker: any cloud, a
VPS, or bare metal. (AGL-904..906)

**What self-hosting v1 is:** the same Apache-2.0 code Aglyn's cloud runs,
pointed at **your own Firebase project** and your own Stripe/Resend keys. You
own the data, the infrastructure, and the domains.

**What it is not (yet):** Google-free. Firebase (Auth, Firestore, Storage,
Realtime Database, Remote Config) is the platform's identity and data layer.
A vendor-neutral backend (Postgres/S3/OIDC-style) is a separate roadmap track
(AGL-909). If your constraint is "no Google services at all," wait for that
track.

---

## Prerequisites

- Docker with Compose v2 (BuildKit enabled — default on current Docker).
- A Google account to create a free-tier Firebase project.
- Node ≥ 24 + the Firebase CLI **on your workstation** (one-time setup steps
  only; the containers don't need them).
- Two DNS names you control: one for the console (e.g.
  `console.example.com`) and a **wildcard** for published sites (e.g.
  `*.sites.example.com`).

## 1. Create your Firebase project

1. [console.firebase.google.com](https://console.firebase.google.com) → Add
   project.
2. Enable **Authentication** (Email/Password, plus Google or other OAuth
   providers you want), **Cloud Firestore**, **Storage**, and **Realtime
   Database**. Remote Config is used for release flags; the defaults compiled
   into the code apply when you leave it untouched.
3. Project settings → General → Your apps → add a **Web app** → copy the SDK
   config into the `NEXT_PUBLIC_FIREBASE_*` variables of your env file (step
   2).
4. Project settings → Service accounts → **Generate new private key** → copy
   the JSON fields into the `FIREBASE_*` variables.

## 2. Configure the environment

```bash
cp .env.selfhost.example .env.selfhost
```

Fill it in following the comments — the Firebase blocks from step 1 first,
since the setup scripts in step 3 read them. Three rules matter:

- `NEXT_PUBLIC_*` values are **baked into the client bundles at image build
  time**. Changing one means rebuilding the images, not just restarting.
- `TOKEN_SIGNING_SECRET` must be identical for console and tenant (compose
  shares one file, so it is). The code fails closed without it.
- `NEXT_PUBLIC_TENANT_DOMAIN` is the apex your sites' subdomains hang off.
  It defaults to `aglyn.app` — **Aglyn's cloud** — so leaving it unset makes
  your console display and link every one of your sites at an address you do
  not control.

## 3. Set your Firebase project up

Three things to apply: rules, indexes, TTL. **All three are required** — the
console will start without them and then misbehave in ways that look like bugs.
The bundled scripts read `.env`, authenticate with your service-account
credentials, and are idempotent, so re-run them any time.

```bash
npm install
cp .env.selfhost .env    # the scripts read .env; back up an existing one first
```

### 3a. Security rules

```bash
node tools/scripts/deploy-firestore-rules.mjs
node tools/scripts/deploy-storage-rules.mjs
node tools/scripts/deploy-database-rules.mjs
```

Storage rules are deny-all **by design** — media flows through tokened URLs
and the Admin SDK, not direct client reads.

### 3b. Firestore indexes — do not skip this

Rules decide who may read; **indexes decide whether the read works at all.**
The repo carries 44 composite indexes and 23 single-field overrides. Without
them the console comes up and then fails in pieces: every query needing a
composite index throws `FAILED_PRECONDITION`, and — worse — the field
overrides that *exempt* the large Besigner `nodes` blobs from indexing are
missing, so Firestore tries to index them and can **reject the write**. Saving
a screen is the first thing you will do and among the first things to break.

This one needs the Firebase CLI, because index reconciliation has no
service-account REST path the way rules do:

```bash
npx firebase login
npx firebase deploy --only firestore:indexes \
  --project "$FIREBASE_PROJECT_ID" --config cloud/firebase.json
```

Composite index builds are asynchronous: `deploy` returning is not "ready".
Watch Firestore → Indexes until they read **Enabled**.

- `NEXT_PUBLIC_*` values are **baked into the client bundles at image build
  time**. Changing one means rebuilding the images, not just restarting.
- `TOKEN_SIGNING_SECRET` must be identical for console and tenant (compose
  shares one file, so it is). The code fails closed without it.
- **Set the operator identity.** `NEXT_PUBLIC_OPERATOR_NAME` and
  `NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL` are not branding — see below.

### Who runs this install

Fill in the **Operator identity** block. These values name *you* on the pages
where naming the wrong party has consequences:

| Surface | What it shows |
| --- | --- |
| `/api/report-abuse` | Public, unauthenticated. Anyone — a bank's fraud team, a browser vendor, a copyright holder — can reach it and report a site you host. |
| `/api/counter-notice` | Public. A subscriber whose material you removed sends a §512(g) counter-notice here, **under penalty of perjury**, consenting to the jurisdiction where *you* may be found. |
| Lockdown 503 | The visitor-facing page a suspended site serves. |
| Quarantine notice | Shown to the customer whose media file you disabled. |
| Sanctions 451 | The regional refusal page. |

Before this was configuration, all five printed `Aglyn` and `support@aglyn.com`
regardless of who ran the install. That meant a self-hosted deployment
published a DMCA intake directing third parties to send statutory notices to
Aglyn — about content Aglyn does not host, cannot see and cannot remove, while
the sender's clock ran. **There is no fallback to Aglyn's addresses.** Leave
these unset and the pages say so plainly rather than naming somebody else.

Because they are `NEXT_PUBLIC_*`, they are compiled into the client bundles:
set them **before `docker compose build`**, not just before `up`.

### Your DMCA position is your own

The counter-notice flow, the 10–14 business-day put-back clock and the
repeat-infringer strike ledger all work on your install. **Aglyn's designated
agent registration does not extend to you.** 17 U.S.C. §512(c)(2) makes
registering an agent with the U.S. Copyright Office a *precondition* of the
safe harbour, not a formality — a provider without one does not get the
limitation on liability however well it handles notices.

So the `NEXT_PUBLIC_OPERATOR_DMCA_AGENT_*` values default to unset, and unset
means the product asserts nothing. `NEXT_PUBLIC_OPERATOR_DMCA_AGENT_REGISTERED`
must be exactly `true` before anything claims a registration, and naming an
agent never implies one. Fill these in only if you have actually filed.

⚠️ This deploy **deletes anything in your project that is not in the file**.
That is what you want on a fresh project. On a project you have hand-tuned,
read [`FIRESTORE_MANUAL_CONFIG.md`](FIRESTORE_MANUAL_CONFIG.md) first.

### 3c. TTL policies

Several collections are written continuously and reaped only by a Firestore
TTL policy — rate-limit windows, per-day analytics counters, CSP-violation
counters, media undo tombstones, and more. Without TTL they grow forever, on
your bill.

```bash
set -a && source .env && set +a
node tools/scripts/set-firestore-ttl.mjs --dry-run   # show what would change
node tools/scripts/set-firestore-ttl.mjs
```

The policy list is [`tools/scripts/lib/ttl-policies.mjs`](../tools/scripts/lib/ttl-policies.mjs),
held to the table in [`FIRESTORE_MANUAL_CONFIG.md`](FIRESTORE_MANUAL_CONFIG.md)
by `npm run test:ttl-policies`. Re-run the script after an upgrade adds one.

## 4. Build and run

```bash
docker compose up --build
```

- Console: `http://localhost:4200`
- Tenant runtime: `http://localhost:4500`

The first account you create is yours; grant yourself staff access with
`node tools/scripts/set-staff-claim.mjs` if you want the admin surfaces.

### Optional: require SSO for your company's email domain

If you run SAML SSO and want to guarantee that nobody on your company domain can
sign in with a password or a personal Google account instead, set both:

```bash
AGLYN_SSO_REQUIRED_DOMAINS="example.com=your-gcip-tenant-id"
AGLYN_SSO_DOMAIN_ENFORCEMENT=on
```

**Both default to empty/off, so a stock install enforces nothing.** Nothing about
Aglyn's own domain or tenant is compiled in — this is entirely your configuration.

It is a rule about a **domain**, not about staff. It never requires staff to use SSO;
staff can be granted to any account, on any domain, in any pool. The only sign-in it
refuses is an address on a domain you listed that arrives with no SSO tenant at all.

**Keep a way back in.** Before switching enforcement on, make sure at least one
account that the rule *cannot* refuse still has staff — the simplest being an admin on
a domain you did not list. Otherwise a misconfigured tenant id locks you out of the
console you would fix it from.

## 5. Put a reverse proxy in front

Terminate TLS at your proxy (Caddy, nginx, Traefik) and route:

- `console.example.com` → `console:4200`
- `*.sites.example.com` → `tenant:4500` (the tenant app resolves the host
  header to the right published site)

Caddy example:

```caddy
console.example.com {
  reverse_proxy localhost:4200
}
*.sites.example.com {
  reverse_proxy localhost:4500
}
```

Custom domains for individual sites work the same way: point the customer
domain at your proxy and route it to `tenant:4500`.

## Optional keys

Every key here is optional and independent. A missing key disables its feature
— the server answers `501` and the UI says so — rather than breaking the stack.

| Feature | Keys |
| --- | --- |
| Commerce checkout on a storefront | `STRIPE_SECRET_KEY` |
| Selling platform plans to your own users | the above **plus** `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, and the `STRIPE_PRICE_*` ids from your own catalogue — the secret key alone is not enough |
| Transactional & campaign email | `RESEND_API_KEY`, `USAGE_EMAIL_FROM` |
| Aglyn Assist + "Rewrite with AI" | `ANTHROPIC_API_KEY` (your own key; the console panel is additionally behind the `release_assist` flag, off by default) |
| Scheduled jobs (audit archival, erasure, retention sweeps) | `CRON_SECRET` — the job routes stay dormant without it |

## Honest limits

| Area | Self-hosted behavior |
| --- | --- |
| Firebase | **Required.** Auth, Firestore, Storage, RTDB, Remote Config run in *your* project (free tier is fine to start). |
| Custom-domain self-service | The in-console attach flow is Vercel-specific and returns 501 without Vercel credentials. Attach domains at your reverse proxy instead (above). |
| Stripe | Optional. Without `STRIPE_SECRET_KEY`, commerce checkout and paid platform plans are unavailable; the rest of the platform runs. |
| Resend | Optional. Without `RESEND_API_KEY`, app email (invites, receipts, campaigns) is an inert no-op. |
| AI assist | Degrades gracefully without an Anthropic key. |
| Texas sales-tax report | Optional, and blank by default. The staff `/admin/tax-return` report is built around a single US-TX registration. Set `TX_WEBFILE_NUMBER` / `TX_TAXPAYER_NUMBER` to *your own* Comptroller identifiers to have them appear on the page and in the exported working papers; leave them unset and both surfaces say "not configured" rather than printing anything. They are **server-only** — never prefix either with `NEXT_PUBLIC_`, which would inline them into a client bundle served without authentication. Aglyn LLC's own values are not in this repository (AGL-2021). |
| Operator identity | **Set it.** `NEXT_PUBLIC_OPERATOR_NAME` / `NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL` name you on the public abuse and §512 counter-notice intakes, the lockdown 503, the quarantine notice and the sanctions 451. No fallback to Aglyn's addresses exists; unset renders an explicit "not configured" state. Baked in at image **build** time. |
| DMCA designated agent | Not configured, and not inherited. Aglyn's Copyright Office registration does not cover your deployment; §512(c)(2) makes your own filing a precondition of the safe harbour. `NEXT_PUBLIC_OPERATOR_DMCA_AGENT_REGISTERED=true` is the only thing that makes the product state one, and nothing infers it. |
| Legal documents / clickwrap | **Still Aglyn's.** Signup clickwraps your users to Aglyn LLC's Terms, hash-pinned to snapshots committed in this repository, and writes the acceptance into your Firestore. `NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN` records your legal origin for the surfaces that need one but does **not** yet retarget the acceptance flow — the document hashes pin Aglyn's bytes. Tracked as AGL-2017. |
| Documentation citations | AI-assist citations deep-link to `https://docs.aglyn.com` unless `NEXT_PUBLIC_DOCS_ORIGIN` points at your own build of `apps/docs`. |
| Your own docs build | `apps/docs` is a standalone Docusaurus package you may publish as your own documentation. Its analytics, error beacon and status probes are all **off unless configured** — see the `DOCS_*` block in `.env.selfhost.example`. They previously defaulted to Aglyn's GA4 property, Aglyn's error collector and Aglyn's production health endpoints, so a published build reported your readers to us and told them our uptime was yours (AGL-2124). Set `DOCS_GA_TRACKING_ID`, `DOCS_ERROR_BEACON_ENDPOINT`, `DOCS_STATUS_TARGETS`, `DOCS_URL` and `DOCS_ORGANIZATION_NAME` before `docusaurus build`, not after — Docusaurus bakes them into the static output. |
| Updates | `git pull && docker compose up --build`. The release notes are [`CHANGELOG.md`](../CHANGELOG.md), where each release is a `v<semver>` git tag on the commit that shipped; a rules change appears there as a `fix(rules)`/`feat(rules)` entry. Re-run the deploy scripts when they change. Check what you are running with `git describe --tags --match 'v*'`. |
| Marketplace | Visible by default and backed by Aglyn's Stripe Connect platform, which you do not have. Browsing works; Buy and payout-onboarding explain themselves only after being clicked. Turn `release_marketplace` off in Remote Config if you do not want it. |
| Staff / admin surfaces | Built for Aglyn's own operations — the tax-return page in particular carries Aglyn LLC's Texas registration identifiers and is meaningless elsewhere. |
| Docs site (`apps/docs`) | Not part of `docker compose`. If you build and publish it yourself, note it currently compiles Aglyn's GA4 measurement id with no override. (AGL-2018) |

## Local development without Docker

The contributor path also works for kicking the tires — `npm install`,
`cp .env.example .env`, `npx nx serve console` — including fully offline
against the Firebase emulators (`npm run serve:console:emulated`; see
`docs/E2E_LOCAL.md`).
