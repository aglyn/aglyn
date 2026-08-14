---
description: "SUPERSEDED 2026-08-14 — AGL-1019 and the whole artifact-lifecycle project shipped. A dated 2026-08-04 session handoff kept for its method notes. Use /handoff."
---

> ⚠️ **SUPERSEDED (2026-08-14) — this is a point-in-time session handoff written
> 2026-08-04, not a live runbook. For the current promotion flow, working
> agreements and queue, read `.claude/commands/handoff.md` and `.claude/HANDOFF.md`;
> where they disagree with anything below, they win.** Corrected in place (AGL-1704):
>
> - **The work in section 1 is DONE — do not build it.** Verified in Linear
>   2026-08-14: **AGL-1019 is Done**, and so is everything it was said to block —
>   AGL-1020, AGL-1021, AGL-1022, AGL-1023 — plus AGL-1027, AGL-1031 and AGL-1049.
>   The override layer exists. This file's own rule applies to itself: *"Verify the
>   premise. AGL-1184 was already done."*
> - **The promotion notes in "Do not promote unless asked" are spent.** The nine
>   commits listed landed long ago. The standing agreement is unchanged in spirit
>   and stricter in form: **promotion needs Zach's word before it starts**, gate in
>   a pinned worktree, PR `main` → `production`, real merge commit, no
>   intermediate branch.
> - **A promotion costs 4 deployment records, not 2 build slots** (AGL-1187,
>   AGL-1633). `aglyn-plugins` creates a record on every promote and then cancels
>   it; only `www` has genuinely stopped.
> - Treat "Needs Zach" and "Loose ends" as history and re-derive from Linear —
>   AGL-1239 and AGL-937's mitigation are among the items that have since moved.
>
> Still worth reading: **section 2, "Method that this session paid for"** — the
> vacuous-control and bundle-attribution lessons are still load-bearing.

Pick up from `/promote-and-enforce` on 2026-08-04. **Read "The other session"
first — it is the thing most likely to cost you time or damage.**

Work issues in Linear: **In Progress** when you start, **In Review** when it
lands, **Done** once verified in production. One conventional commit per
AGL-### on `main`.

## The other session — a real one, running right now

It shares this checkout and pushes to `main`. Three concrete hazards, all
observed rather than theoretical:

- **Something auto-stages.** Files land in the index without `git add`. I found
  a throwaway probe spec and a JSON snapshot of live Stripe customer ids staged
  this way. **Always `git commit --only <your paths>`**, never `-a`, and read
  `git status` before every commit.
- **Never `git stash`, never `commit --amend`** on `main`. Amending rewrites a
  commit that may already be theirs.
- **Commit messages cite issue numbers that did not exist yet.** `63736a494`
  ("the Image element discarded every style") cites **AGL-1238**, which I
  created hours later for something unrelated. `git log --grep AGL-1238` is
  therefore misleading. This has now happened three times across sessions
  (AGL-1213, AGL-1217, AGL-1238) — **trust `get_issue`, never the git trail.**

Their territory: `libs/besigner/**`, `libs/plugins/mui/**`, the media picker,
`tools/marketing/**`, and the marketing-site issues (AGL-1165, AGL-1167–1171,
AGL-1234). Stay out. There is a `/marketing-design-audit` command that is
theirs, not yours.

## Do not promote unless asked

Zach explicitly said **keep working without promoting**. Nine commits sit on
`main` ahead of `production`. Three of them want a production read when he does
promote — offer it, do not do it unprompted:

| commit | what to read afterwards |
| -- | -- |
| `f731c4b7d` AGL-1225 | `AGL-1152:render` log — `composeScreenNodes` was **1577 ms** cold, ~1400 warm. It should drop; that is the whole claim. |
| `11fd5a6a6` AGL-1228 | tenant response should carry **no** `Content-Security-Policy-Report-Only` and no `script-src`. |
| `c2e1007e8` AGL-937 | staff org detail still renders a real org; the new alert only fires on a confirmed-absent or failed read. |

Quota is healthy (~47/day against 100, `www` at 0). A promotion costs 2 build
slots now, not 4 — but `ignoreCommand` only skips a *build*, not a deployment
*record*; only `deploymentEnabled` saves quota. Verify against the **READY
deployment sha**, never the branch.

## 1. The work: AGL-1019 — the override layer

Project **Marketplace artifact lifecycle**. Issues 1–4 are Done; this is 5, and
6–9 (`AGL-1020` themes, `AGL-1021` theme overrides, `AGL-1022`/`AGL-1023` host
variables) all sit on top of it. Also open in the project and *not* blocked by
this: `AGL-1027` (uninstall must show what it breaks), `AGL-1031` (real palette
elements), `AGL-1049` (placement settings from the manifest).

**The mechanism:** never mutate the vendored artifact. Keep the publisher's
version untouched as the **base**, store the user's changes as a **sparse
patch**, resolve `base ⊕ patch` at read time. Update replaces the base; the
patch still applies. "What did I change" *is* the patch. "Reset" is deleting it.

Scope is the mechanism, not its consumers:

- storage convention — patches **beside** the base, never inside it;
- a resolver with defined semantics for **deletions** (needs an explicit
  sentinel) and **arrays** (merge-by-index is a trap; key where one exists);
- pure and heavily unit-tested — everything downstream inherits its bugs;
- provenance-aware: an artifact with no base cannot be patched and should say so.

**Two things I would check before writing any of it**, both learned the hard way
in this codebase:

1. **`orgs/{orgId}/pluginSettings/{pluginId}` is already a patch over schema
   defaults** and has its own merge (`mergePluginConfig`). The issue names it as
   the obvious second consumer. Read it first — either it is the design you
   want, or it is the thing you must not accidentally diverge from.
2. **Firestore `merge: true` deep-merges maps**, which is *not* the same as a
   sparse patch and is why deletion needs a sentinel. `dropClearedProps` and the
   besigner's `null`-means-cleared convention are prior art; a `null` that means
   "cleared" already took down every `/product/*` page once (AGL-1226).

Extend shared libs rather than re-implementing — grep `libs/` first. The
resolver almost certainly belongs in `libs/aglyn/src/lib/app-utils/`.

## 2. Method that this session paid for

Every one of these cost a wrong answer before it became a rule.

- **A control that cannot fail is not a control.** Three of my `node_modules`
  greps returned "0 files" and were vacuous: **`timeout` does not exist on
  macOS**, so each exited 127 without running. Run a positive control in the
  same shape first, and check the command's *own* exit status — `cmd | head`
  makes `$?` belong to `head`.
- **Assert the mutation landed** before reading a negative control. Twice a
  `perl -0pi` substitution silently did not match, so "all tests still pass"
  meant nothing. Prefer a Python edit with `assert old in s`.
- **Absence tests need a presence assertion beside them.** My tenant CSP test
  passed against a *redirect* that had no CSP at all, until the base-directive
  control caught it. Same file: an `x-nonce` assertion could never fail, because
  middleware request-header overrides surface as `x-middleware-request-x-nonce`.
- **Never attribute a bundle by identifier.** I told Zach the CSP `eval` probe
  came from a Node `util` polyfill, inferring it from `isGeneratorFunction`,
  `deprecate`, `inherits`. Minifiers rename those. Signature *string literals*
  falsified it — see AGL-1238, which is now correctly "unknown importer".
- **Verify the premise.** AGL-1184 was already done. AGL-1137 said "every price
  id is dead"; 20 of 64 were fine. AGL-1028 named four keys to move; only two
  could move. Read the code before believing the issue.
- **Route-file existence is not reachability.** `/api/marketplace/verification-request`
  has no route file — it is served by the `[...pluginApi]` catch-all. I nearly
  reported a working feature as unwired.

## 3. Needs Zach, not research

- **AGL-734** — delete the stale GCP DNS zone. One console action; risk is gone.
- **AGL-1148** uptime number · **AGL-1104** compliance posture · **AGL-1132**
  storefront checkout (undone) · **AGL-1133 item 5** collaborator contact
  visibility.
- **AGL-1213** — the design's gating question is aimed at the wrong allowlist.
  App Check runs on a reCAPTCHA key with **origin verification ON** and a
  9-domain list, so a white-label console domain cannot read Firestore at all.
  Needs a ceiling decision before the feature is sold.
- **AGL-1066 Q2** — what the degraded state looks like when a session goes
  stale. Q1 and Q3 are answered on the issue; only the design call is left.
- **AGL-1137 item 3** — whether localhost should point at live Stripe. It does
  today, and I just made those writes *succeed*.

## 4. Loose ends worth an hour

- **AGL-1239** — the marketing site's component fan-out is **48 against a cap of
  50**. Two more pages and every component publish silently leaves the overflow
  stale. Raising `MAX_PATHS` is the cheap fix.
- **AGL-937** — the mitigation landed; the real fix (serve staff org detail from
  the Admin SDK, as AGL-878 did for the list) is still open.
- **AGL-1066** — 25 other surfaces share the read-then-write shape, listed on
  the issue. The `merge: true` ones first.
- **AGL-1151** — one **892 KB** shared client chunk. Worth a module-graph trace;
  the analyser is trustworthy for reachability, never for sizes.
