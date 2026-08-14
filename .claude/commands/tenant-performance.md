---
description: "SUPERSEDED 2026-08-14 — a dated 2026-08-02 session handoff kept for its bundle-measurement method. Use /handoff for the current promotion flow and queue."
---

> ⚠️ **SUPERSEDED (2026-08-14) — this is a point-in-time session handoff written
> 2026-08-02, not a live runbook. For the current promotion flow, working
> agreements and queue, read `.claude/commands/handoff.md` and `.claude/HANDOFF.md`;
> where they disagree with anything below, they win.** Corrected in place (AGL-1704):
>
> - **Promotion is NOT pre-authorised.** The "standing permission" granted below
>   applied to the 2026-08-02 session only. **Promotion needs Zach's word before
>   it starts**, and you never open a production PR unasked.
> - **Gate in a pinned worktree, never the live checkout.** "Build the console
>   locally before promoting" is right about CI not being a signal, but with other
>   agents mid-edit the live working tree produces false reds — and the gate must
>   run **build + test + lint**, each exit code read bare, never through a pipe.
> - **The suggested order is spent.** AGL-1152 was measured and closed; treat the
>   whole list, and the "21 issues sitting In Review", as history and re-derive
>   from Linear.
>
> Still worth reading: **"Read this before touching the bundle"** — the
> string-literal extraction method is still the right way to attribute a chunk,
> and **"Things that will bite you"**.

Continue the **tenant performance** work and clear the verification backlog.
Picks up from `/payments-and-profiles` on 2026-08-02.

Work issues in Linear: **In Progress** when you start, **In Review** when it
lands, **Done** once verified in production. One conventional commit per
AGL-### on `main`, then promote with a PR `main` → `production` and **merge it**
(never squash). ~~Standing permission for that promotion is granted~~ — **corrected
2026-08-14: promotion needs Zach's word before it starts.**

## Read this before touching the bundle

Three attempts were made on 2026-08-02 to identify a 331 KB chunk. **Two were
confidently wrong**, and one of those produced a change that was measured, found
to do nothing, and reverted.

**Do not grep a minified bundle for library names.** Minifiers rename every
identifier that is not a string literal, so `grep '@mui/material'` returning 0
means nothing, and 24 hits of `mdi` in a 1.15 MB file means less. What worked was
extracting **string literals** — CSS class names and event names survive
verbatim and name themselves:

```bash
grep -oE '"[A-Za-z][A-Za-z0-9 ._@/:-]{14,60}"' chunk.js | sort | uniq -c | sort -rn | head -30
```

`pivotPanelField--sorted` and `paginationModelChange` identified MUI X DataGrid
in one pass, after two failed attempts with identifier greps.

**Measure before AND after every bundle change.** A change that "should" shrink
a bundle and doesn't is a wrong diagnosis, not a small win. Compare what the
PAGE transfers (Resource Timing in a browser), not total `dist` size — most
chunks are never fetched by any one page.

Neither real analyser works here, and **fixing one is worth more than any
grepping**: `productionBrowserSourceMaps` produces no maps under Turbopack, and
`@next/bundle-analyzer` cannot install because `~/.npm` ownership needs Zach's
`sudo`. Ask him for that first.

## Suggested order

1. **AGL-1152 — cold starts (worst UX on the platform).** After every tenant
   deploy the site serves a real **502**, then 8–12 s, then ~0.3 s once warm.
   Suspect #1 is already identified by reading, not measured:
   `load-page-data.ts:154` awaits `serverPluginLoader.ensureAll(['tenantApi'])`,
   which imports the server half of **all seven** first-party plugins on every
   render, memoised once per cold instance — exactly the observed shape.
   **Instrument the render path and read one cold render before changing
   anything.** `ensureAll` exists for the API dispatcher; removing it blind can
   break route dispatch.
2. **AGL-1151 — the remaining 255 KB is the Firestore client**, pulled by
   `class Timestamp extends FirestoreTimestamp` in `libs/shared/util/timestamp`,
   reached through `@aglyn/aglyn`. A class `extends` is a hard runtime
   dependency — not type-only, not tree-shakeable. The fix is reimplementing
   Timestamp standalone, and it needs a repo-wide audit of `instanceof` and of
   Firestore write serialisation first. The Admin SDK has its own `Timestamp`,
   so that is a third case.
3. **AGL-1150 gaps.** On-demand invalidation ships only the published screen's
   own path. Shared layouts, scheduled publishes, collection indexes and
   sitemap/RSS still wait out the 60 s window. Once those are covered, the
   window itself can be lengthened — the real load-time win.
4. **The 21 issues sitting In Review.** Most need a signed-in look on
   production, which this session could not do. Verify and move to **Done**, or
   reopen with what you actually saw. Never Done on the strength of a comment.

## Things that will bite you

- **Verify the premise before you build.** On this arc it has been wrong more
  often than right: AGL-1099's description understated its blocker by an order
  of magnitude, AGL-1147 was far bigger than filed, and AGL-1145's own stated
  hypothesis was disproved by its fix.
- **Staff bypasses the thing you are testing.** `zachary.w.gover@gmail.com` is
  `staff: true, staffRole: super`. The support ticket list skips the org filter
  entirely for staff, so verifying AGL-1147 through that account shows the same
  result whether the bug exists or not. Some checks need a **non-staff,
  multi-org** account, or a forced branch.
- **`zach@aglyn.com` is an SSO account** in a GCIP tenant pool — invisible to
  `getUserByEmail`/`listUsers`. Use `auth-pools.ts` or read the roster doc.
- **A denied Firestore read is not a missing document.** Reading a non-existent
  org returns `permission-denied`, and the retry helper reports that as "the
  session is stale: sign out and back in" — which is wrong, and misled both the
  user and me. Check `orgSlugs/{slug}` (public read) before believing it.
- **`?cachebust=` does NOT bust the tenant ISR cache.** A routine cold render
  cannot be forced from outside; measure in the minute after a deploy.
- **A grep that finds nothing may be a bad grep.** Twice this session:
  `export async function POST` missed `export { handler as POST }`, and a
  single-line import regex missed multi-line ones. Let typecheck be the
  authority on call sites.
- **`nx test` leaks the root `.env`** — run bare
  `npx jest --config <project>/jest.config.ts`.
- **Typecheck is not the gate; the suite is.** A commit was pushed after a clean
  `npm run typecheck` that broke the console suite's naming guard.
- **Poll deploys via GitHub commit status**, not the Vercel MCP (rate-limits):
  `gh api repos/aglyn/aglyn/commits/<sha>/status --jq '.statuses[]|select(.context=="Vercel – aglyn-console")|.state'`
  Note the en-dash. The `VERCEL_TOKEN` in `apps/console/.env.production.local`
  **does** work and can write domains — an older note saying it was the wrong
  team was false.

## Standing rules

- Keep docs in sync in the **same** change, and re-run
  `node tools/scripts/generate-docs-help.mjs` after any heading change.
- Build the console locally (`npx nx build console`) before promoting; CI is not
  a signal here.
- Never `--amend` on `main` — a concurrent session shares it.
- Commitlint rejects a capitalised subject; use `git commit -F <file>`.
- File new issues as things surface, with the measurement that found them.
