---
sidebar_position: 2
title: Firewall posture
description: Internal runbook — the expected Vercel WAF posture of every project, the PUT that silently deletes managed bot protection, and the safe PATCH that repairs it.
---

# Firewall posture (AGL-2483)

:::warning Aglyn staff only
Internal infrastructure runbook. Requires a Vercel API token scoped to the
Aglyn team. The checker is **read-only** and never writes.
:::

## ⛔ Read this before you touch a firewall config by hand

**`PUT /v1/security/firewall/config` returns HTTP 200 and silently deletes
managed bot protection.**

On 2026-08-21, adding one custom rule to `aglyn-tenant` that way inserted the
rule exactly as asked and turned off bot protection for the entire project.
Every tenant site would have been left unchallenged. Nothing in the response
said so.

The mechanism is a two-step foot-gun:

1. `PUT` is a **whole-document replace** — any key you omit is deleted.
2. You are **forced** to omit `managedRules`. Sending it back verbatim, even
   byte-identical to what the API just returned, is rejected with
   `managedRules.bot_protection should NOT be valid`. The obvious
   read-modify-write loop therefore cannot work: the API refuses the only body
   that would have preserved the setting, then reads the absence it forced on
   you as an instruction to delete.

It reads as success in every way a human checks it. The rule is there, the
status is 200, the response body looks right. Only a read-back of
`managedRules` shows the damage.

### ✅ The safe write — always `PATCH`, one operation at a time

```http
PATCH /v1/security/firewall/config?projectId=<project>&teamId=<team>
Authorization: Bearer <token>

{
  "action": "managedRules.update",
  "id": "bot_protection",
  "value": { "active": true, "action": "challenge" }
}
```

`id` is **required**. Omitting it fails with

> ``Invalid request: `action` should be equal to constant``

which is a complaint about the **body shape**, not about the `action` string —
and it will send you off rewriting a value that was correct all along.

Custom rules use the same PATCH surface (`rules.insert`, `rules.update`,
`rules.remove`), so there is never a reason to reach for `PUT`.

### That same error also means "your description is too long"

`value.description` is capped at **256 characters**, and exceeding it produces
the *identical* ``Invalid request: `action` should be equal to constant`` — no
mention of `description`, and no mention of a length. Measured 2026-08-23: 250
characters validates, 260 does not.

This is very likely why `rules.insert` was written off as "also fails this way"
when the console rules first went in, and why a `PUT` was reached for instead.
`rules.insert` works fine; the description was just too long.

### Validating a rule body without writing anything

Send it as `rules.update` against an id that does not exist. The schema is
checked **before** the lookup:

| Response | Meaning |
| --- | --- |
| `404 Rule not found: …` | the body shape is **valid** |
| ``400 `action` should be equal to constant`` | the body shape is **invalid** |

That is a dry run against the real validator with no chance of leaving a
half-built rule behind — better than inserting a probe rule and deleting it,
because the delete can fail.

## Running the check

```bash
npm run check:firewall-posture             # verify
npm run check:firewall-posture -- --strict # known gaps also fail
npm run check:firewall-posture -- --json   # machine-readable
```

Locally it uses your `vercel` CLI login. In CI it requires the `VERCEL_TOKEN`
repo secret and refuses the CLI fallback, so a CI run can only ever
authenticate with the secret.

**Exit codes:** `0` posture matches · `1` drift · `2` could not check (no
token, an API refusal, or a malformed posture table). There is no
`--fix`: a firewall is not something a scheduled job should reach in and edit,
and the repair above is one line a human should run with the blast radius in
front of them.

`.github/workflows/firewall-drift.yml` runs it daily.

## What is asserted

Expected posture is **declared as data** at the top of
`tools/scripts/lib/firewall-posture.mjs`. Adding a project or a bypass rule is
an edit to that table, never to the logic.

Per project:

| Assertion | Why |
| --- | --- |
| `firewallEnabled` is `true` | otherwise every rule below is inert |
| `managedRules.bot_protection` is `{active: true, action: "challenge"}` | the setting the `PUT` deletes |
| every declared bypass rule is present | a missing probe rule turns uptime-probe.yml into a false outage |
| every declared bypass rule is **still scoped** | see below |
| every declared **path and group shape** is present | see below — added 2026-09-03 |
| no **undeclared** bypass rule exists | an undeclared hole is an unreviewed hole |
| every declared **rate-limit rule** is present, scoped, and carries its declared window, limit, key and past-the-limit action | a raised limit or a `challenge` past it changes who is refused |
| every declared rate-limit rule sits **ahead of the bypass it precedes** | a matched bypass skips every later custom rule — see [the media CDN rate limit](#the-media-cdn-rate-limit-agl-2812) |

### Why scope, not just presence

A bypass rule is a hole punched through bot protection. The safety property is
not "the rule is still there" — it is "the rule is still **narrow**".

The plugin job runner rule is the sharp case. It is scoped to the path
`/api/plugins/run-jobs` **and** the presence of the `x-plugin-jobs-secret`
header. Drop the header condition and it decays to path-only, leaving an
unauthenticated job-runner endpoint reachable by anything on the internet —
while still passing any check that merely counts rules by name.

`conditionGroup` entries are **OR'd**. So a rule can be re-opened without
touching the existing group at all, simply by appending a second, looser one.
The checker therefore requires **every** group to carry **every** required
condition.

### And coverage, not just scope (added 2026-09-03)

Scope answers *is this hole still narrow*. It cannot answer *is this hole still
there* — and for years it did not.

One rule often serves several paths, through one of two mechanisms: a
`valueAnyOf` allowlist, or a declared alternate group shape. Both describe what
a live group is **allowed** to be, and an allowance is satisfied vacuously by a
group that does not exist. Delete the `/robots.txt` group from the crawler
rule and the five that remain all still carry a listed path: green, with
`robots.txt` challenged.

AGL-2520 is the case that found it — see [A NEW public metadata path ships
challenged](#a-new-public-metadata-path-ships-challenged-2026-09-03) below.

So the checker asserts both directions, and the rule is simply **anything the
table declares must exist**:

| | asserts | catches |
| --- | --- | --- |
| scope | every live group carries every required condition | a rule widened by appending a looser group |
| coverage | every declared path and group shape is carried by some live group | a rule that lost a mouth, or never grew one it is declared to have |

The field that declares an alternate shape is named **`alsoRequiresGroups`**
for this reason. It was `alsoAllowsGroups`, and the name was the bug.

### Secrets

The probe rule matches on a shared-secret header value, and the API returns
that value in the config. It is asserted as *non-empty*, never literally, and
redacted in all output. This repository is public and Actions logs on a public
repo are world-readable.

## Current posture

Measured 2026-10-01.

| Project | Serves | Posture |
| --- | --- | --- |
| `aglyn-tenant` | every customer site on `*.aglyn.app` + custom domains | ✅ protected — challenge, 10 scoped bypass rules, 1 rate limit (enforcing) |
| `aglyn-docs` | `docs.aglyn.com` | ✅ protected — challenge, 4 scoped bypass rules |
| `aglyn-console` | `app.aglyn.com` — sign-in, billing, staff surfaces, and every Sequences link domain | ✅ protected — challenge, 8 scoped bypass rules, 1 rate limit (enforcing) |
| `aglyn-plugins` | `plugins.aglyn.com` — plugin loader origin | ⚠️ **no WAF config** — reviewed, deliberate |

### How the console was closed, and why the order mattered

The console had **no WAF config and never had one**: a scripted `User-Agent`
reached sign-in and billing with a plain **200 and no `x-vercel-mitigated`
header**, while the *marketing* site answered the identical request with **429 +
`x-vercel-mitigated: challenge`**. The protection was on backwards.

It was closed on 2026-08-21 in two steps, and the order is the whole lesson:

1. **The bypass rules went in FIRST**, while nothing was being challenged yet —
   the probe header, plus one `Machine traffic bypass` covering Stripe's
   webhook, the ten `CRON_SECRET` jobs and the `/api/health` prefix.
2. **Bot protection was enabled second**, via `PATCH managedRules.update`.

Enabling first would have challenged Stripe's webhook and every scheduled job —
silently breaking billing and re-firing every uptime alert. Because the config
PUT wipes managed rules (see above), doing rules-then-protection is also the
only ordering that does not need a repair step.

Verified in **both** directions rather than one: a request carrying the
machine-traffic path with a deliberately wrong secret reached the app and was
refused **401** (the challenge was bypassed, authentication was not), and an
ordinary console route answered the same client **429**. A single request that
merely succeeds proves only half of that.

### The cron bypass is a prefix plus a header, not a path list

Added 2026-09-07. The `Machine traffic bypass` names each job route one by
one, and on 2026-09-07 the two reaper jobs were answered with a 403
checkpoint because nobody had added theirs — a job route the list does not
name is a job that goes silent. `Cron bypass` closes that class: any path
matching `^/api/(admin|billing)/` **and** carrying an `x-cron-secret` header
skips the challenge. Both conditions are load-bearing — the prefix alone
would lift the challenge from every admin and billing route, the header alone
would lift it site-wide for anyone who guessed its name — and every route
still compares the header's value against `CRON_SECRET`, so the bypass removes
the bot challenge and nothing else. Verified the day it went in: a wrong-secret
POST reached the app and was refused `401` JSON; a header-less POST got the
`429` checkpoint.

### Protecting the console broke the plugin loader

Two days after the console was closed, sandbox-tier plugin rendering was found
broken on every site using a **verified custom domain** — and nothing had
noticed, because the failure surfaces as a blank iframe with the reason only in
a browser console log.

**It was latent, not an active outage**, and the distinction is worth keeping
straight. Checked on 2026-08-23: every *code* plugin with a live install (the
versions carrying `hostAbi`) is `trust: "realm"`, and realm bundles run in the
app realm — they never touch this iframe or its CSP. No published version
declares a `capabilities.network` origin either. So both consequences were
loaded and pointed, with nothing yet standing in front of them: the first
sandbox-tier install on a custom domain, or the first plugin to declare a
network origin, would have hit it — and would have looked like a plugin bug,
not a firewall one.

`tools/plugin-loader/origin/api/load.mjs` builds the sandbox document's CSP
from two **public, unauthenticated, read-only** console endpoints, fetched
**server-side from inside its own serverless function**:

| Endpoint | Feeds |
| --- | --- |
| `/api/marketplace/listing-versions` | the plugin's declared `connect-src` origins |
| `/api/plugin-host-origins/{hostId}` | the framing site's verified custom domain, for `frame-ancestors` |

A function's `fetch` has no browser to solve a challenge, and it must not be
given the probe token — that token is scoped to *our own scripts*, and
production infrastructure should not borrow it. So both calls got a **429
checkpoint**, the loader folded them to `null`, and took its fail-strict path.

Failing closed is the right design, but the second consequence is an **outage,
not a degradation**: with no extra ancestor, `frame-ancestors` omits the
customer's own domain and the browser refuses the iframe outright.

Repaired on 2026-08-23 with a third bypass rule, `Plugin loader control plane
bypass` — one `path eq /api/marketplace/listing-versions` group and one
`path pre /api/plugin-host-origins` group. `eq` on the first is deliberate:
`pre` would also admit `/api/marketplace/listing-versions-*`. Both endpoints
are public and read-only, and the publisher view (`?scope=publisher`) verifies
its own Firebase ID token and **401s** without one — so this bypasses the bot
challenge and nothing else.

Measured before and after on host `DXnRbPH4CQ` (cname `aglyn.com`):

```text
before  frame-ancestors https://app.aglyn.com https://*.aglyn.app
after   frame-ancestors https://app.aglyn.com https://*.aglyn.app https://aglyn.com
```

…and a host id with **no** custom domain still gains nothing, so the difference
is the lookup succeeding rather than a blanket widening. Both directions were
checked: `/api/marketplace/publish`, `/api/marketplace/listing-versions-x` and
an ordinary console route all still answer **429**.

**The general lesson:** when you enable bot protection, enumerate the callers
that are *your own server-side code fetching your own public endpoints*. They
look like third-party bots to the WAF, they cannot solve a challenge, and their
failure is silent.

### How the tenant health checks were unblocked

The same enablement left **four GCP uptime checks at 0% for three days** —
`tenant-health`, `beacon-heartbeat tenant`, `marketing-home` and
`customer-site`, all on `aglyn-tenant`, all answered with a **429 Vercel
Security Checkpoint**. The two existing bypass rules are keyed on headers GCP
cannot be made to send, and the probe token is deliberately scoped to our own
scripts rather than handed to a third-party monitor.

Fixed on 2026-08-23 (AGL-2486) with a third tenant rule, `Health endpoint
bypass` — a single `path pre /api/health` group. A **path-only** bypass is
right here and wrong for the job runner alongside it: `/api/health` and
`/api/health/error-beacon` are public by design, take no auth, read no session
and answer codes rather than messages, so a challenge protects nothing and
breaks the only thing watching. `pre` rather than `eq` because the beacon
heartbeat is a subpath. Needing no shared secret, it also fixes the endpoints
for any monitor chosen later.

Both directions were checked, anonymous `Monitor/1.0`:

```text
/api/health               200   challenge bypassed
/api/health/error-beacon  200   challenge bypassed
/                         429   the page challenge still stands
```

That last line is the point: `marketing-home` and `customer-site` probe **real
pages**, so a path rule does not reach them and the challenge there is still
doing real work. They need Google's checker IP ranges allowlisted
(`gcloud monitoring uptime list-ips`) — see `docs/UPTIME_AND_SLA.md`.

Because `pre` is a prefix, this rule stays exactly as narrow as the
`/api/health` namespace is kept: any privileged route added under it would be
unchallenged from the day it shipped.

### How tracked sequence links were unblocked (AGL-3306)

A tracked sequence link is opened by the recipient's mail client, by link
previews and by corporate link scanners before any person clicks it — none of
which runs JavaScript. Measured 2026-09-23, before the rule:

```text
curl -sI https://app.aglyn.com/api/outreach/l/<id>   429  x-vercel-challenge-token
```

So a scanner met a challenge page where a redirect belonged, which to a
security gateway reads as a broken link in a suspicious email. The route
already handles scanners itself — it redirects them exactly as it redirects a
person and counts them apart — so the challenge protected nothing.

`Click-tracking link bypass`, inserted with `PATCH rules.insert` on 2026-09-23,
has three groups:

| Group | Admits |
| --- | --- |
| `host pre links.` **and** `path re ^/([A-Za-z0-9]{6,32}\|_aglyn/link-host)$` | a link id, and the verification probe, on any Sequences link domain attached to the console |
| `path pre /api/outreach/l/` | the same short links on the console's own address |
| `path eq /api/outreach/click` | the signed links sent before AGL-3297 |

Both conditions in the first group are load-bearing: host-only would lift the
challenge from every console route reached through a link domain. The
middleware already 404s those, but a hole in the WAF should not rely on the
layer behind it. The probe path is in it because **Check** fetches the probe
from the console's own function, which cannot solve a challenge either.

Both directions, the minute it went in:

```text
anonymous curl  /api/outreach/l/AAAAAAAAAA   400  "This link doesn't work" page (unknown id, reached the app)
anonymous curl  /signin                      429  the page challenge still stands
```

A self-hosted proxy with bot rules of its own owes the same exemption; see
[Environment variables → Link domains](../developers/self-hosting-environment.md#sequences-link-domains).

### Shipping connectors (AGL-3613, AGL-3633)

ShipStation pulls a store's orders from, and posts shipments to,
`/api/commerce/shipstation/{hostId}`; ShippingEasy posts its shipment
callback to `/api/commerce/shippingeasy/{hostId}`. Both callers are the
shipping apps' own servers, which run no JavaScript and send no header we
choose, so a challenge leaves the connector importing nothing and marking
nothing shipped.

`Shipping connector bypass` is DECLARED in `tools/scripts/lib/firewall-posture.mjs`
with two groups, and is added to the console project's live config with
`PATCH rules.insert` before the first live test of either connector — until
then `firewall-drift.yml` reports it missing:

| Group | Admits |
| --- | --- |
| `path pre /api/commerce/shipstation/` | ShipStation's Custom Store export and shipnotify for one site |
| `path pre /api/commerce/shippingeasy/` | ShippingEasy's signed shipment callback for one site |

Each route proves its caller before it reads anything — ShipStation by the
site's HTTP Basic pair, ShippingEasy by an HMAC of the path, query and body
under the merchant's API secret — and answers an unproven caller 401. Both
keep a per-site, per-address rate limit of their own. The trailing slash in
each prefix keeps a sibling path that merely starts the same way challenged.

Check both directions the minute it goes in:

```text
anonymous curl  /api/commerce/shippingeasy/<hostId>  (POST, no signature)  401 from the route
anonymous curl  /signin                                                    429 the page challenge still stands
```

### The remaining gap: `aglyn-plugins` — reviewed, and deliberately open

`GET /v1/security/firewall/config/active` still answers **404** for it, and a
404 means *no config has ever been created* — **not** "a default posture
applies". `GET /v1/security/firewall/config` returns
`{"active":null,"draft":null,"versions":[]}`: zero versions, ever.

Reviewed on 2026-08-23. **This is not a confidentiality or integrity exposure.**
The origin serves exactly two things, and `/` is a 404:

- `GET /load` — the sandbox HTML shell plus a per-request CSP. No secrets, no
  user data, no auth, no session; its whole content ships in this repo.
- `GET /artifacts/*` — an edge rewrite to the console's
  `/api/plugin-artifacts/*`, streaming content-addressed plugin bundles.

| Risk | Verdict |
| --- | --- |
| **Confidentiality** | Nothing to leak. Bundles are deliberately public code; a URL needs the exact sha256, and anyone entitled to the listing already has it. |
| **Integrity** | Not a WAF's job here. Every loader re-hashes the bundle against the pinned sha256 before executing a byte, realm bundles carry a platform Ed25519 signature, the iframe owns its own sandbox attribute, and the CSP is per-manifest. The real integrity risk is a malicious plugin being **published**, which review answers. |
| **Cost / availability** | **The real exposure.** `/load` is `Cache-Control: private, no-store`, so every request is a function invocation plus up to two console calls — an unauthenticated, uncacheable ~3× amplifier. That is a bill, not a breach. |

**A challenge is ruled out on the merits, not deferred.** `/load` is fetched by
visitors to customer sites and by the plugin iframe itself — traffic Aglyn
neither controls nor can hand a bypass header. A challenge there breaks live
customer sites, which is far worse than the gap.

If abuse ever appears, in order of proportionality:

1. **Make `/load` cacheable.** It is a pure function of its query string; an
   `s-maxage` would let the CDN absorb a flood for free. Bigger win than any
   firewall rule, and the only one that also cuts steady-state cost.
2. A Vercel **rate-limit** custom rule on `/load` keyed by IP, generous enough
   that a real visitor never meets it.
3. Managed bot protection with action **`log`**, for visibility only.

Never `challenge`, never `deny`.

It stays declared in the posture table as `expect: 'unprotected'` with that
rationale, so it is reported as a loud `GAP` on every run and fails under
`--strict`. It is still asserted: if it quietly *gains* a config, the run
**fails**, so the table can never silently describe a fiction.

### How link previews and email images were unblocked

A link to `aglyn.com` pasted into iMessage rendered with **no card**. The Open
Graph markup was never the problem — it was complete and correct, and the image
behind it was a valid 1200×630 PNG. Every social crawler was simply being
answered **429 + `x-vercel-mitigated: challenge`**, so none of them ever read
the `og:image` tag.

The same 429 reached three more classes of caller nobody had enumerated:

| Caller | Was reaching | Consequence |
| --- | --- | --- |
| `facebookexternalhit`, `Slackbot`, `Twitterbot`, `LinkedInBot`, `WhatsApp` | every page on every site | no link preview anywhere, including customer sites |
| Gmail's image proxy | the **console's** `/api/media/cdn` | every image in every campaign email rendered broken |
| any crawler or feed reader | `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, RSS | exclusions and URL sets unreadable |

The email one is worth its own line, because it does not follow from
"the marketing site is challenged": `render-system-email.ts` resolves mailed
images to the **console's** CDN mount, not the tenant's. Protecting the console
on 2026-08-21 therefore broke images in mail without touching a site.

**`bot_category` and `bot_name` are unavailable on our plan.** Both are the
right condition type here — Vercel verifies them by reverse DNS rather than by
a spoofable string — and both answer `401 This feature requires an Advanced
Project`. The crawler rule therefore matches on `user_agent`, which is the
weakest condition in the table. That is bounded on the merits: it bypasses the
bot challenge and nothing else, and everything it admits is public HTML anyone
could already fetch by solving a challenge in a headless browser. The exposure
is function invocations, so the proportionate control if it is ever abused is a
**rate limit** on that User-Agent set, not a deny.

The asset rules need no User-Agent at all and are the durable half:
`/api/media/cdn` is annotated `lockdown-423: exempt` precisely because it is
anonymous public delivery with no caller identity to verdict, and
`serveMediaCdn` still enforces lockdown behind the bypass.

Measured 2026-09-01, both directions:

```text
facebookexternalhit  /                    200   (og:image now read)
anonymous            /api/media/cdn/…     200   image/png, 1200x630
GoogleImageProxy     console /api/media/… 404   challenge bypassed, app answered
anonymous            /robots.txt          200
anonymous            /                    429   (the page challenge still stands)
anonymous            app.aglyn.com/       429
```

The console 404 is the useful one: a bogus media id reaching the app and being
refused *there* proves the challenge was bypassed and the routing was not.

### A NEW public metadata path ships challenged (2026-09-03)

The **Crawler metadata bypass** matches **exact paths**. So does its docs-project
twin. That is the right default — it keeps the neighbouring `/api/*` namespace
challenged — and it has a consequence nobody remembers at the time: **any new
public SEO path is challenged from the moment it ships**, silently, with a 429
that no log of ours records.

AGL-2520 is the case that proved it. `/sitemap.xml` became a sitemap *index*
naming child sitemaps at `/sitemaps/{section}/{page}.xml`, one per section of
the site and one per content collection. `/sitemap.xml` itself was bypassed;
every child it named was not. The index would have parsed perfectly and led
every crawler to a wall.

Fixed by adding a **sixth condition group** to the existing rule — a prefix, not
an exact path, because the set is a function of the customer's own collections
and cannot be enumerated:

```json
{ "conditions": [{ "type": "path", "op": "pre", "value": "/sitemaps/" }] }
```

`/sitemaps/*` is served by the sitemap route alone, is public, read-only and
secrets-free, and answers an empty `<urlset>` for a section that does not exist,
so the namespace is safe to open wholesale.

Measured 2026-09-03, both directions, Googlebot User-Agent against `aglyn.com`:

```text
Googlebot  /sitemaps/pages/1.xml    404  no x-vercel-mitigated  (app answered)
Googlebot  /sitemap.xml             200  no x-vercel-mitigated
Googlebot  /a-random-path…          429  challenge              (protection intact)
```

The 404 is the useful one, for the same reason the console's is above: the route
was not deployed yet, so the app itself refused it — which proves the challenge
was bypassed and nothing else changed. The 429 on the third line is what proves
the bypass is still scoped.

**The check could not catch this class, and now can.** The declaration was
originally `alsoAllowsGroups` — a *permitted* shape — so a declared-but-absent
alternate was not a finding: the repo was green, the drift job was green, and
the feature was dead to crawlers. Since 2026-09-03 the checker asserts
**coverage** as well as scope (below), the field is named `alsoRequiresGroups`,
and a group the table declares but the live rule lacks is a failure that names
the missing path. **Still PATCH the live rule in the same change** — the check
tells you that you forgot, it does not do it for you.

**The general lesson, restated:** the marketing site's own pages are not the
only thing a challenge hides. Enumerate what fetches your **metadata** and your
**assets**, not just your HTML — crawlers, mailbox image proxies, feed readers
and install prompts are all non-browsers, and each one fails silently.

### A DOCUMENTED endpoint ships challenged too (2026-09-10)

The section above is about metadata a crawler discovers on its own. This is the
same failure one step further out: an endpoint we **published a contract for**.

`/openapi.json` went on the crawler allowlist with AGL-2716, so any agent could
read the tenant's API description. Neither endpoint that description names was
on it. Measured on `aglyn.com` with the default curl User-Agent:

```text
curl  /openapi.json   200  application/json
curl  /api/host       429  challenge
curl  /api/screen     429  challenge
```

A document that can be read but not acted on is worse than no document: it
spends the caller's trust and then refuses them. An agent-readiness audit read
it exactly that way — it found the `RateLimit-*` headers declared in the spec,
could not observe one on a live response, and reported the API as
authentication-gated. It is not gated. It was unreachable, and the RFC 9331
headers `publicReadApiGate` has emitted since AGL-2722 had never once been
observable from outside.

Fixed with a rule of its own rather than two more entries on the crawler
allowlist, because the justification differs: these two carry their own
limiter. `publicReadApiGate` meters every address at 600/minute and answers 429
with `RateLimit-*` and `Retry-After`, so removing the challenge does not remove
the ceiling — it replaces an unanswerable JavaScript challenge with a limit a
caller can read and pace against, which is the whole reason those headers are
published.

**Exact paths, not a prefix.** `/api/screen/nodes` and `/api/screen/not-found`
sit directly under the same namespace, are internal to the render, and must
stay challenged.

Measured after the PATCH, default curl User-Agent:

```text
curl  /api/host               200  ratelimit-limit: 600  ratelimit-remaining: 599
curl  /api/screen             200  ratelimit-limit: 600  ratelimit-remaining: 598
curl  /api/screen/nodes       429  challenge   (scope held)
curl  /api/screen/not-found   429  challenge   (scope held)
curl  /                       429  challenge   (page protection intact)
```

**This class now has a guard.** `npm run check:agent-readiness` reads the
`paths` of the tenant's OpenAPI document and asserts that every concrete one is
admitted by a declared bypass whose conditions are **all** path conditions — a
rule gated on a shared secret, or on a User-Agent, does not admit a stranger
and must not be counted as though it did. Templated paths are skipped and
`/search` is declared a human-facing page, both with their reasons in the
source. Nothing touches the network: it compares two files, exactly as the
check's first half compares `robots.txt` against the WAF.

The lesson the two cases share is the uncomfortable one. AGL-2727 fixed this
same defect on the console's `/api/v1` a day earlier, by hand, and nothing
looked at the tenant. A fix applied by hand to one surface is not a fix for the
class — the guard is.

### The media CDN rate limit (AGL-2812)

`/api/media/cdn` skips the bot challenge on both mounts, and that bypass stays:
link-preview crawlers and Gmail's image proxy cannot solve a challenge. The
per-caller limit inside `serveMediaCdn` bounds what one address is **served**,
but it runs in the function, so every refusal is still an invocation and a
Firestore transaction, and a cache-busted flood is nothing but misses.
`Media CDN per-IP rate limit` counts the same path at the edge, before any
function runs. It went in on 2026-10-01 on `aglyn-tenant` and `aglyn-console`:

| | |
| --- | --- |
| scope | `path pre /api/media/cdn`, the bypass's own scope |
| count | fixed window, **1,500 requests per 60 s per IP** |
| past the limit | **`rate_limit`**: a 429 the caller can back off from (enforcing since 2026-10-01; `log` before that) |
| position | directly **ahead of** `Public asset delivery bypass` |

**Position is the whole rule.** A request matching a custom bypass "is allowed
through any custom or managed rules", so a rate limit behind the bypass it
shares a path with counts nothing, while reading back present, active and
valid. `rules.insert` appends, so the rule was inserted and then moved with
`PATCH rules.priority` (its id, and the bypass's 0-based index). Under the
limit, and in log mode past it, evaluation continues into the bypass, so the
challenge stays lifted for every caller the limit admits. The checker asserts
the position, and fails a rate limit found behind its bypass.

**The number** is set against the full request stream, edge hits and 304s
included, because the firewall runs in front of the cache. Measured
2026-10-01:

| measured | requests a minute |
| --- | ---: |
| the heaviest public page (61 images, all `srcset`), scrolled end to end | 58 |
| the same page with every `srcset` width fetched for every image | 244 |
| tenant mount, busiest minute, every caller together, 7 days (4,991 requests) | 66 |
| tenant mount, busiest single client | 53 |
| console mount, busiest minute, every caller together, 23 hours | 7 |
| whole route, busiest minute on 2026-09-11 | 236 |

1,500 is 25 times the heavy page and more than six times anything the route has
been measured serving to every caller at once. It is also above the 780 a minute
the function serves one address (600 images, 180 other files), so the edge
never refuses a caller the function would still have served. A video is not a
burst here: the route answers a player's `bytes=0-` with the whole file, so a
play is one request and each seek one more; no asset took more than 5 requests
from one client in a minute.

**Verified the day it went in**, and the second result is the one to remember:

```text
anonymous  /api/media/cdn/…      200   the bypass still lifts the challenge
anonymous  /                     429   the page challenge still stands
burst      1,650 in 9 s          200 × 1,650, logged NOWHERE
burst      3,300 in 11 s         200 × 3,300, logged NOWHERE
probe      limit 10, enforcing   1–10 reached the app, 11–30 → 429, x-vercel-mitigated: deny
```

⛔ **In log mode this rule is invisible.** Vercel reports a log "if no other
rule matches and acts on the request", and the bypass directly behind it acts
on every request, so a past-the-limit log is reported as a bypass and dropped.
Both bursts show in the request logs as `wafAction: bypass` with the asset
bypass's rule id, and the dashboard's **Logged** count stayed at zero. The probe
is what proves the rule works where it sits: a temporary enforcing rule in the
same position, scoped to one nonexistent path **and** one test User-Agent, was
counted and enforced exactly at its limit, then removed, leaving the config
deep-equal to what it was.

So **a quiet Logged count proves nothing here.** Judge false positives from
traffic instead: Firewall → Traffic, narrowed to `/api/media/cdn`, **Top IPs**.
An address can only cross 1,500 in some minute if it sent at least 1,500 in the
whole window, so a window in which no address reaches 1,500 is a window the
limit would have refused nobody in. The two test bursts above, under the
User-Agent `aglyn-agl2812-burst-check/1.0`, are in the 2026-10-01 data and are
not visitors.

**Switching it to enforce** is one `PATCH rules.update` per project that
changes only `rateLimit.action` from `log` to `rate_limit` (a 429), plus
`exceeded: 'rate_limit'` in the posture table in the same change. Until both
move together, `check:firewall-posture` reports the difference. Never
`challenge` or `deny` past this limit: the callers this path serves without a
browser can answer neither.

**Enforcing since 2026-10-01** (tenant firewall config v32, console v23). The
window it was judged on: Firewall → Traffic over the past day showed no address
but the burst test's (`74.244.49.138`, the two bursts above) at 1,500 requests
or more in the WHOLE day on either project, across every path, so none can have
crossed 1,500 in a minute on this one. Read back after the change: only this
rule's `rateLimit.action` differed; every other rule, the managed rulesets and
the IP rules were identical, and an anonymous media URL still answered 200.

What it does not bound: the bytes in one request, a caller spread across many
addresses, and an org's total delivery. The function folds an IPv6 address to
its /64; Vercel does not document whether its `ip` key does, so a caller
rotating addresses inside one /64 is bounded by the function, not by this rule. Signed or referrer-checked URLs and a
per-org byte cap wait on the delivery-platform decision (AGL-2824, AGL-2825).

## Guarding the guard

`npm run test:firewall-posture` runs 81 cases, each damaging exactly one thing
in a known-good config and asserting the **specific** finding — not merely that
the result is false. A test that only checks `ok === false` passes just as
happily when the detector has collapsed into `return false`.

To exercise the checker end to end against a doctored config **without touching
the real firewall**, hand it a fixture:

```bash
npm run check:firewall-posture -- --fixture=/tmp/doctored.json
```

The fixture is `{ "<project>": <config> | null }`, with `null` modeling "no
config exists". Every project in the table must have an entry, so a fixture
cannot silently skip one.
