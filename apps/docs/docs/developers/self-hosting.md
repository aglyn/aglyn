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

# 2. Firestore indexes — whether the reads work, and some writes.
node tools/scripts/deploy-firestore-indexes.mjs

# 3. TTL policies — what stops the write-forever collections growing forever.
set -a && source .env && set +a
node tools/scripts/set-firestore-ttl.mjs

docker compose up --build
```

:::caution There is no image to pull — you build it
Aglyn publishes **no** Docker images, on any registry. `docker compose up
--build` from a clone is the only supported path, and that is deliberate
rather than pending: Next inlines every `NEXT_PUBLIC_*` value into the client
bundles when the image is **built**, and this deployment has 27 of them — your
Firebase client config, your console URL and tenant apex, your brand name, and
the operator and DMCA-agent details shown on your public abuse intake. An
image built by someone else would ship their answers to all of those inside
your bundles. If you find something claiming Aglyn offers prebuilt images, it
is wrong.
:::

:::caution Give Docker more memory than it starts with
Docker Desktop allocates **2 CPUs and 4 GB** by default on macOS and Windows,
and the Next production build does not fit in it — it is killed by the
out-of-memory killer about ninety seconds in, with a message that never
mentions memory:

```
Build process exited due to code 128 and signal SIGKILL
```

Raise it to **8 GB or more** under Settings → Resources before you build. If
you cannot, build the two images one at a time (`docker compose build console`,
then `docker compose build tenant`) — `up --build` builds them concurrently and
roughly doubles peak demand. Capping Node's heap does not help: Next builds
with Turbopack, which allocates outside the heap `--max-old-space-size` bounds.
Measured: 4 GB fails, 12 GB builds both in about six minutes (AGL-2437).
:::

- **Console** (the management app) on `http://localhost:4200`
- **Tenant runtime** on `http://localhost:4500` — a specific site is served at
  `<site-subdomain>.localhost:4500`; the bare port serves the demo tenant.

:::caution Don't skip any of the three
A stack that boots without the **rules** deployed is a stack whose data is not
protected the way the application assumes. The rules scripts talk to Firebase's
API directly with your service-account credentials — no `firebase login`
needed. Neither does the index deploy, since AGL-2015: all four setup commands
now use the same `.env` and the same service account.

Skipping the **indexes** is the one that bites first, and it bites in two
different-looking ways. Without the composite indexes, queries throw
`FAILED_PRECONDITION` and the product degrades feature by feature. Without the
field overrides that exempt the large Besigner `nodes` blobs from indexing,
Firestore tries to index the blob and **rejects the write** on its 40KB
index-entry limit — so saving a screen, among the first things you will do,
is among the first things to break.

`deploy-firestore-indexes.mjs` only ever **adds**. Anything live that the file
does not list is reported and left alone — unlike `firebase deploy --only
firestore:indexes`, which deletes it. Run it with `--dry-run` first to see the
plan. Index builds are asynchronous, so a successful run means *accepted*, not
*ready*; `npm run check:index-drift` tells you when they have finished
building.

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

**Registering is only half the duty.** §512(c)(2) also requires the agent's
name, address, **phone number** and email to be *available to the public
through your service* — a separate obligation the Copyright Office filing does
not discharge. Set all four (`_NAME`, `_ADDRESS`, `_PHONE`, `_EMAIL`) and the
public abuse-report form publishes them where a copyright holder composing a
notice will see them. `_NAME` and `_ADDRESS` are what gate the block: without
both, nothing renders, because a mailbox with no legal person or no physical
address behind it is not a designation. Omitting `_PHONE` or `_EMAIL` leaves
that line out rather than inventing one — and leaves you short of §512(c)(2),
which enumerates all four. Publishing the same details on your own copyright
policy page is still yours to do; the form is a second surface, not a
substitute.

## Which addresses this install calls its own {#addresses}

The operator identity above says who you are. This section is about where your
deployment *lives*, and it is the group most often left at its default — with
the default being one of Aglyn's own hostnames.

### `NEXT_PUBLIC_TENANT_DOMAIN` — set this one first {#tenant-domain}

The apex your sites' assigned subdomains hang off. A site whose subdomain is
`acme` is served at `acme.<this value>`.

**Unset, it is `aglyn.app` — Aglyn's cloud.** This is the single most
consequential value on the page, because the damage is not confined to your
own console. The same constant is what every published site uses to describe
itself to the outside world:

- `<link rel="canonical">` on every page
- `/api/sitemap` and `/api/robots`
- item links in `/api/collections-rss`
- `/api/manifest`
- `og:image`
- the origin an inbox-bound `<img src>` in email resolves against

Left at the default, your customers' sites tell Google, every feed reader and
every inbox that they live at an address you do not control and Aglyn does not
serve for you.

### `AGLYN_TENANT_HOST_CNAME` — and its near-twin {#tenant-host-cname}

This is what the **tenant runtime** matches an incoming `Host` header against.
A request for that name, or for anything under `*.<that name>`, resolves to one
of your published sites; anything else falls through to the custom-domain path.
It has no default.

There is a second, similarly-named variable, and they are not the same one:

| Variable | Read by | If unset |
| --- | --- | --- |
| `AGLYN_TENANT_HOST_CNAME` | The tenant runtime, to resolve incoming hosts | No apex matches, and every visitor falls through |
| `NEXT_PUBLIC_AGLYN_TENANT_HOST_CNAME` | The console, as the CNAME target it displays and verifies in the custom-domain wizard | Defaults to `sites.aglyn.app` |

`.env.selfhost.example` carries both, on adjacent lines. **Set both, to the
same value.** The first is consumed at image-build time, so it has to be in the
env file before `docker compose build`, not merely before `up` — a container
started with it in `env_file` but built without it still runs the compiled-in
`undefined`.

### `NEXT_PUBLIC_CONSOLE_URL` {#console-url}

Your console's public origin. Unset, it falls back to `https://app.aglyn.com`,
and four things follow from that:

- A visitor who reaches your tenant runtime on a hostname it cannot resolve is
  redirected to **Aglyn's** console — your user, mid-session, on our domain.
- The besigner's "edit this page" bounce keeps Aglyn's two console origins in
  its return allowlist. Naming your own console replaces them with yours
  alone, so your tenant runtime stops carrying a redirect target at a console
  you do not run.
- The admin bar and the links inside transactional email point at us.
- Campaign forwarding (AGL-1731) decorates console-bound links with the
  visitor's `utm_*`, and this variable is the **only** origin it will touch.
  Unset, your own signup links get nothing — the campaign is attached to
  Aglyn's origin instead of yours, so your acquisition reporting reads as a
  silent zero. Setting it to an **empty** value is not a way to opt out
  either way: forwarding switches off entirely rather than falling back to us.

### `AGLYN_STANDALONE` {#aglyn-standalone}

The variable that tells the software it is a real deployment rather than a
developer's laptop, and it must be exactly `1`. Two things key on it: the
tenant runtime's host resolution, and the canonical custom-domain redirect.

**You do not set this one — the images do.** Both Dockerfiles set it in the
stage that *runs*, so a stock container has it and host resolution works out of
the box.

It is deliberately absent from `.env.selfhost.example`, and that is not an
oversight: compose `env_file` values *override* an image's `ENV`, so a line in
your env file would give you a way to delete the setting and silently break
serving for every visitor, while image `ENV` survives an env file that simply
does not mention it.

Worth knowing because of what came before: the Dockerfiles once set it only
while **building**, and a build stage's environment does not carry into the
runner stage. Every image shipped before that fix ran with it unset, read
itself as a developer's laptop, matched no host, and redirected every visitor
to the configured console. **If you are running an image built before that
fix, rebuild** — you cannot patch it from the outside without also taking on
the override hazard above.

### Reverse proxy: one wildcard is enough {#reverse-proxy}

The tenant runtime resolves the `Host` header itself, so you need two rules,
not one per site:

```caddy
console.example.com {
  reverse_proxy localhost:4200
}
*.sites.example.com {
  reverse_proxy localhost:4500
}
```

A customer's own custom domain works the same way — point it at your proxy and
route it to the tenant container. The runtime treats any hostname it does not
recognise as a candidate custom domain and looks it up.

## Renaming the product {#platform-brand}

`NEXT_PUBLIC_PLATFORM_BRAND_NAME` renames the product everywhere it names
itself: browser-tab titles, the installable PWA, the relying-party name the
operating system shows when someone saves a passkey, transactional email, and
the `<meta name="generator">` / `x-powered-by` fingerprint on every site you
publish. Unset, it is `Aglyn`.

| Variable | Unset means |
| --- | --- |
| `NEXT_PUBLIC_PLATFORM_BRAND_NAME` | `Aglyn` |
| `NEXT_PUBLIC_PLATFORM_BRAND_LEGAL_NAME` | `<brand> LLC` — a US company form, so set it if you are not one |
| `NEXT_PUBLIC_PLATFORM_SUPPORT_URL` | Falls back to `NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL` as a `mailto:` before it ever falls back to Aglyn's support page |

Brand **images** are not environment variables and are not meant to be: the
favicon, app icons and social card are files under
`apps/console/public/_static/images/brand` and the matching tenant path.
Replace them in your Docker build context.

:::caution `NEXT_PUBLIC_*` is baked in at build time
Every variable on this page whose name starts with `NEXT_PUBLIC_` is compiled
into the client bundles when the image is built. Changing one needs
`docker compose build`, not a restart. A restart will appear to do nothing,
which is the failure mode worth recognising.
:::

This is the **deployment-level** rename, and it is orthogonal to the per-organization
[white-label](../workspace-and-billing/white-label.md) feature. The platform
brand is what every organization on your install falls back to; white-label is
a paid entitlement that lets one organization override it for itself. The two
compose: on your deployment, a non-white-label organization renders *your*
brand, not Aglyn's.

## Optional keys

The example env file carries the required Firebase blocks plus a handful of
optional integrations. The related features degrade gracefully — a missing key
disables its feature rather than breaking the stack:

| Feature | Keys |
| --- | --- |
| Billing & commerce checkout | `STRIPE_SECRET_KEY`, plus `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, and the `STRIPE_PRICE_*` price ids if you want working plan checkout — the secret key alone is not enough |
| Transactional & campaign email | `RESEND_API_KEY`, `USAGE_EMAIL_FROM` |
| AI assist | `ANTHROPIC_API_KEY` |
| Scheduled jobs | `CRON_SECRET` — the job routes stay dormant without it. See [below](#scheduled-jobs) for what that silently switches off |
| Customer issue reports | `LINEAR_API_KEY` and `LINEAR_CUSTOMER_REPORTS_TEAM_ID` — both required. See [below](#issue-reports) |
| The every-minute job beat | `AGLYN_JOB_RUNNER_URL`, only if you deploy `cloud/functions`. See [below](#scheduled-jobs) |
| The fifteen-minute console sweeps | `AGLYN_CONSOLE_URL`, only if you deploy `cloud/functions`. See [below](#scheduled-jobs) |

### Scheduled jobs {#scheduled-jobs}

Three separate mechanisms, and missing any of them is quiet rather than loud.

**`CRON_SECRET`** is the shared secret every scheduled route checks. Without
it those routes answer `501` and do nothing — including audit archival,
erasure runs, retention sweeps, booking reminders, abandoned-cart and restock
mail, and, least obviously, **scheduled campaign sends**. A self-hoster who
skips this can schedule a campaign in the console, see it accepted, and watch
its send time pass with nothing delivered and no error anywhere. Generate one
with `openssl rand -hex 32` and point a scheduler at the routes.

**`AGLYN_JOB_RUNNER_URL`** only matters if you deploy `cloud/functions`. It is
the tenant origin its every-minute beat POSTs to, and it drives scheduled
publishing and booking-hold expiry. It has **no default**, deliberately: it
used to fall back to a specific Aglyn customer's published site, so a
deployment that missed the variable POSTed to a stranger every minute carrying
its own `PLUGIN_JOBS_SECRET` while none of its own jobs ran. Unset, the beat
now refuses to fire and logs the variable name once per tick. Set it to a
tenant origin on *your* deployment, for example
`https://sites.example.com/api/plugins/run-jobs`.

**`AGLYN_CONSOLE_URL`** also only matters if you deploy `cloud/functions`. Its
`consoleFastCrons` job runs every fifteen minutes and POSTs the two console
routes that cannot wait for a slower scheduler: **scheduled campaign sends**
and the sweep that finishes a **custom domain** once its certificate or DNS
settles. Set it to the origin that *serves* your console — not one that
redirects to it, because a redirect drops the POST body and the
`x-cron-secret` header. Unset, the job refuses to fire and names the variable,
for the same reason `AGLYN_JOB_RUNNER_URL` has no default.

Aglyn's own deployment moved these two off GitHub Actions in AGL-1617: GitHub
coalesces and silently drops scheduled triggers under load, which is fine for
a nightly job and not fine for one a customer set a clock time on. If you
schedule these some other way, **anything hourly or slower will quietly break
the promise the campaign composer makes** — it accepts a time down to the
minute. `/api/health/crons` is the check that notices; it reds a
fifteen-minute job after roughly three missed fires.

`CRON_SECRET` reaches this function through Secret Manager
(`firebase functions:secrets:set CRON_SECRET`) and must equal the console's.
`AGLYN_PROBE_TOKEN` is optional and only needed if a bot-protection layer sits
in front of your console; unset, the header is simply not sent.

Both non-secret variables live in a dotenv file in `cloud/functions/` —
copy `cloud/functions/.env.example` to `.env.<your-project-id>` **before your
first `firebase deploy --only functions`**. The Firebase CLI writes whatever
that file contains onto the deployed service, so a missing file does not mean
"keep the current values", it means "deploy with none". Both beats have no
defaults, so that is a pair of jobs that stop firing with no error anywhere
except a `job-silent` row on `/api/health/crons`.

### Customer issue reports {#issue-reports}

The console's **Report an issue** dialog files into Linear, and it files into
*your* Linear workspace or nowhere. Both `LINEAR_API_KEY` and
`LINEAR_CUSTOMER_REPORTS_TEAM_ID` are required; with either missing the route
answers `501` and names them, and no report is ever sent to Aglyn.

Scope the key when you create it. Linear can restrict a personal API key to
**Create issues** and to **specific teams** — do both, so a leaked key cannot
read your backlog. Keep inbound reports out of whatever queue you plan
releases from: unbounded inbound volume in that queue destroys the count you
steer by.

`LINEAR_CUSTOMER_REPORTS_PROJECT_ID` is optional. Set it to file into a
specific project inside that team, if you separate intake by project rather
than by team. Left unset the report still files, into the team's own backlog —
a missing project is a vaguer destination, never a lost report.

Both are **server-only**. Never prefix either with `NEXT_PUBLIC_`, which would
inline a workspace-wide credential into the browser bundle.

### Request geo: sanctions screening and consent region {#request-geo}

Two features read the visitor's country off a request header: the embargo gate
in front of the console, and the storefront's consent-region endpoint. On
Aglyn's cloud that header comes from Vercel's edge. **A container has no edge**,
so before this was configurable every request looked like "no country" and the
embargo gate failed open on all of them — announcing it once per instance in
your logs and then blocking nothing:

```
[sanctions-geo] FAILING OPEN: no x-vercel-ip-country on 1 request(s) since instance start
```

Your proxy already has the signal under its own name. Name it:

| Variable | Default | Example |
| --- | --- | --- |
| `AGLYN_GEO_COUNTRY_HEADER` | `x-vercel-ip-country` | `cf-ipcountry` behind Cloudflare |
| `AGLYN_GEO_REGION_HEADER` | `x-vercel-ip-country-region` | whatever your GeoIP module sets |

Country is ISO 3166-1 alpha-2; region is ISO 3166-2, bare or prefixed. Leave
the region one blank if your proxy sends no subdivision — Cloudflare does not.

Baked in at **build** time, because the console's middleware runs in the edge
runtime and has no request-time environment: set it before
`docker compose build`, not before `up`. Left blank, sanctions screening is not
running on your deployment (AGL-2436).

### Bucket CORS is not a file you can use as-is {#bucket-cors}

`cloud/storage-cors.json` in the repository is **Aglyn's own live bucket
policy** — it names `https://app.aglyn.com`, and a test asserts that it stays
byte-identical to what our bucket serves. It is applied with
`gcloud --cors-file`, which cannot read environment variables, so this one
cannot be made configurable in place.

Copy the file, replace the origin with your console's, and apply your copy.
Without it, every upload over 3 MB dies at the CORS preflight as a generic
"try again".

## Publishing your own documentation {#docs-build}

`apps/docs` is a standalone Docusaurus package. It is not part of
`docker compose`; you build and publish it separately if you want your own
documentation site. Skip this whole section if you do not.

Every value below is read at **build** time by `docusaurus build`, from that
build's environment. They are not container runtime environment, and they are
not `NEXT_PUBLIC_*` — Docusaurus is not Next. Set them before the build, not
after; the values are baked into the static output.

| Variable | Unset means |
| --- | --- |
| `DOCS_GA_TRACKING_ID` | No analytics tag is loaded at all |
| `DOCS_ERROR_BEACON_ENDPOINT` | The browser error beacon installs no handlers |
| `DOCS_STATUS_TARGETS` | `/status` probes nothing and says so |
| `DOCS_STATUS_FALLBACK_URL` | `/status` names no independent monitor to fall back to |
| `DOCS_URL` | The canonical origin is `https://docs.aglyn.com` |
| `DOCS_ORGANIZATION_NAME` | The footer copyright reads `Aglyn LLC`, followed by Aglyn's trademark attribution. Setting it replaces the name and drops the attribution — a rebranded build must not claim our marks. |

The rule to hold on to for the first three: **unset means off, never ours.**
They previously defaulted to Aglyn's GA4 property, Aglyn's error collector and
Aglyn's production health endpoints — so a published build reported your
readers to us and told them our uptime was yours, which is a false all-clear
during your own outage.

`DOCS_STATUS_TARGETS` is a comma-separated list of
`name|label|origin|description|path` entries. A name and an origin are
required; the description may be omitted and an empty label falls back to the
name, so `console||https://console.example.com` is a valid entry:

```
DOCS_STATUS_TARGETS='console|Console|https://console.example.com,sites|Published sites|https://sites.example.com'
```

The fifth field is the health path to probe, and defaults to `/api/health`.
Point a target at a subsystem endpoint when the aggregate is not the signal you
want a visitor to see — `/api/health` proves the app is serving, while
`/api/health/render/site` proves a real page still renders:

```
DOCS_STATUS_TARGETS='rendering|Site rendering|https://sites.example.com|A real page renders|/api/health/render/site'
```

Two things the grammar cannot do, both of which fail quietly rather than
loudly: **a description may not contain a comma** (the comma separates
entries, so the text after it is parsed as a new entry, found to have no
origin, and dropped), and a path that does not begin with `/` is ignored in
favour of `/api/health` rather than pasted onto the origin.

Whatever you configure, the page reports a service as operational **only**
when it answers 200 with the platform's own health body. A reply it cannot
read — a bot-protection challenge, a proxy error page, a redirect — is shown
as *no reading*, never as healthy, and never as an outage either.

`DOCS_STATUS_FALLBACK_URL` takes one `http(s)` URL and should point at a status
page **someone else hosts** — a free UptimeRobot page, or any third-party
monitor. `/status` prints it in full under a line telling the reader to check
it when this page will not load, which is the one thing this page cannot do for
itself: it is served from your own infrastructure, so an outage broad enough to
take that down takes your status page with it. Leave it blank and no such line
is printed; a value that is not plainly `http:` or `https:` is dropped rather
than rendered.
If you point `DOCS_ERROR_BEACON_ENDPOINT` at your own console's `/api/errors`,
set `NEXT_PUBLIC_DOCS_ORIGIN` on that **console** to your docs origin as well —
the collector's CORS allowlist reads it.

## Honest limits

| Area | Self-hosted behavior |
| --- | --- |
| Firebase | Required — Auth, Firestore, Storage, RTDB, and Remote Config run in your project. |
| Custom-domain self-service | The in-console attach flow is Vercel-specific and answers `501` without Vercel credentials; self-hosters attach domains at their reverse proxy instead. DNS **verification** works everywhere — see the row below. |
| Custom-domain verification | The verify step requires an exact CNAME match, or an apex address match when the name carries no CNAME at all. There is a soft pass that accepts *any* CNAME, for local development where no DNS points at a tenant edge. It used to be enabled by the absence of a hosting vendor's environment variable — which a container never sets — so it was **on in production on every self-host install**, and any domain carrying any CNAME to anywhere verified. A user of your platform could claim a domain they do not control. It now keys on `NODE_ENV`, which both Dockerfiles set to `production` in the image that actually runs. **If you run an image built before this fix, upgrade.** |
| Legal pages & clickwrap | The signup checkbox links **Aglyn LLC's** Terms and Privacy and records acceptance against Aglyn's document hashes. Nothing breaks, but the agreement is ours, not yours, and is not yet configurable. Replace it before running this for anyone but yourself. |
| Marketplace | Visible by default, but backed by Aglyn's Stripe Connect platform. Browsing works; purchase and payout onboarding explain themselves only after a click. Turn `release_marketplace` off in Remote Config if you don't want it. |
| Wildcard published-site domains | Supported. The tenant runtime resolves the `Host` header itself, so a single `*.sites.example.com` rule at your proxy serves every site — see [Reverse proxy](#reverse-proxy). It needs `AGLYN_TENANT_HOST_CNAME` set and `AGLYN_STANDALONE=1` present **at runtime**; without the latter the runtime reads itself as a developer's machine, matches nothing, and redirects every visitor to the configured console. |
| Stripe / Resend / AI assist | Optional keys (see above); the related features degrade gracefully when absent. |
| Operator identity | Set `NEXT_PUBLIC_OPERATOR_NAME` and `NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL` — the public abuse and §512 intakes, the lockdown 503, the quarantine notice and the sanctions 451 all name them, there is no Aglyn fallback, and unset renders "not configured". Baked in at image build time. |
| DMCA designated agent | Not inherited from Aglyn. Register your own with the U.S. Copyright Office; the product asserts a registration only when you set `NEXT_PUBLIC_OPERATOR_DMCA_AGENT_REGISTERED=true`. |
| Legal documents | Signup still clickwraps your users to Aglyn LLC's Terms, hash-pinned to snapshots in the repository. `NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN` records your own legal origin but does not yet retarget the acceptance flow. |
| Documentation links | `NEXT_PUBLIC_DOCS_ORIGIN` retargets **every** docs link — Assist citations, console help, besigner help, and the `documentation` URL your own REST API returns. Unset, they all point at `https://docs.aglyn.com`. It previously governed the citations alone while the console and besigner read a separate, undocumented variable, so following the runbook exactly retargeted about a third of the links and left the rest citing ours inside your product. |
| Staff / admin surfaces | Built for Aglyn's own operations. The `/admin/tax-return` report in particular is built around a single US-TX registration; set `TX_WEBFILE_NUMBER` / `TX_TAXPAYER_NUMBER` to your own identifiers or leave both unset for an explicit "not configured". |
| Updates | `git pull && docker compose up --build`, re-running the rules deploy when `CHANGELOG.md` records a rules change. Releases are `v<semver>` git tags; `git describe --tags --match 'v*'` tells you which one you are on. |

## Related

- [White-label](../workspace-and-billing/white-label.md)
- [Report an issue](../workspace-and-billing/report-an-issue.md)
- [Billing & plans](../workspace-and-billing/billing-and-plans/overview.md)
