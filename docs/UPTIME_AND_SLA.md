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
GET  https://app.aglyn.com/api/health     console
GET  https://demo.aglyn.com/api/health    tenant runtime
HEAD <either>                             liveness only, touches nothing
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

## Still missing

Tracked in **AGL-1148**:

- An external uptime monitor with real alerting.
- A public status page.
- An incident-response and comms process.
- The uptime percentage itself, plus SLA credit terms — the commercial half,
  and the part that must not be guessed.
