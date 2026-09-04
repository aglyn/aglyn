# Managed platform provisioning

Aglyn is a managed service: **tenants never touch infrastructure**. Hosts,
screens, media, forms, analytics, and billing all live inside the shared
platform (one Firebase project + two Vercel projects) and are provisioned
implicitly by using the console — creating a host is the only "setup" a
customer ever does.

This doc is for platform operators: how the shared infrastructure is spun
up and converged.

## One command

```bash
# Dry run (reports what would happen per section)
node tools/scripts/bootstrap-platform.mjs

# Apply everything the current env has credentials for
FIREBASE_PROJECT_ID=... STRIPE_SECRET_KEY=... VERCEL_TOKEN=... \
  node tools/scripts/bootstrap-platform.mjs --apply --staff you@aglyn.com
```

Sections (each skips with instructions when its credential is absent):

| Section | What it converges | Credentials |
| -- | -- | -- |
| Firebase rules | Deploys `cloud/firebase-firestore.rules`, indexes, and `cloud/firebase-storage.rules` | `FIREBASE_PROJECT_ID` + firebase CLI auth |
| *(not converged)* | **Bucket CORS** — `firebase deploy` cannot express it, and without it every signed direct-to-storage upload fails its preflight (AGL-1408). Apply `cloud/storage-cors.json` by hand: see [`docs/STORAGE_MANUAL_CONFIG.md`](STORAGE_MANUAL_CONFIG.md) | `gcloud` auth |
| Stripe | Products/prices (lookup-key idempotent) + subscription webhook via `setup-stripe.mjs` | `STRIPE_SECRET_KEY` (+ `STRIPE_WEBHOOK_URL`) |
| Vercel env sync | Upserts the console/tenant projects' env vars from the current shell (incl. `ANTHROPIC_API_KEY` for AI assist, AGL-89) | `VERCEL_TOKEN`, `VERCEL_CONSOLE_PROJECT_ID`, `VERCEL_TENANT_PROJECT_ID` (+ `VERCEL_TEAM_ID`) |
| Staff claim | Grants the `staff` custom claim via `set-staff-claim.mjs` | `FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY` + `--staff <uid-or-email>` |
| *(not converged)* | **App Check reCAPTCHA allowlist** — a one-time IAM grant on the project the reCAPTCHA key lives in, plus `RECAPTCHA_ADMIN_KEY_NAME`. Without both, a custom console domain (AGL-1099) attaches and routes but every sign-in there 401s. See [`docs/APPCHECK_DOMAIN_ALLOWLIST.md`](APPCHECK_DOMAIN_ALLOWLIST.md) | `gcloud` auth (owner on the key's project) |

## What tenants get automatically (no setup)

- Host + subdomain on the shared tenant edge (create host in the console)
- Storage (media library), forms inbox, analytics, collections — all inside
  the shared Firebase project under `hosts/{hostId}/…`, quota-enforced by
  plan
- Custom domains: the connect wizard verifies DNS and attaches the domain
  to the tenant Vercel project (SSL automatic) using platform credentials —
  the tenant only creates one CNAME record at their registrar (the single
  unavoidable customer-side step)
- Billing: Stripe Checkout/webhook run entirely on platform keys

## Switcher search needs a backfill (AGL-835/837)

The site, screen and org switchers search by name prefix over a `nameLower`
field, which is stamped **on write**. Two consequences on any environment with
data older than AGL-835:

- Screens and hosts created before it exist but are **invisible to switcher
  search** until they're renamed (which re-stamps) or backfilled. They still
  appear in the recent-first idle list, so this reads as "search is broken for
  old sites" rather than as missing data.
- Run `node tools/scripts/backfill-name-lower.mjs` once per environment to
  stamp them.

Search also needs the composite indexes in `cloud/firebase-firestore.indexes.json`
deployed — see [`docs/FIRESTORE_MANUAL_CONFIG.md`](FIRESTORE_MANUAL_CONFIG.md),
which warns that an index deploy also reconciles `fieldOverrides`.

## Reconstructing a site's activity log

`hosts/{hostId}/activity` is appended by the console at the moment of the
edit, so anything a mutation point failed to log is lost rather than derivable
— there is no second record of it. AGL-118 is the instance: the three template
surfaces created screens, layouts and components without logging, so a site
built from a template read as a site nobody had touched.

`node tools/scripts/backfill-reconstructed-activity.mjs` recovers what the
surviving artifacts prove. Dry-run by default; `--commit` applies, `--host
<id>` narrows. Entry ids are derived from the artifact, so a re-run overwrites
rather than duplicates, and every row it writes carries `reconstructed: true`
and `reconstructedFrom`.

**It cannot restore attribution, and no future script will.** Screens,
layouts, components, templates and versions carry no author field of any kind
— only `media.uploadedBy` names a person. So a reconstructed row for anything
but a media upload has `actorId: null`, and the per-account staff feed, which
filters on `actorId`, will never show it. A site's own activity feed shows it
fine. If attributing these actions later matters, the fix is upstream: stamp a
creator on the resource when `/api/hosts/resources` writes it. Inferring the
actor from org ownership is not a substitute — it would put a name on an
action the record does not support.

## Runbooks

- Stripe specifics: `docs/STRIPE_GO_LIVE.md`
- Content security posture: `docs/SECURITY_CONTENT_REVIEW.md`
- Firestore config `firebase deploy` does not manage: `docs/FIRESTORE_MANUAL_CONFIG.md`
- Cloud Storage config `firebase deploy` does not manage: `docs/STORAGE_MANUAL_CONFIG.md`
