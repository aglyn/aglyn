---
description: Continue after the Enterprise/SSO arc — native payments, contact details, onboarding (AGL-1112, 1115, 1117, 1121, 1131–1134)
---

Continue the **payments, profiles and onboarding** work in Linear (Aglyn team).
This picks up where `/enterprise-sso` left off on 2026-07-30. Read each issue
before starting it — several were written from measured evidence, and on this
arc **the evidence has repeatedly outlived the summary**.

Work issues in Linear: **In Progress** when you start, **In Review** when it
lands, **Done** once it is verified in production. One conventional commit per
AGL-### with `git commit --only <paths>` on `main`, then promote with a PR from
`main` → `production` and **merge it** (never squash). Standing permission for
that promotion is already granted — but build and verify first.

## First: close the loop on what already shipped

Seven issues landed and deployed on 2026-07-30 and are sitting in **In Review**
because their surfaces are behind a sign-in that session could not perform:
**AGL-1120, 1124, 1125, 1126, 1127, 1129, 1130**. Each has a comment naming
exactly what to look at. Verify on production and move them to **Done** — or
reopen with what you actually saw. Do not mark them Done on the strength of the
comment alone.

## Blocked on a human, not on code

Both are ~60 seconds in a console. Neither needs a code change; the code is
already waiting for them.

- **AGL-1131** — the *Aglyn Console SSO* SAML app
  (`admin.google.com/ac/apps/saml/532096782621`) says **"SAML attribute mapping
  isn't configured"**, so SSO users have no name, photo or phone anywhere. The
  exact seven rows to add are in the issue. I got `First name → firstName` to
  stick and backed out without saving rather than leave a half-applied config —
  the field picker is an animated Closure menu whose item coordinates shift
  between frames, and an "unsaved changes" modal silently swallows clicks aimed
  at the row beneath it. **Do not burn a dozen turns on it like I did.**
- **AGL-1112** — the Firebase Auth email `callbackUri` is still
  `aglyn-main.firebaseapp.com`; the Admin API refuses every write under
  `notification.sendEmail`. Console only. Don't re-investigate it.

## Suggested order

1. **AGL-1133** — contact details and addresses across profiles, collaborators
   and the Stripe customer. Zach asked for this directly. The Stripe customer
   is created with no `address`/`phone`/`tax_id`, so invoices carry no billing
   address — that is the part with a deadline attached to it (tax). Read the
   privacy note first: mirroring an address onto the org roster would expose it
   to every member and site collaborator, which is the AGL-1122 bug class again.
2. **AGL-1132** — take payments natively instead of redirecting to Stripe.
   Also asked for directly. Decide embedded Checkout vs Payment Element per
   surface rather than defaulting; the issue argues console → embedded,
   storefront → Payment Element. **The webhook must stay the fulfilment source**
   — an in-page flow makes trusting the browser tempting.
3. **AGL-1115 / AGL-1117** — signup onboarding and plan-aware marketing
   deep-links. Untouched all session; read them fresh.
4. **AGL-1134** — build `orgMonthlyCogsUsd` from the real meters. AGL-1120
   re-shaped the discount verdict and wired the *existing* `usage/{month}.costUsd`
   rollup in as a floor; this is the actual cost model, and it should feed the
   staff MRR views too so the two cannot drift.
5. **AGL-1121** — publisher Verified badge. A policy gap, not a bug: the button
   is gated on the review checklist and works.
6. **Leftover from AGL-1125**: the site Users table still calls per-site access
   "Role". Renaming it "Site access" is two minutes, but it is a vocabulary
   decision of the same kind Zach already made once — ask, don't assume.

## Things that will bite you

- **Verify the premise before you build.** Three tickets this session were
  substantially stale: AGL-1124 asked for staff pagination and a writable member
  page that both already existed; AGL-1126's first item had shipped; AGL-1129's
  named trigger (a staff SSO-config save) **does not exist anywhere in the
  codebase** — nothing writes `org.sso`. Drive the page or read the doc before
  writing code, and say so in the commit when a premise was wrong.
- **SSO users are invisible to project-level auth.** Never write
  `auth.getUserByEmail()` / `listUsers()` / `getUser()` — use
  `libs/tenant/data/admin/src/lib/server/auth-pools.ts`. For *display* identity
  prefer the roster doc (`orgs/{id}/members/{uid}` now carries `photoURL` too).
- **A MUI `Select` renders NOTHING for an empty value without `displayEmpty`.**
  The placeholder option is there in the code and never drawn, so the field
  reads as broken. Half of AGL-1125 was this. A `<Typography>` child collapses
  in the value slot too — the label must be a plain string.
- **The dev server on :4200 runs against real Firebase (`aglyn-main`) and LIVE
  Stripe.** Every write is production data. Clean up fixtures — and check the
  cleanup, don't assume it.
- **Minting a session cookie from an extracted ID token can sign the browser
  tab out.** It happened mid-verification this session and only Zach could
  recover it. Do that kind of probing *after* the visual checks, not before.
- **Force the branch when the data cannot exercise it.** A green run against
  two members proves nothing about pagination, and a table with zero custom
  roles proves nothing about how a custom role renders. Force it, observe,
  revert, and re-check the baseline **in the same session**.
- **Poll deploys via GitHub's commit status**, not the Vercel MCP (rate-limits
  hard) and not the CLI (`VERCEL_TOKEN` in `apps/console/.env.production.local`
  is scoped to a *different team* than `.vercel/repo.json`):
  `gh api repos/aglyn/aglyn/commits/<sha>/status --jq '.statuses[]|select(.context=="Vercel – aglyn-console")|.state'`
  Note the en-dash. The top-level `.state` stays `pending` until every project
  settles, so poll the one you care about.
- **`nx test` leaks the root `.env`** — run bare
  `npx jest --config <project>/jest.config.ts`.
- **A clean `npm run typecheck` does not prove null safety**; `strictNullChecks`
  is off repo-wide.
- **Commitlint rejects a capitalised subject.** Use `git commit -F <file>`;
  backticks in a `-m` string get shell-expanded and silently eat words.
- **Browser clicks**: `computer left_click` with **screenshot** coordinates,
  never JS clicks. Re-screenshot after anything opens or closes — an animating
  menu moves between frames, and a modal overlay will eat clicks meant for what
  is behind it.

## Standing rules

- Keep docs in sync in the **same** change (`apps/docs/docs/…`), and re-run
  `node tools/scripts/generate-docs-help.mjs` after any heading change — a
  stale registry fails `docs-links.spec.ts`.
- Build the console locally (`npx nx build console`) before promoting; CI is
  not a signal here.
- Never `--amend` on `main` — a concurrent session shares it.
- File new Linear issues as things surface, with the measurement that found
  them, not just the symptom.
