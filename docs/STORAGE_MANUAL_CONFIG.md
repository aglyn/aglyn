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

#### The origin list, and why it is exactly one entry

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
| `https://aglyn.com`, `https://www.aglyn.com` | No | Marketing site. No DAM. |
| `https://<slug>.aglyn.com` (org workspace subdomains) | No | The middleware **rewrites** rather than redirects, so the origin would be preserved and would need its own entry. Measured 2026-08-12: `demo.aglyn.com` and `northwind.aglyn.com` both `404` — no workspace subdomain is attached to the console Vercel project today. See the ceiling note below before the first one is. |
| Custom console domains (AGL-1099c white-label) | No | Same rewrite, same consequence: a customer console on their own domain is a distinct origin. Same ceiling note. |
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
exact entry here**, which makes this a per-customer provisioning step and a
commercial ceiling of the same shape as the reCAPTCHA list. Establish that
before selling white-label consoles with large-file DAM uploads; the durable
alternative is to keep the DAM on `app.aglyn.com` (which path routing already
does) or to proxy the `PUT` through our own origin.

#### `x-goog-resumable`

Present in `responseHeader` but **not currently sent by any client** — the
uploader does a single `PUT` with only `Content-Type`. It is headroom for a
resumable upload, which the 200 MB video cap will eventually want. Note that
`responseHeader` is what GCS answers a preflight's
`Access-Control-Request-Headers` from, so a client that starts sending a new
header needs it added here first; the spec asserts that coupling in the other
direction.

### Current bucket settings (verified 2026-08-12)

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
but has no gcloud section — so a fresh project does **not** get this CORS rule.
Apply it by hand with the command above after bootstrap.

## Runbooks

- Firestore's equivalent: [`docs/FIRESTORE_MANUAL_CONFIG.md`](FIRESTORE_MANUAL_CONFIG.md)
- Plugin artifact bucket: [`docs/PLUGIN_LOADING.md`](PLUGIN_LOADING.md)
- Provisioning overview: [`docs/PLATFORM_PROVISIONING.md`](PLATFORM_PROVISIONING.md)
