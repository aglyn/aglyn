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

## The status page

**https://docs.aglyn.com/status**

Served from the docs site on purpose. `aglyn-docs` is a separate Vercel project
from the console and the tenant runtime, so a console outage does not take the
page reporting it down with it — which is the whole job. A status page served by
the thing it reports on is decoration.

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
monitors. **Every alert emails zach@aglyn.com** (notification channel
`7043898327231541746`).

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
  run that produced nothing usable, so that is what is measured. Since
  AGL-1843 the same endpoint carries a SECOND, separately-labeled check —
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
  nothing** (`handlers-inert`, AGL-1954), or when the census
  could not be taken at all (`stripe-unavailable`; unknown is never a pass).
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
  reading it also gives on a healthy day. **A dead beacon is
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
  deliberately idle. Grace per job is generous on purpose (6h daily, 24h
  weekly, 90 min for the frequent sweeps): GitHub delays scheduled workflows
  routinely, and a row that reds on ordinary lateness is one people mute.
  **Clearing event:** the next invocation of that job; nothing latches.
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

### Verifying the monitor yourself {#verifying-the-monitor-yourself}

The lesson of the fifty-one hours is that a documented monitor is not a
monitor. **Confirm the sink exists before trusting the report.** Both of these
are read-only and need only an authenticated `gcloud` session:

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
All eleven existing checks have `validateSsl: true`, because the console
checkbox is on by default — the CLI's is not. Omitting the flag creates the
one check in the set that would keep reporting green through an expired or
invalid certificate on `app.aglyn.com`. Verified against the live configs on
2026-08-23 (AGL-2486): 11 of 11 `true`.
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
   duration **10 minutes**, notification channel the existing
   **zach@aglyn.com** email channel. **Next.**
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

- **The server-side error RATE (AGL-1921).** This is the largest remaining
  hole and it deserves its own line rather than a clause. Every check above is
  a *liveness* signal on one URL: they answer "is `/api/health` up", and not
  one of them can answer "are 30% of checkout requests 500ing". **A route can
  500 for every paying customer while every check above stays green.** It
  cannot be built today, and the reason is specific: server errors live in the
  Vercel runtime log, which retains ~60 minutes and drains nowhere —
  `GET /v2/integrations/log-drains` returns `[]` on both `aglyn-console` and
  `aglyn-tenant` (AGL-1799). Nothing from the running app reaches GCP Logging,
  so there is nothing in `aglyn-main` for a log-based metric or a log-match
  policy to key on. **Do not paper over this with a reachability probe.** The
  health endpoints on this page are correctness signals for the subsystems
  they name — beacon transport, Stripe delivery, backups, rate limiters — and
  each is honest about what it reads; none of them is an error rate, and
  dressing one up as one would be worse than the gap. The unblocking decision
  is a Vercel log drain into GCP Logging: it closes this, closes AGL-1799, and
  makes every "check the runtime log" instruction in the tree executable.
  **Partly closed since 2026-08-20** by AGL-1921's fallback arm — see the
  runbook below for what now reaches GCP, what still does not, and the
  ordered steps that finish it.
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

**What it still cannot see, and this is why the issue stays open.** It is a
fallback, not the fix. It misses an error that kills the process before the
handler runs, a platform-level 5xx that never reaches our code (a Vercel
function timeout, an OOM, a cold-start 502), and anything thrown in the edge
runtime, where firebase-admin cannot be loaded. A log drain sees all of them.

#### Ordered steps — Zach

**No GCP resource was created for this.** Steps 1 and 2 are free and can be done
today; step 3 onward costs money and is a decision, not a task.

1. **Free, and does the most: an alert policy on the new log.** The beacon is
   already writing, so this needs no Vercel change at all. In `aglyn-main` →
   Monitoring → Alerting, create a **log-based alert** on

   ```
   logName="projects/aglyn-main/logs/server-errors" AND severity>=ERROR
   ```

   Notify the existing `zach@aglyn.com` channel. Start it as a *log-match*
   (pages on the first entry) for the beta window — volume is near zero today,
   so a first-error page is informative rather than noisy — and convert it to a
   counter with a threshold once a baseline exists. Log-based metrics and alert
   policies are not separately billed; the log entries themselves fall under the
   Logging free tier at this volume.
2. **Free: confirm it can go red.** Do not trust an untested alarm. The AGL-1923
   beacon heartbeat already proves the credential and transport this path shares
   — check `/api/health/error-beacon` is green on both deployments, which is the
   dead-man's switch for server-error reporting too. Then force one real server
   error on a preview deployment and confirm the entry lands and the policy
   fires.
3. **Billable, and the real fix: a Vercel log drain into GCP Logging.**
   Log drains require **Vercel Pro** (~$20/user/month; tracked as AGL-723,
   already targeted for mid-September). Once on Pro: Vercel → each of
   `aglyn-console` and `aglyn-tenant` → Integrations → Log Drains → add a drain
   to GCP Logging. Verify with `GET /v2/integrations/log-drains`, which returns
   `[]` on both projects today — that empty array is the current evidence of the
   gap, so it is also the check that the drain took.
4. **After the drain, the policy this issue originally specified.** A log-based
   counter metric on

   ```
   resource.type="global" AND logName=~"vercel" AND httpRequest.status>=500
   ```

   with a threshold policy — proposed `> 5` in 5 minutes, `ALIGN_DELTA` /
   `REDUCE_SUM`, grouped by project. Re-tune against the beta baseline; the
   point of the beta window is to get one.
5. **Then reconcile the two.** With the drain live, the drain sees a superset of
   what the beacon sees, and keeping both would double-page. Keep the beacon —
   it survives a Vercel outage and a plan downgrade — but demote its policy to
   the counter form so the drain's policy is the one that pages.

Until step 3 lands, AGL-1921 stays open and this section is the honest statement
of how much of the server tier is actually watched.

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
  way (one request per location per period) the eleven checks come to roughly
  430k/month, about 43% of the allowance; read the other (one request per
  sample) they come to ~2.1M and we would be 1.1M over, which at $0.30/1,000
  is roughly $330/month. **The bill decides between those, and the bill says
  the first one.** A $330 line would have been shouting through the
  `aglyn-main monthly spend` $20 budget alert every month; it has not. Treat
  the headroom as real but not precisely known.
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
  the checks in the table above, who is on point (Zach, no rotation), and the
  comms rules. What is still missing from it is the **status page's
  incident-post mechanism**: the page shows live health only, so incident comms
  today are email to affected customers. That file specifies the cheapest
  honest version and why it works (`aglyn-docs` is a separate Vercel project,
  so a push updates the status page while the console is down).
- The uptime percentage itself, plus SLA credit terms — the commercial half,
  and the part that must not be guessed. Four options with their tradeoffs are
  laid out in [`docs/INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) §"The SLA
  decision"; the number remains AGL-1148 and remains Zach's. The constraint
  worth carrying back here: the alert path's ~20-minute floor (5 min probe memo
  + 5 min check period + ~10 min sustained failure) means **nothing shorter is
  even visible**, against a 43-minute monthly budget at 99.9%.

A data breach is a different process with a statutory clock — see
[`docs/BREACH_NOTIFICATION.md`](BREACH_NOTIFICATION.md), whose §0 is built on
the honest-gaps list above.
