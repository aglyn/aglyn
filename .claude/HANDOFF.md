# HANDOFF — 2026-08-14 (post-promotion, batch-3)

## ✅ READ FIRST — BATCH-3 IS PROMOTED AND THE RULES ARE LIVE

**Production: `867c963e7`** — PR **#851**, opened **directly from `main`** (no intermediate branch),
**84 commits**, gated at `762621581`, **merged (not squashed)** at 2026-08-14T19:01:48Z.
Real merge commit, parents `710004423` + `762621581`.
`git merge-base --is-ancestor 762621581 origin/production` → **exit 0**.

**Drift at merge time: ZERO.** `origin/main` was byte-identical to the gated SHA at both the PR-create
and the merge check — dispatch had been frozen so `main` was genuinely quiet. Nothing rode along ungated.

**Firestore rules deployed at 2026-08-14T19:02:41Z**, from a worktree pinned to the promoted SHA:

- **Deployed ruleset: `projects/aglyn-main/rulesets/607f464f-191f-48f5-9a93-93bb9b131419`**
  (superseded `c0e8cffd-92a7-4c2b-a955-c541d8d4ce0f`)
- Discharges **`6a6e64661`** (AGL-1701 — marketplace listing artwork held to first-party media; until this
  deploy any org owner/admin could set an arbitrary image host by direct client write, since
  `marketplaceListings` is `allow read: if true` and the rules did not deny `logoUrl`/`screenshots`) and
  **`c3cfd6975`** (AGL-1668 — `formSubmissions` create-exclusion).
- Pre-deploy the worktree's rules file was diffed against **both** `867c963e7` and `origin/production` —
  identical. The script's own AGL-1489 dirty-tree refusal was a second net.
- Post-deploy `check-rules-drift.mjs --baseline=origin/production` → **exit 0** — firestore, storage and
  database all OK. Exit 0, not exit 2 ("cannot check").
- The `.env` copied in for the deploy was removed immediately and its removal verified.

**Deploys verified Ready BEFORE any fetch**, then one request each:

| Surface | Serving deployment | Status |
| --- | --- | --- |
| `app.aglyn.com` | `aglyn-console-1am8h4ix6` | **200** |
| `aglyn.com` | `aglyn-tenant-k36zcqktg` | **200** |
| `docs.aglyn.com` | `aglyn-docs-ofk5e4chh` | **200** |

All three were created 14:01:58 CDT — **10 seconds after the merge**. ⚠️ For ~8 minutes after the merge the
`app.aglyn.com` and `aglyn.com` aliases still resolved to the **3h-old previous** deployments while console
built; `docs` had already cut over. Fetching then would have returned three 200s from the old build.

### What is still owed

- **AGL-1651 is CLOSED (Done)** — both Firestore rules commits discharged and verified live.
- **AGL-1742 (NEW, Low)** — the Remote Config publish, split out of AGL-1651 so closing it did not silently
  drop that half. `cloud/firebase-remoteconfig.template.json`'s `version.description` records the per-org
  override layer. Documentation-only; no parameter values changed. **Costs accuracy, not safety.**
- **Not verified by live write attempt:** nobody tried a client write to `marketplaceListings.logoUrl` to
  watch it be refused. The proof above is a deployed-ruleset match — strong, but not the same claim.
- **AGL-1602 is CLOSED (Done)** — `contactSuppressions`, discharged by an earlier deploy.

**The repo guard still proves nothing about production.**
`libs/aglyn/src/lib/foundation/definitions/org-write-deny-coverage.spec.ts` reads the rules **file**, not
the deployed ruleset. Keep using `check:rules-drift` for the live claim.
⚠️ The deploy script reads the **worktree, not HEAD** — always pin the checkout to the promoted SHA first.

## ⛔ PROMOTION PROCESS — CORRECTED BY ZACH 2026-08-14, follow this exactly

Zach, verbatim: *"We need to keep commits on merge so it needs to be a merge commit. We push immediately
to main, then we batch promote by building a lot of commits on main then open pr to production and then
you merge for me. We should not be creating any additional branches."*

1. Push work to `main` immediately; let commits accumulate there.
2. **Gate `main` in a pinned worktree** — never the live checkout. Read **every exit code bare**, never
   through a pipe (`$?` after `| tail` is tail's code and has produced a false green here).
3. **Open the PR directly from `main`:** `gh pr create --base production --head main`.
   **Do NOT create a `promote/*` branch or any other branch.**
4. **`gh pr merge <n> --merge`** — a real merge commit. **Never squash, never rebase.** Keeping the
   individual commits is the entire point.
5. **Immediately before merging, re-check whether `main` moved** (`git fetch origin && git rev-parse
   origin/main`). Because the PR tracks `main` rather than a frozen SHA, anything landing between the gate
   and the merge **rides along ungated**. Gate as late as possible; if the tip moved, say so explicitly and
   name the uncovered commits. More than a commit or two of drift → **re-gate**, don't report a stale green.
6. **Rules deploy runs from a checkout pinned to the promoted SHA**, never from `main` (which will have
   moved). The deploy script reads the **worktree, not HEAD**.

✅ **Batch-3 followed this process exactly** — `gh pr create --base production --head main` with **no**
intermediate branch, `gh pr merge 851 --merge`, real merge commit `867c963e7`. No `promote/*` refs exist.
(Batch-2 predated the correction and used a `promote/2026-08-14-batch-2` branch; it did no damage and the
branch is long deleted.)

⚠️ **Step 5's drift problem is real and was nearly unwinnable.** Mid-afternoon `main` was absorbing roughly
**one commit every 90 seconds** while a full gate takes ~10 minutes, so every gate finished stale — a
treadmill no amount of re-gating wins. What broke it was **freezing dispatch**: with no new agents starting,
`main` went quiet and the tip held still across two checks two minutes apart. **If a batch is large and the
fleet is busy, freeze dispatch before gating rather than racing.** The fast-confirmation fallback (test +
lint + typecheck only, against the exact tip, re-checking `origin/main` at the merge) is the compromise if
you cannot freeze — but naming any uncovered commit individually is mandatory either way.

## ⚑ THE FRAME

**Public beta: 2026-09-01** (18 days). Linear project **"Public beta: paying customers on September 1"**
is the spine. Work is admitted by answering *"what breaks the first real customer?"*

## STANDING DIRECTIVES — SHARPENED TODAY (Zach, verbatim)

Two quotes, same instruction applied to defects and to decisions:

1. **Defects** — *"our backlog is getting full very quickly, just start busting these out as they're
   discovered and file them concurrently."*
   → When an agent finds a defect it can fix safely within its pass, it **fixes it AND files it**.
   Filing *instead of* fixing is now the exception, not the default. This sharpens, and does not replace,
   the `implement, don't just file` memory entry — filing remains mandatory for anything outside the
   agent's safe blast radius or that would balloon a commit.
2. **Decisions** — *"Even if there is a decision to be made just ask me with a prompt but still fix it
   and complete it."*
   → A decision point is **no longer a stop condition**. The agent **picks the best option, implements it,
   and completes the work**; the question is raised **concurrently**, not as a precondition. If Zach's
   answer differs, adjust after. Subagents cannot prompt him — they implement their best option and
   **report the decision crisply in their final message**; the orchestrating session surfaces it via
   `AskUserQuestion`.

### 🛑 The carve-out — irreversible / outward-facing actions still ASK FIRST

Publishing to a live site · submitting a filing · deleting data · **deploying rules** · any production
write. *"Complete it"* cannot be undone there. This is not a bare rule — it is **what made today work**:

- Holding **promotion** preserved the legal **v4 window**. Promoting first would have forced a **v5** and a
  clickwrap re-acceptance prompt for **every existing user** — for a copy fix.
- Holding the **`aglyn-app` delete** preserved the **one genuine lead** out of 120 records; the export found it.
- Deploying rules from the **promoted SHA** rather than `main` avoided shipping rules for an unpromoted
  feature — `52ab9c196` had already moved `main` ahead.

## STATE

**Production: `867c963e7`** — PR **#851** `main` → `production`, **84 commits** (gated at `762621581`),
**merged (not squashed)** at 2026-08-14T19:01:48Z. Deploy verified **after** each alias was confirmed to
point at a deployment created *after* the merge — see the top section for the trap this avoided.

| Surface | Status |
| --- | --- |
| `app.aglyn.com` | 200 |
| `aglyn.com` | 200 |
| `docs.aglyn.com` | 200 |

**`main` = `762621581` = `origin/production`'s second parent. ZERO commits unpromoted** at handoff time
(`git rev-list --count origin/production..origin/main` — computed, not copied). Dispatch was frozen for the
promotion; the next batch starts from a clean slate.

### Gate results at `762621581`

Pinned detached worktree, clean tree, **`npm ci` first** (see lore), `--skip-nx-cache`, every exit code
written to a file and read from there:

| Target | Exit | Detail |
| --- | --- | --- |
| `build` | **0** | |
| `test` | **0** | after re-run, see note |
| `lint` | **0** | |
| `typecheck` | **0** | 145/145 configs |
| `sync:next-tsconfigs --check` | **0** | |
| `generate:docs-help --check` | **0** | |
| `generate:plugin-manifests --check` | **0** | |
| `check-app-router-graph` | **0** | |

⚠️ **The combined `test` run exited 1 and was NOT a red gate.** `plugins-marketplace:test` died of jest
worker **SIGSEGV** ×2 with **zero assertion failures**, and **Nx itself printed "Nx detected a flaky task"**.
Re-run alone: **exit 0**, 24/24 suites, 289/289 tests. Same known contention flake as batch-2 —
**always re-run the one project before calling a gate red.**

### ⚑ Gating held this batch FIVE times, and every red was real

This is the strongest argument yet for gating a large batch rather than trusting CI green:

| Issue | What was red | Fixed by |
| --- | --- | --- |
| **AGL-1718** | AGL-1361 write-deny guard read `host.toLowerCase()` as a host field | `c6a610a91` |
| **AGL-1723** | all three generated Next tsconfigs missing the `@aglyn/aglyn-markdown-editor` alias; CI step red since `7981fced6` | `09ca8dcbb` |
| **AGL-1685** | `middleware.spec.ts` asserted no `…-Report-Only` header while the commit added one | `94ca344e5` |
| **AGL-1733** | `jest.fn(() => ({}))` inferred a zero-arg mock → TS2556 + 2×TS2352, `npm run typecheck` red | `f81844309` |
| **AGL-1739** | a legitimate 3,494-char docblock tripped the AGL-1479 comment-stripper bound, taking `console:test` down | `762621581` |

**Three of those five were source-scanning guards going red on a legitimate pattern rather than a real
defect** (AGL-1718, AGL-1685, AGL-1739), and each shipped an error message asserting only one of two
possible causes — the wrong one. AGL-1739's fix now states both readings and how to tell them apart; that
is the pattern to copy when writing a guard.

**AGL-1658 (`db5ecdf2b`) detail worth keeping:** it resolves the flag through the **same**
`isReleaseFlagOnForOrg` + per-org override expression the usage cron uses, so an AGL-1635 early grant is
**billed and shown consistently**. It resolves `released`, never `visible` — *the staff bypass must not move a
billing claim.* It filed **AGL-1662** (Low) for the same missing check on the **staff-preview** path in
`libs/plugins/contacts/src/lib/components/contacts-console-page.tsx:505-512`, where `visible = released || isStaff`
makes a staff previewer see a dollar figure the cron is deliberately withholding — which support then reads
back to the customer.

## 🔴 IN FLIGHT — two legal findings dispatched to background agents

Both came out of the **AGL-1647** audit of the remaining eight Legal Docs. Both are **publication-first**:
the code half can be fixed by an agent, **the live publish needs Zach's go-ahead.**

- **AGL-1660 — the Marketplace Publisher Agreement was never published.** This is a **contract-formation
  problem**, not a broken link: publishers accept `PUBLISHER_AGREEMENT_VERSION = '2026-07-28.1'` behind a hard
  gate (`publish-plugin.ts:310` blocks publishing until accepted), and the "read the document" link points at
  `PUBLISHER_AGREEMENT_URL` (`libs/aglyn/src/lib/app-utils/publisher-agreement.ts:50` — **line 50, not 51**),
  which I re-fetched just now: **404**. The agreement is also absent from the `/legal` index (8 documents, not 9).
  An acceptance gate whose terms were never served is materially weaker than one whose terms were.
  ⚠️ The 13 KB source (`Platform Docs/Legal/MARKETPLACE_PUBLISHER_AGREEMENT.md.gdoc`) is **not publishable
  as-is** — it still carries `DRAFT — ATTORNEY REVIEW REQUIRED` and `Last updated: [EFFECTIVE DATE]`.
  ⚠️ **AGL-1077 — the issue that built this gate — is marked Done.** It shipped the acceptance record, the
  version bump, and the publish refusal, but the *document* it gates on was never published. A "Done" gate
  with an unpublished agreement is the exact gap AGL-1660 names.
- **AGL-1659 — live legal contradicts itself on Anthropic.** Verified firsthand just now:
  `aglyn.com/legal/subprocessors` (200) contains **"Anthropic" 0 times**; `aglyn.com/legal/dpa` (200) contains it
  **2 times**, and §7.1 names Anthropic as a **current** sub-processor *and links to the page that omits it*.
  A customer exercising §7.1's objection right cannot see the sub-processor they were told about. The
  Subprocessors write-back was **deliberately stopped** rather than completed — writing it back would silently
  ratify whichever version is wrong. **Explicitly NOT covered by AGL-1555**, which only relocated Anthropic
  *within* Privacy §3. The same pass is answering the sibling question (whether other subprocessors named in
  the DPA/Privacy/code are missing from the list). **Zach's decision:** is Anthropic still a sub-processor?
  If yes the row belongs on the register; if no, the DPA is wrong and the change log owes a removal notice.

### Agents in this checkout — do not touch their files

**Re-checked at 2026-08-14T16:20Z, after batch-2:** the source-file contention listed here earlier has
**cleared** — AGL-1655 (`894477356`) and AGL-1658 (`db5ecdf2b`) both committed, and `git status --porcelain`
now shows **no dirty source files at all**. The only untracked/staged paths are `.claude/` docs:
`.claude/HANDOFF.md` and `.claude/commands/{queue,marketing-issues-continue,marketing-pricing-and-addons,marketing-site-continue,pricing-desktop-and-signup}.md`.

⚠️ `.claude/HANDOFF.md` is **untracked** and regenerated by whoever finishes a promotion — it was last
rewritten at 16:07Z and again (this edit) at ~16:21Z. **Append or edit in place; do not overwrite wholesale**,
or you will drop another agent's section.

The **two Google Docs write-back agents** may still be live; their issue ids remain **unconfirmed**
(AGL-1647 and AGL-1611 both exist and both describe that work). They touch Google Docs, not repo files.

## LEGAL v4 — CORRECTED, PUBLISHED, AND RE-SNAPSHOTTED ✅

The blocker that held yesterday's batch is **cleared**. Verified live:

- **The live legal pages are on `aglyn.com`, NOT `app.aglyn.com`.** ⚠️ `app.aglyn.com/legal/privacy` **404s**
  (and `curl -L` still returns a 70KB body, so a naive grep reads as "0 occurrences, all clear" on a 404 page).
- `aglyn.com/legal/privacy` (200): **`"no third-party analytics"` = 0 occurrences** — the false claim is gone.
  The corrected wording `"one third-party analytics provider"` is present (2 occurrences; count is a lower bound).
- `aglyn.com/legal/cookies` (200): `"no analytics cookies"` = 0; `_ga` named 8×. The old contradiction is gone.
- `aglyn.com/legal/terms` (200): 0 × `"WAIVER OF CONSUMER RIGHTS"`, 0 × `"DTPA"`. Live now states it does
  **not** ask you to waive DTPA rights (2 × "Deceptive Trade Practices").
- Clickwrap snapshot re-captured and re-hashed: `apps/console/constants/legal/v4/privacy.txt`,
  **12,912 bytes**, `sha256 96b24414fb39209be36c804cec72d11341474edfadc279f7b252f1431f1906a9`,
  0 occurrences of the false claim. Only two commits ever touched v4: `65d6379ef` (AGL-1564) and
  `46b55623d` (AGL-1594 + AGL-1592). Both in production.

**Google Docs are now the legal source of truth (Zach's decision) — but they are the STALEST artefact.**
Until **AGL-1647**'s write-back lands, **the live page is the source of truth, not the Doc**. The Terms Doc is
reported to still carry a `WAIVER OF CONSUMER RIGHTS (Texas DTPA)` block that live deliberately replaced.
**UNVERIFIED** — Doc contents are not checkable from the repo, and the write-back agents own those files.
Related: **AGL-1611** (no diff path between Doc and live), **AGL-1623** (`aglyn.com/legal` index says
"last updated 5 August" while every document says the 14th).

## CORRECTIONS TO THE OLD HANDOFF — do not re-derive these

- ✅ **AGL-1551 (Stripe webhook 400 on 100% of deliveries) is DONE.** Prior handoffs and agent reports called
  it a live blocker. It is fixed. (AGL-1552 was Canceled; AGL-1560, the last-`v1`-only signature parser, is In Review.)
- ✅ **AGL-1523 and AGL-1524 are both DONE** — the two defects Zach's original ~2-minute signup produced.
  Both fixes are **in production**, which is what makes the AGL-1514 re-proof meaningful now.
- **GA4 env was a *linkage* problem, not an absence problem — and it now appears ALREADY FIXED.**
  Re-verified against the Vercel API (`GET /v1/env?slug=aglyn`, read-only) at handoff time: **both**
  `GA4_API_SECRET` **and** `GA4_MEASUREMENT_ID` exist as team-level shared vars, encrypted, targeting
  dev/preview/production, each **linked to 4 projects** (`aglyn-console`, `aglyn-docs`, `aglyn-tenant`,
  `aglyn-plugins`). Timestamps: `GA4_API_SECRET` created 01:25:59Z, **updated 10:15:14Z**;
  `GA4_MEASUREMENT_ID` created **10:15:01Z**. The "secret unlinked / measurement-id absent" state was real
  but describes the window ~01:26–10:15Z today. **The production redeploy (PR #849, 15:06Z) came after the
  10:15Z edits, so the rebuild requirement is satisfied too.**
  → **AGL-1637 items 1–2 look discharged. What remains is the PROOF, which nobody has run** — trigger or
  replay one `invoice.paid` and watch GA4 Realtime for a `purchase`. AGL-1637 says it outright: do not accept
  "the variable is set" as proof. Items 3–8 (custom dimensions, internal-traffic filter, stitching) are untouched.
- **`vercel env ls` cannot see team-level shared variables — VERIFIED, and it is a repeatable trap.**
  `vercel env ls --scope aglyn` resolves to `aglyn-console` and prints 111 rows with **zero** GA4 matches,
  even though `aglyn-console` is one of the 4 linked projects. Shared vars are visible **only** via `/v1/env`.
  Also `vercel env ls --project <name>` is **not a valid flag** (`unknown or unexpected option`) — likely how
  the earlier audit ended up scoped to one project and concluded simple absence. The "131 keys" figure could
  not be reproduced (today: console 110, tenant 39, www-aglyn-io 18, docs 0, plugins 0).
- **`aglyn-app`'s leads are overwhelmingly spam — AGL-1590's premise is inverted. Re-verified end to end.**
  Export at `Platform Docs/Archives/aglyn-app-firestore-export-2026-08-14/` (9 files incl. `export.mjs`,
  `verify.mjs`, `restore.mjs`, `classification.json`). Re-ran `adjudicate.mjs` read-only:
  **120 total → 116 spam (61 bot / 52 solicitation / 3 test), 3 genuine, 1 ambiguous.** Range 2021-06-09 →
  2026-08-04. **2026 = 57 records → 39 bot / 16 cold / 1 genuine / 1 blank.** The single genuine 2026 lead is
  **2026-04-13** — confirmed the only one that year. README records an independent round-trip: source COUNT
  = 120 forms / 58 permissions, 120 unique ids, 0 empty shells, `restore.mjs` dry run 120 restorable / 0 failed.
  ⚠️ **Nuance:** those figures are the *adjudicated* result. The raw classifier alone gives 58/38/3/18/3 —
  the 116 only appears after `adjudicate.mjs` applies a hand-review OVERRIDE map. Reproducible, but not raw output.
  Retirement is **AGL-1657**, correctly gated on the GA property `257010770` question (**do not delete it** —
  it is the live Firebase Analytics link for `aglyn-app`; AGL-1581).
- **`aglyn.com` is already fully consent-gated** by the AGL-1498 machinery (Done). **AGL-1597's premise was
  wrong for 1 of its 3 domains.**
- **The console DOES have a real `window.gtag`** — Firebase injects it at runtime and owns that surface's GA
  state (`apps/console/components/layouts/firebase-app.layout.tsx:108–115`). **Grepping the served HTML wrongly
  concludes GA is absent.**
- **Crashlytics cannot be integrated.** No web SDK, no native surface in this repo (0 references anywhere).
  The wired equivalent is the error beacon → Cloud Error Reporting pipeline. Recorded in AGL-1637 and
  `docs/ANALYTICS.md` decision 9. Stop re-proposing it.

## OWED TO ZACH — all verified still open

| # | Item | Issue / status |
| --- | --- | --- |
| 0 | 🚨 **NEW, FOUND WHILE WRITING THIS HANDOFF — `RESEND_API_KEY` is linked to ZERO Vercel projects.** Same failure shape as the GA4 one, found the same way (visible only via `/v1/env`). `docs/EMAIL_SETUP.md:98` says it must be linked to **console + tenant**; `docs/SELF_HOSTING.md:113` says that without it *"app email (invites, receipts, campaigns) is an inert no-op."* `libs/plugins/bookings` and `libs/plugins/marketing` both refuse at runtime without it. **If this is real, invites / receipts / campaigns send nothing in production, 18 days from beta.** Blast radius **UNVERIFIED** — `docs/EMAIL_SETUP.md:15` also routes the *Firebase Auth relay* through Resend, yet the AGL-1524 verification mail did arrive on 2026-08-13, so the two need reconciling before concluding. **Verify first, then fix; no issue filed yet.** | ⚠️ **needs an issue** |
| 1 | **GA4 items 1–2 appear ALREADY DONE** (see corrections above) — both vars now linked to 4 projects as of 10:15Z, and the 15:06Z promotion rebuilt after that. **What is owed is the proof:** replay a delivered `invoice.paid` and watch GA4 Realtime for a `purchase`. Then items 3–8 (8 custom dimensions · `traffic_type` filter in **Testing mode first** · cross-domain stitching). | **AGL-1637** · Backlog · **Urgent** |
| 2 | **AGL-1514 re-proof** — his own ~2-min signup against now-fixed code. The original run produced AGL-1523/1524; both Done and in production. | AGL-1514 · In Progress |
| 3 | **Texas private letter ruling** — `Platform Docs/Legal/TX_PRIVATE_LETTER_RULING_REQUEST_marketplace-plugins.md`, **36,817 bytes / 265 lines**, self-labelled DRAFT, substantively complete through Part 10. Part 9 has **five** checkboxes, not four: 4 document exhibits (Publisher Agreement w/ §8 highlighted · ToS + EULA · a listing page · an invoice showing the tax line) **plus** the `[CONFIRM]` on whether any completed third-party publisher sale occurred (lines 106, 246). Send to `tax.help@cpa.texas.gov` (line 12). ⚠️ **Correction:** registered agent is *already filled in* (line 35) and the signatory is already named in Part 10 — only a physical signature + date remain, not a decision. ⚠️ **Extra gap not previously tracked:** line 234 discloses Rule 3.286 could not be verified against the live TAC (viewer retired mid-drafting); only the 2020-01-01 version was available. | (no issue — consider filing one) |
| 4 | **Advertising signals denied with no host control** — product/legal call. | **AGL-1649** · Backlog |
| 5 | **Live `VERCEL_OIDC_TOKEN`** in gitignored `tools/plugin-loader/origin/.env.local` — rotate? | **AGL-1634** · Backlog |
| 6 | **`E2ETEST100` discrepancy — UNRESOLVED.** A runbook audit verified it **unredeemed**, expiring **2026-08-21**; Zach believes it was redeemed last night. Not reconciled; would need a live Stripe read (⚠️ localhost uses `sk_LIVE`). | **AGL-1620** · Backlog |
| 7 | Carried forward, still open: Squarespace re-auth blocking 10 DNS records (AGL-1584/1585) · Squarespace billing address blocking the card before `aglyn.com`'s **Sep 15** charge (AGL-1578) · `roles/billing.admin` on the production billing account · registrar contact records unwritable (AGL-1567). | various · Backlog |

## LORE ADDED TODAY

- 🚨 **THE `git add` HAZARD IS NOW OBSERVED, NOT THEORETICAL — brief every agent with this verbatim.**
  Three separate agents today reported that **something ran `git add` across the whole tree**, staging files
  they did not author; **twice** it swept another agent's scratch or in-flight files into the index. In every
  case **`git commit --only <explicit paths>`** is what prevented a contaminated commit. **It saved three
  commits today.** Two rules follow:
  1. **Never `git add -A`.** Commit with `git commit --only` and explicit paths, always.
  2. **Run `git status --porcelain` immediately before committing — do not trust the index.** Someone else
     may have staged your files, or yours theirs, since you last looked.
  (Related standing memory: `--only` bounds the file *list*, not the *lines* — a contended file still carries
  the other agent's worktree state into your commit.)
- **`main` moves under you in this checkout.** It advanced twice during this handoff
  (`5ba159cc9` → `8c2dac60a` → `db5ecdf2b`). Never quote a commit count you did not compute in the same breath.
- **`app.aglyn.com/legal/*` 404s — the live legal pages are on `aglyn.com`.** A `curl -L` against the console
  path returns a 70KB 404 body, so "0 occurrences of the bad claim" is a **false pass**. Always assert the
  status code and a *positive* control string, not just the absence of the bad one.
- **A green rules guard is not a deployed rule.** `org-write-deny-coverage.spec.ts` reads the rules **file**.
  The only production signal is `npm run check:rules-drift`, which reports the **live ruleset id**.
- **The rules drift tool over-reports divergence.** "N lines only live" counts the pre-edit form of every
  modified line. Read the actual `-` lines before believing there are live-only edits worth preserving.
- **Live blob identity is the cleanest possible deploy proof.** The drift tool prints `index <live>..<HEAD>`;
  compare that against `git rev-parse origin/production:<path>`. Equal blob = deployed exactly at that SHA.
- **The rules deploy script reads the WORKTREE, not HEAD** — fatal in a shared checkout with live agents.
- **A shared Vercel variable is invisible to `vercel env ls`** and reads as absent while existing. Audit team
  scope with `GET https://api.vercel.com/v1/env?slug=aglyn`, never the CLI. `--scope` silently resolves to a
  *project*, and `--project` is not a real flag. **"Linked to 0 projects" is the bug shape to grep for** — it
  caught GA4 this morning and `RESEND_API_KEY` this afternoon. Check the whole shared list, not the one key
  you came for.
- **A stale premise can be stale because it was FIXED.** The GA4 finding was true at 01:26Z and false by
  10:15Z. Before re-reporting a blocker from earlier in the same session, re-read the source — the
  `updatedAt` timestamp is the tell.
- **Adjudicated counts are not classifier output.** The `aglyn-app` 116/120 spam figure only exists after a
  hand-review OVERRIDE map runs. Cite which pass produced a number when a decision rests on it.
- **Check a premise in both directions.** AGL-1590 (leads worth saving) and AGL-1597 (3 ungated domains) were
  each partly inverted; AGL-1581's "two unused GA properties" had one live Firebase link.

### Added by batch-3 (2026-08-14 evening)

- 🚨 **`npm ci` IN THE PINNED WORKTREE IS MANDATORY, NOT OPTIONAL.** The gate worktree's `node_modules`
  predated `3538d3a58`, so `qrcode.react` was missing. Node then **climbed out of the worktree and resolved
  `react` and `qrcode.react` from the live checkout** (`/Users/zgover/.../aglyn/node_modules`) while taking
  `react-dom` locally — **two copies of React**, "Invalid hook call", **7 phantom test failures and a phantom
  build break**. All three vanished after `npm ci`. A pinned worktree protects you from other agents' *source*
  edits; it does **nothing** about stale dependencies, and the failure it produces looks exactly like a real
  regression. ⚠️ The shared `~/.npm/_cacache` throws `EACCES`/`EEXIST` under concurrent agents — use
  `npm ci --cache <private-dir>`.
- 🚨 **A wrapper script's own exit code is NOT the gate verdict.** A gate script ending in `echo "ALL_DONE"`
  always exits **0**. Background-task notifications said *"completed (exit code 0)"* three separate times while
  `TEST_EXIT=1` / `TYPECHECK_EXIT=1` sat in the results file. Write each exit code to a file the instant the
  command returns, and **quote the captured variable, never the wrapper's status.** Same family as the
  `$?`-after-a-pipe trap.
- 🚨 **"Deployment Ready" ≠ "the alias points at it."** After the merge, `docs.aglyn.com` cut over in ~10s but
  `app.aglyn.com` and `aglyn.com` kept resolving to the **3h-old previous** deployments for ~8 minutes while
  console built. All three would have returned **200** the whole time. Verify the alias's *target*, not just
  that some production deployment is Ready: `vercel inspect <domain> --scope aglyn` prints the serving URL and
  its **created** age. Require an age younger than the merge.
- **`vercel inspect` and `vercel ls` silently use the wrong scope.** `vercel inspect docs.aglyn.com` resolves
  under `zach-govers-projects` and errors with "Can't find the deployment"; **`--scope aglyn` is required**.
  `vercel ls <project>` is not valid in CLI 55 — it suggests `vercel project ls --filter`. Bare `vercel ls`
  only ever shows the *linked* project (`aglyn-console`), so the tenant and docs builds are invisible to it.
- **The live checkout lies in BOTH directions about a spec's state.** Reading `author-css.spec.ts` from the
  live tree showed the AGL-1725 fix already applied — it was another agent's **uncommitted** work. `git show
  <sha>:<path>` showed the real committed state, still red. The mirror of AGL-1719's lesson ("reverting the
  worktree proves nothing once the change is committed"): a dirty tree can **fake a fix** as easily as it can
  hide one. Always check the committed blob.
- **Freezing dispatch is a legitimate promotion tool.** With ten agents landing ~1 commit/90s against a
  ~10-minute gate, no gate can ever be current. Freezing dispatch let `main` hold still across two checks and
  produced a **zero-drift** merge. Cheaper than an indefinite chase.
- **`git show "$VAR:path"` breaks in zsh.** `$TIP:a...` is parsed as the `:a` (absolute-path) parameter
  modifier and mangles the ref into a nonexistent path. Use `"${TIP}:path"` with braces.
- **A guard's error message should name every cause it cannot distinguish.** Three guards went red on
  legitimate patterns today; each asserted one cause as fact and picked the wrong one, sending the reader
  hunting a bug that was not there. See `apps/console/specs/source-text.ts` after `762621581` for the shape
  to copy.
