# Self-hosting Aglyn

Run the entire Aglyn platform — the console and the tenant runtime that serves
your published sites — on your own infrastructure with Docker: any cloud, a
VPS, or bare metal. (AGL-904..906)

**What self-hosting v1 is:** the same Apache-2.0 code Aglyn's cloud runs,
pointed at **your own Firebase project** and your own Stripe/Resend keys. You
own the data, the infrastructure, and the domains.

**You build the images; we do not publish any.** There is no `docker pull` for
Aglyn — not on GHCR, not on Docker Hub, nowhere. The one supported path is
`git clone`, fill in `.env.selfhost`, `docker compose up --build`. This is not
an oversight, and a generic image is not a packaging step we have skipped:
Next inlines every `NEXT_PUBLIC_*` value into the client bundles at **build**
time, and `.env.selfhost.example` declares 27 of them — your Firebase client
config, your console URL and tenant apex, your brand name, and the operator
and DMCA-agent details printed on the public abuse and §512 intakes. An image
built by us would carry **our** answers to all of those into **your**
deployment, in bundles you cannot change without rebuilding. That is worse
than no image, because it looks like it works. That becomes possible only
once the operator-facing public configuration moves from build time to request
time (AGL-2434); until then, treat any claim that Aglyn ships prebuilt images
as false.

**What it is not (yet):** Google-free. Firebase (Auth, Firestore, Storage,
Realtime Database, Remote Config) is the platform's identity and data layer.
A vendor-neutral backend (Postgres/S3/OIDC-style) is a separate roadmap track
(AGL-909). If your constraint is "no Google services at all," wait for that
track.

---

## Prerequisites

- Docker with Compose v2 (BuildKit enabled — default on current Docker).
- **At least 8 GB of memory available to Docker**, and ideally 4 CPUs. This is
  the prerequisite most likely to bite you, because Docker Desktop's default
  allocation on macOS and Windows is 2 CPUs / 4 GB and **the build does not fit
  in it**. Measured: at 4 GB neither image builds — the Next production build
  is killed by the OOM killer every time, in about a minute and a half — and at
  12 GB both build in roughly six minutes including `npm ci`. The exact floor
  between those two numbers has not been measured; 8 GB is the recommendation,
  not a tested boundary. Docker Desktop → Settings → Resources. Around 10 GB of
  disk for the build cache and both images.
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
since the setup scripts in step 3 read them. These rules matter:

- `NEXT_PUBLIC_*` values are **baked into the client bundles at image build
  time**. Changing one means rebuilding the images, not just restarting.
- `TOKEN_SIGNING_SECRET` must be identical for console and tenant (compose
  shares one file, so it is). The code fails closed without it.
- `NEXT_PUBLIC_TENANT_DOMAIN` is the apex your sites' subdomains hang off.
  It defaults to `aglyn.app` — **Aglyn's cloud** — so leaving it unset makes
  your console display and link every one of your sites at an address you do
  not control, and makes every published site advertise that address as its
  canonical origin to Google, feed readers and inboxes (AGL-2121).
- `AGLYN_TENANT_HOST_CNAME` and `NEXT_PUBLIC_AGLYN_TENANT_HOST_CNAME` are
  **two variables**, both in the template, adjacent — **set both, to the same
  value**. The prefixed one is what the console displays and verifies in the
  custom-domain wizard (`apps/console/utils/tenant-dns.ts`, default
  `sites.aglyn.app`); the unprefixed one is what the tenant middleware matches
  the incoming `Host` against, mapped through the `env` block of
  `apps/tenant/next.config.js` and therefore fixed at image-build time — so it
  must be right before `docker compose build`, not merely before `up`. Leave
  the unprefixed one blank and the host-resolution branch AGL-2177 restored has
  nothing to match against, so every visitor to every published site is
  redirected to your console (AGL-2424).

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

### Building `apps/docs` as your own documentation (AGL-2124)

Optional — skip the whole section if you do not publish the docs site. Every
one of these is **off when unset, and never falls back to Aglyn's**:

| Variable | Unset means |
| --- | --- |
| `DOCS_GA_TRACKING_ID` | no analytics tag is loaded at all |
| `DOCS_ERROR_BEACON_ENDPOINT` | the browser error beacon installs no handlers |
| `DOCS_STATUS_TARGETS` | `/status` probes nothing and says so |
| `DOCS_STATUS_FALLBACK_URL` | `/status` names no independent monitor to fall back to |
| `DOCS_URL` | canonical origin defaults to `https://docs.aglyn.com` — set it |
| `DOCS_ORGANIZATION_NAME` | the footer copyright reads `Aglyn LLC` — set it |

`DOCS_STATUS_TARGETS` is a comma-separated list of
`name|label|origin|description|path`, for example:

```
DOCS_STATUS_TARGETS='console|Console|https://app.example.com|Sign-in and editing'
```

The fifth field is optional and defaults to `/api/health`; set it to probe a
subsystem endpoint such as `/api/health/render/site` instead. A description
may not contain a comma — the comma separates entries, and the remainder is
dropped as an entry with no origin.

`DOCS_STATUS_FALLBACK_URL` is a single `http(s)` URL — a status page hosted by
someone other than you, such as a free UptimeRobot page. `/status` prints it,
spelled out in full, under a line telling the reader to go there when this page
itself will not load. Set it to **your own** monitor: the page is served from
your infrastructure, so a broad enough outage takes it down too, and this link
is the only thing on it that still works when that happens. Anything that is
not plainly `http:` or `https:` is dropped rather than rendered.

If you point `DOCS_ERROR_BEACON_ENDPOINT` at your own console's
`/api/errors`, set `NEXT_PUBLIC_DOCS_ORIGIN` on that console to your docs
origin — the collector's CORS allowlist reads it, and defaults to Aglyn's.
(The older `NEXT_PUBLIC_AGLYN_DOCS_URL` is still honoured for a deployment
already configured under it, but `NEXT_PUBLIC_DOCS_ORIGIN` is the one name to
use now — AGL-2186.)

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

Rules decide who may read; **indexes decide whether the read works at all** —
and, through the field overrides, whether some writes are accepted. Everything
in [`cloud/firebase-firestore.indexes.json`](../cloud/firebase-firestore.indexes.json)
has to be applied. Without it the console comes up and then fails in pieces,
in two ways that feel like different bugs:

- every query needing a composite index throws `FAILED_PRECONDITION`, so the
  product degrades feature by feature; and
- **worse**, the overrides that *exempt* the large Besigner `nodes` blobs from
  indexing are missing, so Firestore tries to index the blob and **rejects the
  write** on its 40KB index-entry limit. Saving a screen is the first thing you
  will do and among the first things to break.

Same shape as the rules deploys above — same `.env`, same service account, no
`firebase login`, idempotent:

```bash
node tools/scripts/deploy-firestore-indexes.mjs --dry-run   # show the plan
node tools/scripts/deploy-firestore-indexes.mjs
```

The service account needs the **Cloud Datastore Owner** role (or
`datastore.indexes.create` + `datastore.indexes.update`).

**This script only ever adds.** If your project has an index the file does not
list, it is reported and left alone. That is the deliberate difference from
`npx firebase deploy --only firestore:indexes`, which *reconciles* — it
**deletes** whatever the file does not list, `fieldOverrides` included. On a
fresh project the two are equivalent; on a project you have since hand-tuned,
they are very much not, and the reconciling one has destroyed a live index
exemption here before. If you prefer the CLI anyway, read
[`FIRESTORE_MANUAL_CONFIG.md`](FIRESTORE_MANUAL_CONFIG.md) first.

TTL policies are **not** written by this script — that is 3c below. Anything
owed is printed at the end of the run so it cannot be silently skipped.

Index builds are asynchronous: a successful run means *accepted*, not *ready*,
and a query against a still-building index fails exactly as it did before.
Watch them finish with `npm run check:index-drift`, which lists anything still
building and, when it reports no drift, is your evidence that the project
matches the file.

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

### Which version am I running? (AGL-2091)

Ask either container. `version` is the platform release your image was built
from, and it is the number to quote in a bug report or to check a fix against:

```bash
curl -s http://localhost:4200/api/health | jq '{version, commit, environment}'
curl -s http://localhost:4500/api/health | jq '{version, commit, environment}'
```

```json
{ "version": "1.0.0-beta.6", "commit": null, "environment": "production" }
```

`version` needs nothing from you — it is read out of the repo's `package.json`
at build time and inlined, so it is correct the first time you build. Before
AGL-2091 the health body carried no version field at all and answered
`"commit": null`, because the commit was read from a variable only Aglyn's own
hosting sets; an operator had no way to say what they were running.

`commit` stays `null` unless you stamp the build, which is worth doing if you
build from a fork or from an untagged tree:

```bash
COMMIT_REF=$(git rev-parse HEAD) docker compose up --build
```

That also lands on the image as the standard
`org.opencontainers.image.revision` label, so you can identify an image without
starting it:

```bash
docker image inspect aglyn-console --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
```

The console footer prints the same version, and `COMMIT_REF` may equally be set
in `.env.selfhost` if a fixed value suits you better than one per build — the
build argument wins where both are present.

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

#### Your SSO auth origin must be configured (AGL-2020)

The Reply/ACS URL and Entity ID your customers paste into their IdP are **derived from
your configuration**, in this order — the first one set wins:

1. `NEXT_PUBLIC_FIREBASE_AUTH_HANDLER_HOST` — an explicit override.
2. `auth.<NEXT_PUBLIC_WORKSPACE_DOMAIN>` — set by the template, so this normally wins.
3. `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` — your project's own `*.firebaseapp.com`.
4. `<NEXT_PUBLIC_FIREBASE_PROJECT_ID>.firebaseapp.com`.

**With all four blank, SSO setup now fails with a message naming them.** That is
deliberate, and it is the one place in this runbook where a missing value is not
allowed to degrade quietly. There is no safe "off" value: an empty auth origin
produces `https:///__/auth/handler`, which Google accepts when written and which then
rejects every assertion afterwards, with nothing in the config that looks wrong.

Until this was fixed the fourth line defaulted to **Aglyn's own Firebase project**, so
an install with none of the four set wrote our auth origin into *your* GCIP SAML
provider and displayed it in *your* console as the URL to hand your identity provider.
If you configured SSO on a build older than this fix, re-check the Reply/ACS URL shown
on the org's SSO card and re-save the provider — it must name a host you operate.

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
| Customer issue reports → your tracker | `LINEAR_API_KEY`, `LINEAR_CUSTOMER_REPORTS_TEAM_ID` — both required; unset, the console's "Report an issue" dialog answers 501 and files nowhere |

## Troubleshooting the first build

**`Build process exited due to code 128 and signal SIGKILL`** — followed by
`NX Running target build for project console failed` and `failed to solve`.
Nothing in that output says so, but this is the **out-of-memory killer**: the
build needed more memory than Docker has, and the kernel ended it. Raise
Docker's memory (Prerequisites above). If you cannot, build the images one at
a time — `docker compose build console`, then `docker compose build tenant`,
then `docker compose up` — since `docker compose up --build` builds both
concurrently and roughly doubles peak demand. Capping Node's heap does **not**
help: Next builds with Turbopack, which allocates outside the V8 heap that
`--max-old-space-size` bounds (AGL-2437).

**`npm ci` fails with `EUSAGE … package.json and package-lock.json are not in
sync`, listing dozens of "Missing:" packages.** The image build must copy the
repo's `.npmrc` — it sets `legacy-peer-deps=true`, and the lockfile is only
valid under it. Fixed in AGL-2423; if you see this, your checkout predates that
fix, so `git pull`.

**`Failed to parse private key`, with an OpenSSL `DECODER
routines::unsupported` stack, while the console still serves pages and
`/api/health` answers 500.** You started the container with
`docker run --env-file` instead of compose. `docker run` does not strip the
quotes around a value, so `FIREBASE_PRIVATE_KEY="-----BEGIN…"` arrives with the
quote characters attached and the Admin SDK cannot parse it. The quotes have to
stay in the file — `set -a && source .env` in step 3 would otherwise eat the
`\n` escapes and mangle the key a different way — so use
`docker compose up`, which strips them (AGL-2443).

**`Ports are not available: … bind: address already in use`** — the compose
file publishes 4200 and 4500 on the host. Something else on your machine has
one of them (a local dev server, most often). Stop it, or add a
`docker-compose.override.yml` that maps different host ports.

## Honest limits

| Area | Self-hosted behavior |
| --- | --- |
| Firebase | **Required.** Auth, Firestore, Storage, RTDB, Remote Config run in *your* project (free tier is fine to start). |
| Custom-domain self-service | The in-console attach flow is Vercel-specific and returns 501 without Vercel credentials. Attach domains at your reverse proxy instead (above). |
| Stripe | Optional. Without `STRIPE_SECRET_KEY`, commerce checkout and paid platform plans are unavailable; the rest of the platform runs. |
| Resend | Optional. Without `RESEND_API_KEY`, app email (invites, receipts, campaigns) is an inert no-op. |
| AI assist | Degrades gracefully without an Anthropic key. |
| Issue reporting | Optional, and **off by default**. The console's "Report an issue" dialog needs a tracker of your own: set `LINEAR_API_KEY` and `LINEAR_CUSTOMER_REPORTS_TEAM_ID` to *your* Linear workspace and a team dedicated to inbound reports. Nothing about Aglyn's workspace is compiled in — unset, the route answers 501 and says so, and your customers' reports are never sent to Aglyn (AGL-2185). Both are **server-only**; never prefix either with `NEXT_PUBLIC_`, which would inline a key that can read and write your whole workspace into the browser bundle. Scope the key when you create it — Linear can restrict a personal API key to **Create issues** and to **specific teams**; do both, so the separation is enforced by the credential rather than only by the variable, and a leaked key cannot read your backlog. |
| Texas sales-tax report | Optional, and blank by default. The staff `/admin/tax-return` report is built around a single US-TX registration. Set `TX_WEBFILE_NUMBER` / `TX_TAXPAYER_NUMBER` to *your own* Comptroller identifiers to have them appear on the page and in the exported working papers; leave them unset and both surfaces say "not configured" rather than printing anything. They are **server-only** — never prefix either with `NEXT_PUBLIC_`, which would inline them into a client bundle served without authentication. Aglyn LLC's own values are not in this repository (AGL-2021). |
| Operator identity | **Set it.** `NEXT_PUBLIC_OPERATOR_NAME` / `NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL` name you on the public abuse and §512 counter-notice intakes, the lockdown 503, the quarantine notice and the sanctions 451. No fallback to Aglyn's addresses exists; unset renders an explicit "not configured" state. Baked in at image **build** time. |
| DMCA designated agent | Not configured, and not inherited. Aglyn's Copyright Office registration does not cover your deployment; §512(c)(2) makes your own filing a precondition of the safe harbour. `NEXT_PUBLIC_OPERATOR_DMCA_AGENT_REGISTERED=true` is the only thing that makes the product state one, and nothing infers it. |
| Legal documents / clickwrap | **Still Aglyn's.** Signup clickwraps your users to Aglyn LLC's Terms, hash-pinned to snapshots committed in this repository, and writes the acceptance into your Firestore. `NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN` records your legal origin for the surfaces that need one but does **not** yet retarget the acceptance flow — the document hashes pin Aglyn's bytes. Tracked as AGL-2017. |
| Documentation links | `NEXT_PUBLIC_DOCS_ORIGIN` retargets **every** docs link — Assist citations, console help, besigner help, and the `documentation` URL your own REST API returns — at your build of `apps/docs`. Unset, they point at `https://docs.aglyn.com`. It previously governed the citations alone while console and besigner read a separate undocumented name, so following this runbook retargeted a third of them (AGL-2186). |
| Scheduled jobs | `AGLYN_JOB_RUNNER_URL` has **no default** and the Cloud Functions beat refuses to fire without it, logging what to set (AGL-2176). It used to default to a specific Aglyn customer's published site, so a deployment that missed it POSTed to a stranger every minute carrying your `PLUGIN_JOBS_SECRET`, while none of your own scheduled publishing or booking-hold expiry ran. Set it to a tenant origin on **your** deployment, e.g. `https://sites.example.com/api/plugins/run-jobs`. **`AGLYN_CONSOLE_URL`** has no default for the same reason and drives the fifteen-minute `consoleFastCrons` job — scheduled campaign sends and pending custom-domain completion (AGL-1617). Set it to the origin that *serves* your console, never one that redirects: a redirect drops the POST body and the `x-cron-secret` header. Both routes also need `CRON_SECRET` in Secret Manager (`firebase functions:secrets:set CRON_SECRET`), matching the console's. |
| Bucket CORS | `cloud/storage-cors.json` is **Aglyn's own** live bucket policy — it names `https://app.aglyn.com`, and `apps/console/specs/storage-cors.spec.ts` asserts that, because it must stay byte-identical to what our bucket serves. It is applied by `gcloud --cors-file`, which cannot read environment variables, so this one genuinely cannot be made configurable in place. **Copy it, replace the origin with your console's, and apply your copy** — see `docs/STORAGE_MANUAL_CONFIG.md`. Without it, every upload over 3 MB dies at the CORS preflight as a generic "try again". |
| Renaming the product | `NEXT_PUBLIC_PLATFORM_BRAND_NAME` is the one value that renames the product everywhere it is shown: browser-tab titles, the installable PWA, the WebAuthn relying-party name the OS shows when a user saves a passkey, transactional email, and the `<meta name="generator">` / `x-powered-by` fingerprint on every published site (AGL-2153). It works because `resolveBrandingProfile` — the single resolver every branded surface already routes through — takes its platform default from it. Brand **images** stay files: replace them in your Docker build context. |
| Your own docs build | `apps/docs` is a standalone Docusaurus package you may publish as your own documentation. Its analytics, error beacon and status probes are all **off unless configured** — see the `DOCS_*` block in `.env.selfhost.example`. They previously defaulted to Aglyn's GA4 property, Aglyn's error collector and Aglyn's production health endpoints, so a published build reported your readers to us and told them our uptime was yours (AGL-2124). Set `DOCS_GA_TRACKING_ID`, `DOCS_ERROR_BEACON_ENDPOINT`, `DOCS_STATUS_TARGETS`, `DOCS_URL` and `DOCS_ORGANIZATION_NAME` before `docusaurus build`, not after — Docusaurus bakes them into the static output. |
| Updates | `git pull && docker compose up --build`. The release notes are [`CHANGELOG.md`](../CHANGELOG.md), where each release is a `v<semver>` git tag on the commit that shipped; a rules change appears there as a `fix(rules)`/`feat(rules)` entry. Re-run the deploy scripts when they change. Check what you are running with `git describe --tags --match 'v*'`. |
| Marketplace | Visible by default and backed by Aglyn's Stripe Connect platform, which you do not have. Browsing works; Buy and payout-onboarding explain themselves only after being clicked. Turn `release_marketplace` off in Remote Config if you do not want it. |
| Staff / admin surfaces | Built for Aglyn's own operations — the tax-return page in particular carries Aglyn LLC's Texas registration identifiers and is meaningless elsewhere. |
| Docs site (`apps/docs`) | Not part of `docker compose` — build and publish it separately if you want it. Its configuration is the "Your own docs build" row above. |
| Deployment shape | **Nothing to set — the images set it.** `AGLYN_STANDALONE=1` is what tells the software this is a real deployment rather than a laptop; `isDeployedRuntime()` and the tenant middleware's local copy of it gate the whole host-resolution switch plus the canonical custom-domain redirect. Both Dockerfiles now set it in the `runner` stage (AGL-2221), and it is kept out of `.env.selfhost.example` on purpose: compose `env_file` overrides image `ENV`, so a line there would be a way to delete it and silently break serving, whereas image `ENV` survives an env file that never mentions it. It was previously set only in the **build** stage, which does not carry across, so every image built before AGL-2221 ran with it unset and 307'd every visitor to the configured console (AGL-2177). **Rebuild if you are running one.** |
| Request geo (sanctions + consent region) | `readRequestGeo` reads two headers whose names are now `AGLYN_GEO_COUNTRY_HEADER` / `AGLYN_GEO_REGION_HEADER`, defaulting to Vercel's `x-vercel-ip-country` / `x-vercel-ip-country-region`. On a container nothing sets those, so before AGL-2436 every request had no country and the **embargo gate failed open on all of them** — it logged `[sanctions-geo] FAILING OPEN` once per instance and blocked nothing — while the storefront consent-region endpoint had no region to answer with. Point them at what your proxy sets (`cf-ipcountry` behind Cloudflare; a GeoIP module's header behind Caddy/nginx/Traefik). Baked in at **build** time, because the console's middleware is an edge bundle with no request-time environment. Leave them blank only if you accept that sanctions screening is not running. |
| Health report `environment` | Was `VERCEL_ENV ?? 'development'`, so `/api/health` on a production container told you — and your monitoring — that it was `development`. It now derives from the deployment shape and reads `production` on a container with `NODE_ENV=production` (AGL-2436). |
| Security headers | On a container (`AGLYN_STANDALONE=1`) the `frame-ancestors` allowlist is **yours alone** — the 26 Aglyn hostnames that feed Aglyn's own policy are dropped, so your published pages do not tell browsers that our domains may frame them (AGL-2446). It is built from `NEXT_PUBLIC_CONSOLE_URL`, `NEXT_PUBLIC_WORKSPACE_DOMAIN`, `NEXT_PUBLIC_TENANT_DOMAIN` and `NEXT_PUBLIC_AGLYN_TENANT_HOST_CNAME`; configure none of them and it falls to `'self'` rather than to an empty list, which browsers would drop entirely. `img-src` still carries both sets, deliberately — an unused entry there names a host a page may load *from* and costs nothing. |
| Custom-domain verification | `/api/domains/verify` has a DEV soft pass that accepts any CNAME, because a laptop has no DNS pointing at a tenant edge. It used to key on `!process.env.VERCEL` — never set on a container — so it was **on in production on every self-host install**, and any domain carrying any CNAME to anywhere verified: the AGL-733 defect, reinstated. It now keys on `isDevelopmentRuntime()` / `NODE_ENV`, which both Dockerfiles set to `production` in the runner stage (AGL-2180). A relaxation must key on the variable that means "not production", never on the absence of a vendor's. **Upgrade if you run an image built before this.** |
| Edit-hint bounce | `apps/tenant/app/api/edit-hint/set/route.ts` validates the `return` origin against an allowlist. Aglyn's two console origins are seeded **only when `NEXT_PUBLIC_CONSOLE_URL` is unset**; they used to be unconditional with yours merely added, so an operator could not narrow the list and their tenant runtime kept an open redirect target at a console they do not run (AGL-2176). Name your console and it is the only permitted target. The same variable is the tenant middleware's fallback redirect, so leaving it unset also sends a visitor who lands on an unresolvable host to `app.aglyn.com`. |

## Local development without Docker

The contributor path also works for kicking the tires — `npm install`,
`cp .env.example .env`, `npx nx serve console` — including fully offline
against the Firebase emulators (`npm run serve:console:emulated`; see
`docs/E2E_LOCAL.md`).
