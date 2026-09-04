/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// Reads Main Gate's verdict for the commits a promotion would ship (AGL-2533).
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// Main Gate works. Until now its verdict reached no one. It cannot open a
// tracking issue — `gh api repos/aglyn/aglyn` returns `has_issues: false` — so
// it writes a COMMIT STATUS, which is correct, precise, and attached to a sha
// the branch has already moved past. On 2026-09-03 two red cycles went unread
// for hours by two different sessions while four promotions went out. An
// undetected break and a detected-but-unseen break cost the same.
//
// A promotion is the moment that verdict is finally worth something, so this
// is read there.
//
// ── THE TWO QUESTIONS, WHICH ARE NOT THE SAME QUESTION ─────────────────────
//
// 1. **Is the tip we are about to ship red?** That is a hard refusal. Nothing
//    about a known-red tip improves by promoting it.
//
// 2. **Did anything in this range ever go red?** That is a REPORT, never a
//    refusal, and the difference is the whole design. An intermediate red may
//    have been repaired by a later commit — `7aea3d373`'s ceiling red was —
//    or may have been a flake that will not reproduce. Refusing on range
//    history would block nearly every promotion and teach everyone to
//    override the check, which is worse than not having it.
//
// The observed incident is case 2: the reds were on commits that were
// ancestors by promotion time, and every promotion PR's own CI was green
// because the failure is timing-dependent (AGL-2532). No hard gate would have
// caught that. Being TOLD would have.
//
// ── WHY AN ABSENT `main-gate/full` IS NOT A FAILURE ────────────────────────
//
// `fast` runs on every push to `main` (AGL-2534); `full` runs only on the
// hourly cron, which GitHub delivers at roughly 11%. So most shas legitimately
// carry `fast` and no `full`. Demanding both would make this check refuse
// almost every promotion, for a reason that says nothing about the code.
// An absent `full` is therefore never a refusal.
//
// ── WHY AN ABSENT `main-gate/full` IS NOT GREEN EITHER (AGL-2564) ──────────
//
// The paragraph above is still right, and on its own it left a hole. Refusing
// a KNOWN red is correct; tolerating an ABSENT full is correct; together they
// mean nothing guarantees a full sweep ever ran on the code being promoted,
// and a commit nobody examined graded identically to one that passed
// everything. `d1cbc338f` broke three console specs, carried `fast=success`
// with no `full` at all, and would have promoted clean — a peer session
// bisecting by hand is what caught it.
//
// So the shape is a THIRD state rather than a stricter second one. `fast`
// covers typecheck and the guards; `full` adds the test sweep and the three
// production builds. A tip green on `fast` alone has had its tests looked at
// by nobody, which is a different claim from "the tests passed" and now prints
// as a different claim. The human still promotes — the grader reports, it does
// not refuse.
//
// The sweep must be on THE TIP. An ancestor's `full` graded different code, so
// it cannot vouch for what is being shipped; it is reported as context for the
// person deciding (how far back the last swept commit is) and never as a pass.

/** The prefix every Main Gate commit status shares. */
export const MAIN_GATE_CONTEXT_PREFIX = 'main-gate/'

/**
 * The context carrying the test sweep and the production builds. `fast` makes
 * a weaker claim, so its green alone leaves a tip unexamined.
 */
export const FULL_SWEEP_CONTEXT = 'main-gate/full'

/** GitHub commit-status states that mean the gate said no. */
const RED_STATES = new Set(['failure', 'error'])
/** States that are not yet a verdict. */
const PENDING_STATES = new Set(['pending'])

/**
 * EXIT CODES — "cannot check" must never masquerade as "clean", which is the
 * same rule `external-facts.mjs` and `check-shipped-not-closed.mjs` apply.
 *
 *   0  the tip passed a FULL sweep — tests and production builds included
 *   1  the tip is RED — refuse the promotion
 *   2  the tip carries no verdict at all, or only a pending one
 *   3  the tip is green on `fast`, and no full sweep ever ran on it
 *
 * 3 is not a refusal and must never become one; see the header. It exists so
 * that "nobody ran the tests on this" stops printing as "the tests passed".
 */
export const OK = 0
export const REFUSE = 1
export const UNVERIFIED = 2
export const UNEXAMINED = 3

/** Only the Main Gate contexts, ignoring every other status on the sha. */
export function gateContexts(commit) {
  return (commit?.contexts ?? []).filter((c) =>
    String(c?.context ?? '').startsWith(MAIN_GATE_CONTEXT_PREFIX),
  )
}

function redContexts(commit) {
  return gateContexts(commit).filter((c) => RED_STATES.has(c.state))
}

/** The full sweep's own context on a sha, whatever state it is in. */
function fullSweepContext(commit) {
  return (
    gateContexts(commit).find((c) => c.context === FULL_SWEEP_CONTEXT) ?? null
  )
}

/** Whether a full sweep ran on this sha and passed. */
function sweptFull(commit) {
  const full = fullSweepContext(commit)
  return (
    Boolean(full) &&
    !RED_STATES.has(full.state) &&
    !PENDING_STATES.has(full.state)
  )
}

/**
 * How the tip stands with respect to the full sweep, for the report.
 *
 *   `passed`   a full sweep ran on this sha and came back green
 *   `pending`  one is running now — the answer exists shortly, it is not here
 *   `absent`   no full sweep has ever run on this sha
 */
function sweepStanding(commit) {
  const full = fullSweepContext(commit)
  if (!full) return 'absent'
  if (PENDING_STATES.has(full.state)) return 'pending'
  return RED_STATES.has(full.state) ? 'red' : 'passed'
}

/**
 * The newest commit in the range a full sweep passed on, or `null`.
 *
 * It never makes a promotion green — it graded different code. It answers the
 * question the person deciding actually has: how much of what I am shipping
 * has had its tests run at all.
 */
function lastSweptCommit(list) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (sweptFull(list[i])) {
      return { commit: list[i], behind: list.length - 1 - i }
    }
  }
  return null
}

/**
 * Grade a promotion range.
 *
 * `commits` is oldest-first, exactly as `git log --reverse base..head` gives
 * it, so the LAST entry is the tip being promoted. Each entry is
 * `{ sha, subject, contexts: [{ context, state, targetUrl }] }`.
 *
 * The verdict carries `sweep` (`passed` / `pending` / `absent` / `red`) and
 * `lastSwept` alongside the code, so a caller can say WHICH kind of green it
 * is holding without re-deriving it from the contexts.
 */
export function gradePromotion(commits) {
  const list = Array.isArray(commits) ? commits : []
  const tip = list.length ? list[list.length - 1] : null

  // Every red in the range, tip included — the REPORT half.
  const reds = list
    .map((c) => ({ commit: c, contexts: redContexts(c) }))
    .filter((r) => r.contexts.length > 0)

  const lastSwept = lastSweptCommit(list)

  if (!tip) {
    return {
      code: UNVERIFIED,
      tip: null,
      reds,
      sweep: 'absent',
      lastSwept,
      reason: 'no commits in the promotion range — nothing to grade',
    }
  }

  const sweep = sweepStanding(tip)
  const base = { tip, reds, sweep, lastSwept }

  const tipRed = redContexts(tip)
  if (tipRed.length > 0) {
    return {
      ...base,
      code: REFUSE,
      reason:
        `the tip ${tip.sha.slice(0, 9)} is RED: ` +
        tipRed.map((c) => c.context).join(', '),
    }
  }

  const tipGate = gateContexts(tip)
  const decided = tipGate.filter((c) => !PENDING_STATES.has(c.state))
  if (decided.length === 0) {
    return {
      ...base,
      code: UNVERIFIED,
      reason: tipGate.length
        ? `the tip ${tip.sha.slice(0, 9)} has only a pending gate verdict`
        : `the tip ${tip.sha.slice(0, 9)} carries no Main Gate status at all`,
    }
  }

  if (sweep !== 'passed') {
    return {
      ...base,
      code: UNEXAMINED,
      reason:
        `the tip ${tip.sha.slice(0, 9)} is green on ` +
        `${decided.map((c) => c.context).join(', ')}, and ` +
        (sweep === 'pending'
          ? `${FULL_SWEEP_CONTEXT} is still running on it`
          : `${FULL_SWEEP_CONTEXT} has never run on it`) +
        ' — its tests and production builds are UNEXAMINED',
    }
  }

  return {
    ...base,
    code: OK,
    reason:
      `the tip ${tip.sha.slice(0, 9)} passed a full sweep — green on ` +
      decided.map((c) => c.context).join(', '),
  }
}
