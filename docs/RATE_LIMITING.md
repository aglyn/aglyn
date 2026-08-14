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

Keys are compound on purpose. Unlock is keyed per *(screen, IP)* so a shared
office NAT can't be locked out of a whole site by one person, while one IP
still can't get a fresh budget for every screen it attacks.

## What is deliberately NOT durable

`POST /api/analytics/collect` still uses the in-memory limiter.

Each durable call is a Firestore transaction — one read plus one write. That
is the right price for a password attempt and the wrong price for a beacon
that can fire on every page view. The harm from analytics spam is polluted
numbers, not access; paying a write per pageview to prevent it would cost more
than the problem.

The same reasoning applies to `checkRateLimit()` in `api-http.ts`, which the
customer REST API uses per key. Those callers are already authenticated, so
the limiter is protecting capacity rather than a secret. If it needs to become
global later, swap the call — the shapes match.

**Rule of thumb: `checkRateLimit` for volume, `consumeRateLimit` for
consequence.**

## Failure behaviour: soft, not open

If Firestore is unreachable, `consumeRateLimit` falls back to the in-memory
limiter and returns `degraded: true`.

Neither extreme is right here. Failing fully **open** would let an attacker
disable brute-force protection by inducing a storage error — the protection
evaporates exactly when someone is attacking it. Failing fully **closed**
would lock legitimate visitors out of a customer's site over an unrelated
Firestore blip. Degrading to the per-instance cap keeps some protection, keeps
sites usable, and reports which happened.

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
per caller per minute on the two protected endpoints — small, but unbounded).

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
