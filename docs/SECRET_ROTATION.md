# Secret rotation and environment isolation (AGL-2403)

Twenty-five Vercel environment records hold **one value across production and a
non-production environment**. This is the runbook for splitting them, and for
rotating the ones whose production value has already left the building.

Nobody has to trust this document's inventory. Regenerate it:

```bash
npm run check:env-isolation          # exit 0 clean, 1 findings, 2 cannot check
npm run check:env-isolation -- --json
```

It reads Vercel env **metadata only** — never a value, never `decrypt=true`,
never `vercel env pull`. A Vercel variable is a record with one value and a
`target` array, so a single record targeting `production` **and** `development`
*is* the proof that development holds the production value. Nothing has to be
decrypted to know it. `npm run test:env-isolation` drives the checker over
doctored records and proves it can still go red.

---

## The one thing to understand first

There are two kinds of record and they live in different places:

| | Where | Which of these live there |
| --- | --- | --- |
| **Team-shared** | Vercel → team `aglyn` → Settings → **Shared Environment Variables** | `CRON_SECRET`, `TOKEN_SIGNING_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GA4_API_SECRET` |
| **Project-scope** | Vercel → project → Settings → Environment Variables | everything else on this list |

`vercel env ls` shows the project scope **only**. It cannot see the shared
scope and gives no hint that a whole class is missing, which is why the
"rotate any dev-shared secrets" checklist line survived unexecuted for months
— every casual check reported clean. Do not conclude anything from `env ls`.

**A project-scope record shadows a shared record of the same key, per target.**
That is not a footnote, it is the cheapest tool in this runbook: you can give
development and preview their own value **without touching the production
value at all**, by adding a project-scope record targeted only at
development/preview. `aglyn-tenant` already does exactly this for
`STRIPE_SECRET_KEY` (project-scope, production-only, shadowing the shared
record) — which is why tenant production runs a different Stripe key from
console production.

**Three traps, all previously survived here:**

1. **Editing a shared record can *replace* it and silently drop every project
   link** — new `id`, empty `projectId` array, correct-looking targets,
   applying to nothing. It happened to `TOKEN_SIGNING_SECRET` on 2026-07-21.
   After any shared edit, re-check `projectId`, not the targets. The targets
   look right in precisely the broken case.
2. **A shared record linked to no project is inert.** `RESEND_API_KEY` is in
   that state right now: a shared record with an empty `projectId` array, plus
   real project-scope records on both apps. Rotating the shared one would look
   like work and change nothing. `check:env-isolation` labels this
   `(linked to no project — inert)`.
3. **Env changes only apply to NEW deployments.** Every running deployment
   holds a build-time snapshot. A change with no redeploy is inert now and
   lands on the next unrelated deploy, which is how a breakage arrives with no
   connection to the change that caused it.

---

## Ranked inventory

Ranked by what a leak buys an attacker, not by how many rows it occupies.
"On laptops" means the record targets `development`, which is what
`vercel env pull` writes to a working copy — so anyone who has ever run it
holds the production value.

| # | Secret | Scope | Grants | On laptops? | Action |
| --- | --- | --- | --- | --- | --- |
| 1 | `FIREBASE_PRIVATE_KEY` (+`_ID`) | project, both apps | Firebase **Admin SDK** — total read/write on Firestore, Auth and Storage, **bypassing every security rule** | **yes** | rotate + split |
| 2 | `STRIPE_SECRET_KEY` | shared (+tenant prod override) | live Stripe API: charges, refunds, payouts, customer PII | **yes** | rotate + **test key** for dev/preview (AGL-2401) |
| 3 | `VERCEL_TOKEN` | project, console | full Vercel API on team `aglyn` — **can rewrite the env vars themselves**, so it revokes every other split on this list | no (preview only) | rotate + remove from preview |
| 4 | `CRON_SECRET` | shared | every `admin/*` and billing cron route as `system:cron`; **also the live HMAC key for marketing unsubscribe links** | **yes** | rotate, with the pre-step below |
| 5 | `TOKEN_SIGNING_SECRET` | shared | mints download links, supplier tokens, media signatures, edit tokens the platform then trusts | **yes** | rotate **now, before launch** — see the timing note |
| 6 | `RESEND_API_KEY` | project ×2 (+inert shared) | send mail as Aglyn — a phishing primitive against our own customers | **yes** | rotate + split; delete the inert shared record |
| 7 | `LINEAR_API_KEY` | project, console | read/write on the Aglyn Linear workspace — the planning record this launch runs on | **yes** | rotate + remove from dev/preview (**new finding, 2026-08-23**) |
| 8 | `MEMBER_SESSION_SECRET` | project ×2 | forge storefront member session cookies on any tenant site | no (preview only) | split only |
| 9 | `PLUGIN_JOBS_SECRET` | project, tenant | call the plugin job runner past the WAF bypass rule | no (preview only) | split only |
| 10 | `REVALIDATE_SECRET` | project ×2 | force ISR revalidation on tenant sites (cache nuisance, not data) | no (preview only) | split only |
| 11 | `GA4_API_SECRET` | shared | write events into the GA4 property — pollutes revenue analytics | **yes** | split; rotation optional |
| 12 | `STRIPE_WEBHOOK_SECRET` | shared | forge webhook deliveries into `/api/billing/webhook` | **yes** | split to the **test** endpoint secret (AGL-2401) |
| 13 | `APP_CHECK_DEBUG_TOKEN_FROM_CI` / `_FROM_CONSOLE` | project ×2 | standing App Check **attestation bypass** | **yes** | **delete**, do not rotate (AGL-2402) |
| 14 | `RECAPTCHA_PRIVATE_KEY` | project ×2 | verify reCAPTCHA assertions — **read by no code in this repo** | **yes** | see the note below |

**The single highest-consequence item is #1, and it was not in the original
AGL-2403 table.** That audit compared values four ways across projects;
console's service account differs from tenant's, so a cross-project identity
test could not see it. Within each project one record still covers
development, preview and production. The Firebase Admin credential outranks
the live Stripe key: Stripe can move money and be reversed, Admin SDK can read
and rewrite every customer's data with no rule in the way, and the Admin SDK
init runs in a **module top-level IIFE** (`libs/shared/util/fbserver/src/lib/fbserver.ts`),
so it is captured at cold start and a change needs a fresh deployment, not
just a variable edit.

**`RECAPTCHA_PRIVATE_KEY` — resolve before acting.** AGL-2403 says its sharing
is correct and should not be "fixed" (one classic v3 key whose allowlist
includes `localhost` by design), and `RELEASE_CHECKLIST.md` §3 records it as
verified-in-production. But a repo-wide search finds **no code that reads it**
— only `NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY` is read, for App Check. Both
statements cannot be true of a working server-side verification. Decide which
it is before deleting anything: if nothing verifies, that is a gap in its own
right, not a variable to tidy away.

---

## What should differ, not rotate

For several of these the right answer is not a new production value but a
**different, lesser credential in development and preview**. Cheaper, safer,
and it survives the next person who adds a variable.

| Secret | Give dev/preview this instead |
| --- | --- |
| `STRIPE_SECRET_KEY` | the `sk_test_` key from the same Stripe account. `aglyn-tenant`'s local `.env` already uses one — but `vercel env pull` will overwrite that file with the shared live key, so the fix is not durable until the Vercel record is split. |
| `STRIPE_WEBHOOK_SECRET` | the signing secret of the **test-mode** endpoint. The console webhook already verifies against three independent secrets (`STRIPE_WEBHOOK_SECRET`, `_TEST`, `STRIPE_CONNECT_WEBHOOK_SECRET`), so this needs no code change. |
| `GA4_API_SECRET` | a second GA4 data stream, so local traffic never lands in the property the revenue numbers come from. |
| `FIREBASE_PRIVATE_KEY` | a **second service account** with narrower roles, or the Firestore emulator. Sharing the production Admin credential with a laptop has no development benefit that the emulator does not also give. |
| `CRON_SECRET`, `TOKEN_SIGNING_SECRET`, `RESEND_API_KEY`, `LINEAR_API_KEY`, `MEMBER_SESSION_SECRET`, `REVALIDATE_SECRET`, `PLUGIN_JOBS_SECRET` | any throwaway value — `openssl rand -hex 32`. Nothing in development needs the production one. `RESEND_API_KEY` can instead be left **unset** in development: `sendEmail()` degrades to `{ sent: false, reason: 'unconfigured' }` and never throws. |

---

## Execution order

Do these in order. The first block cannot break production, so start there and
build confidence; the later blocks have lockstep dependencies that are the
whole reason this document exists.

### Block A — no production value changes (safe, do first)

1. **Delete `APP_CHECK_DEBUG_TOKEN_FROM_CI` and `_FROM_CONSOLE`** from both
   projects. Read by no code; a repo guard
   (`libs/aglyn/src/lib/app-utils/app-check-debug-token.spec.ts`) fails CI if
   anything starts reading them. **Revoke the debug tokens in the Firebase
   console *before* deleting the Vercel records** — deleting the variable
   removes our copy, not Firebase's acceptance of the token. (AGL-2402)
   - Which tokens, and did the revoke land? `npm run check:app-check-debug-tokens`
     lists every debug token registered on every app in the project and exits 1
     while any remains (2 if it could not look — never 0). Measured 2026-08-24:
     **2 registered on the single web app**, and the value held by these two
     variables still exchanged for a live production attestation token, so this
     is an active bypass rather than an inert record. Re-run it after revoking;
     0 is the evidence the click worked.
2. **Delete the inert shared `RESEND_API_KEY` record** (empty `projectId`).
   Confirm it is empty first; deleting a *linked* shared record breaks mail.
3. **Split the preview-only three** — `MEMBER_SESSION_SECRET`,
   `REVALIDATE_SECRET`, `PLUGIN_JOBS_SECRET`. Edit the existing record down to
   `production` only, then add a second record targeting `preview` with a fresh
   `openssl rand -hex 32`. Production is untouched.
   - ⚠️ `REVALIDATE_SECRET` must **match between console and tenant** — console
     calls the tenant's `/api/revalidate` with it. Give preview one new value
     and set the *same* new value on both projects' preview records.
     A mismatch is silent: publishes leave tenant HTML stale.
   - ⚠️ `MEMBER_SESSION_SECRET` is a module-scope `const` with a
     `randomBytes(32)` fallback, so it never fails closed. A preview record
     with a different value is correct and invisible; a *missing* one is also
     invisible and quietly signs every member out on each deploy.
4. **Split `GA4_API_SECRET`** (shared record → production-only, plus a
   dev/preview record pointing at a second data stream). A wrong value here is
   the most deceptive failure on the list: the Measurement Protocol returns
   **2xx for a bad `api_secret`**, so a typo produces zero errors and zero
   data. Verify in GA4 Realtime, never by watching for an error.
5. **Split `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`** to test-mode
   credentials on development and preview (AGL-2401). Production keeps the
   live values. This removes the `sk_live_` key from every laptop **and** stops
   `deploymentLivemode()` reading a preview build as the live deployment.
   - ⚠️ **Splitting the record is not the same as fixing the mode, and the
     sharing check cannot tell them apart.** A development record holding the
     *live* key satisfies every rule in step 5 as written: production is on its
     own record, nothing is shared, findings go to zero. It is also exactly the
     defect AGL-2401 was filed for. This is the likely slip, because the value
     already in the field you copied from is the live one.
   - So `verify-env-isolation.mjs` asks the mode separately, from
     `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — public by construction (Next inlines
     it into every browser bundle) and required to match the secret key's mode.
     Set the **test** publishable key on development and preview in the same
     pass, or the run stays red and correctly so.
   - ⚠️ Store that publishable key as `encrypted`, **not** `sensitive` — see
     "What not to do". `sensitive` is write-only, so the checker cannot read it
     back and reports the environment's mode as **UNKNOWN**, which is a
     finding, not a pass. `aglyn-tenant`'s development and preview copies were
     added `encrypted`/`sensitive` on 2026-08-23 and are in that state now.

Redeploy both projects, then re-run `npm run check:env-isolation`. Everything
above should have dropped off the findings list, and the mode section should be
empty too.

### Block B — rotations with a lockstep dependency

Each of these changes a value something *else* also holds. Getting the order
wrong is an outage, not a nuisance.

#### `CRON_SECRET` — ⚠️ has a hidden second job

`CRON_SECRET` is the fallback HMAC key for **marketing-email unsubscribe
links** (`libs/plugins/marketing/src/lib/server/campaign-send.ts` mints,
`libs/plugins/email/src/lib/server.ts` verifies, both via
`EMAIL_UNSUBSCRIBE_SECRET || CRON_SECRET`). `EMAIL_UNSUBSCRIBE_SECRET` is set
**nowhere**, so the fallback is load-bearing in production. Rotating
`CRON_SECRET` without the pre-step permanently 403s the unsubscribe link in
every marketing email already delivered — a CAN-SPAM/GDPR problem, not a job
outage.

1. **Pre-step:** set `EMAIL_UNSUBSCRIBE_SECRET` on production (both projects)
   to the **current** `CRON_SECRET` value, and redeploy. Prove it took effect
   before continuing — the dedicated variable wins over the fallback, so this
   step is what makes existing links keep working.
2. Set the new `CRON_SECRET` on the shared record, **production only**.
3. Add a dev/preview record with a throwaway value.
4. `gh secret set CRON_SECRET` — the GitHub Actions crons in
   `.github/workflows/scheduled-crons.yml` send it as `x-cron-secret` to 12
   console routes. **Vercel and GitHub must move together**; whichever lags,
   every cron 401s in the gap.
5. Redeploy console **and** tenant (the plugin cron routes live on both).
6. Verify: dispatch one cron manually and confirm 200; confirm an unsubscribe
   link from an already-sent campaign still resolves.

There is **no grace period**. `isCronAuthorized` compares against exactly one
value; there is no key list and no previous-secret fallback.

#### `FIREBASE_PRIVATE_KEY` / `FIREBASE_PRIVATE_KEY_ID`

Rotating means creating a **new service-account key in Google Cloud** and
deleting the old one — the Vercel variable is only where we keep it.

1. Create the new key in GCP. Do not delete the old one yet: both are valid
   simultaneously, which is the grace period this rotation gets and the reason
   it is safe to do at all.
2. Set the new `FIREBASE_PRIVATE_KEY` + `FIREBASE_PRIVATE_KEY_ID` on
   **production** on both projects.
3. Update the **GitHub repo secrets** `FIREBASE_PRIVATE_KEY` and
   `FIREBASE_CLIENT_EMAIL` — five workflows authenticate with them
   (`backup-copies`, `auth-domains-drift`, `index-drift`, `legal-drift`,
   `rules-drift`). They fail loudly, but they fail.
4. Give development and preview a **narrower second service account**, or
   remove the variable there entirely and use the emulator.
5. Redeploy both projects. The Admin SDK initialises in a module top-level
   IIFE, so the old credential lives in every warm lambda until it is replaced.
6. Only after the deployments are serving and healthy: **delete the old key in
   GCP.** That is the step that actually ends the exposure; everything before
   it just stops using it.
7. Verify: a console page that reads Firestore, and one Storage read.

#### `VERCEL_TOKEN`

Rotate this **last** among the credentials, and be aware of the ordering
paradox: a Vercel token can rewrite environment variables, so a leaked one can
undo every split above. But rotating it first would invalidate the token
`check:env-isolation` and `check:firewall-posture` use to verify the rest.

1. Create the new token in Vercel (team-scoped).
2. Set it on console **production only** — nothing in preview reads it that
   production does not.
3. `gh secret set VERCEL_TOKEN` (used by `firewall-drift` and `env-isolation`).
4. Redeploy console; confirm domain attach/detach still works
   (`/api/domains/attach` returns "not configured" when the token is absent).
5. Revoke the old token.

#### `RESEND_API_KEY`, `LINEAR_API_KEY`

Straightforward: create a new key at the provider, set it on production, give
dev/preview a throwaway or leave it unset, redeploy, revoke the old key.

- `RESEND_API_KEY` fails **silently** — `sendEmail()` never throws, and a wrong
  key produces a 401 that surfaces only as `{ sent: false }`. Verify with the
  live probe: `GET /api/admin/email-health?probe=1` (staff-gated). 401/403 from
  Resend means the key is bad; 422/400 means it is good.
- On console, `RESEND_API_KEY` may be managed by the Resend Vercel
  integration. If it is, re-check the targets after any integration action —
  it can re-create the variable across all three.

#### `TOKEN_SIGNING_SECRET` — the one with no grace period at all

Every verifier re-signs with the single current secret and compares. There is
no key ring and no previous-secret fallback anywhere. The moment the old value
dies, everything signed with it is permanently invalid:

| Token | TTL | Persisted where |
| --- | --- | --- |
| Order **download links** | 90 days | customer inboxes (receipt emails) |
| **Supplier** tokens | **no expiry at all** | written to order documents, emailed to suppliers |
| Tenant **edit-hint** cookie | 7 days | browser cookie on `.aglyn.app` |
| Media signatures, stream URLs, edit-access tokens | 15–30 min | not persisted |

**Correction to `docs/COMMERCE_TOKEN_SIGNING.md`:** that document's rule 2 says
rotation breaks "every download and gift-card link". Gift-card codes are **not**
signed with this secret — `billing-webhook.ts` keys their HMAC on the Stripe
object id and stores them as Firestore documents, so they survive a rotation
untouched. The real long-tail casualty it omits is the **supplier token, which
has no expiry**.

**Timing argument — rotate this before September 1, not after.** The cost of
rotating is proportional to the number of outstanding signed artefacts, and
that number will never again be as small as it is today. After launch, every
digital order adds a 90-day download link and every routed order adds a
never-expiring supplier token. If the value is going to be rotated at all —
and it is on laptops, so it should be — the cheapest moment is now.

1. Count what breaks: open orders with a `supplierToken`, and orders with
   receipts sent in the last 90 days. If both are zero or near-zero, proceed.
2. Set the new value on the shared record, **production only**, keeping it
   linked to **both** `aglyn-console` and `aglyn-tenant`. The console mints
   what the tenant verifies; a mismatch produces no error, only 403s that read
   as "downloads are broken".
3. **Immediately re-check `projectId`, not the targets** — the dashboard can
   replace rather than edit, leaving correct targets and zero project links:

   ```bash
   npm run check:env-isolation -- --json | \
     jq '.findings[] | select(.key=="TOKEN_SIGNING_SECRET")'
   # or straight from the API — note projectId is SINGULAR, holding an ARRAY
   ```
4. Add a dev/preview record with a throwaway value.
5. Redeploy **both** projects.
6. Verify end to end, as `docs/COMMERCE_TOKEN_SIGNING.md` describes: complete a
   test checkout for a digital product on a tenant site and open the download
   link from the receipt. That link is minted by the console webhook and
   verified by the tenant app, so a success proves both sides resolve the same
   value. A 403 with the variable set on both sides means they differ.

---

## Verification

After every block:

```bash
npm run check:env-isolation                  # the metadata verdict
npm run check:env-isolation -- --deployment  # did it reach the running build?
```

`--deployment` diffs the env **key list** of the newest production deployment
against the previous one. Two things to know reading it:

- A pure **value** swap leaves the key list identical by construction. There
  the evidence is the deployment **id** having moved after the change — the old
  id is still serving the old value.
- If you **added or removed** a key and the diff shows nothing, the redeploy
  did not carry your change. That is the negative control; do not skip it.

---

## What not to do

- **Do not** conclude a variable is missing from `vercel env pull` output. It
  writes an **empty string** for `sensitive`-typed variables — unreadability,
  not absence. This has manufactured a false launch blocker three times
  (AGL-691, AGL-1636, AGL-1846). Check the API's `type` field.
- **Do not** create a project-scope twin of a shared variable to "fix" a value.
  It shadows the shared one, so updating the shared record then silently does
  nothing, and the twin usually ends up production-only, splitting prod from
  preview by accident.
- **Do not** mark a public identifier `sensitive`. It is write-only, so the
  value can never be read back and verified. Prefer `encrypted`, the default.
- **Do not** add `continue-on-error` to `.github/workflows/env-isolation.yml`,
  and do not move a finding into the checker's `ACCEPTED` table to quiet it. An
  `ACCEPTED` entry requires a name and a reason and is still printed on every
  run — that is the point. A guard that cannot be red is not a guard.

## Related

- `docs/COMMERCE_TOKEN_SIGNING.md` — `TOKEN_SIGNING_SECRET` in depth (with the
  gift-card correction above)
- `docs/BREACH_NOTIFICATION.md` — rotation under incident conditions
- `docs/STRIPE_GO_LIVE.md`, `docs/EMAIL_SETUP.md`
- `tools/deploy/verify-env-isolation.mjs` — the checker
- AGL-2401 (Stripe), AGL-2402 (App Check debug tokens), AGL-2403 (this)
