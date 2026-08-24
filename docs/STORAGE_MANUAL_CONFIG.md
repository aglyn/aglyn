<!--
 Copyright 2026 Aglyn LLC — Apache-2.0
-->

# Cloud Storage manual configuration (gcloud only)

Bucket-level configuration is **not** managed by `firebase deploy`. It lives
only in the project and is invisible to code review, which is exactly how the
signed direct-to-GCS upload path shipped unable to complete from a browser
(AGL-1408): the route minted a valid signed URL, returned 200, and the `PUT`
that followed could never run because the bucket had no CORS rule at all.
This file is the source of truth for that config so it stays reproducible.

Prod project: **`aglyn-main`**.

## The buckets, and which is which

| Bucket | Registered with Firebase? | What it holds |
| -- | -- | -- |
| `gs://aglyn-main.appspot.com` | Yes — the default Firebase Storage bucket | All tenant/org media: the DAM, host assets, audit archives. Both upload routes (`/api/media/upload` and `/api/media/upload-url`) write here, via `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`. |
| `gs://$PLUGIN_ARTIFACTS_BUCKET` | **No** — deliberately | Marketplace plugin bundles only. Invisible in the Firebase console's Storage tab; use `gcloud`. Its lifecycle policy is `cloud/plugin-artifacts-lifecycle.json` — see `docs/PLUGIN_LOADING.md`. |

Do not confuse the two. The CORS rule below belongs on the **media** bucket;
the plugin bucket is never reached from a browser at all (the console's
`/api/plugin-artifacts/…` route is its only read path).

## What `firebase deploy` DOES manage (so it lives in the repo, not here)

`firebase deploy --only storage` replaces the ruleset from
`cloud/firebase-storage.rules`. That governs **Firebase SDK** access to the
bucket. It has no bearing on the CORS rule below: a signed URL is a GCS-level
credential and bypasses Firebase Security Rules entirely, and CORS is a
bucket-metadata property that no rules file can express.

## What `firebase deploy` does NOT manage (documented + applied here)

### 1. Bucket CORS for signed direct-to-storage uploads (AGL-1408)

`cloud/storage-cors.json` carries the policy.

```bash
gcloud storage buckets update gs://aglyn-main.appspot.com \
  --cors-file=cloud/storage-cors.json --project=aglyn-main

# read it back:
gcloud storage buckets describe gs://aglyn-main.appspot.com \
  --format="value(cors_config)" --project=aglyn-main
```

Revert with `--clear-cors`. **`--cors-file` replaces the whole config**; it does
not merge, so the file must always carry every rule the bucket should have.

#### Why the rule is needed at all

Files above `SIGNED_UPLOAD_THRESHOLD_BYTES` (3 MB — video, PDF, ZIP) cannot use
the base64-JSON route, because Vercel rejects any serverless request body over
4.5 MB at the platform layer before our handler runs. They go direct instead:
`POST /api/media/upload-url` mints a v4 signed URL, the browser `PUT`s the bytes
straight to `storage.googleapis.com`, and `PATCH` finalizes. A `PUT` is never a
CORS "simple request", and `Content-Type: application/pdf` is not a safelisted
value either, so **that call is always preflighted** — with no CORS config, the
preflight is unanswered and the upload dies as `TypeError: Failed to fetch`
behind a generic "try again" snackbar. Ordinary images never take this path,
which is why the break was invisible in everyday use.

### 1a. Adding an origin — the console does it, and what to do when it cannot (AGL-1452)

**GCS matches the `origin` list as an exact string.** There is no subtree form.
This is the OPPOSITE of the App Check reCAPTCHA allowlist, which matches a
listed name and everything beneath it — and reasoning across from that list is
the natural move, since both are "allowed domains for the platform".

Re-measured against the live bucket on 2026-08-20 by driving real preflights
(`OPTIONS` with `Origin` + `Access-Control-Request-Method: PUT`):

| Origin | Preflight answer |
| -- | -- |
| `https://app.aglyn.com` | `access-control-allow-origin: https://app.aglyn.com` |
| `https://console.aglyn.com` | no CORS headers — and it does not need them: `308 → app.aglyn.com` |
| `https://app.aglyn.io` | no CORS headers — `307 → app.aglyn.com` |
| `https://zgover.aglyn.com` | **no CORS headers, and it SERVES the console at 200** |
| `http://app.aglyn.com` | no CORS headers (scheme is part of the match) |
| `https://app.aglyn.com.evil.example` | no CORS headers (no suffix matching) |

The rule that falls out, and the one the code now encodes: **a name attached to
the console project as a REDIRECT never becomes a browser origin and needs no
entry; a name that SERVES the console does.**

`attachProjectDomain()` — the single seam every console name goes through, org
workspace subdomains and white-label console domains alike — now reconciles the
bucket itself: it reads the live CORS, merges the new origin in, and writes it
back conditional on the metageneration it read. Nobody has to remember this at
attach time any more.

**When it cannot**, which in practice means the runtime service account has no
`storage.buckets.update`, the attach still succeeds and the result carries
`uploadCors.permitted: false` plus the exact command. Do it by hand:

```bash
# 1. READ the live document. Do not skip this step.
gcloud storage buckets describe gs://aglyn-main.appspot.com \
  --format=json\(cors_config\) --project=aglyn-main > /tmp/cors.json

# 2. ADD the origin to the rule whose method is PUT. Keep every existing entry.

# 3. Write it back.
gcloud storage buckets update gs://aglyn-main.appspot.com \
  --cors-file=/tmp/cors.json --project=aglyn-main

# 4. Prove it with the request a browser actually makes — not a config read-back.
curl -sS -D - -o /dev/null -X OPTIONS \
  -H 'Origin: https://acme.example.com' \
  -H 'Access-Control-Request-Method: PUT' \
  -H 'Access-Control-Request-Headers: content-type,x-goog-resumable' \
  https://storage.googleapis.com/aglyn-main.appspot.com/probe | grep -i access-control
```

⚠️ **`--cors-file` replaces rather than merges.** Building a fresh document from
the origins you happen to know about drops every other customer's, and that
failure lands on them, days later, as a large upload that fails behind a generic
snackbar. Step 1 is the whole procedure.

`libs/aglyn/src/lib/app-utils/upload-cors.ts` holds the matching rules and the
merge, with `upload-cors.spec.ts` pinning each against the measurements above.
It refuses to emit `*` at all.

#### 1b. The list is DERIVED, and drift is checkable (AGL-1452)

Attach-time reconcile alone only ever **grows** the allowlist. It closes the
future and does nothing about two other directions, both of which were live on
2026-08-24:

* **Names attached before it existed.** Nothing walked the project. Of the
  console project's 20 attached names, 15 served and only **6** were permitted.
  Nine serving names could not complete a large upload — up from the five
  measured on 2026-08-20, because add-on-attach makes that number grow.
* **Detach never reclaimed.** The bucket still carried five
  `agl1514-smoke-*.aglyn.com` origins from a smoke run. For an `*.aglyn.com`
  name that is untidy; for a **white-label console domain** it is a standing
  permission to complete a signed `PUT`, held by a host the customer keeps.

Both are closed, and neither is a checklist line:

```bash
npm run check:upload-cors             # report only; writes nothing
npm run check:upload-cors -- --fix    # merge the missing origins in
npm run check:upload-cors -- --prune  # ALSO remove origins nothing serves
```

The expected origin set is **derived**, not maintained: it is computed from the
same Vercel project-domains resource `attachProjectDomain()` writes to, where a
name with no `redirect` is a serving origin and a name with one is not. A name
cannot serve the console without being there, so the list cannot silently fall
behind the customers.

Exit codes — **cannot-check never masquerades as clean**: `0` the bucket permits
exactly the derived set · `1` drift (missing origins, stale origins, or a
wildcard) · `2` no credential, an API refusal, or a failed write.

`--fix` and `--prune` are separate on purpose. Adding is additive and safe;
removing is a permission withdrawal, and a run that healed and pruned in one
motion would make a routine fix carry an irreversible half nobody asked for. The
platform origin is refused by both, structurally: removing it breaks large
uploads for every customer at once.

`detachProjectDomain()` now calls `releaseUploadCors()` on a successful detach,
so the reverse direction closes itself the same way the forward one does.

#### Is "an entry per customer" bounded? (AGL-1353 asked; answered 2026-08-24)

**Not by a count.** Google documents no maximum number of CORS entries or
origins per bucket. The real ceiling is a different one, and it is documented:

> Maximum rate of bucket metadata updates per bucket: **one update per second.**
> "Rapid updates to a single bucket (for example, changing the CORS
> configuration) might result in throttling errors."

So the constraint on attach-time reconcile is **write contention**, not list
length. Two attaches racing contend on the conditional write; a burst contends
on the rate limit. Both surface as a `412` or a `429`, which is the expected
shape under load rather than an anomaly — the reconcile reports `permitted:
false` with the remedy rather than treating it as written, and
`check:upload-cors` heals whatever a contended write missed. The proxy-the-PUT
alternative is therefore **not forced**; it stays a preference, not a necessity.

#### The origin list, and what does and does not belong in it

> Heading note: this section was written when the rule held **one** origin. It
> holds 15 as of 2026-08-24 — one per serving console name, derived (§1b). The
> per-origin reasoning below is unchanged and is still the test for whether a
> new name belongs.

The signed URL already carries the authorization. CORS here is not deciding
*who* may write — it is deciding **which page may present a signed URL**, for
the URL's full 15-minute TTL. `*` on a bucket that accepts signed writes would
let any site on the internet finish an upload with a leaked URL, so it is not
an acceptable answer here and `apps/console/specs/storage-cors.spec.ts` fails
the build if it ever appears.

| Origin | In the rule? | Why |
| -- | -- | -- |
| `https://app.aglyn.com` | **Yes** | The canonical console. Routing is path-based (`app.aglyn.com/{slug}`), so every org's DAM is served from this one origin. |
| `https://console.aglyn.com` | No | Measured 2026-08-12: `308 → https://app.aglyn.com/`. It never renders the app, so no page there can issue the `PUT`. |
| `https://aglyn.com`, `https://www.aglyn.com` | No | The marketing site. It is served by the **tenant** runtime (host `aglyn-marketing`, `cname: aglyn.com` — AGL-1607), not by a separate marketing app, but the verdict is unchanged: the tenant runtime only *serves* published pages and never issues a signed `PUT`. DAM uploads happen in the console. |
| `https://<slug>.aglyn.com` (org workspace subdomains) | **Yes, all of them — since 2026-08-24** | The middleware **rewrites** rather than redirects, so the origin is preserved and each one needs its own entry. The 2026-08-12 reading (`demo.aglyn.com`, `northwind.aglyn.com` → `404`, none attached) was stale by 2026-08-20, when five served and none were permitted; by 2026-08-24 that was **nine of fifteen serving names refused**. `check:upload-cors --fix` added all nine (metageneration 10 → 11, nothing removed) and real preflights now echo each one. See §1b. |
| Custom console domains (AGL-1099c white-label, shipped AGL-1378) | **Yes, on attach** | Same rewrite, same consequence: a customer console on their own domain is a distinct origin. `attachProjectDomain()` reconciles it, `detachProjectDomain()` reclaims it, and `check:upload-cors` catches whatever either missed. |
| `*.vercel.app` preview/branch hosts | No, deliberately | `aglyn-console-aglyn.vercel.app` serves a fully working console today, and AGL-1344 exists to **remove** that exposure. Adding it to a bucket allowlist would entrench a host we are deleting. |
| `http://localhost:*` | No | Consequence, stated plainly: **signed uploads over 3 MB cannot be exercised on localhost.** Small files use the base64 route and are unaffected. Add a `http://localhost:4200` entry temporarily if you need to drive the large path locally, and take it back out — a permanent localhost entry means any page on a developer's machine can spend a leaked signed URL. |

#### The ceiling (measured 2026-08-12)

GCS matches `origin` as an **exact string**, not a subtree. Probed against the
live rule with the real preflight:

| `Origin` sent | `Access-Control-Allow-Origin` returned |
| -- | -- |
| `https://app.aglyn.com` | `https://app.aglyn.com` |
| `https://sub.app.aglyn.com` | *(none — blocked)* |
| `http://app.aglyn.com` | *(none — blocked)* |
| `https://app.aglyn.com.evil.example` | *(none — blocked)* |
| `https://acme.aglyn.com` | *(none — blocked)* |

So there is **no `*.aglyn.com` form**. This is the opposite of the reCAPTCHA
App Check allowlist, where a bare entry covers its whole subtree — do not
reason across from that one. Every org workspace subdomain and every
white-label console domain that ever needs a >3 MB upload will need its **own
exact entry here**.

That is still true, and it is no longer a *manual* per-customer step: the entry
is derived and applied by `attachProjectDomain()`, reclaimed by
`detachProjectDomain()`, and audited by `npm run check:upload-cors` (§1b). It is
also not a commercial ceiling — Google documents no cap on the number of entries,
only a **one-update-per-second** limit on bucket metadata, which bounds the
write rate and not the customer count. The proxy-the-`PUT` alternative remains
available but is not forced.

#### `x-goog-resumable`

Present in `responseHeader` but **not currently sent by any client** — the
uploader does a single `PUT` with only `Content-Type`. It is headroom for a
resumable upload, which the 200 MB video cap will eventually want. Note that
`responseHeader` is what GCS answers a preflight's
`Access-Control-Request-Headers` from, so a client that starts sending a new
header needs it added here first; the spec asserts that coupling in the other
direction.

### 2. Bucket lifecycle — retention on the artifact prefixes (AGL-1443)

`cloud/media-bucket-lifecycle.json` carries the policy. **The bucket had no
lifecycle configuration at all before it.**

```bash
gcloud storage buckets update gs://aglyn-main.appspot.com \
  --lifecycle-file=cloud/media-bucket-lifecycle.json --project=aglyn-main

# read it back:
gcloud storage buckets describe gs://aglyn-main.appspot.com \
  --format="value(lifecycle_config)" --project=aglyn-main
```

Revert with `--clear-lifecycle`. **`--lifecycle-file` replaces the whole
config**; like `--cors-file` it does not merge, so the file must always carry
every rule the bucket should have.

#### Every prefix in this bucket, and what bounds it

| Prefix | Written by | Bounded by |
| -- | -- | -- |
| `orgs/{orgId}/…`, `hosts/{hostId}/…` | the DAM and the media routes (`media-scope.ts`) | **Code, never age.** `eraseOrg`/`eraseHost` sweep them. See the warning below. |
| `users/{uid}/…` | avatar upload | **Code, never age.** `eraseUser` sweeps it. |
| `adminAudit-archive/{yyyy-MM}/*.jsonl` | `/api/admin/audit-archive` | **`age: 365`** — this rule. |
| `erasures/{orgId}/*.json` | **nothing, since AGL-1443** | **`age: 30`** — a backstop, not the policy. |
| `marketplaceListings/{id}/preview` | `libs/plugins/marketplace/.../preview-image.ts` | **Nothing, deliberately.** See below. |

> **A rule here can delete live customer media, and nothing would say which.**
> Lifecycle matches on age and has no view of Firestore. A Delete rule with no
> `matchesPrefix`, or one naming `orgs/`, `hosts/` or `users/`, would age out
> the bytes behind media documents that still exist, across every live
> workspace. `apps/console/specs/media-bucket-lifecycle.spec.ts` fails the
> build on either shape.

#### The two periods, and why they are those numbers

**`adminAudit-archive/` — 365 days.** The archiver advertises
`RETENTION_DAYS = 90`, but it only ever *moved* entries: out of Firestore, into
this prefix, where nothing reaped them. Rows name the org and some carry
`email` (`sso-jit/route.ts` writes one). The prefix does not exist in
production yet — the oldest audit rows are 2026-08-01, so it first materialises
around **2026-10-30**, which is the deadline on applying this rule. GCS ages an
object from its own creation and the archive object is created at the *end* of
the 90-day Firestore window, so 365 is the floor on every entry inside it, not
an average: an audit entry is retained about **15 months end to end**.

**`erasures/` — 30 days, as a backstop.** `eraseOrg` no longer writes here at
all. It used to persist a complete verbatim copy of the org tree and every host
tree — including `webhooks.secret`, `orders.paymentLinkUrl`,
`screens.protection.passwordHash` and `ssoDomains.token` — on a prefix its own
storage sweep does not cover. That object is gone rather than shortened: the
proof that an erasure happened is the `adminAudit` `org.erased` row, which is
ids and counts, and a governed full copy already exists in the weekly Firestore
backups (14-week retention, AGL-871). **Zero of these objects were ever created
in production**, so there is nothing to clean up; the rule exists so a revert or
a future writer cannot quietly recreate an unbounded prefix.

Both periods are the DPA §11 commitment — *"a limited period, after which it
will be deleted or de-identified"* — made enforceable. Note that **soft delete
is on (7 days)**, so nothing here frees bytes or removes an object for a week
after its rule fires. That is true of a manual delete too.

#### `marketplaceListings/{id}/preview` gets no rule, on purpose

It is the third prefix outside every erasure sweep, and it is **not a retention
artifact** — it is the live preview image of a published listing, referenced by
`previewImageUrl` on the listing document. An age-based rule would 404 the
browse card of a listing that is still for sale. It survives an org erasure
because the *listing* does, and whether a listing outlives its publisher is
AGL-1448's Tier 3 product decision (an erased org's listing is something buyers
paid for). Whatever that decision is, it has to take this object with it —
deleting the Storage object here without the Firestore document, or the other
way round, is the AGL-1443 shape again in the opposite direction.

### Current bucket settings (lifecycle re-verified 2026-08-18)

Lifecycle: **APPLIED**. It was `none` when measured on 2026-08-12 — AGL-1496
filed that gap and applied `cloud/media-bucket-lifecycle.json` on 2026-08-13.
Read back on 2026-08-18, both rules are live:

```
$ gcloud storage buckets describe gs://aglyn-main.appspot.com \
    --format='value(lifecycle_config)' --project=aglyn-main
rule=[{'action': {'type': 'Delete'}, 'condition': {'age': 365, 'matchesPrefix': ['adminAudit-archive/']}},
      {'action': {'type': 'Delete'}, 'condition': {'age': 30, 'matchesPrefix': ['erasures/']}}]
```

Soft delete is `retentionDurationSeconds: 604800` (7 days), also read back the
same day. The retention schedule these two settings implement is
[`docs/DATA_RETENTION.md`](DATA_RETENTION.md).

Object **versioning is OFF** on this bucket and on
`gs://$PLUGIN_ARTIFACTS_BUCKET` — no `versioning` key is returned by
`GET /storage/v1/b/<bucket>?fields=versioning`, re-measured 2026-08-20 — and
that is currently the correct setting. See the warning below before changing
it.

### ⚠️ Do NOT enable object versioning on the media bucket as a backup (AGL-2422)

It looks like the cheap fix for "customer media has no backup" and it is a
**DPA violation**. `libs/tenant/data/admin/src/lib/server/erase.ts` erases
customer media with three `bucket.deleteFiles({ prefix })` calls —
`hosts/{hostId}/`, `orgs/{orgId}/` and `users/{uid}/` — and none of them
passes `versions: true`. The Node Storage client lists live versions only, so
with versioning ON each of those deletes leaves the erased object behind as a
noncurrent version, retained **forever**, because this bucket has no
noncurrent-expiry rule. The erasure would report success and the object would
be invisible in every ordinary listing while still existing.

Enabling versioning here is therefore a code change to `erase.ts` plus a new
lifecycle rule, not a config flip — and it still buys nothing against loss of
the project. The backup that AGL-2422 actually calls for puts versioning on
the off-project **mirror** instead (`cloud/storage-mirror-lifecycle.json`,
runbook in `docs/DISASTER_RECOVERY.md` gap 6), where a bounded window is the
right answer for a copy and the source stays a faithful record of what exists.

### The off-project object mirror (AGL-2422 — not created yet)

`gs://aglyn-dr-storage-mirror` will hold both buckets under a prefix each
(`media/`, `plugin-artifacts/`), filled nightly by Storage Transfer Service.
It does not exist today; `docs/DISASTER_RECOVERY.md` gap 6 has the ordered
commands, and `npm run check:backup-copies` reports its absence on every run
and will compare its object counts against both sources once
`STORAGE_MIRROR_BUCKET` is set. Read the mirror's settings back with:

```bash
gcloud storage buckets describe gs://aglyn-dr-storage-mirror --project=aglyn-dr \
  --format='json(versioning,lifecycle_config,uniform_bucket_level_access,public_access_prevention,location)'
```

Expect `versioning.enabled: true` and exactly one lifecycle rule, with
`isLive: false` and `daysSinceNoncurrentTime: 30`. A rule on that bucket
WITHOUT `isLive: false` deletes mirrors of objects that still exist in
production, on a schedule — `tools/scripts/lib/backup-copies.test.mjs` fails
the build if the committed document ever grows one.

`gs://aglyn-main.appspot.com` — location `US`, CORS as in
`cloud/storage-cors.json` (confirmed byte-identical to the live config, and
confirmed by driving the real preflight, which returned
`access-control-allow-origin: https://app.aglyn.com`,
`access-control-allow-methods: PUT`,
`access-control-allow-headers: Content-Type,x-goog-resumable`).

**Not proven by any of that**: that a browser upload completes. The preflight
is only the first leg — the `PUT` itself, its signature, and the finalize
`PATCH` still need one real >3 MB PDF or ZIP dragged into the DAM at
`app.aglyn.com`. AGL-1317 was closed on exactly this kind of one-layer
evidence; do not close AGL-1408 the same way.

## Not converged by `bootstrap-platform.mjs`

`tools/scripts/bootstrap-platform.mjs` deploys rules, Stripe and Vercel env,
but has no gcloud section — so a fresh project gets **neither** the CORS rule
nor the lifecycle policy. Apply both by hand with the commands above after
bootstrap.

## Runbooks

- Firestore's equivalent: [`docs/FIRESTORE_MANUAL_CONFIG.md`](FIRESTORE_MANUAL_CONFIG.md)
- Where every copy of this data lives (and does not): [`docs/DISASTER_RECOVERY.md`](DISASTER_RECOVERY.md) gaps 1 and 6
- Plugin artifact bucket: [`docs/PLUGIN_LOADING.md`](PLUGIN_LOADING.md)
- Provisioning overview: [`docs/PLATFORM_PROVISIONING.md`](PLATFORM_PROVISIONING.md)
