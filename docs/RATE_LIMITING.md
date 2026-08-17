# Rate limiting

How abuse is bounded on the endpoints that anyone on the internet can call.

## The problem this fixed (AGL-794)

Every limiter in the codebase was a per-instance `Map`:

```ts
const recentByIp = new Map<string, number[]>()
```

Each carried an honest caveat — *"serverless instances are ephemeral, so this
only blunts bursts"* — and on Vercel that is close to no limit at all. The
counter resets on every cold start, and each concurrent instance keeps its
own, so the effective cap is roughly `limit × instances`. An attacker widens
it just by sending requests faster, which spreads them across more instances.

That is fine for damping accidental bursts. It is not a brute-force defense.

## What is durable now

`consumeRateLimit()` in `@aglyn/tenant-data-admin`
(`lib/server/rate-limit-store.ts`) backs the same fixed-window shape with a
Firestore counter, so the cap is global.

| Endpoint | Limit | Why durable |
| --- | --- | --- |
| `POST /api/protection/unlock` | 10 / min per (screen, IP) | Password guessing. The per-instance cap was directly bypassable. |
| `POST /api/forms/submit` | 10 / min per (site, IP) | Spam. The monthly plan quota is the hard cap, but burning a site's whole allowance *is* the damage — it shouldn't be the protection. |
| `POST /api/orgs/create` | 3 / hour per uid AND 10 / hour per IP | Scripted org minting (AGL-1534). The AGL-1523 signup grace admits a brand-new unverified account, so each fresh account can create one org; the uid key catches a stuck or scripted client, the IP key catches a farm rotating accounts. A real person creates at most 2–3 workspaces in a burst, so 3/h/uid clears every human while an office NAT signing up a team still fits under 10/h/IP. |
| `/api/v1/*` (customer REST API) | 120 / min per API key | The limit is **published** (AGL-1679). Not a secret to protect — a number customers plan against. See below. |
| `/api/*` plugin dispatcher, **writes** | 120 / min per (site, IP) | Unbounded document creation in the *merchant's* Firestore (AGL-1770). See below. |

Keys are compound on purpose. Unlock is keyed per *(screen, IP)* so a shared
office NAT can't be locked out of a whole site by one person, while one IP
still can't get a fresh budget for every screen it attacks.

## The visitor-write limiter on the plugin dispatcher (AGL-1770)

`apps/tenant/app/api/[...pluginApi]/route.ts` is the single chokepoint every
plugin's visitor endpoints pass through — cart, checkout, reserve, reviews,
newsletter, membership registration, bookings, A/B beacons — and it had **no
rate limit of any kind**. The gates it did have each refuse something
narrower: per-site enablement is skipped by an unresolvable `hostId`, the
release gate only checks that the plugin is on, and `visitorWriteRefusal`
refuses only a *paused or suspended* site. None of them bounds volume from a
working, enabled site, which is every live merchant.

AGL-1769 closed the *shape* of the unauthenticated cart write and was explicit
that it did not bound the *quantity* — "id control never multiplied volume; it
bought shape". This is the other half. The cost lands in the merchant's own
Firestore: document count and storage on a tenant who did nothing wrong.

Policy is pure and lives in `@aglyn/aglyn/server`
(`app-utils/plugin-api-rate-limit.ts`); the durable half is
`visitorWriteRateLimitRefusal` in `@aglyn/tenant-data-admin`, beside
`visitorWriteRefusal`. The reasoning for each decision is in those files; the
summary:

- **Key: compound (site, IP).** Per-site *alone* was rejected — one attacker
  would spend the merchant's whole allowance and every real shopper would then
  be refused, an attacker-triggered DoS against the victim that costs the
  merchant *sales* rather than storage. Per-IP alone is trivially distributed.
  A second, platform-wide per-IP limiter was considered and dropped: it costs a
  second transaction on every storefront write to bound an attack the compound
  key already prices at one full budget per merchant. The path is **not** in
  the key, so a caller cannot multiply its budget by cycling endpoints.
- **Ceiling: 120/min, deliberately generous.** `cart.tsx` puts the quantity
  field's `onChange` straight onto a POST with no debounce, so typing `100` is
  three writes; `experiments/track` is a per-page-view beacon. A limit that
  trips on genuine use is worse than none, because it gets raised until it
  means nothing. A tighter cap buys little: 120/min still allows ~172k
  documents/day from one source, 30/min ~43k. What the cap actually buys —
  turning a one-line flood script into something needing a botnet, and turning
  an incident from instantaneous into detectable — is bought at either.
- **Writes only.** Reads leave the dispatcher before any Firestore read, so a
  durable limiter there would be the *only* Firestore work in the request —
  the analytics-beacon anti-pattern this document already names. Tenant read
  cost is real but its remedy is caching and ISR, not a per-request
  transaction.
- **Machine surfaces are exempt**, by an explicit path list: `email/events`
  (Resend/Svix signature), `campaigns/send` (console token or `CRON_SECRET`),
  `bookings/reminders` (`x-cron-secret`) and `hooks/…` (per-hook secret, and it
  already carries its own 30/min limiter). Their volume is set by campaign size
  or a cron schedule, so no shopper-sized ceiling fits — one 50k-recipient
  campaign's open/click webhooks arrive from a handful of IPs for one host.
  The list is an *exemption* list, so the default is limited and a new visitor
  endpoint is covered by doing nothing; only a forgotten machine endpoint
  fails, and it fails loudly as 429s with `Retry-After`. Header presence
  (`authorization`, `svix-signature`) is deliberately **not** an exemption —
  the dispatcher cannot verify signatures it does not own, so any caller could
  attach a garbage one to a cart POST.
- **Placed after route resolution.** Limiting earlier would make an
  unregistered path — free today — cost a transaction, a cheaper amplification
  than the one being closed.
- **Not nested in `if (hostId)`.** A limiter a caller switches off by declining
  to name a site is not a limiter; host-less writes share one bucket per IP.

## A published limit is a third reason to be durable (AGL-1679)

The rule below was written as a two-way trade — cost against consequence — and
the REST API was filed under "cheap, already authenticated, protecting capacity
rather than a secret". That reasoning missed what the number *is*.

`apps/docs/api/rate-limits.md` publishes **120 requests per minute per API key**
and API usage is a plan differentiator, so this is a billed product surface: it
is the number an integrator sizes their client against and load-tests on day
one. Enforced per instance, the actual ceiling was `120 × warm instances` — it
moved with *our* traffic, not the customer's. A customer over their limit was
throttled inconsistently or not at all; a customer under it could still be cut
off by an unlucky cold instance. The docs disclosed the caveat honestly, which
made the page defensible and the limit no less unenforceable.

The cost objection does not survive contact with this endpoint either. Every
`/api/v1` request already does an API-key lookup, an org read and a usage-meter
write before it reaches a handler. One more transaction is proportionate to what
the request costs anyway — unlike the analytics beacon, where the limiter would
have been the *only* Firestore work in the request.

So the third question, alongside cost and consequence: **is the limit a number
we publish?** If it is, per-instance enforcement means the published number is
not the enforced one, and that is a defect regardless of how cheap the endpoint
is.

## What is deliberately NOT durable

`POST /api/analytics/collect` and the two `POST /api/errors` client error-report
endpoints still use in-memory limiters.

Each durable call is a Firestore transaction — one read plus one write. That
is the right price for a password attempt and the wrong price for a beacon
that can fire on every page view. The harm from analytics spam is polluted
numbers, not access; paying a write per pageview to prevent it would cost more
than the problem. Neither limit is published, so nobody is planning against it.

**Rule of thumb: `checkRateLimit` for volume, `consumeRateLimit` for
consequence — or for any limit we have published.**

## Failure behaviour: soft, not open

If Firestore is unreachable, `consumeRateLimit` falls back to the in-memory
limiter and returns `degraded: true`.

Neither extreme is right here. Failing fully **open** would let an attacker
disable brute-force protection by inducing a storage error — the protection
evaporates exactly when someone is attacking it. Failing fully **closed**
would lock legitimate visitors out of a customer's site over an unrelated
Firestore blip. Degrading to the per-instance cap keeps some protection, keeps
sites usable, and reports which happened.

### …but only if someone finds out it fired (AGL-1679)

`degraded: true` used to exist in one `console.error` and nothing else. A
Firestore blip therefore dropped **every** durable limiter — sign-in, password
reset, and now the REST API quota — back to a per-instance cap for as long as
it lasted, with the only record in a log retained for about an hour. Fail-soft
is a defensible choice only if the fallback is findable afterwards; otherwise
it is indistinguishable from the protection never having been there.

This is not an alerting stack. It is the cheapest thing that makes a degraded
window answerable after the fact:

- **The episode is written down, once.** When the store recovers, the instance
  writes one summary document — `rateLimits/degraded_{minuteBucket}` — with
  `calls`, `episodes`, `firstAtMs`, `lastAtMs`, `code` and `region`. Same
  collection on purpose: it inherits the deny-all rule and the `expiresAt` TTL
  policy that already exist, so this needed no new collection, no rules deploy
  and no second TTL policy. Markers carry a 30-day `expiresAt` rather than the
  counters' two minutes.
- **Written on recovery, never during.** The store is unreachable exactly while
  the episode is happening, so a marker written then is the one write
  guaranteed to fail.
- **The log stopped flooding.** It logs at the start of an episode, once a
  minute while it continues, and once on recovery with the totals. The REST API
  calls this on every request, so the old per-call `console.error` would have
  buried the signal it exists to be.

To see whether a window degraded, list the prefix:

```bash
# documents ids sort lexically, so a prefix range is a plain query
#   collection rateLimits, __name__ >= 'degraded_' and < 'degraded`'
```

A marker is per instance per episode, so several documents in one minute bucket
means several instances degraded — `episodes` counts them.

### …and only if someone is TOLD (AGL-1693)

The marker above only helps a person who already suspects something and goes
looking in Firestore. `GET /api/health/rate-limits` is the reader:

```
GET https://app.aglyn.com/api/health/rate-limits
→ 200 { "status": "ok",       "checks": { "rateLimits": { "degradedCalls": 0, … } } }
→ 503 { "status": "degraded", "checks": { "rateLimits": {
          "code": "rate-limiter-degraded", "degradedCalls": 240,
          "degradedEpisodes": 2, "minutesSinceLast": 4, "windowMinutes": 30 } } }
```

Same 200/503 contract as the sibling health endpoints, so the GCP uptime check
+ email path already watching serving watches this too — see
`docs/UPTIME_AND_SLA.md`, including the note that the GCP check itself is still
owed.

**It reports a trailing 30-minute window, and that is the whole design.**
Markers live 30 days. A check that asked "does a marker exist" would sit red
for a month after a thirty-second blip, and a check that is permanently red
gets muted — worse than not having one. This is the deliberate opposite of
`/api/health/backups`, red by design until the bad backup is gone, because a
missing restore point is a *condition* that persists while a degraded limiter
window is an *event* that is already over. The window floor is set by the alert
path (probe memo + check period + sustained-failure delay), not by taste.

The query filters on `lastAtMs`, not the document id: ids are bucketed on
`firstAtMs`, so an id-range window would miss precisely the long episodes. It
is a range plus an `orderBy` on one field, so the automatic single-field index
serves it — **no composite index, no `firebase-firestore.indexes.json` change
and no rules change**, same property the markers themselves have.

`RATE_LIMIT_ALARM_MAX_CALLS` overrides the "any fallback is degraded" default
without a deploy. `-1` makes even a clean probe report degraded: the way to
prove the alert path end to end without inducing a Firestore outage.

### What a degraded window leaves on the record (AGL-1667)

`POST /api/forms/submit` read `allowed` and `resetMs` and never `degraded`, so
on the one public, unauthenticated, *billed* endpoint a degraded window left no
trace at all.

It still fails soft — that is not reversed, and the fallback can only allow
*more* than 10/min, never fewer, so nothing legitimate is refused by it. What
it now does is stamp `rateDegraded: true` on the stored submission. The marker
says the store degraded at 14:02; only the row can say this invoice line
arrived during it, and `/api/billing/report-usage` prices these rows. The stamp
rides a write that was already happening — a separate counter would mean an
extra Firestore write per submission, issued exactly while Firestore is the
thing failing. It is never sent to the caller: "the global limiter is currently
a per-instance one" is the sentence an abuser would spend the window on.

The other call sites — unlock, passkeys, password reset, email verification,
org create, `/api/v1` — deliberately do **not** get an equivalent. None of them
writes a durable row a stamp could ride, so recording per-request degradation
there means an extra write during the outage, on the collection that is
failing. For those the marker plus the health endpoint above is the record.

Note the distinction from a fail-*open* default, the pattern the pre-release
audit flagged as systemic. The canonical example was the CSRF middleware's
`CSRF_SECRET = process.env.CSRF_SECRET || ''`, which signed with an empty key
when unset — making tokens forgeable while still reporting success. AGL-795
made it fail closed; AGL-919 then deleted the module outright, because an
audit found it had **no callers at all**: the fail-closed guard protected a
path nothing executed, and its presence in the env implied a protection that
did not exist. Degrading is only defensible here because the fallback still
enforces *something*, and because this limiter is actually wired to live
routes — which is the first thing to check before trusting any control.

## Operational: enable the TTL policy

Each call writes `rateLimits/{hash}_{windowStart}` with an `expiresAt`
timestamp. **Firestore does not act on that field by itself** — a TTL policy
has to be configured once, or these documents accumulate forever (roughly one
per caller per minute on each protected endpoint — small, but unbounded, and
the REST API added the highest-volume caller set of them).

> **TTL is not in the Firebase console.** It is a Firestore/Cloud feature and
> there is no Time-to-live tab under Firebase → Firestore. Looking for it
> there is a dead end.

Three ways to set it, in order of preference:

```bash
# 1. This repo's script (service-account auth, same pattern as the rules deploy)
set -a && source .env && set +a && node tools/scripts/set-firestore-ttl.mjs
#    --dry-run reports current state without changing anything
```

**Status: `rateLimits.expiresAt` is ACTIVE on `aglyn-main`** (enabled 2026-07-24).
The script *reads* state fine with the service account, but **cannot apply**
changes: `firebase-adminsdk-fcgi3@aglyn-main.iam.gserviceaccount.com` lacks
`datastore.indexes.update`, and it cannot even read the project IAM policy —
so it can never grant itself that role. Applying a NEW policy therefore needs
a human-authenticated `gcloud` (below), or a one-time grant from an account
with IAM admin:

```bash
gcloud projects add-iam-policy-binding aglyn-main \
  --member="serviceAccount:firebase-adminsdk-fcgi3@aglyn-main.iam.gserviceaccount.com" \
  --role="roles/datastore.indexAdmin"
```

That grant is optional — it only buys unattended future runs. The `gcloud`
route below needs no widening at all.

```bash
# 2. gcloud directly, as a human with project access
gcloud firestore fields ttls update expiresAt \
  --collection-group=rateLimits --project=aglyn-main --enable-ttl
```

3. **Google Cloud console** (not Firebase): console.cloud.google.com →
   Firestore → your database → **Time-to-live** → Create policy →
   collection group `rateLimits`, field `expiresAt`.

Firestore deletes expired documents *after* the timestamp, usually within 24h.
That is cleanup, not a correctness boundary — buckets are keyed by window
start, so a stale document is simply never read again.

## Privacy

Bucket keys contain client IPs, so the document id is a truncated SHA-256 of
the key rather than the key itself. IPs are personal data and would otherwise
sit in plaintext ids, which also surface in index exports. Hashing has the
side benefit of producing ids that are always Firestore-safe.

## Rules

`rateLimits` is denied to all clients in `cloud/firebase-firestore.rules`. A
client that could write these could reset its own counter, which defeats the
point; one that could read them could see which buckets are near their cap.

The rule is explicit rather than load-bearing — there is no catch-all match in
the ruleset, so unmatched collections are denied anyway, and the Admin SDK
bypasses rules entirely. It does not need an urgent deploy; it will go out
with the next `node tools/scripts/deploy-firestore-rules.mjs` run.

`match /rateLimits/{bucketId}` is a wildcard over document ids, so the
`degraded_*` markers are covered by the same rule and needed **no rules change
at all** — which is most of why they live in this collection rather than one of
their own.

## Adding a limiter

```ts
import { consumeRateLimit } from '@aglyn/tenant-data-admin'

const rate = await consumeRateLimit(`myfeature:${scopeId}:${ip}`, {
  limit: 10,
  windowMs: 60_000,
})
if (!rate.allowed) {
  return Response.json({ error: 'Too many requests' }, {
    status: 429,
    headers: { 'Retry-After': String(Math.ceil((rate.resetMs - Date.now()) / 1000)) },
  })
}
```

Always send `Retry-After` on a 429 — without it a well-behaved client has no
idea when to come back and will usually just retry immediately.
