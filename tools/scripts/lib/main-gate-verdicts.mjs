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
// A sha with SOME green gate context and no red one is `ok`.

/** The prefix every Main Gate commit status shares. */
export const MAIN_GATE_CONTEXT_PREFIX = 'main-gate/'

/** GitHub commit-status states that mean the gate said no. */
const RED_STATES = new Set(['failure', 'error'])
/** States that are not yet a verdict. */
const PENDING_STATES = new Set(['pending'])

/**
 * EXIT CODES — "cannot check" must never masquerade as "clean", which is the
 * same rule `external-facts.mjs` and `check-shipped-not-closed.mjs` apply.
 *
 *   0  the tip carries a gate verdict and none of it is red
 *   1  the tip is RED — refuse the promotion
 *   2  the tip carries no verdict at all, or only a pending one
 */
export const OK = 0
export const REFUSE = 1
export const UNVERIFIED = 2

/** Only the Main Gate contexts, ignoring every other status on the sha. */
export function gateContexts(commit) {
  return (commit?.contexts ?? []).filter((c) =>
    String(c?.context ?? '').startsWith(MAIN_GATE_CONTEXT_PREFIX),
  )
}

function redContexts(commit) {
  return gateContexts(commit).filter((c) => RED_STATES.has(c.state))
}

/**
 * Grade a promotion range.
 *
 * `commits` is oldest-first, exactly as `git log --reverse base..head` gives
 * it, so the LAST entry is the tip being promoted. Each entry is
 * `{ sha, subject, contexts: [{ context, state, targetUrl }] }`.
 */
export function gradePromotion(commits) {
  const list = Array.isArray(commits) ? commits : []
  const tip = list.length ? list[list.length - 1] : null

  // Every red in the range, tip included — the REPORT half.
  const reds = list
    .map((c) => ({ commit: c, contexts: redContexts(c) }))
    .filter((r) => r.contexts.length > 0)

  if (!tip) {
    return {
      code: UNVERIFIED,
      tip: null,
      reds,
      reason: 'no commits in the promotion range — nothing to grade',
    }
  }

  const tipRed = redContexts(tip)
  if (tipRed.length > 0) {
    return {
      code: REFUSE,
      tip,
      reds,
      reason:
        `the tip ${tip.sha.slice(0, 9)} is RED: ` +
        tipRed.map((c) => c.context).join(', '),
    }
  }

  const tipGate = gateContexts(tip)
  const decided = tipGate.filter((c) => !PENDING_STATES.has(c.state))
  if (decided.length === 0) {
    return {
      code: UNVERIFIED,
      tip,
      reds,
      reason: tipGate.length
        ? `the tip ${tip.sha.slice(0, 9)} has only a pending gate verdict`
        : `the tip ${tip.sha.slice(0, 9)} carries no Main Gate status at all`,
    }
  }

  return {
    code: OK,
    tip,
    reds,
    reason:
      `the tip ${tip.sha.slice(0, 9)} is green on ` +
      decided.map((c) => c.context).join(', '),
  }
}
