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
| `rate-limiter` ⚠️ | `app.aglyn.com/api/health/rate-limits` | HTTP 2xx and `$.status == "ok"` | 5 min |
| Cloud Functions | `execution_count{status != ok}` | > 2 failures in 5 min | metric |
| Cloud Scheduler | job attempt logged at `severity >= ERROR` | any | log match |

Notes that keep these honest:

- ⚠️ **`rate-limiter` is the only row above that is not yet created in GCP.**
  The endpoint ships and is spec-covered; the uptime check and its alert policy
  are a console/API action against production and are owed (AGL-1693). Until
  that is done the endpoint answers correctly and nobody is listening, which
  is the same gap AGL-1693 was filed for — one layer up. Create it exactly like
  `signup-volume`: uptime check on the path, 5-minute period, JSONPath matcher
  `$.status == "ok"`, notification channel `7043898327231541746`. Prove the
  path end to end with the forced-failure lever (`RATE_LIMIT_ALARM_MAX_CALLS=-1`
  in the console's Vercel env → every probe reports degraded → expect the
  email → unset), which is why that knob exists.
- `console-imaging` exists because `imaging.ok` is **deliberately body-only** —
  variant encoding being down is degraded, not an outage, so it must not 503
  the main check. A status-code monitor is blind to it; this check reads the
  body with a JSONPath matcher. That failure mode was real: three weeks of no
  WebP variants, discovered by archaeology (AGL-1468).
- `backup-state` closes AGL-1490's alert gap: 503 when any backup is failed,
  none is READY, or the newest READY is older than 8 days. The probe's verdict
  logic is `backupsHealth` in `health-report.ts`, spec-covered.
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
  muted. That is the deliberate **opposite** of `backup-state`, which is red by
  design until the bad backup is gone (`DISASTER_RECOVERY.md` gap 2) because a
  missing restore point is a *condition* that persists; a degraded limiter
  window is an *event* that is already over. The window's floor is set by this
  alert path, not by taste: 5 min probe memo + 5 min check period + ~10 min
  sustained-failure before the email means anything under ~20 minutes can go
  red and green again before anyone is told.
- `customer-site` asserts on the demo site's own content. If someone renames
  the demo site's title away from "Aglyn Demo", this check goes red — update
  the content matcher, don't delete the check.
- Incident emails carry a runbook snippet pointing back at this file. Alert
  fires after ~10 minutes of sustained failure (2+ probe regions), so a single
  blip does not page.

### What is deliberately NOT watched (the honest list)

- **Vercel function errors and logs.** Hobby has no log drains — a 500 spike
  invisible to the health checks (one broken route, one bad deploy path) is
  observable only by a user report. **Upgrade path:** Vercel Pro unlocks log
  drains → pipe to GCP Logging → the same alerting stack picks it up.
- **APM / client-side error tracking.** No Sentry or similar. A browser-side
  crash in the builder is invisible end to end. Post-launch decision, tracked
  in AGL-1148's follow-ups; Sentry's free tier (5k events/mo) likely suffices
  at beta scale.
- **Email delivery** (Resend outages), **Stripe webhooks**, and **DNS**: no
  synthetic coverage. Each has failed loudly rather than silently so far;
  revisit if that stops being true.

### Cost and plumbing

Everything above sits in the Cloud Monitoring free tier: ~300k uptime
executions/month against a 1M free allowance, alert policies and the email
channel are free, and the backup probe is one metadata-only REST call per
15 minutes. **Expected marginal cost: $0.** (Budget guard: the existing
`aglyn-main monthly spend` $20 alert.)

The backup probe needed one IAM grant:
`roles/datastore.backupsViewer` (backups get/list, nothing else) to
`firebase-adminsdk-fcgi3@aglyn-main.iam.gserviceaccount.com` (2026-08-13).

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
- An incident-response and comms process, and whoever updates the status page
  during one.
- The uptime percentage itself, plus SLA credit terms — the commercial half,
  and the part that must not be guessed.
