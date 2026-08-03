---
description: Self-serve Enterprise SSO (AGL-1210) plus the leftovers from /tenant-performance — CSP enforcing (AGL-523), tenant cold-start 502s (AGL-1152), and the AGL-1187 skip proof
---

Build **self-serve Enterprise SSO** (AGL-1210), then work the leftovers below.
Picks up from `/tenant-performance` on 2026-08-03.

Work issues in Linear: **In Progress** when you start, **In Review** when it
lands, **Done** once verified in production. One conventional commit per
AGL-### on `main`, then promote with a PR `main` → `production` and **merge it**
(never squash). Standing permission for that promotion is granted — build and
verify first.

## AGL-1210 is the main task

**Decided:** self-serve **within** an Enterprise org. Getting onto Enterprise
stays a conversation; everything after that is the customer's to do. The gate
is the existing `ssoEnabled` entitlement and nothing else.

The read half already works (AGL-1101): `ssoDomains/{domain}` → `{orgId,
tenantId, providerId}`, `/api/auth/sso-lookup` resolves it pre-auth, `sso-jit`
provisions the user. **The write half does not exist at all** — `tenantManager()`
appears six times in the repo and every one is `authForTenant(...)`. There is no
`createTenant`, no `createProviderConfig`.

**Do DNS TXT domain verification first, and do not skip it.** `domainVerified`
is staff-attested today. Self-serve without replacing that attestation lets an
org claim a domain it does not own, which routes that domain's sign-ins to its
IdP — account takeover, not a papercut. Copy the pattern from site custom
domains (`/api/domains/attach|verify|detach`), which is already self-serve with
DNS verification and is the closest working analogue in the repo.

`enforced` strips other sign-in methods from a pool. That is a lockout risk, so
surface the existing dry run (`tools/scripts/enforce-sso-signin.mjs`) as a
rehearsal in the UI rather than shipping a bare toggle.

`apps/docs/docs/enterprise/sso.md` currently says SSO is provisioned by us, in
two places. It changes **in the same commit**, not after.

## Then, in rough order

1. **AGL-523 — flip CSP to enforcing.** Both middlewares still send
   `Content-Security-Policy-Report-Only`, so violations are being reported right
   now and are collectable from the browser console on production. Gather them
   across the console dashboard, the besigner canvas, a published storefront and
   checkout **before** flipping. Two known unknowns: realm-plugin `blob:`
   imports under `strict-dynamic`, and the JSON-LD `dangerouslySetInnerHTML`
   block in `apps/tenant/app/[host]/[[...slug]]/page.tsx`. The flip is one line
   per app; the evidence is the work.
2. **AGL-1152 — tenant cold-start 502s.** Measured 2026-08-03 right after a
   deploy: `502 @ 11.1s`, then `200 @ 7.9s`, then warm `~0.3s`. The 502 is a
   **gateway timeout**, not a rejection — first-request initialisation exceeds
   the limit. Suspect remains `serverPluginLoader.ensureAll(['tenantApi'])` in
   `load-page-data.ts`. Instrument before changing; `ensureAll` exists for the
   API dispatcher and removing it blind breaks route dispatch. A post-deploy
   warm GET would move who pays the 502 without fixing it — worth doing anyway.
3. **AGL-1187 — prove the skip path.** The ignore-build script is live and the
   www disconnect is confirmed twice (no deployment record). What has never
   run is a **skip**: it needs a promotion touching neither `apps/docs` nor
   `libs`, where `aglyn-docs` and `aglyn-tenant` should produce no build.
4. **The four that need Zach, not research** — AGL-1102 (uptime commitment),
   AGL-1104 (compliance posture), AGL-1121 (who grants Verified), AGL-1128 (SSO
   + social linking policy). Ask; do not infer a commitment we have not made.
   AGL-1133 and AGL-1134 stay held on live-Stripe access and meters that do not
   exist.

## Another session is live in this repo

It shares the working tree, `main`, the dev server on :4200 and the Firestore
emulator on :8082. On 2026-08-03 it was in besigner/theme/preview.

- **`git commit --only <your files>`.** Something auto-stages here; a plain
  commit sweeps their work in.
- **You cannot hold a commit back by not pushing.** Their `git push origin main`
  pushes the *branch*, carrying your local commits with it. If work must stay
  out of a batch, put it on a **branch**. An open `main→production` PR also
  tracks `main`, so its diff is never the diff you approved.
- **Never `git stash`.** Read the failure — it names the file — instead of
  reverting a tree that holds two sessions' work.
- **Their broken code can block you.** Twice on 2026-08-03: a spec that did not
  typecheck, and a docs page landed without re-running
  `node tools/scripts/generate-docs-help.mjs`. Fixing their file is fine when
  Zach says so; flag it otherwise.
- Leave them promotion capacity. One promotion costs **3** deployment records
  against ~100/day.

## What this session got wrong, so you do not repeat it

**Measure; do not reason.** Three plausible inferences were refuted by a
five-minute probe:

- "A standalone Timestamp would be silently written as a map" — Firestore
  actually **throws** `invalid-argument` in client-side validation. That
  inversion turned a 136-site migration into a one-file change.
- "The ignore commands will cut a promotion from 4 deploys to 1" — ignored
  builds **still create a deployment record**. It is 4 → 3.
- "The 331 KB chunk is mdi" — it was not, twice.

**Never grep a minified bundle for library names.** Identifiers are renamed;
only string literals survive. This was re-learned again on 2026-08-03 while
grepping `@firebase/firestore` for `instanceof Timestamp`.

**A merged production PR is not a deploy.** `origin/production` can sit ahead of
what is serving when deploys fail (rate limits). Check containment against the
sha of the **READY** production deployment, never the branch.

**A partial `git add` failure still commits.** It aborts the add, and git
commits what was already staged — landing a config with nothing to invoke it.
Verify with `git show HEAD:<path>`, not the worktree, which still looks right.

**Make every negative control discriminate.** Two controls this session were
vacuous: one crashed the script (so everything "passed"), one asserted an
outcome identical to the feature being off. A guard reporting zero failures
because it crashed looks exactly like a guard that works — check it *ran*.

## Environment notes

- The Firestore emulator applies the repo's **deny-by-default rules to every
  project id**, including a throwaway one. Client-side validation still runs
  before rules, so validation questions are answerable; anything needing a
  successful write is not.
- `nx test` leaks the root `.env` — run bare
  `npx jest --config <project>/jest.config.ts`.
- `libs/tenant/feature/instance` now has a test target (AGL-1206). Its barrel no
  longer drags Firestore in, since `Timestamp` extends `Date` (AGL-1207).
- Commitlint rejects a capitalised subject; use `git commit -F <file>`.
- Build the console locally before promoting; CI is not a signal here.
