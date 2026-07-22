# Commerce token signing (`TOKEN_SIGNING_SECRET`)

One secret signs every commerce token the platform mints: order download links, supplier
tokens, gift-card codes and gated-video stream URLs.

It **fails closed**. If the variable is unset, the code throws rather than minting — no
fallback, deliberately. The bug this replaced (AGL-509) was
`createHmac('sha256', process.env.STRIPE_SECRET_KEY ?? 'aglyn')`: on any deploy without a
Stripe key the HMAC key was the literal string `aglyn`, and every payload is built from
public identifiers, so the tokens were trivially forgeable. A fallback is what made that
possible, which is why there isn't one now.

## Where it is read

| File | Tokens |
| --- | --- |
| `libs/plugins/commerce/src/lib/server/download.ts` | order download links (90-day TTL) — defines `tokenSigningSecret()` |
| `libs/plugins/commerce/src/lib/server/billing-webhook.ts` | supplier tokens, gift-card codes |
| `libs/plugins/commerce/src/lib/server/stream.ts` | gated-video stream URLs (15-min TTL) — AGL-689 |

## The two rules that bite

**1. Console and tenant must hold the _same_ value.** The console's Stripe webhook mints
download links that the tenant app verifies. A mismatch does not error anywhere — it just
rejects every link as an invalid signature, which reads like "downloads are broken" rather
than "the secret differs."

Today this is arranged so the mismatch *cannot* happen: `TOKEN_SIGNING_SECRET` is a single
**team-level shared environment variable** linked to both projects, so there is only ever
one value. Keep it that way. Replacing it with two per-project variables reintroduces the
failure mode for no benefit.

**2. Rotation invalidates every outstanding link.** Changing the secret breaks every
download and gift-card link already in a customer's inbox, permanently — they were signed
with the old key and there is no grace window or key-ring. Rotate only with a deliberate
plan to re-issue, and never as a routine hygiene step.

## Current state — check before you change anything

As of 2026-07-21 this is **already provisioned** as a shared variable on `development`,
`preview` and `production`, linked to both `app-aglyn-io` and `tenant-aglyn-app`. Setting a
"new" value would be a live rotation with the consequences in rule 2. Audit first, always.

### Recreating a shared variable silently drops its project links

Changing a shared variable's targets in the dashboard can **replace** it rather than edit it
— a new `id`, and an **empty `projectId` array**. The variable still lists correctly, still
shows the right targets, and applies to *nothing*. Nothing warns you.

This happened on 2026-07-21: `TOKEN_SIGNING_SECRET` was recreated with all three targets and
zero linked projects. Nothing broke at the time, because running deployments hold the env
snapshot taken at build time — it would have surfaced on the **next unrelated deploy**, as
downloads, gift-card and supplier tokens, and gated video all failing closed at once, with
no obvious connection to the deploy that triggered it.

So after any shared-variable edit, re-check `projectId` — not just the targets:

```bash
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v1/env?teamId=$VERCEL_TEAM_ID" \
  | jq '.data[] | select(.key=="TOKEN_SIGNING_SECRET") | {id, target, projectId}'
```

An empty `projectId` means the variable applies to no project. (Note the response envelope
is `.data`; older payloads used `.envs`, so handle both.)

### Auditing it correctly (this is the part that misleads people)

**`vercel env ls` and the project env API do not show shared variables.** Both list
*project-level* variables only, with nothing to indicate a whole class is missing — so a
provisioned secret reads as absent, and two checks that look independent agree with each
other because they share the blind spot.

You must consult both sources:

```bash
# 1. project-level
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/<project>/env?decrypt=false&teamId=$VERCEL_TEAM_ID" \
  | jq '.envs[] | {key, target}'

# 2. team-level SHARED — note the linkage field is `projectId` (singular)
#    but holds an ARRAY of project ids. Reading `projectIds` yields nothing
#    and makes every shared var look unlinked.
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v1/env?teamId=$VERCEL_TEAM_ID" \
  | jq '.envs[] | {key, target, projectId}'
```

A shared variable only applies to a project whose id appears in its `projectId` array.

### If you genuinely need to set it

Prefer editing the existing shared variable over adding project-level ones — that preserves
the single-value guarantee in rule 1. Local is separate and *should* differ: the root `.env`
is plaintext and `nx` injects it into every task (AGL-690), so reusing a laptop value in
production needlessly widens where the production secret lives.

```bash
openssl rand -hex 32
```

If you do fall back to per-project variables, run from the app directory and link explicitly
— the root `.vercel/repo.json` maps EVERY directory to `app-aglyn-io`, so an unlinked tenant
command silently writes to the console project (AGL-542):

| Vercel project | Directory to run from |
| --- | --- |
| `app-aglyn-io` (console) | `apps/console` |
| `tenant-aglyn-app` (tenant) | `apps/tenant` |

Env values are snapshotted per deployment, so **existing deployments do not pick this up** —
redeploy each project after changing it.

## Verify

Read the dashboard last, not first. The dashboard shows the variable exists; it does not
show that both projects resolve the same value, nor that a shared variable is actually
linked to the project you care about. Mint a token end to end:

1. Complete a test checkout for a digital product on a tenant site.
2. Open the download link from the receipt — it is minted by the console webhook and
   verified by the tenant app, so a success exercises both secrets and proves they match.
3. For the video path, POST to `/api/commerce/stream` as an entitled member and follow the
   returned URL.

A 403 on step 2 with the variable set on both sides means the values differ.

## Related

`MEMBER_SESSION_SECRET` (`membership.ts`) signs the storefront member session cookie. It
*does* have a fallback — a per-boot `randomBytes(32)` — so it never fails closed. That is
fine locally, but unset in production it means member sessions silently drop on every deploy
and disagree between instances. Set it in production too.

Note that `nx` loads the root `.env` into every task, tests included (AGL-690), so a local
`nx test` may pass on a secret that CI does not have.
