---
description: Continue the Enterprise / SSO / identity arc (AGL-1112, 1115, 1117, 1120–1129)
---

Continue the **Enterprise, SSO and identity** work in Linear (Aglyn team).
Read each issue before starting it — several were written from measured
evidence and the evidence matters more than the summary.

Work issues in Linear: **In Progress** when you start, **In Review** when it
lands, **Done** once it is verified in production. One conventional commit per
AGL-### with `git commit --only <paths>` on `main`, then promote with a PR from
`main` → `production` and **merge it** (never squash). Standing permission for
that promotion is already granted — but build and verify first.

## Where this came from

`enterprise` is now a real `OrgPlan` (AGL-1118) — uncapped quotas, `whiteLabel`
and `ssoEnabled` on the plan itself, excluded from `SELF_SERVE_PLANS`, no list
price. **aglyn-org (`jWmGooWE3L`) is `plan: 'enterprise'`**, comped, 100%
discount, SSO live via GCIP tenant `aglyn-org-y5v14`. Keep it that way.

Chasing that plan surfaced an identity cluster that is the real work now: SSO
users live in a **separate GCIP tenant user pool** that project-level Firebase
Auth cannot see. AGL-1122 fixed 13 call sites behind
`libs/tenant/data/admin/src/lib/server/auth-pools.ts`. AGL-1128 then locked
down social linking on SSO accounts. What is left is mostly consequences of
those two.

## Suggested order

1. **AGL-1127** — SSO JIT never creates `users/{uid}`, so an SSO account has no
   profile at all: Basic info renders empty, there is nowhere to store a photo,
   and notification prefs cannot be set. Highest value, smallest blast radius,
   and it explains three separate "missing" reports.
2. **AGL-1129** — force-unlink social providers when `sso.enforced` flips true.
   Decided, not built. Read the verify note: there is nothing to unlink in the
   tenant today, so a green run proves nothing.
3. **AGL-1120** — the discount margin guardrail rates a **93% off** coupon
   "OK". The formula only asks whether the leftover covers ~$2 of infra;
   discount depth never enters the verdict. Needs re-shaping AND a real COGS
   model, not a threshold tweak.
4. **AGL-1124 / AGL-1125** — user-table pagination + row click-through, then
   the Role vs Custom role vocabulary. 1125 is a design call first: there are
   currently **four** overlapping notions of "what this person is" across two
   tables (type, org role, custom role, per-site role).
5. **AGL-1126** — finish member avatars: persist `photoURL` on the roster in
   `upsertOrgMember`, and give the Team/site rows an avatar at all. The
   Gravatar fallback already shipped.
6. **AGL-1121** — the publisher Verified badge is a policy gap, not a bug. The
   button is gated on the review checklist and works.
7. **AGL-1115 / AGL-1117** — signup onboarding and plan-aware marketing
   deep-links. Untouched; read them fresh.

**AGL-1112 is blocked on a human.** The Firebase Auth email `callbackUri` is
still `aglyn-main.firebaseapp.com`, and the Admin API refuses every write under
`notification.sendEmail` (`EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`) because the
templates are customized. It needs ~60 seconds in the Firebase console. The
exact target URL, proof it works, and the revert value are in the issue. Don't
re-investigate it.

## Things that will bite you

- **SSO users are invisible to project-level auth.** Never write
  `auth.getUserByEmail()` / `listUsers()` / `getUser()` again — use
  `auth-pools.ts`. Claims are per-pool, so `setCustomUserClaims` on the project
  pool silently cannot touch an SSO account. For *display* identity, prefer the
  Firestore roster doc (`orgs/{id}/members/{uid}` has email/displayName), which
  works for tenant users without any pool logic.
- **Fixing visibility exposes the next lookup down the chain.** Making SSO
  users appear in the staff list turned "User detail failed" and "Grant staff
  failed" into new bugs, because the rows became reachable. After un-hiding a
  population, walk every route reachable *from* it.
- **SSO sign-in cannot be tested on localhost** — "missing initial state" is
  the cross-site authDomain, not a regression. Test SSO on **production**.
- **For SSO-only UI you cannot sign in for**, force the predicate to `true`,
  observe, revert, and re-check the baseline in the same session. Say so in the
  report rather than implying you saw the real thing.
- **`nx test` leaks the root `.env`** — run bare
  `npx jest --config <project>/jest.config.ts`.
- **A clean `npm run typecheck` does not prove null safety**; `strictNullChecks`
  is off repo-wide.
- **The dev server on :4200 runs against real Firebase (`aglyn-main`) and LIVE
  Stripe.** Every write is production data. Clean up test invites/members, and
  restore any entitlement override you force.
- **Commitlint rejects a capitalised subject** — `fix(auth): SSO users…` fails
  `subject-case`. Start lowercase. Use `git commit -F <file>`; backticks in a
  `-m` string get shell-expanded and silently eat words.
- **Browser clicks**: use `computer left_click` with **screenshot** coordinates
  (the viewport is larger than the screenshot — scale accordingly), never JS
  clicks, which don't fire React handlers. Re-screenshot after a banner appears
  or disappears; the layout shifts and stale coordinates miss silently.
- **Verify the negative control.** Several checks this session passed for the
  wrong reason — a hidden button that was hidden for an unrelated reason, an
  assertion made vacuous by a `??` fallback. If a check passes, ask what would
  make it fail.

## Standing rules

- Keep docs in sync in the **same** change (`apps/docs/docs/…`), and re-run
  `node tools/scripts/generate-docs-help.mjs` after any heading change — a
  stale registry fails `docs-links.spec.ts`.
- Build the console locally (`npx nx build console`) before promoting; CI is
  not a signal here.
- Never `--amend` on `main` — a concurrent session shares it.
- File new Linear issues as things surface, with the measurement that found
  them, not just the symptom.
