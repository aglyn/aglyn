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
  node tools/scripts/bootstrap-platform.mjs --apply --staff you@aglyn.io
```

Sections (each skips with instructions when its credential is absent):

| Section | What it converges | Credentials |
| -- | -- | -- |
| Firebase rules | Deploys `cloud/firebase-firestore.rules`, indexes, and `cloud/firebase-storage.rules` | `FIREBASE_PROJECT_ID` + firebase CLI auth |
| Stripe | Products/prices (lookup-key idempotent) + subscription webhook via `setup-stripe.mjs` | `STRIPE_SECRET_KEY` (+ `STRIPE_WEBHOOK_URL`) |
| Vercel env sync | Upserts the console/tenant projects' env vars from the current shell (incl. `ANTHROPIC_API_KEY` for AI assist, AGL-89) | `VERCEL_TOKEN`, `VERCEL_CONSOLE_PROJECT_ID`, `VERCEL_TENANT_PROJECT_ID` (+ `VERCEL_TEAM_ID`) |
| Staff claim | Grants the `staff` custom claim via `set-staff-claim.mjs` | `FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY` + `--staff <uid-or-email>` |

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

## Runbooks

- Stripe specifics: `docs/STRIPE_GO_LIVE.md`
- Content security posture: `docs/SECURITY_CONTENT_REVIEW.md`
