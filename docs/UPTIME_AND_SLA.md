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
GET  https://demo.aglyn.com/api/health         tenant runtime
GET  https://app.aglyn.com/api/health/backups  Firestore backup state (AGL-1490)
GET  https://app.aglyn.com/api/health/signups  org-creation volume (AGL-1536)
GET  https://app.aglyn.com/api/health/rate-limits
                                               rate-limiter fallbacks (AGL-1693)
GET  https://app.aglyn.com/api/health/billing  Stripe webhook delivery (AGL-1924)
GET  https://app.aglyn.com/api/health/error-beacon
                                               console beacon liveness (AGL-1923)
GET  https://aglyn.com/api/health/error-beacon tenant beacon liveness (AGL-1923)
HEAD <any>                                     liveness only, touches nothing
```

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
| `marketing-home` | `aglyn.com/` | 2xx and body contains `Aglyn` | 5 min |
| `customer-site` | `demo.aglyn.app/` | 2xx and body contains `Aglyn Demo` | 5 min |
| `backup-state` | `app.aglyn.com/api/health/backups` | HTTP 2xx and `$.status == "ok"` | 15 min |
| `signup-volume` | `app.aglyn.com/api/health/signups` | HTTP 2xx and `$.status == "ok"` | 5 min |
| `rate-limiter` | `app.aglyn.com/api/health/rate-limits` | HTTP 2xx and `$.status == "ok"` | 5 min |
| `billing-webhook` | `app.aglyn.com/api/health/billing` | HTTP 2xx and `$.status == "ok"` | 5 min |
| `beacon-heartbeat console` | `app.aglyn.com/api/health/error-beacon` | HTTP 2xx and `$.status == "ok"` | 15 min |
| `beacon-heartbeat tenant` | `aglyn.com/api/health/error-beacon` | HTTP 2xx and `$.status == "ok"` | 15 min |
| Cloud Functions | `execution_count{status != ok}` | > 2 failures in 5 min | metric |
| Cloud Scheduler | job attempt logged at `severity >= ERROR` | any | log match |

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
  (`deliveries-failing` — the AGL-1551 / AGL-1560 shape), or when the census
  could not be taken at all (`stripe-unavailable`; unknown is never a pass).
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
- `customer-site` asserts on the demo site's own content. If someone renames
  the demo site's title away from "Aglyn Demo", this check goes red — update
  the content matcher, don't delete the check.
- Incident emails carry a runbook snippet pointing back at this file. Alert
  fires after ~10 minutes of sustained failure (2+ probe regions), so a single
  blip does not page.

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
  makes every "check the runtime log" instruction in the tree executable. The
  policy is then a log-based counter on
  `httpRequest.status >= 500`, threshold to be tuned against a real beta
  baseline. AGL-1921 carries the fallback design (a first-party *server*-error
  beacon, the same trick AGL-1538 plays for the browser) for the case where
  the drain is not bought.
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
