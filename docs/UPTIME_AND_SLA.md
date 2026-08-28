# Uptime, health checks and the SLA

Enterprise order forms promise an SLA (AGL-1102). This is what exists to back
it, and — more importantly — what does not yet.

## Where this stands

**There is no uptime commitment, and there should not be one yet.** Before this
work there was no health endpoint, no probe and no history, so any percentage
would have been a number nobody could check. The plumbing is here; the
commitment is deliberately deferred to **AGL-1148**, gated on real data.

If someone needs a figure for a deal before then, the honest answer is that we
measure availability and will commit to a number once there is a quarter of it
— not a percentage invented to close the deal.

## Health endpoints

```
GET  https://app.aglyn.com/api/health          console
GET  https://demo.aglyn.app/api/health         tenant runtime
GET  https://app.aglyn.com/api/health/backups  Firestore backup state (AGL-1490)
GET  https://app.aglyn.com/api/health/signups  org-creation volume (AGL-1536)
GET  https://app.aglyn.com/api/health/rate-limits
                                               rate-limiter fallbacks (AGL-1693)
GET  https://app.aglyn.com/api/health/billing  Stripe webhook delivery (AGL-1924)
GET  https://app.aglyn.com/api/health/error-beacon
                                               console beacon liveness (AGL-1923)
GET  https://aglyn.com/api/health/error-beacon tenant beacon liveness (AGL-1923)
GET  https://app.aglyn.com/api/health/crons    scheduled-job liveness (AGL-1955)
GET  https://app.aglyn.com/api/health/server-errors
                                               uncaught server-error RATE, both
                                               deployments (AGL-1921)
GET  https://aglyn.com/api/health/render/marketing
                                               marketing home RENDERS (AGL-2486)
GET  https://demo.aglyn.app/api/health/render/site
                                               a tenant site RENDERS (AGL-2486)
HEAD <any>                                     the SAME probe and status as GET
```

:::caution `HEAD` is not a liveness shortcut any more
It used to return a hardcoded `200` and "touch nothing", which made every one
of these a check that **could not go red** for the monitors most likely to use
it. `healthHeadOf(GET)` now runs the same probe and returns the same status
and headers, minus the body; the per-route memo is what keeps that cheap.
:::

```json
{
  "status": "ok",
  "service": "console",
  "checks": { "firestore": { "ok": true, "ms": 105 } },
  "commit": "b04842011",
  "environment": "production",
  "region": "iad1",
  "at": "2026-08-02T22:40:43.593Z"
}
```

**The status code is the contract.** `200` when healthy, `503` when any check
fails. Most uptime monitors read nothing else, so a degraded dependency must
not be a `200` whose body says "degraded" — a body nobody parses is not a
signal.

Three properties these have to keep, each a way health checks routinely lie:

| Property | Why |
| --- | --- |
| Never cached | A cached check returns `200` from the edge while the origin is on fire, and the graph stays green through the outage. `force-dynamic` plus `no-store`. |
| Checks a dependency | "The function booted" is a fact Vercel already knows. Firestore is what actually takes us down, so that is what gets touched. |
| Bounded cost | Public and unauthenticated, so an unthrottled dependency check is a free amplifier. The probe result is memoised for 15s per instance. |

The probe reads a document that deliberately does not exist. A missing document
is a *successful* read: it proves credentials, network and the API all work,
needs no fixture, and returns almost nothing.

:::warning Reserved document ids
The probe id must **not** match `__.*__`. Firestore reserves that pattern, and
a read of one fails with `INVALID_ARGUMENT` before rules are ever consulted.
This is not theoretical: `probe-public-read.ts` used `__console-health-probe__`
and had therefore never worked — the diagnostic built to tell an App Check
rejection apart from a rules denial was reporting "likely offline" every time.
Found only by running the same pattern here and getting a 503 out of a healthy
database. A leading **or** trailing double underscore alone is fine; it is the
pair that is reserved.
:::

## The status pages — there are TWO, and they are not redundant

| | Where | Job |
| --- | --- | --- |
| **https://docs.aglyn.com/status** | `aglyn-docs`, our Vercel | the branded page: live per-service detail, read from the visitor's own browser |
| **https://stats.uptimerobot.com/7NGEl81zvD** | UptimeRobot, off our infrastructure | the always-up fallback: the only surface that can speak during a Vercel-wide or DNS outage |

:::danger Neither one is "the" status page, and knowing which fails when is the point
`aglyn-docs` is a separate Vercel **project** from the console and the tenant
runtime, so a Firestore outage or a broken console deploy leaves the docs page
up and reporting the failure — which is the whole job. But separate project is
not separate **platform**, and `docs.aglyn.com` is not a separate **DNS zone**:

| Failure | `docs.aglyn.com/status` | UptimeRobot page |
| --- | --- | --- |
| Firestore outage | survives, reports it | survives |
| console/tenant build broken | survives, reports it | survives |
| Vercel platform or region outage | **dies with them** | survives |
| `aglyn.com` nameserver failure | **dies** | survives |

So the Aglyn-hosted page's job is branding, detail and **linking to the other
one** — not being the source of truth during an outage. A status page hosted on
the infrastructure it reports on is theatre; this one is honest only because
there is somewhere else to go when it is gone.
:::

### What `docs.aglyn.com/status` actually checks

Nothing, unless `DOCS_STATUS_TARGETS` is set on the `aglyn-docs` Vercel
project — and for weeks it was set on no scope at all, so the page shipped
reading *"not configured to check any services"* while `/pricing` pointed
customers at it (AGL-2411 found it, AGL-2496 fixed it). Set 2026-08-24, first to
five targets, then narrowed to three, then widened to **six** on the call the
same evening:

| Card | Origin | Path | Asserts |
| --- | --- | --- | --- |
| Console | `app.aglyn.com` | `/api/health` | Firestore reachable from the console runtime |
| Published sites | `aglyn.com` | `/api/health/render/site` | a real tenant page server-renders to a non-empty node tree |
| Site delivery | `aglyn.com` | `/api/health` | Firestore reachable from the tenant runtime |
| Marketing site | `aglyn.com` | `/api/health/render/marketing` | the same render check, for `cname--aglyn.com` |
| Billing | `app.aglyn.com` | `/api/health/billing` | the Stripe webhook destination is enabled and deliveries are landing |
| Scheduled jobs | `app.aglyn.com` | `/api/health/crons` | every cron job stamped its beat inside its own schedule + grace |

**Six, and the page's explainer is what makes six legal.** The middle state of
that history is the lesson: a first cut added Billing and Scheduled jobs while
the shipped explainer still told the reader that *"internal subsystems —
scheduled jobs, backups, billing and abuse controls — … are not shown here"*, so
the page contradicted itself and was narrowed back to three. **The env var must
not out-promise the page, and the page must not out-promise the env var.** The
explainer now names billing and scheduled jobs as shown, says plainly that
neither is part of serving, and disclaims only what is genuinely absent —
backups, abuse controls, the error beacon.

**Why `Site delivery` and `Published sites` are both cards, and are not
duplicates.** The render canary resolves ONE subject site (`demo`) internally.
If that single workspace's content breaks, `render/site` goes red and would
otherwise tell every customer that published sites are down. The plain tenant
liveness card is the disambiguator: both red is a platform event, `sites` red
and `delivery` green is our sample page, not their site.

:::caution Five things that will bite whoever edits this value
1. **The grammar is `name|label|origin|description|path`, comma-separated.** A
   comma **in a description** does more than truncate the description: every
   field after it shifts, so the entry loses its `path` and silently falls back
   to `/api/health` — the card then probes the wrong endpoint and reads green.
   Measured, not assumed: `…|Payments, invoices and subscription updates|/api/health/billing`
   parses to `desc="Payments"`, `path="/api/health"`. Parse a candidate value
   through `parseTargets` from `apps/docs/src/status-model.ts` before setting
   it, and assert the **probe URLs**, not just the card count.
2. **Docusaurus bakes it at BUILD time** into `customFields`. Setting the
   variable without redeploying `aglyn-docs` changes nothing.
3. **Unset must keep meaning OFF, never ours** (AGL-2124). Do not "fix" a
   self-hoster's blank page with an Aglyn default; their build would print our
   uptime as theirs during their outage.
4. **`backups` must not become a card.** It LATCHES by design — degraded until
   a bad restore point is gone, because a missing backup is a condition rather
   than an event — and it spent four and a half days red while backups were
   healthy (AGL-1843, still open). A customer-facing page that reds for that is
   one customers learn to scroll past.
5. `signups`, `rate-limits` and `error-beacon` are deliberately **not** cards
   either. `rate-limits` fails soft, so a degraded window changed nothing a
   customer could see — and publishing it announces when our abuse controls
   were weakest. `signups` degraded means we suspect a signup farm. The error
   beacon watches our own telemetry: if it is dead we are blind and the
   customer's site is fine.
6. **`server-errors` is the one genuinely arguable case** (AGL-1921), and the
   argument is not settled here. FOR: unlike every entry in 4 and 5, a spike is
   customer-visible by definition — it counts requests that returned a 500 to
   somebody. AGAINST: it aggregates BOTH deployments, so a console-only spike
   would red a card customers read as "my published site is down", which
   overstates it. If it becomes a card, split the verdict by
   `checks.serverErrors.byService` first so the page can say WHICH. Until then
   it is watched by the probe and the external monitor, which page us without
   telling a customer their site is broken when it is not.
:::

`DOCS_STATUS_FALLBACK_URL` is the second variable this page reads. It prints
the "if this page will not load, check the independent monitor" paragraph with
the URL spelled out in full — the one link here written to be useful from a
screenshot or a cached copy, because the moment it is needed is the moment this
page will not render. Same rule as everything else: **unset prints nothing**, so
a self-hosted build never tells an operator's customers that Aglyn is up while
their own platform is down.

Verify it from a browser, not curl — `aglyn-docs` runs Bot Protection at
Challenge and answers an anonymous `curl` with **429**. The page stamps
`data-status-overall` on the summary and `data-status-target` /
`data-status-verdict` on each card, so the assertion is a DOM read, and a page
carrying **zero** `data-status-target` nodes is the unconfigured failure above.

### The external monitors (UptimeRobot, free tier)

**Ten** keyword monitors, keyword `"status":"ok"`, `ALERT_NOT_EXISTS`, 5-minute
interval, email to the operator's mailbox. Read from the status page's own monitor-list
API on 2026-08-24 rather than transcribed from memory — this list said *five*
for most of that day, because five more were created after it was written:

| Monitor | Created (UTC) |
| --- | --- |
| Console | 08:10 |
| Marketing site | 08:11 |
| Published sites | 08:13 |
| Billing | 08:14 |
| Scheduled jobs | 08:16 |
| Tenant runtime | 09:10 |
| Backups | 09:12 |
| Signups | 09:31 |
| Rate limiting | 09:32 |
| Error beacon (console) | 09:33 |

```bash
# The count and the names, unauthenticated. `url` is null in this payload —
# the public API exposes the NAME and not the target, so a name is the only
# thing anything can assert on. Name new monitors accordingly.
curl -s https://stats.uptimerobot.com/api/getMonitorList/7NGEl81zvD |
  node -e 'const j=JSON.parse(require("fs").readFileSync(0));
    console.log(j.psp.totalMonitors); for (const m of j.psp.monitors) console.log(m.name)'
```

✅ **`server-errors` now has a monitor.** Uptime check
`server-errors-app-aglyn-com-api-health-server-errors-status-ok-u6GLENjkYKg`
(900s, three regions, `$.status == "ok"`, `validateSsl: true`) and policy
`alertPolicies/16393806930883434684` on the one channel. Before this the
endpoint was live and graded, the 15-minute GitHub probe read it, and nothing
emailed anyone when it went red — the GitHub probe only records.

🔴 **The one gap that matters now is the notification channel itself.** See
[The channel is unverified](#the-channel-is-unverified) below. Every policy
counted in this document points at it.

⚠️ **The monitor set and the card set are still not identical**, in both
directions now. `Site delivery` (`aglyn.com/api/health`) is a card with no
monitor — though `Tenant runtime` may already be it, and the public API cannot
say, because it returns `url: null`. Confirm from the UptimeRobot dashboard
before creating a duplicate. 40 free slots remain either way. Do not close the
gap the other way by dropping the card — the card is what tells a reader that a
red `Published sites` is our sample workspace rather than their site.

⚠️ **`Backups` will page for days at a time, by design.** That check LATCHES —
degraded until a bad restore point ages out — and it has already sat red for
four and a half days while backups were healthy (AGL-1843, still open). It is
correctly *not* a status-page card for that reason; it is now an emailing
monitor, which is the same fatigue risk pointed at whoever is on call. Tune or
mute it there, not by weakening the check.

**Keyword and not plain HTTP, deliberately.** A plain HTTP monitor passes a 200
whose body says `"status":"degraded"`, which is precisely the shape of the
fifty-one-hour false green this file records further down. Do not "simplify" one
of these back to an HTTP check.

Free-tier facts, so nobody re-litigates them: **50 monitors** (ten used),
5-minute floor, keyword/ping/port/DNS/heartbeat all free, **one public status
page free** at `stats.uptimerobot.com/<id>`. Paid: custom domain (Solo,
$144/yr — this is what `status.aglyn.com` on UptimeRobot would cost), branding
removal (Team, $468/yr), Slack (Solo), webhooks (Team), SSL-expiry monitoring.
The REST API is on every plan at 10 req/min, and the status page's own
`stats.uptimerobot.com/api/getMonitorList/<id>` is unauthenticated and sends
`Access-Control-Allow-Origin: *` — so a browser page can read live monitor state
with **no key and no env var**. It is undocumented; treat an unreadable answer
as unknown, never as green.

:::warning Its "100.000%" is not an uptime figure, and must never be quoted as one
The UptimeRobot page prints an availability percentage. The monitors were
created 2026-08-24, so that number is measured over hours, and its own
`dailyRatios` are `0.000`/no-data for every earlier day. **This file's whole
position is that we do not publish a number we cannot measure over time**
(AGL-1148), and `/pricing` was already selling an SLA that does not exist
(AGL-2411 F2). Linking the two pages is fine; letting a sales conversation
quote that percentage is the exact failure both issues are about. The status
page's link says so in its own copy — it calls it a second opinion on
reachability, "not a service level we have committed to".

⚠️ The monitor **names** carry the health-route paths (`Keyword on
app.aglyn.com/api/health/billing`), and a free-tier status page cannot be
`noindex`ed. Those endpoints are public and unauthenticated by design, so this
is disclosure rather than exposure — but renaming the monitors to the card
labels costs nothing and reads better to a customer.
:::

### How the docs page reads, and what it refuses to say

It reads the health endpoints **live from the visitor's browser**, which is why
those endpoints send `Access-Control-Allow-Origin: *`. Without it the browser
blocks the read and every service renders as unreachable on a perfectly healthy
day. The body is already public and carries no secrets, so opening it costs
nothing.

It deliberately shows **no uptime percentage and no history** — nothing stores
samples yet, and inventing "99.9%" from one successful fetch is how a status
page loses its credibility. It also says "unreachable from your browser" rather
than "down", because from a browser a real outage, a DNS failure and a local
network problem are indistinguishable.

`operational` is reachable from exactly one shape: HTTP 200 carrying our own
`{"status":"ok"}`. Everything else — a 5xx, a 200 whose body claims `degraded`,
a bot-protection interstitial, a redirect, an unparseable body, a timeout —
lands in `degraded` or `unknown`, never in green. Each of those branches has
been driven against the real page in a browser and watched to paint the right
colour (AGL-2496); the rules themselves are pure functions in
`apps/docs/src/status-model.ts` with a spec beside them.

### `status.aglyn.com`

Unclaimed today: it resolves through the `*.aglyn.com` wildcard to Vercel and
answers `404 DEPLOYMENT_NOT_FOUND`. **When it is claimed, point it at
`aglyn-docs` and serve `/status` — not at a besigner screen on the marketing
site.** A marketing screen cannot probe anything live, cannot tell `unknown`
from `down`, and would put the status page on `aglyn-tenant`, the runtime it is
supposed to report on. Pointing it at UptimeRobot instead is the $144/yr option
above.

The footer of every marketing page already links `docs.aglyn.com/status`, so
this is about giving the existing surface a memorable name, not about building
a second one. **Two surfaces competing to be "the status page" is the failure
mode to avoid** — whichever way this is done, one URL must end up serving the
other.

**Exact steps (account owner — this is a domain change, not an agent action):**

1. Vercel → `aglyn-docs` → Settings → Domains → **Add** `status.aglyn.com`.
   The apex is already on Vercel DNS, so no registrar work is needed and the
   certificate issues automatically.
2. Choose **redirect**, not rewrite: set the domain's redirect target to
   `docs.aglyn.com` (Vercel offers this in the same dialog). A visitor typing
   `status.aglyn.com` lands on the real page at its canonical URL, and there is
   exactly one indexable copy.
3. Add `{ "source": "/", "destination": "/status", "permanent": false }` to
   `apps/docs/vercel.json`'s `redirects` **only if** step 2's redirect lands on
   `/` rather than `/status` — check before adding, since a redirect chain is
   worse than either link alone.
4. Verify from a **browser**, not curl (`aglyn-docs` challenges anonymous
   clients with 429): `status.aglyn.com` must end on the status page with
   cards rendered, and `docs.aglyn.com/status` must still work unchanged.

A rewrite (serving the page at `status.aglyn.com` without changing the URL) is
the tempting option and the wrong one here: it produces two live copies of the
same page, and every footer link, the `/pricing` FAQ and AGL-2411 F2 all name
`docs.aglyn.com/status`.

## The probe

```bash
node tools/scripts/probe-uptime.mjs                        # production defaults
node tools/scripts/probe-uptime.mjs http://localhost:4200  # anything else
```

Exits non-zero if any target is down. `.github/workflows/uptime-probe.yml`
runs it every 15 minutes on GitHub's runners — not our infrastructure, which is
the only part that makes it a real probe. A monitor hosted on the thing it
monitors cannot observe its own outage.

It refuses to follow redirects. A base URL that `3xx`es to the real host would
otherwise report the redirect target's health under the wrong name, and
pointing a job at a redirecting hostname is a mistake already made once here —
`CONSOLE_BASE_URL` kept pointing at `aglyn.io` after the domain move and every
scheduled cron failed for a week (AGL-786).

It also fails a target whose response is **cacheable**, even if that response
says `ok`. A health check that can be cached has stopped being a health check.

### What this is not

GitHub's scheduled runs are best-effort: they can be delayed, skipped under
load, and stop entirely if the repository goes quiet for 60 days.

**A gap in the history is not evidence of an outage, and an unbroken green
history is not evidence of 100% uptime.** Do not quote it as one. It exists so
the endpoints are exercised continuously from outside the deploy, and so there
is something concrete to point a paid external monitor at when one is chosen.

## Production monitoring and alerting (AGL-1502, 2026-08-13)

The external monitor AGL-1148 called for. Lives in **GCP Cloud Monitoring on
`aglyn-main`** — already paid for (free tier: 1M uptime-check executions/month;
current usage ≈ 300k), alerting built in, and not hosted on anything it
monitors. **Every alert emails one mailbox** — notification channel
`7043898327231541746`, the only one configured on the project.

Console: https://console.cloud.google.com/monitoring/uptime?project=aglyn-main

### What is watched

| Check | Target | Asserts | Interval |
| --- | --- | --- | --- |
| `console-health` | `app.aglyn.com/api/health` | HTTP 2xx **and** `$.status == "ok"` | 5 min |
| `console-imaging` | `app.aglyn.com/api/health` | `$.imaging.ok == true` | 15 min |
| `tenant-health` | `aglyn.com/api/health` | HTTP 2xx **and** `$.status == "ok"` | 5 min |
| `marketing-home` | `aglyn.com/` → **repoint to** `/api/health/render/marketing` | 2xx and body contains `Aglyn` → `$.status == "ok"` | 5 min |
| `customer-site` | `demo.aglyn.app/` → **repoint to** `/api/health/render/site` | 2xx and body contains `Aglyn Demo` → `$.status == "ok"` | 5 min |
| `backup-state` | `app.aglyn.com/api/health/backups` | HTTP 2xx and `$.status == "ok"` | 15 min |
| `signup-volume` | `app.aglyn.com/api/health/signups` | HTTP 2xx and `$.status == "ok"` | 5 min |
| `rate-limiter` | `app.aglyn.com/api/health/rate-limits` | HTTP 2xx and `$.status == "ok"` | 5 min |
| `billing-webhook` | `app.aglyn.com/api/health/billing` | HTTP 2xx and `$.status == "ok"` | 5 min |
| `beacon-heartbeat console` | `app.aglyn.com/api/health/error-beacon` | HTTP 2xx and `$.status == "ok"` | 15 min |
| `beacon-heartbeat tenant` | `aglyn.com/api/health/error-beacon` | HTTP 2xx and `$.status == "ok"` | 15 min |
| `scheduled-jobs` | `app.aglyn.com/api/health/crons` | HTTP 2xx and `$.status == "ok"` | 15 min |
| Cloud Functions | `execution_count{status != ok}` | > 2 failures in 5 min | metric |
| Cloud Scheduler | job attempt logged at `severity >= ERROR` | any | log match |

:::danger Read this table with two corrections
**Four of these checks have been at 0% since 2026-08-21** — every one of them
on a host our own bot protection challenges. See
[Four of these checks have been red](#four-checks-red).
**`scheduled-jobs` has never been created at all**, and it is the check that
would have caught the fifty-one-hour cron outage. See
[Creating the missing check](#creating-the-missing-scheduled-jobs-check).
A table of what is *meant* to be watched is not a list of what *is*; verify it
with [the read-only commands below](#verifying-the-monitor-yourself) before
quoting it.
:::

Notes that keep these honest:

- `rate-limiter`'s check and policy were created 2026-08-17 (`rate-limits
  health check failing (AGL-1717)`), closing the gap this note used to
  describe. The forced-failure lever still exists and is still the way to
  re-prove the path end to end: `RATE_LIMIT_ALARM_MAX_CALLS=-1` in the
  console's Vercel env → every probe reports degraded → expect the email →
  unset.
- `console-imaging` exists because `imaging.ok` is **deliberately body-only** —
  variant encoding being down is degraded, not an outage, so it must not 503
  the main check. A status-code monitor is blind to it; this check reads the
  body with a JSONPath matcher. That failure mode was real: three weeks of no
  WebP variants, discovered by archaeology (AGL-1468).
- `backup-state` closes AGL-1490's alert gap: 503 when the **newest** backup is
  unusable, none is READY, or the newest READY is older than 8 days. The
  probe's verdict logic is `backupsHealth` in `health-report.ts`, spec-covered.
  **"Newest" is load-bearing, and it was learned the hard way.** The rule was
  originally "any non-READY backup fails", and that made the check incapable of
  ever reporting green: managed Firestore backups flip `READY` →
  `NOT_AVAILABLE` at ~7 days while their `expireTime` sits ~90 days out, so a
  working weekly schedule always shows a pile of aged-out backups beside
  exactly one READY one. It went red on 2026-08-13 and stayed red for four and
  a half days — 210 consecutive windows, 6/6 probe regions — while the backups
  were entirely healthy (AGL-1843). An aged-out backup behind a good one is how
  a managed backup *ends*, not a failure; what reproduces AGL-1490 is a newest
  run that produced nothing usable, so that is what is measured.

  **Second pass (2026-08-24, AGL-1843): the check now has THREE states, not
  two.** Everything it could not establish — a transient upstream error, a
  partial listing (`ListBackupsResponse.unreachable`), a run that had not
  finished — used to collapse into `backup-failed`, the loudest thing it can
  say, and in every one of those cases it was false. Indeterminate now answers
  **200** with `determinate: false` and its own code (`backups-unreadable`,
  `backups-partial`, `backups-not-ready-yet`). Three things bound that so it
  is not fail-open: it is only tolerated while a backup younger than 8 days
  exists, it never overrides a stale READY backup, and PERMANENT upstream
  refusals (missing credential, 401/403/404) stay hard red so a revoked
  `roles/datastore.backupsViewer` cannot silently retire the check. The same
  pass also stopped reading `NOT_AVAILABLE` as damage at all: it is documented
  as "not available **at this moment**", and the same backup ids were measured
  flipping in BOTH directions (`3b5238df` and `eb4d21e3` were both
  `NOT_AVAILABLE` on 2026-08-17 and both `READY` on 2026-08-24). What goes red
  is the fact that actually matters — no restore point inside the age budget.
  Since AGL-1843 the same endpoint carries a SECOND, separately-labeled check —
  `exports` — watching the weekly Firestore GCS export
  (`gs://aglyn-main-firestore-exports`, cron in `scheduled-crons.yml`): 503
  when no completed export exists or the newest is older than 8 days
  (`exportsHealth`, also spec-covered). Separate checks on purpose: the body
  says WHICH recovery layer is degraded — `checks.backups` is Google's
  managed backups, `checks.exports` is our own portable copy — instead of
  blending two very different failures into one verdict.
- `signup-volume` is the AGL-1536 wave alarm — the detection layer over the
  AGL-1534 rate limit. The endpoint 503s when more than 10 orgs were created
  in the trailing hour (one maxed-out IP under the AGL-1534 cap can produce
  exactly 10, so 11+ means multiple addresses — the shape the limiter cannot
  see; baseline today is ~0/h against 4 orgs total). **When it fires:** open
  the console org list and look at what arrived; a launch-day rush of real
  people is good news, a wall of gibberish names is a wave — pull the
  `signups` feature lock from the staff console (runbook:
  `apps/docs/docs/staff-console/lockdown.md`), which refuses sessions to
  accounts created after the lock while every existing account signs in
  untouched. A pure log-based metric was the lighter design, but Vercel Hobby
  stdout never reaches GCP Logging (see the honest-gaps list), so the count
  is read from the `orgs` collection itself — which also means a creation
  path that skips any log line still moves the alarm.
- `rate-limiter` is the AGL-1693 listener for AGL-1679's degradation markers.
  `consumeRateLimit` fails **soft** — a Firestore blip drops every durable
  limiter (sign-in, passkeys, password reset, email verification, org create,
  form submit, page-protection unlock, the public REST API's per-key quota) to
  a per-instance cap. AGL-1679 made that findable by writing one marker on
  recovery; nothing read it, so a degraded window would still have passed
  unnoticed in real time. The endpoint 503s when any fallback happened in the
  **trailing 30 minutes**. **When it fires:** the limiters were wider than
  advertised for a window, in the direction of allowing MORE — check Firestore
  health and GCP status first, then `docs/RATE_LIMITING.md` for what the
  fallback still enforced. Form submissions accepted during the window carry
  `rateDegraded: true` on the stored row (AGL-1667), which is how a billing
  spike gets correlated rather than guessed at.
- **The 30-minute window is the design, not a default.** Markers carry a
  30-day `expiresAt`, so a check that asked "does a marker exist" would sit red
  for a month after a thirty-second blip, and a permanently red check gets
  muted. `backup-state` is the nearer case, not the opposite one: it stays red
  while a *condition* persists — no usable restore point
  (`DISASTER_RECOVERY.md` gap 2) — where a degraded limiter window is an
  *event* that is already over. But it holds that licence only for a condition
  that can actually be cleared. Reading "red until the bad backup is gone"
  literally is what produced AGL-1843, because an aged-out `NOT_AVAILABLE`
  backup never goes away inside its 90-day retention: the condition was
  unclearable, so the check was permanently red, and the mute this very
  paragraph warns about is exactly what it was earning. **Before giving any
  check a persistent-condition licence, name the event that clears it.** The
  window's floor is set by this
  alert path, not by taste: 5 min probe memo + 5 min check period + ~10 min
  sustained-failure before the email means anything under ~20 minutes can go
  red and green again before anyone is told.
- `billing-webhook` is the AGL-1924 standing alarm over the one subsystem
  where silent failure costs money directly. **Stripe supplies the
  denominator, and it has to.** `stripeEvents` alone cannot answer this: the
  webhook returns 400 *before* claiming the idempotency document, so a
  rejected delivery writes nothing and an empty collection reads identically
  whether nothing happened or everything was refused. That is exactly how the
  2026-08-14 checklist tick came out green while AGL-1551 had the live
  endpoint 400ing 100% of deliveries behind an "Active" badge. The endpoint
  503s when Stripe holds no endpoint at
  `https://app.aglyn.com/api/billing/webhook` (`endpoint-missing` — nothing is
  even being attempted), when Stripe has disabled it (`endpoint-disabled`),
  when Stripe attempted and **failed** deliveries in the trailing hour
  (`deliveries-failing` — the AGL-1551 / AGL-1560 shape), when a REQUIRED
  event type has fallen off the destination (`events-unsubscribed` — the
  AGL-1798 shape, and the quietest of them: Stripe simply stops sending that
  one, so there is no failed delivery to count and every other number reads a
  perfectly healthy zero), when a delivery **landed, answered 200 and moved
  nothing** (`handlers-inert`, AGL-1954), when a delivery **only landed on a
  retry** (`deliveries-retried`, AGL-2039), when the separate **Connect**
  destination is absent, disabled or has lost `account.updated`
  (`connect-endpoint-missing` / `connect-endpoint-disabled` /
  `connect-events-unsubscribed`, AGL-2122 — a second destination sharing the
  same URL, told apart only by its `aglyn_scope=connect` metadata stamp,
  without which `syncConnectAccountStatus` never runs and a restricted
  merchant keeps selling on a stale `stripeChargesEnabled`), or when the
  census could not be taken at all (`stripe-unavailable`; unknown is never a
  pass).
  `deliveries-retried` is the arm that reconciles this check with the Stripe
  Dashboard. `delivery_success=false` is a **terminal-state** filter over
  EVENTS: an event that 400s three times and then succeeds on the fourth reads
  back clean, so it is zero in `undelivered`, present in `processed` and zero
  in `inert` — every number here describes a healthy hour while three real
  attempts failed. The Dashboard's denominator is delivery **attempts**, which
  is why AGL-1906 reported 0.00% over the same window the Dashboard showed 30%
  for and both figures were correct; the three attempts it could not see were
  AGL-1551's. The webhook now decides lateness at claim time — the distance
  from `event.created` to the claim written by the attempt that actually got
  through — and stamps `retriedAtMs` past 120 seconds, calibrated against a
  measured healthy band of 1.0–3.7s and the AGL-1551 event's 16,665s. Deciding
  it at write time is what keeps the probe a `.count()` aggregation rather
  than a document scan on a public endpoint. An absent, zero or non-numeric
  `created` stamps **nothing**: `strictNullChecks` is off repo-wide, so
  folding it to zero would read as a 56-year lag and red this check
  permanently on its own missing input.
  `handlers-inert` is the one that closes the last blind spot in this check:
  Stripe scores the status code, so a handler that drops the work silently
  keeps `delivery_success` true and `undelivered` at zero. The webhook now
  reports what it **committed** rather than that it ran — a write observed
  from inside the call that commits it, never a note beside one — and stamps
  `inert: true` on the event's own `stripeEvents` claim when a required event
  produced neither a committed effect nor a **named** deliberate skip. The
  naming is what keeps this off the ordinary traffic that correctly does
  nothing (a tenant shopper's subscription, a marketplace refund, a `won`
  dispute nobody claimed); conflating those with a silent drop would be alert
  fatigue, which is its own failure. **Residual gap:**
  `checkout.session.completed` is owned entirely by the plugins and is
  recorded as a deliberate skip — closing that half needs the plugin handlers
  to report `claimed` (the AGL-2429 mechanism exists but is wired only for
  `charge.dispute.*`).
  **It cannot page for lack of business:** the verdict never keys on the
  absence of events, so a quiet night scores zero failed deliveries and reads
  healthy for the right reason. Events emitted and events processed are
  carried in the body for whoever reads the incident and are deliberately not
  verdict inputs — no defensible floor exists for them until the beta produces
  a baseline. **Clearing event:** a trailing-hour window with an enabled
  endpoint and no failed deliveries; everything is a sliding window over live
  Stripe state, so nothing latches. `npm run audit:stripe-webhook` (AGL-1906)
  is the deeper point-in-time join to run once this fires, and it owns the
  subscribed-event-list assertion this check deliberately does not duplicate.
- `beacon-heartbeat` (console and tenant) is the AGL-1923 dead-man's switch,
  and it is the only condition in the project that watches for **silence**.
  Every other log-match policy here can report only the *presence* of an
  entry: the `Client error beacon` policy fires when a browser error appears,
  so if the beacon stops writing, that policy goes quiet — and quiet is the
  reading it also gives on a healthy day. That policy's filter excludes
  `localhost` and `127.0.0.1` in `jsonPayload.context.httpRequest.url`,
  because `/api/errors` on a developer's machine writes to the same production
  log through the same credential, and those reports outnumbered the deployed
  ones 219 to 17 over a week — 87 of the last 100 alert-violation events in
  the project. The exclusion is on the URL rather than on the absence of
  `serviceContext.version`, which separates the two just as cleanly today but
  fails the wrong way: a deployment that stopped stamping a commit ref would
  go silently unwatched, whereas a dev report with no URL merely stays noisy. **A dead beacon is
  indistinguishable from zero errors**, and all three failure paths in
  `reportClientErrors` end in a `console.warn` to a log that retains an hour
  and drains nowhere. The endpoint writes one INFO entry to the separate
  `client-error-beacon-heartbeat` log through the beacon's own credential and
  transport, and 503s when that write does not land: `no-credential`
  (the deployment's `FIREBASE_*` admin credential is missing or unparsable),
  `http-401`/`http-403` (the service account lost `logging.logEntries.create`),
  `http-429` (Logging quota), `transport-TimeoutError` (Logging unreachable
  within 4s). **Two deployments, two checks, deliberately** — `/api/errors`
  exists in both the console and the tenant runtime with different admin
  credentials, so a console heartbeat proves nothing about the tenant one.
  **Clearing event:** the next heartbeat write that reaches Cloud Logging;
  nothing latches, so recovery shows within one probe TTL (5 min) plus one
  check period (15 min). The heartbeat log id is *not* `client-errors` on
  purpose — writing there at `severity >= ERROR` would trip the existing
  policy on every probe, building the alert fatigue this exists to prevent.
- `scheduled-jobs` is the AGL-1955 half of the dead-man's switch, and it is
  the second condition here that watches for **silence**. The `Cloud
  Scheduler` row below it can only report the *presence* of a failed attempt:
  a job that is deleted, paused, or whose `- cron:` line was edited away
  produces no attempt, so it trips neither that policy nor
  `scheduled-crons.yml`'s non-200 check, and quiet reads exactly like healthy.
  **What is downstream of these jobs is metered billing, GDPR erasures, the
  audit archive and scheduled publishing** — a silently unscheduled job means
  customers are not billed, or data is not reaped, with every other row on
  this page green.
  Each job stamps `platformCronBeats/{jobId}` when it is invoked; the endpoint
  compares each mark against that job's own cron expression and 503s naming
  the ones that should have run and did not (`job-silent`), never ran at all
  since we started watching (`job-never-reported`), or whose marks it could
  not read (`beats-unavailable`). The inventory and verdict logic are
  `SCHEDULED_JOBS` / `cronJobsHealth` in `health-report.ts`, spec-covered
  branch by branch, and `scheduled-crons-wiring.spec.ts` fails the build when
  a schedule is deleted from the workflow without its inventory row.
  **Nothing on a schedule winds it** — the reader is the uptime probe and the
  staff Health page, so there is no cron here that could itself stop
  unnoticed, which is the AGL-1923 argument for a graded switch over a
  `conditionAbsent` policy.
  **It cannot page for a quiet week:** the mark is stamped by the INVOCATION,
  not by the work, and the expected time comes from the job's cron rather than
  a fixed interval — so `usage-email`, which runs hourly on the 1st and 2nd
  and not at all afterwards, reads green for the twenty-nine days it is
  deliberately idle. **Grace is a property of the RUNNER, and it is a floor
  rather than the exact bar** — the verdict compares the mark against the last
  fire already that old, so the phase of the clock against the schedule
  decides where the threshold lands. GitHub Actions rows carry 6h (daily) and
  24h (weekly) because GitHub delays scheduled workflows routinely and a row
  that reds on ordinary lateness is one people mute. The two Cloud Scheduler
  rows added by AGL-1617 carry **45 minutes on a 15-minute schedule — red
  between 45 and 60 minutes of silence, three missed fires** — because Cloud
  Scheduler does not drift. That tightening is the point of the move: the 90
  minutes they used to carry was GitHub's drift budget, bought with six
  missed sends of a feature `/product/marketing` sells.
  **Clearing event:** the next invocation of that job; nothing latches.
  **⚠️ A SINGLE PROBE OF THIS ENDPOINT PROVES NOTHING.** It memoises its
  Firestore read for five minutes **per lambda instance**, and a burst lands
  on many. During the 2026-08-24 incident 36 probes split cleanly — ~19
  instances holding a pre-beat memo at `age 103–105m / 503`, ~17 fresh at
  `age 1m / 200`. Either single answer, taken alone, would have been believed
  and been wrong. Burst, and read the spread.
  **⚠️ STILL OWED, AND IT HAS NOW COST SOMETHING.** The `scheduled-jobs` row
  in the table above has never been created in Monitoring. Verified against
  the live project on 2026-08-23: `gcloud monitoring uptime list-configs
  --project=aglyn-main` returns **eleven** checks and this is not one of them,
  and no alert policy names it either. The table listed it as watched while
  this note recorded it as owed, twelve paragraphs further down — and the
  table is what people read.
  **What that bought:** `/api/health/crons` answered 503 with
  `campaigns-process-scheduled: job-silent` for **fifty-one hours** and
  nothing said a word. The `Uptime probe` workflow was green every fifteen
  minutes throughout, because it read only `/api/health` — which aggregates
  exactly one check — and GCP was not reading this endpoint at all. Two
  independent gaps, and each one on its own was enough.
  The probe half is fixed (it now reads all seven subsystem endpoints, so a
  `job-silent` verdict fails a run every fifteen minutes). **The GCP half is
  a console action nobody has taken — see
  [Creating the missing `scheduled-jobs` check](#creating-the-missing-scheduled-jobs-check).**
  Until it exists, the endpoint is watched by the staff Health page
  (Staff → Health, `Scheduled jobs`), by the GitHub probe, and by anything
  that curls it; it answers the same 200/503 either way.
- `customer-site` **used to assert on the demo site's own content** — renaming
  the demo site's title away from "Aglyn Demo" turned it red. The render
  canary that replaces it (AGL-2486) asserts a resolved host and a non-empty
  node COUNT instead, so a content edit can no longer page anyone. ⚠️ **The
  repoint is still owed** — see
  [Repointing `marketing-home` and `customer-site`](#repointing-the-two-page-checks).
- Incident emails carry a runbook snippet pointing back at this file. Alert
  fires after ~10 minutes of sustained failure (2+ probe regions), so a single
  blip does not page.

### ⚠️ Four of these checks have been red since 2026-08-21 {#four-checks-red}

**Our own bot protection is failing our own monitors, again — this time the
one that matters.** Measured against the live project on 2026-08-23, pass rate
over the trailing six hours:

| Check | Host | Pass rate |
| --- | --- | --- |
| `console-health`, `console-imaging`, `backup-state`, `signup-volume`, `rate-limiter`, `billing-webhook`, `beacon-heartbeat console` | `app.aglyn.com` | **100%** |
| `tenant-health` | `aglyn.com/api/health` | **0%** → ✅ fixed 08-23 |
| `beacon-heartbeat tenant` | `aglyn.com/api/health/error-beacon` | **0%** → ✅ fixed 08-23 |
| `marketing-home` | `aglyn.com/` | **0%** — fix ready, needs repointing |
| `customer-site` | `demo.aglyn.app/` | **0%** — fix ready, needs repointing |

**Two of the four were fixed on 2026-08-23** by the `Health endpoint bypass`
rule (AGL-2486, option 1 below); expect them back at 100% within two check
periods.

The other two probe **real pages**, which a path bypass cannot reach. Their
fix has SHIPPED but is not applied: `/api/health/render/marketing` and
`/api/health/render/site` render those pages server-side and grade them, under
the bypassed prefix. They stay red until someone runs
[Repointing `marketing-home` and `customer-site`](#repointing-the-two-page-checks),
which needs the authenticated `gcloud` session a build agent cannot hold.

`tenant-health` ran at 100% through 2026-08-20, 3.9% on 08-21, and 0% since.
Every one of the four red hosts is served by `aglyn-tenant`, and every one of
them answers **429 Vercel Security Checkpoint** to an anonymous automated
client:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -A 'Monitor/1.0' https://aglyn.com/api/health   # 429
curl -s -o /dev/null -w '%{http_code}\n' -A 'Monitor/1.0' https://app.aglyn.com/api/health # 200
```

**The cause is known and half-fixed already.** Vercel Bot Protection is set to
*Challenge* on `aglyn-tenant` and `aglyn-docs`. That was found on 2026-08-20
and fixed **for the GitHub probe only**, by sending `x-aglyn-probe` against a
Bypass rule (`withProbeHeaders`, AGL-1611). The GCP uptime checks send no such
header and cannot be given one without storing a shared secret in a second
system — so the same root cause has had four of the eleven external checks red
for three days, with their alert policies enabled the whole time.

**This is worse than it looks, and worse than the missing `scheduled-jobs`
check.** A board with four permanently-red rows is a board people stop reading,
and this file already records what that costs: AGL-1843's permanently-red
backup check was "actively teaching the one person who receives it that a
backup page is noise". Alert fatigue here is not a hypothetical — it is the
condition under which a real `/api/health/crons` outage went unnoticed for
fifty-one hours.

#### What to do, in preference order

1. ~~**Bypass bot protection on the health PATHS of `aglyn-tenant`.**~~
   ✅ **DONE 2026-08-23 (AGL-2486).** Bypass rule `Health endpoint bypass`,
   one `path pre /api/health` group, added with `PATCH` / `rules.insert` and
   declared in `tools/scripts/lib/firewall-posture.mjs`. Those endpoints are
   public, unauthenticated and free of secrets, so challenging them protected
   nothing and broke the only thing watching them; needing no shared secret,
   the fix also covers any monitor chosen later. Verified anonymously:
   `/api/health` and `/api/health/error-beacon` answer **200**, `/` still
   answers **429**. This clears `tenant-health` and `beacon-heartbeat tenant`
   only — the two below are unaffected and still open.
2. ~~**Allowlist Google's uptime checkers by IP.**~~ ⛔ **REJECTED on the
   merits, 2026-08-23.** `gcloud monitoring uptime list-ips` is 54 addresses
   across four regions and Google rotates it. Worse than the maintenance: an
   IP-valued bypass rule is one `check-firewall-posture.mjs` cannot
   meaningfully assert. Pin all 54 in the posture table and every rotation
   reads as drift; leave them out and the rule's scope is not asserted at all.
   A guard that quietly stops guarding is the failure this whole file is
   about.
3. ✅ **DONE — move the RENDER to where the bypass already is (AGL-2486).**
   Two new endpoints under `/api/health` server-render a real page and grade
   it, so Google's checkers reach them through the rule added in option 1 and
   no IP list or shared secret is involved. See
   [Repointing `marketing-home` and `customer-site`](#repointing-the-two-page-checks).
4. **Last resort: put `x-aglyn-probe` in each GCP check's custom headers.**
   It works, but it copies a shared secret into a second system and fixes only
   the monitor that holds it. `probe-headers.mjs` says not to hand this header
   to third parties for a reason.

:::danger Do not "fix" this with a firewall PUT
Editing Vercel firewall config with a `PUT` **wipes bot protection entirely**.
Use `PATCH`, or the dashboard. Turning the challenge off wholesale would make
every check green and would be the wrong fix — the challenge is doing real work
on the pages that are not health endpoints.
:::

**How to know it worked:** the `curl` above returns 200 from an anonymous
client, and the four checks return to 100% within two check periods (10
minutes). Re-run the pass-rate query in
[Verifying the monitor yourself](#verifying-the-monitor-yourself).

### The channel is unverified {#the-channel-is-unverified}

🔴 **`notificationChannels/7043898327231541746` is UNVERIFIED, and every alert
policy in this project points at it.** Establish this from the API, which will
not tell you directly — `verificationStatus` is a valid field path on the
resource and comes back unset, and the unfiltered `GET` does not return the key
at all. The surface that does answer is `getVerificationCode`, which sends no
mail and succeeds only on a verified channel:

```bash
TOK=$(gcloud auth print-access-token); echo "${#TOK}"   # never 2>/dev/null
curl -s -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' --data '{}' \
  'https://monitoring.googleapis.com/v3/projects/aglyn-main/notificationChannels/7043898327231541746:getVerificationCode'
```

It returns `FAILED_PRECONDITION: Cannot generate a verification code from an
unverified channel.` A `200` with a code means the channel is verified and this
section is stale.

**What it does and does not prove.** It proves the channel never completed
verification. It does not prove mail is being dropped — Cloud Monitoring
exposes no delivery metric or audit record (`monitoring.googleapis.com/*` has
no notification descriptor in this project, and there is no delivery log), so
whether the ~100 violations since 2026-08-14 produced email is not answerable
from any API here. **The one check that settles it takes a human ten seconds:
search the inbox for mail from `alerting-noreply@google.com`.** Nothing found
means the estate has been alerting into a void.

To fix, send the code and complete the round trip — this one *does* mail the
channel's real address, which is why it is not run unattended:

```bash
CH='projects/aglyn-main/notificationChannels/7043898327231541746'
curl -s -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' --data '{}' \
  "https://monitoring.googleapis.com/v3/$CH:sendVerificationCode"
# then, with the code from that email:
curl -s -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  --data '{"code":"<code>"}' "https://monitoring.googleapis.com/v3/$CH:verify"
```

### Verifying the monitor yourself {#verifying-the-monitor-yourself}

The lesson of the fifty-one hours is that a documented monitor is not a
monitor. **Confirm the sink exists before trusting the report.** Both of these
are read-only and need only an authenticated `gcloud` session.

⚠️ **`entries:list` with no `timestamp` in the filter silently returns a recent
window, not everything.** A query for a whole log's history came back with zero
entries and then returned 180 for the same filter with an explicit
`timestamp>=`. Always bound the range, and treat a zero from an unbounded query
as unanswered rather than as an answer:

```bash
# Which checks actually exist? Compare against the table above.
gcloud monitoring uptime list-configs --project=aglyn-main \
  --format='table(displayName,monitoredResource.labels.host,httpCheck.path,period)'

# Which alert policies exist, are enabled, and have somewhere to send?
# A policy with zero notification channels is a check nobody reads.
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  'https://monitoring.googleapis.com/v3/projects/aglyn-main/alertPolicies?fields=alertPolicies(displayName,enabled,notificationChannels)'
```

And the one that answers "is any of this actually passing", which neither of
the above can tell you — pass rate per check over the last six hours:

```bash
gcloud monitoring time-series list \
  --project=aglyn-main \
  --filter='metric.type="monitoring.googleapis.com/uptime_check/check_passed"' \
  --format='value(metric.labels.check_id)' | sort -u
```

A check listed in this file but absent from the first command is a monitor that
does not exist. A check present in all three but sitting at 0% is a monitor
nobody is reading any more.

### Creating the missing `scheduled-jobs` check {#creating-the-missing-scheduled-jobs-check}

**This is the one open item in AGL-1148's "wire an external monitor" step.**
Everything else in the table above exists; this does not, and it is the check
that would have caught the fifty-one hours.

It needs an authenticated `gcloud` session against `aglyn-main`, which is why
it has never been done from a PR — a build agent cannot hold that credential
and should not. It is two commands, or five minutes of clicking.

The endpoint is already correct and already answers 200/503 with
`$.status`, so nothing in the app has to change first. Confirm it before and
after:

```bash
curl -si https://app.aglyn.com/api/health/crons | head -20
```

#### Option A — two commands

Modelled exactly on the existing `backup-state` check and its policy, so the
new one behaves identically to the eleven that already work.

```bash
# 1. The check. 900s to match the other subsystem checks; the endpoint
#    memoises for 5 minutes, so anything tighter reads the same memo twice.
gcloud monitoring uptime create \
  'scheduled-jobs — app.aglyn.com/api/health/crons status=ok' \
  --project=aglyn-main \
  --resource-type=uptime-url \
  --resource-labels=host=app.aglyn.com,project_id=aglyn-main \
  --path=/api/health/crons \
  --port=443 --protocol=https --request-method=get \
  --validate-ssl=true \
  --status-classes=2xx \
  --matcher-type=matches-json-path \
  --json-path='$.status' --json-path-matcher-type=exact-match \
  --matcher-content='"ok"' \
  --period=15 --timeout=10

# 2. Read back the generated check id — the alert policy filters on it, and
#    it is generated from the display name plus a random suffix, so it
#    CANNOT be predicted and must not be guessed. `name.basename()` prints the
#    bare id; `value(name)` would print the full resource path, and pasting
#    that into the filter below yields a policy that matches no time series
#    and therefore never fires.
gcloud monitoring uptime list-configs --project=aglyn-main \
  --filter='displayName~scheduled-jobs' --format='value(name.basename())'
```

:::caution `--validate-ssl` defaults to FALSE on the CLI
All thirteen existing checks have `validateSsl: true`, because the console
checkbox is on by default — the CLI's is not. Omitting the flag creates the
one check in the set that would keep reporting green through an expired or
invalid certificate on `app.aglyn.com`. Verified against the live configs on
2026-08-28: 13 of 13 `true`.
:::

Then create the policy, substituting the id from step 2:

```bash
CHECK_ID='<paste the id from step 2>'
cat > /tmp/scheduled-jobs-policy.json <<JSON
{
  "displayName": "Uptime failure: scheduled-jobs (app.aglyn.com/api/health/crons)",
  "combiner": "OR",
  "conditions": [{
    "displayName": "Scheduled-jobs check failing",
    "conditionThreshold": {
      "filter": "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id=\"${CHECK_ID}\" AND resource.type=\"uptime_url\"",
      "comparison": "COMPARISON_GT",
      "thresholdValue": 1,
      "duration": "600s",
      "trigger": { "count": 1 },
      "aggregations": [{
        "alignmentPeriod": "1800s",
        "perSeriesAligner": "ALIGN_NEXT_OLDER",
        "crossSeriesReducer": "REDUCE_COUNT_FALSE",
        "groupByFields": ["resource.label.*"]
      }]
    }
  }],
  "documentation": {
    "content": "A scheduled job has stopped being scheduled: it did not run when its own cron said it should (job-silent), has never run since we started watching (job-never-reported), or its marks could not be read (beats-unavailable). Downstream of these jobs are metered billing, GDPR erasures, the audit archive and scheduled publishing. Open https://app.aglyn.com/api/health/crons and read which job is named. Runbook: docs/UPTIME_AND_SLA.md.",
    "mimeType": "text/markdown"
  },
  "notificationChannels": [
    "projects/aglyn-main/notificationChannels/7043898327231541746"
  ],
  "enabled": true
}
JSON

curl -s -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H 'Content-Type: application/json' \
  -d @/tmp/scheduled-jobs-policy.json \
  'https://monitoring.googleapis.com/v3/projects/aglyn-main/alertPolicies'
```

#### Option B — the console, by clicking

1. https://console.cloud.google.com/monitoring/uptime?project=aglyn-main →
   **Create uptime check**.
2. Protocol **HTTPS**, Resource type **URL**, Hostname `app.aglyn.com`,
   Path `/api/health/crons`. **Next.**
3. Response validation: check timeout **10s**; leave **Validate SSL
   certificates** checked (it is on by default here — this is the setting
   Option A has to pass explicitly); **Content matching** on →
   Response content type **JSON**, matcher **Matches JSON path**,
   JSON path `$.status`, JSON path matcher **Exact match**,
   Content `"ok"` (with the quotes). Accepted status codes: **2xx**. **Next.**
4. Alert & notification: create an alert, name it
   `Uptime failure: scheduled-jobs (app.aglyn.com/api/health/crons)`,
   duration **10 minutes**, notification channel the existing email channel
   `7043898327231541746`. **Next.**
5. Title `scheduled-jobs — app.aglyn.com/api/health/crons status=ok`,
   frequency **15 minutes**. **Test** — it should come back green — then
   **Create**.

#### Confirm the new check matches the known-good one

Whichever option you took, diff the created config against `backup-state` —
the check this one was modelled on. Every field but the path, the display
name and the generated id should be identical, so anything else the diff
prints is a mistake worth fixing before you trust the check.

```bash
dump() {  # dump <displayName filter>
  gcloud monitoring uptime list-configs --project=aglyn-main \
    --filter="displayName~$1" --format=json |
    python3 -c 'import json,sys; c=json.load(sys.stdin)[0]; c.pop("name",None); c.pop("displayName",None); c["httpCheck"].pop("path",None); print(json.dumps(c,indent=2,sort_keys=True))'
}
diff <(dump backup-state) <(dump scheduled-jobs) && echo "IDENTICAL apart from path/name/id"
```

An empty diff is the pass. In particular it catches a missing
`"validateSsl": true`, which nothing else in this runbook would surface.

#### Prove it can go red before trusting it

A check that has never been seen to fail is a check nobody has verified. The
cheapest honest test does not require breaking a real job: delete the
bootstrap document and the endpoint reports every job as never having
reported.

```bash
# Re-opens the watch window: `platformCronBeats/<watch doc>` is a plain
# document, not a reserved id, and the next request recreates it.
# Expect a 503 within one probe TTL (5 min), an email within ~10 more.
```

Recreate it by hitting the endpoint once, and the next probe clears. **Name
the clearing event before running any forced-failure test**, and unwind it the
same day — a check left red is a check about to be muted.

### Repointing `marketing-home` and `customer-site` {#repointing-the-two-page-checks}

**These two checks already exist — they are UPDATED, not created.** Both have
been at 0% since 2026-08-21 because they fetch `/`, which bot protection
challenges. The fix is to point them at the render canaries added in
`AGL-2486`, which live under the bypassed `/api/health` prefix:

| check | new path | replaces fetching |
| --- | --- | --- |
| `marketing-home` | `/api/health/render/marketing` | `aglyn.com/` |
| `customer-site` | `/api/health/render/site` | `demo.aglyn.app/` |

:::danger Step 0 — configure the marketing target, or it stays red
The canaries name **no Aglyn host of their own**: the self-host ratchet
forbids it, and a canary hard-wired to `aglyn.com` is dead weight on somebody
else's install. The marketing target resolves
`AGLYN_CANARY_MARKETING_HOST` → `cname--{NEXT_PUBLIC_WORKSPACE_DOMAIN}` →
**nothing**, and nothing is reported as `503 not-configured` rather than a
green it has not earned.

Measured on `aglyn-tenant` 2026-08-23: **both are unset**, so
`/api/health/render/marketing` answers `not-configured` until one is set.
`AGLYN_TENANT_DEMO` *is* set, so `/api/health/render/site` needs nothing.

Set one of these on the `aglyn-tenant` project and **redeploy** — an env var
added without a redeploy does not reach the running deployment:

```
AGLYN_CANARY_MARKETING_HOST=cname--aglyn.com
```

Repointing the check before this is done just moves the red from one cause to
another.
:::

**Confirm both endpoints are green BEFORE repointing anything.** Repointing a
check at an endpoint that is failing tells you nothing you did not already
know, and it costs you the ability to tell "the fix did not work" from "the
page is genuinely broken":

```bash
curl -s -A 'Monitor/1.0' https://aglyn.com/api/health/render/marketing | python3 -m json.tool
curl -s -A 'Monitor/1.0' https://demo.aglyn.app/api/health/render/site | python3 -m json.tool
# Expect: HTTP 200, "status": "ok", checks.render.nodeCount > 0.
# "code": "not-configured"  -> Step 0 above is not done (or not redeployed).
# "code": "not-found"       -> the host resolves nothing; check the cname-- sentinel.
# "code": "rendered-empty"  -> the page really is blank. That is a real outage.
```

**Keep each check's HOSTNAME as it is.** Only the path and the matcher change.
`aglyn.com` and `demo.aglyn.app` both serve these endpoints, and leaving the
hostnames alone means each check still proves DNS, the TLS certificate and
edge routing *for that hostname* — coverage the old checks had and that a
render assertion alone would not replace.

:::note What the hostname does and does not cover
The canary renders a **pinned** host (`AGLYN_CANARY_MARKETING_HOST` /
`AGLYN_CANARY_SITE_HOST`), not one derived from the request's `Host` header —
deliberately, so nobody can make our deployment render an arbitrary host by
choosing a URL. So the hostname you fetch proves DNS/TLS/edge for that name,
while the render half always grades the same two pinned sites.
:::

:::warning The site canary's subject must be a seeded host (AGL-1617)
`siteHost()` still defaults to `demo`, and that default is **known-weak**.
`demo` is not a maintained demo — it is a legacy host in an individual's
personal org with zero seed documents, and it graded green for months while
publicly serving `CLICK ME`, nineteen `hello` nodes, a fake `$9/$29/$79`
pricing table and unresolved `{{Message}}` tokens. Nineteen nodes is a
non-empty tree, so the check was right and the subject was wrong.

The fix is the subject, not the assertion — tightening the canary into a
content match would make every ordinary customer edit page on-call. Point it
at a host whose content comes from version control and is never hand-edited:

```bash
# 1. host first — seeds `showcase` from the brand pack in demo-brands.mjs
node tools/scripts/seed-demo-org.mjs --org <orgSlug> --create-hosts --brands showcase
# 2. env second — only once that host serves
AGLYN_CANARY_SITE_HOST=showcase
```

**Order matters.** Setting the variable before the host exists points the
canary at a 404 and reddens the public status page; changing the `|| 'demo'`
default to `not-configured` before both are done 503s it. Host first, env
second, default third.
:::

Each endpoint answers the ordinary health contract — `200` with
`$.status == "ok"`, or **`503`** when the page fails to render — so the
matcher becomes the same JSON-path matcher the other nine checks use, and
`marketing-home` and `customer-site` stop being special.

```bash
# 1. The ids. `update` takes the CHECK ID positionally, so this is the same
#    name.basename() correction as above — the full resource path is rejected.
gcloud monitoring uptime list-configs --project=aglyn-main \
  --filter='displayName~marketing-home' --format='value(name.basename())'
gcloud monitoring uptime list-configs --project=aglyn-main \
  --filter='displayName~customer-site' --format='value(name.basename())'

# 2. Repoint each one. --validate-ssl is passed EXPLICITLY: both checks carry
#    validateSsl: true today, the CLI default is false, and an update that
#    omits it is exactly how the one check that stays green through an expired
#    certificate gets created.
gcloud monitoring uptime update '<marketing-home id>' --project=aglyn-main \
  --path=/api/health/render/marketing \
  --validate-ssl=true \
  --set-status-classes=2xx \
  --matcher-type=matches-json-path \
  --json-path='$.status' --json-path-matcher-type=exact-match \
  --matcher-content='"ok"' \
  --display-name='marketing-home — aglyn.com/api/health/render/marketing status=ok'

gcloud monitoring uptime update '<customer-site id>' --project=aglyn-main \
  --path=/api/health/render/site \
  --validate-ssl=true \
  --set-status-classes=2xx \
  --matcher-type=matches-json-path \
  --json-path='$.status' --json-path-matcher-type=exact-match \
  --matcher-content='"ok"' \
  --display-name='customer-site — demo.aglyn.app/api/health/render/site status=ok'
```

Then re-run the pass-rate query in
[Verifying the monitor yourself](#verifying-the-monitor-yourself); both should
return to 100% within two check periods (10 minutes at their 5-minute period).

#### Why these can go red, and how that was proved

A canary that cannot fail is worse than the dark check it replaces. `renderHealth`
fails a page that resolves no host, 404s, redirects away, composes an **empty
node tree**, or cannot be loaded at all — a blank page served with a `200` is
precisely the outage a reachability ping calls healthy.
`apps/tenant/specs/render-canary-can-go-red.spec.ts` drives the real handlers
for every one of those shapes on **GET and HEAD alike**, and the assertions
were verified by mutation: making `HEAD` return a hardcoded `200`, grading an
empty node tree as healthy, and grading "could not determine" as calm each
turned exactly the corresponding tests red.

The marker is **structural** — a resolved host and a non-empty node *count*,
never a string from the page. Two reasons: asserting copy would page whoever is
on call for an ordinary content edit, and the endpoint is public, so customer
content must not appear in its body. Both probed hosts are Aglyn's own (`demo`
is the platform demonstration site the middleware falls back to for
`app.aglyn.com` and every preview), so no customer can turn these red.

### What is deliberately NOT watched (the honest list)

- **PLATFORM 5xx — the part of the server error rate still nobody's (AGL-1921).**
  This line used to say the whole server error rate was unwatched. It no longer
  is: since 2026-08-24 `/api/health/server-errors` reports the count of uncaught
  render/route-handler errors across BOTH deployments in a trailing 30-minute
  window.

  ⚠️ **One reader watches it, and it is the one that cannot email you.** The
  15-minute GitHub probe reads the endpoint and fails its run; the UptimeRobot
  monitor that would mail the operator **does not exist yet** (measured
  2026-08-24 — ten monitors, none of them this one), and it is deliberately not
  a status-page card. So a spike today reddens a workflow and pages nobody.
  Runbook step 1 below closes it in two minutes.

  What remains unwatched even after that is precisely the set that never
  reaches our code:

  - an error that kills the process before `onRequestError` runs;
  - a platform-level 5xx — a Vercel function timeout, an OOM, a cold-start 502;
  - anything thrown in the edge runtime (middleware), where firebase-admin
    cannot load.

  Those live only in the Vercel runtime log, which retains ~60 minutes and
  drains nowhere — `GET /v2/integrations/log-drains` returns `[]` on both
  `aglyn-console` and `aglyn-tenant` (AGL-1799). A log drain sees all three and
  is still the only thing that closes them. **Do not read the new endpoint as
  more than it is:** it counts errors our own hook observed, which is most of
  what "the server is failing" means and not all of it.
- **Do not paper over any of this with a reachability probe.** The health
  endpoints on this page are correctness signals for the subsystems they name —
  beacon transport, Stripe delivery, backups, rate limiters, and now the error
  count — and each is honest about what it reads. A probe that measures the one
  request it makes is not an error rate, and dressing one up as one would be
  worse than the gap.
- **Vercel function errors and logs.** The same root cause as the row above,
  from the operator's side: a `console.error` written during an incident is
  gone before anyone reads it. **Upgrade path:** Vercel Pro unlocks log drains
  → pipe to GCP Logging → the same alerting stack picks it up.
- **APM / client-side error tracking.** No Sentry or similar. The AGL-1538
  first-party beacon plus Error Reporting covers uncaught browser errors, and
  AGL-1923's heartbeat now covers the beacon itself going dark — but there is
  still no session replay, no breadcrumbs, and no performance tracing, so a
  browser-side *misbehaviour* that never throws is invisible. Post-launch
  decision, tracked in AGL-1148's follow-ups.
- **Stripe's own delivery attempts, from Stripe's side.** `billing-webhook`
  reads them through the API on every probe, but Stripe also has built-in
  endpoint-failure notification (Developers → Webhooks → the endpoint →
  alerting on consecutive failures). It is free, needs no code, and catches
  the case our infrastructure cannot see — an outage in which our probe is
  down too. **It is an account-settings change and has not been made.**
- **Email delivery** (Resend outages) and **DNS**: no synthetic coverage. Each
  has failed loudly rather than silently so far; revisit if that stops being
  true.

### The server-error runbook (AGL-1921)

**What shipped in code, 2026-08-20.** `onRequestError` in
`apps/console/instrumentation.ts` and `apps/tenant/instrumentation.ts` — Next's
own hook for an uncaught error in any render or route handler — reports through
`reportServerError` into a **new `server-errors` log** in `aglyn-main`, under the
same admin credential and the same Cloud Logging transport the AGL-1538 client
beacon uses. Entries carry the `ReportedErrorEvent` `@type`, so Error Reporting
groups them, *and* they are real log entries a log-match policy can page on.

Three properties worth knowing before you tune anything:

- **A separate log id, on purpose.** `server-errors`, never `client-errors`. The
  existing `Client error beacon` policy keys on the latter; merging them would
  make it fire for both and force triage to start by asking which it was.
- **The route PATTERN is reported, never the resolved path.** A resolved console
  path carries the org slug and document ids, and this payload leaves our origin
  for a Google log.
- **Writes are budgeted at 60/minute per instance**, with a suppression count
  logged on rollover. The event being watched for is a spike, and a spike is
  exactly when an unbounded reporter turns one incident into a billing incident
  on a $20/month budget. The counter only has to cross a threshold, not be exact.

**What it still cannot see.** It is a fallback, not the fix. It misses an error
that kills the process before the handler runs, a platform-level 5xx that never
reaches our code (a Vercel function timeout, an OOM, a cold-start 502), and
anything thrown in the edge runtime, where firebase-admin cannot be loaded. A
log drain sees all of them.

#### What shipped 2026-08-24 — the READER, which is the half that was missing

The 08-20 arm captured errors and put them somewhere nothing here could read.
That is the shape this repo keeps losing to (`/api/health/crons` was correct
about a broken job for fifty-one hours because nobody asked it), and it was not
a suspicion — it was measured. Against the production credential:

```
POST https://logging.googleapis.com/v2/entries:list
  filter: logName="projects/aglyn-main/logs/server-errors"
→ 403  { "message": "Permission denied for all log views" }
```

The firebase-admin service account can **create** log entries and cannot
**list** them, so no probe in this repo can read back what the hook writes. The
only reader that log can ever have is a GCP alert policy created by hand — step
1 below, still worth doing, and still a click nobody had made.

So `reportServerError` now also counts into a
`rateLimits/serverError_{minute}` marker, and **`/api/health/server-errors`**
grades those counts in the same 200/503 contract as every sibling endpoint.
Four things about it that are decisions rather than details:

- **The count is written FIRST**, above the Logging budget gate, the credential
  check and the fetch. A beacon whose transport is dead otherwise reports zero
  errors, and it reports it during exactly the incident that killed the
  transport.
- **Unknown is its own state.** A failed marker query is `errors-unavailable`
  and **503**, never "0 errors". `strictNullChecks` is off repo-wide, so a
  swallowed query folding to a confident zero is one `.catch(() => [])` away —
  and on this endpoint that would be the worst bug it could have.
- **Threshold 5 in a trailing 30 minutes**, not zero. Unlike the rate-limiter
  and billing alarms, a healthy day can produce the occasional uncaught error,
  and an alarm that pages on the first one gets muted before the real one
  arrives. `SERVER_ERROR_ALARM_MAX_ERRORS` retunes it without a deploy.
- **Cost is bounded by coalescing, not by dropping.** Errors accumulate in
  process and land at most once per five seconds per instance — twelve writes a
  minute at worst — with the first error of each minute written immediately so a
  lone error is never invisible. Nothing is rounded down.

**Who reads it, concretely:** `.github/workflows/uptime-probe.yml` (every 15
minutes, from GitHub's runners, and a 503 fails the run); the external
UptimeRobot keyword monitor once pointed at it; and `docs.aglyn.com/status` once
the URL is in `DOCS_STATUS_TARGETS`. The list it is on
(`tools/scripts/lib/uptime-targets.mjs`) is now guarded in BOTH directions —
`evaluateSubsystemReaders` fails the suite on a health endpoint nothing probes
*and* on a watched path no app serves.

:::note A subsystem 404 reads `PEND`, not `DOWN`
The watch list lives on `main`; the probe hits **production**, promoted
separately. Between merge and promotion the probe asks for a route that build
does not serve. A 404 on a subsystem path *while that target's root is UP* is
therefore reported `PENDING — promote main` and does not fail the run. It is
narrow on purpose (never the root, never a non-404, never while the root is
down), and the review-time `missing` check above is what stops a deleted route
hiding behind it forever.
:::

#### Ordered steps — the account owner

**No GCP or Vercel resource was created for any of this.** Steps 1–4 are free;
step 5 onward costs money and is a decision, not a task.

1. **Free, 2 minutes: point the external monitor at the new endpoint.** In
   UptimeRobot add a **keyword** monitor (never plain HTTP) on
   `https://app.aglyn.com/api/health/server-errors`, keyword `"status":"ok"`,
   alert when **not** found, 5-minute interval — the same shape as the other
   ten. This is the arm that emails you; the GitHub probe only records.

   **Name it exactly `Server errors`, and leave it on the public status page.**
   Both halves are load-bearing rather than cosmetic. The status page's monitor
   API returns `url: null`, so a NAME is the only thing any checker can key on,
   and AGL-1921 now carries an `aglyn-check` block asserting that this name
   appears — so `check:external-facts` notices the moment this step is done and
   says so on the issue. A different name reads as *still not created*; a
   monitor kept off the status page is invisible to it entirely.

   Verify with the `getMonitorList` command above: **ten** names today, eleven
   after, and `Server errors` among them. Confirmed absent 2026-08-24 — this
   step has not been done.
2. **Free, 1 minute, and YOUR call: a status-page card?** Appending the same URL
   to `DOCS_STATUS_TARGETS` on the `aglyn-docs` Vercel project renders a card on
   `docs.aglyn.com/status`. It is the one arguable case in the card policy above
   — a spike is genuinely customer-visible, but the endpoint aggregates both
   deployments, so a console-only spike would tell site owners their sites are
   down. Read item 6 of that policy and decide; step 1 already covers alerting
   us either way.
3. **Free, 5 minutes: prove the alarm fires, before trusting it.** Set
   `SERVER_ERROR_ALARM_MAX_ERRORS=-1` on `aglyn-console` and redeploy: zero
   errors is still over a negative threshold, so the endpoint reports
   `server-error-spike` and **503**s without anyone breaking a real route.
   Confirm the UptimeRobot email arrives and the status card flips, then remove
   the variable. An alarm nobody has seen fire is an alarm nobody should trust.
4. **Free, and still worth doing: an alert policy on the log.** The GCP side is
   independent of the endpoint above and catches the case where the console
   itself is down. In `aglyn-main` → Monitoring → Alerting, create a
   **log-based alert** on

   ```
   logName="projects/aglyn-main/logs/server-errors" AND severity>=ERROR
   ```

   Notify the existing email channel `7043898327231541746`. Start it as a *log-match*
   (pages on the first entry) for the beta window — volume is near zero today,
   so a first-error page is informative rather than noisy — and convert it to a
   counter with a threshold once a baseline exists. Log-based metrics and alert
   policies are not separately billed; the log entries themselves fall under the
   Logging free tier at this volume.

   Optional, also free: grant the firebase-admin service account
   `roles/logging.viewer` on `aglyn-main`. That is what the 403 above is, and
   with it a future probe could read the log directly as a second, independent
   reader. Not required for anything shipped.
5. **The real fix: two Vercel log drains pointed at our own receiver.**

   :::warning This step used to say "add a drain to GCP Logging". It was wrong.
   **Vercel has no native GCP Logging destination.** A log drain POSTs to an
   HTTPS endpoint *you host*; the marketplace destinations are Dash0, Datadog,
   Splunk, S3 and friends, none of which is Cloud Logging. Anyone following the
   old instruction would have gone looking in the dashboard for a picker that
   does not exist and concluded the plan was wrong rather than the doc. The
   endpoint is now written and shipped — see **the receiver** below.
   :::

   Log drains require **Vercel Pro**; team `aglyn` is on `pro` as of
   2026-08-25, so the plan precondition (AGL-723) is met. Both projects still
   return `[]` from `GET /v2/integrations/log-drains` — that empty array is the
   current evidence of the gap, so it is also the check that the drain took.

   **Before creating either drain**, set both variables on the **console**
   project (Production) and redeploy, because the receiver fails closed and a
   drain created against an unconfigured endpoint just delivers 403s until
   Vercel disables it:

   | variable | value |
   | -- | -- |
   | `VERCEL_LOG_DRAIN_SECRET` | `openssl rand -hex 32`; paste the SAME value into each drain's *Signature Verification Secret* field |
   | `VERCEL_LOG_DRAIN_VERIFY` | the `x-vercel-verify` token Vercel shows beside the endpoint URL |

   Then, per project (`aglyn-console` **and** `aglyn-tenant`) — Team Settings →
   Drains → Add Drain → Logs → Custom endpoint:

   - **Endpoint URL** the Cloud Run receiver,
     `https://log-drain-receiver-543499566626.us-central1.run.app` — ONE
     receiver for both projects, and it must NOT be a Vercel project (see
     "Why the receiver is not on Vercel" below). Each entry carries its own
     `projectId`, so the two projects never blur.
   - **Format** `ndjson` (`json` also parses; the receiver reads either).
   - **Sources** `lambda`, `edge`, `external` — the runtime tiers. **Not**
     `build` or `static`: a build log has no status code, and a static 5xx is
     the CDN's, not ours.
   - **Environments** `production` only. Preview 5xx are expected and would
     page on unfinished work.
   - **Sampling** none (100%). The receiver's own 5xx filter is the cost
     control, and sampling a rare error is how you miss it. ⛔ Do not reach for
     sampling as a cost or loop control regardless: measured 2026-08-26, a
     single `{environment:"production", rate:0}` rule with no path prefix —
     literally "drop everything" — moved delivery volume from 31 to 32 per
     five minutes. The whole `schemas.log` filter block (`sources`,
     `environments`, `sampling`) is accepted by the API, echoed back on `GET`,
     and never applied.

   Equivalent REST payload, if you would rather not click — note the current
   endpoint is `POST /v1/drains`; `POST /v2/integrations/log-drains` is
   deprecated and rejects anything but an OAuth2 integration token:

   ```jsonc
   // POST /v1/drains?teamId=…   (current shape, one call per project)
   {
     "name": "aglyn-console-runtime-5xx",
     "projects": "some",                    // required ALONGSIDE projectIds
     "projectIds": ["<aglyn-console or aglyn-tenant project id>"],
     "schemas": { "log": { "version": "v1" } },
     "delivery": {
       "type": "http",
       "endpoint": "https://log-drain-receiver-543499566626.us-central1.run.app",
       "encoding": "ndjson",
       "headers": {},                       // required, even when empty
       "secret": "<the same VERCEL_LOG_DRAIN_SECRET>"
     }
   }
   ```

   Both drains share ONE secret because they share one receiver, which knows a
   single `VERCEL_LOG_DRAIN_SECRET`. Recreating either must copy the secret out
   of the surviving one, or the receiver fails closed on everything. Vercel
   probes `delivery.endpoint` at create time, so the endpoint must already be
   live and answering 200 to an unsigned empty body.

   Verify the same way the gap was measured: `GET
   /v2/integrations/log-drains` per project, now non-empty.

   ### Why the receiver is not on Vercel

   It was, at `apps/console/app/api/log-drain/route.ts`, from 2026-08-25 to
   2026-08-26 — and the `aglyn-console-runtime-5xx` drain watched
   `aglyn-console`. **A delivery POST is a request to whatever hosts the
   receiver, and a request produces a log**, so every delivery manufactured its
   own next input: 695K invocations in nine hours, ~21/sec, billing at once on
   function invocations, function duration, edge requests, observability events
   and drains volume, and projecting to ~$250–300/month.

   The route's own filters (drop the receiver's path, drop `level: "warning"`)
   were real and are still in the gate — but they cut the WRITE, and the cost
   was the DELIVERY. Nothing inside a receiver can decline to be requested.

   The loop is *positional*: it exists exactly when a drain's watched project is
   also the receiver's host. So the receiver moved to `cloud/log-drain` on Cloud
   Run, which no drain watches. That also removes a hop — the data was always
   destined for Cloud Logging in `aglyn-main` — and swaps the Firebase admin
   credential for Application Default Credentials.

   ⛔ **Never point a drain at an endpoint hosted on a project that drain
   watches**, and do not try to solve it with drain configuration.

   **The receiver** (`cloud/log-drain/server.mjs`, on Cloud Run in `aglyn-main`)
   is what makes this cost nothing much:

   - **It verifies `x-vercel-signature`** — HMAC-SHA1 of the *raw* body keyed
     by `VERCEL_LOG_DRAIN_SECRET`, timing-safe compared — and **fails closed**.
     Unset secret, missing header or wrong value: nothing is written, ever.
   - **It filters to server errors BEFORE writing, and this is the whole cost
     story.** A drain streams *every* request log for both projects; writing
     all of them would turn a ~$20/month monitoring budget into a real bill.
     Forwarded: `statusCode >= 500`, `proxy.statusCode >= 500`, `statusCode
     === -1` (documented as a crashed lambda — the OOM case the hook cannot
     see), and `level`/`type` of `fatal`. Dropped unwritten: everything else,
     including plain `level: "error"` console lines (the hook already covers
     our own thrown errors properly) and `proxy.statusCode === -1`, which is
     *background ISR revalidation* and would otherwise forward healthy traffic
     forever. On a healthy day this endpoint writes nothing at all.
   - **It writes to `vercel-runtime`, not `server-errors`.** The latter is the
     `onRequestError` hook's log and step 4's policy keys on it; merging would
     count one incident twice and make triage start by asking which arm saw
     it. Same discipline that keeps `client-errors` and `server-errors` apart.
   - **It cannot feed back on itself, structurally.** It runs on Cloud Run,
     which no Vercel drain watches, so its own request logs are never drained
     anywhere. The two older guards remain as defence in depth for anyone who
     mounts this gate on a Vercel route again: entries whose path is
     `/api/log-drain` are dropped *before* the 5xx gate, and every line the
     module logs about itself is a `console.warn` (`level: "warning"`), which
     the 5xx gate drops on a second, independent property.
   - **Its gate is BUNDLED from the workspace, not reimplemented.**
     `cloud/log-drain/prepare.mjs` vendors the compiled
     `vercel-log-drain.js` and `vercel-drain-signature.js` out of
     `nx build tenant-data-admin`, so `vercel-log-drain.spec.ts` and
     `vercel-drain-signature.spec.ts` still cover the code that actually runs.
     It has zero npm dependencies, and `prepare.mjs` fails the build if either
     module ever gains a static import beyond `node:`.
   - **Its cost is bounded and its lossiness is reported.** 60 entries per
     minute per instance, the same budget `reportServerError` uses; overflow
     increments a counter that is `console.warn`ed as a summary when the
     window rolls, and every response body carries `suppressed`.
   - **It answers 200 on an accepted delivery whatever happens downstream.**
     Vercel disables a drain that fails more than 80% of deliveries or 50
     times in an hour, so a receiver that 5xx'd during a Cloud Logging wobble
     would switch the monitor off mid-incident.
   - **It sends no more than the shipped beacons do.** No request bodies, no
     `proxy.path` (that one carries the query string), no client IP, user
     agent or referer. The route *pattern*, status, host, region, project and
     a 1 KB-clamped message — the last is where `Task timed out after 10.01
     seconds` lives, which is the entire triage value of the platform-5xx case.
6. **The policy this issue originally specified — LIVE.**
   `projects/aglyn-main/alertPolicies/14031689508473384486`, "Server errors:
   Vercel runtime 5xx via log drain (AGL-1921)", a `conditionMatchedLog` on

   ```
   resource.type="global" AND logName=~"vercel" AND severity>=ERROR
   ```

   notifying `.../notificationChannels/7043898327231541746`, rate-limited to
   one notification an hour with a seven-day auto-close — the same strategy
   the two sibling log-match policies use. It extracts `route`, `status`,
   `vercel_project` and `environment` as labels so the mail names the failing
   route without a console round trip.

   **`severity>=ERROR` and not `httpRequest.status>=500`, deliberately.** A
   crashed lambda (`statusCode: -1`) and a `fatal` entry have no HTTP status
   to report, so they land with `httpRequest.status` absent and the narrower
   filter misses them — the subset the other two arms are worst at seeing.
   Every entry in this log is already a server error by construction (the
   receiver's gate discards the rest before writing), so `severity>=ERROR` is
   not the blunt instrument it would be on a raw log. Both forms were measured
   against the live log before the policy was created and matched the same 180
   entries; the severity form is the one that also covers the crash class.

   A threshold policy over a log-based counter metric was the original
   proposal. The match form was taken instead because it needs no derived
   metric to exist first, and because the volume does not warrant a rate
   threshold: 180 entries in seven days, against ~20K drain deliveries a day.
   If that ratio changes, a counter metric grouped by project is the next
   step, not a tighter match filter.
7. **Then reconcile the three.** With the drain live it sees a superset of what
   the hook sees, and keeping every arm at page level would triple-page. Keep
   them all — the hook and its endpoint survive a Vercel outage and a plan
   downgrade — but let the drain's policy be the one that pages, and demote the
   other two to the counter form.

All three arms are live. Both drains exist and are enabled —
`aglyn-console-runtime-5xx` and `aglyn-tenant-runtime-5xx`, on team
`team_JFfQodGE8VhCAZM6usYTu54M`, both delivering to the Cloud Run receiver —
and step 6's policy pages on what they deliver. Verify the drains by their
`delivery.endpoint` and `status`, never by assuming: an endpoint nobody is
delivering to is a monitor that reports silence.

8. **The watcher-of-the-watcher.** `alertPolicies/15663465441534996183`, "Log-drain
   receiver is not receiving", a **`conditionAbsent`** on

   ```
   metric.type="run.googleapis.com/request_count" AND resource.type="cloud_run_revision"
     AND resource.label.service_name="log-drain-receiver"
   ```

   summed across response classes and revisions, firing after **3600s** with no
   data. **Do not remove this as redundant with step 6** — it is the only thing
   that can report that step 6 has gone deaf.

   **Absence, not error rate, and that is the whole point.** A policy on the
   receiver's error rate cannot fire when the receiver is down: no requests
   means no 5xx responses means no data means no threshold is ever crossed. The
   failure worth catching emits *no signal at all*, so the condition has to be
   about missing data. `request_count` is the right series because it is written
   on every delivery whatever the outcome, and goes absent exactly when the
   service stops being reached — deleted, failing to start, or drains disabled
   by Vercel after repeated delivery failures.

   Summing across revisions matters: a routine deploy retires one revision and
   starts another, and a per-revision condition would read that as an absence.

   **Sized against measurement, not guesswork:** floor 568 requests/hour over 24
   hours, median 666, no empty hours. One hour of true silence is far outside
   normal quiet.

**The tenant drain has delivered nothing, and that is not yet proof of
anything.** `aglyn-tenant-runtime-5xx` has produced zero entries since it was
created. It is correctly configured — project id `QmVstR8xiYtabTkVo2t9NNsiYY72nSTbNr1MGDLffzZeLn`
confirmed against the project list as `aglyn-tenant` (an old-format id, not a
typo), `status: enabled`, no `disabledAt`, sources `lambda`+`edge`,
environments `production`, same endpoint the console drain uses successfully —
and the receiver has logged zero warnings across ~45K deliveries, so nothing is
being dropped on our side.

It cannot be settled from here, and these were tried:

- **Vercel exposes no per-drain delivery counter.** `/v1/drains/{id}/deliveries`
  and `/events` both 404; the drain object carries no delivery fields.
- **Deliveries are not attributable at the receiver.** Every request carries the
  same `VercelDrain/1.0` user agent, from 177 distinct ephemeral source IPs
  across 200 consecutive deliveries.
- **The gate writes nothing per delivery** — by design, for cost — so a
  non-5xx tenant delivery leaves no trace in Cloud Logging.
- **The 9.4-hour window when only the tenant drain existed** (2026-08-25T16:37
  → 2026-08-26T02:00) predates the Cloud Run receiver's first boot at
  2026-08-26T03:55, so it cannot serve as an isolation test.

**To settle it:** read per-drain delivery status on the Vercel Drains page,
which the API does not expose; or compare `aglyn-console`'s own production
request volume in Vercel observability against the receiver's ~16K
deliveries/day — if console alone accounts for all of it, the tenant drain is
delivering nothing.

**What stays blind even with all three arms live**, so nobody reads this
section as "the server tier is covered":

- **A Vercel-side outage.** If the platform cannot run our functions it also
  cannot deliver a drain; the external uptime monitors are the only arm that
  survives that, which is why steps 1–4 stay in place rather than being
  replaced by the drain.
- **The receiver being down.** Both drains deliver to the one Cloud Run
  service, so an outage there silences both at once. Vercel retries and then
  disables a drain that keeps failing, so a long receiver outage can require
  re-enabling the drains by hand afterwards — check the Drains page after any
  receiver incident. Nothing watches the receiver itself; it is the one arm
  with no monitor of its own.
- **Anything below 500.** A route answering 200 with a broken body, a 403 storm
  from a bad rule, a 404 spike from a lost route: none is a server error and
  none of the three arms sees it.
- **Deliberate drops.** `level: "error"` console lines and anything past the
  60/minute/instance budget are not forwarded — the budget reports itself, but
  the reading is "at least this many", never "exactly this many".
- **Preview deployments**, excluded by the drain's `environments` above.

**Marginal cost of the 08-24 arm: effectively zero.** Firestore writes are
bounded by coalescing at ≤12/minute/instance and only during an incident (~$0.02
per sustained hour across a five-instance fleet at the $0.18/100k write price);
the probe reads at most 60 documents once per five minutes per instance
(~$0.0002/hour); the endpoint adds no GCP resource and no log ingest. The
Logging writes it sits beside were already budgeted at 60/minute/instance.

### Cost and plumbing

Everything above sits in the Cloud Monitoring free tier: ~300k uptime
executions/month against a 1M free allowance, alert policies and the email
channel are free, and the backup probe is one metadata-only REST call per
15 minutes. **Expected marginal cost: $0.** (Budget guard: the existing
`aglyn-main monthly spend` $20 alert.)

Measured 2026-08-18, because two readings of this were in circulation and
they are not the same quantity:

- **Metric points are not executions, and they are not billable here.** The
  `check_passed` timeseries carries ~430 points/hour for a 5-minute check and
  ~144/hour for a 15-minute one (6 checker locations × 6 samples per period),
  which totals ~2.1M points/month across the eleven checks. That number is
  real and it is *not* a cost: uptime-check metrics are Google system metrics,
  free to ingest. Confirmed directly rather than assumed —
  `monitoring.googleapis.com/billing/samples_ingested` and
  `billing/bytes_ingested` both return **no data at all** for `aglyn-main` over
  a 30-day window, i.e. this project ingests nothing chargeable.
- **Executions are the billable dimension** — 1M free per project per month —
  and the point count above does **not** settle how many there are. Read one
  way (one request per location per period) the checks come to roughly
  430k/month, about 43% of the allowance; read the other (one request per
  sample) they come to ~2.1M and we would be 1.1M over, which at $0.30/1,000
  is roughly $330/month. **The bill decides between those, and the bill says
  the first one.** A $330 line would have been shouting through the
  `aglyn-main monthly spend` $20 budget alert every month; it has not. Treat
  the headroom as real but not precisely known.
- **Re-read 2026-08-28, and the config had moved underneath the numbers
  above.** There are now **thirteen** checks, not eleven, and every one is
  pinned to three regions (`USA_VIRGINIA`, `EUROPE`, `ASIA_PACIFIC`) rather
  than the six the sample-density figure assumes. On the low reading that is
  summing `regions × (30d / period)` per check = **233,280 executions/month,
  ~23% of the allowance** — roughly half the 43% above, because halving the regions
  halved the executions. Count the regions from `selectedRegions` on the live
  configs before re-deriving any of this; the default is all of them and the
  flag that narrows it is `--set-regions`.
- Consequently the proposed `marketing-home` / `customer-site` 300s → 600s
  relaxation is **not worth making for cost reasons**. If we are on the low
  reading it saves nothing billable at all; if we are on the high reading it
  saves ~10% of an overage that would be visible in the budget alert and is
  not. Either way it halves sample density on the two customer-visible checks
  to buy headroom nobody is short of. Change the period if 10-minute detection
  is genuinely acceptable for those two pages — not to save money.
- Not verified here: the invoice itself. The billing account has no BigQuery
  billing export configured and neither the Cloud Billing API nor Monitoring
  exposes invoice lines, and there is no browser in the loop. **One look at
  Billing → Cost table, filtered to Cloud Monitoring, closes this for good** —
  it is the only thing that turns the inference above into a measurement.

The backup probe needed one IAM grant:
`roles/datastore.backupsViewer` (backups get/list, nothing else) to
`firebase-adminsdk-fcgi3@aglyn-main.iam.gserviceaccount.com` (2026-08-13).
The exports probe needs `storage.objects.list` on the export bucket, which
the same service account's pre-existing project-level `roles/storage.admin`
already covers; the export cron's own grants are documented in
`docs/DISASTER_RECOVERY.md`.

Checks and policies were created via the Monitoring REST API; to inspect or
edit, the console UI is fine, or
`gcloud monitoring uptime list-configs --project=aglyn-main`.

## Still missing

Tracked in **AGL-1148**:

- ~~An external uptime monitor with real alerting.~~ Exists as of 2026-08-13 —
  see "Production monitoring and alerting" above. The GitHub probe stays as a
  second, independent vantage point.
- **Stored samples** now accrue in Cloud Monitoring automatically; the
  availability figure can be read from the uptime dashboards once a quarter of
  history exists.
- ~~An incident-response and comms process.~~ Written as
  [`docs/INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) — severity levels tied to
  the checks in the table above, who is on point (one person, no rotation), and the
  comms rules. What is still missing from it is the **status page's
  incident-post mechanism**: the page shows live health only, so incident comms
  today are email to affected customers. That file specifies the cheapest
  honest version and why it works (`aglyn-docs` is a separate Vercel project,
  so a push updates the status page while the console is down).
- The uptime percentage itself, plus SLA credit terms — the commercial half,
  and the part that must not be guessed. Four options with their tradeoffs are
  laid out in [`docs/INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) §"The SLA
  decision"; the number remains AGL-1148 and remains the account owner's. The constraint
  worth carrying back here: the alert path's ~20-minute floor (5 min probe memo
  + 5 min check period + ~10 min sustained failure) means **nothing shorter is
  even visible**, against a 43-minute monthly budget at 99.9%.

A data breach is a different process with a statutory clock — see
[`docs/BREACH_NOTIFICATION.md`](BREACH_NOTIFICATION.md), whose §0 is built on
the honest-gaps list above.
