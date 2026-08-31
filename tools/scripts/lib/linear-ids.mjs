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

// The citation comparator behind `npm run check:linear-ids` (AGL-2500).
// Pure functions only — no git, no network, no filesystem — so the self-test
// can pin every verdict by hand.
//
// ── THE DEFECT THIS ANSWERS ───────────────────────────────────────────────
//
// On 2026-08-28 fourteen commits landed on `main` citing Linear issue ids
// that had never been assigned: AGL-2508 through AGL-2521, against a
// workspace whose highest issue was AGL-2499. The same fourteen ids reached
// ninety-seven source comments across fifty files, where they outlive the
// commit message that carried them, because a reader who opens a file reads
// the comment and a reader who opens the log usually does not.
//
// A commit citing a NON-EXISTENT issue is worse than one citing none. Citing
// none says "there is no ticket". Citing AGL-2515 says "there is context, go
// and read it" and sends the reader to a 404 — so the reader concludes their
// own access is broken, or that somebody deleted the issue, and the cost is
// paid by every future reader rather than once by the author.
//
// It happened fourteen times in one day, in commits written minutes apart,
// which is the whole argument for an exit code instead of another note.
//
// ── WHY A CEILING, AND NOT A LIVE QUERY ───────────────────────────────────
//
// The obvious guard asks Linear whether each cited id resolves. It would need
// `LINEAR_API_KEY`, and that key is set NOWHERE in this repository — not in
// any `.env`, not as a repo secret. `check-shipped-not-closed.mjs` records the
// same finding and takes the same turn for the same reason: a check built on
// a credential nobody has set is BORN INERT, which is exactly how
// `check:legal-drift` spent its first day (AGL-2379 — wired, scheduled, and
// blocked on a repo variable nobody had set).
//
// The three candidate offline behaviours, and why this one:
//
//   FAIL OPEN (pass when Linear is unreachable) — refused outright. That is
//   the swallowed-query-as-a-measured-zero shape this repo has been bitten by
//   repeatedly: a guard that cannot check, printing the same green as a guard
//   that checked and found nothing. It would have caught zero of the fourteen.
//
//   FAIL CLOSED (refuse every commit when Linear is unreachable) — refuses
//   every commit always, since the credential does not exist. That is not a
//   guard, it is a work stoppage, and the first response to it would be to
//   delete it.
//
//   A CACHED CEILING, REFRESHED DELIBERATELY — this. The highest issue that
//   existed at a recorded date is checked into the repo as a fact with a
//   provenance line. Every citation above it is refused. It needs no network,
//   no credential and no Linear account, so it runs on every checkout and in
//   every workflow, and it is never silently green: with no ceiling file, or a
//   malformed one, the verdict is UNKNOWN (exit 2), never clean.
//
// ── WHAT A CEILING CAN AND CANNOT SEE ─────────────────────────────────────
//
// ⚠️ Stated plainly because a guard whose limits are not written down gets
// trusted past them.
//
// It CATCHES a citation above the highest assigned id. That is the entire
// observed failure mode: an agent that wants a plausible issue number invents
// the NEXT one, and all fourteen fabrications were 2508–2521 against a
// ceiling of 2499. Linear identifiers are assigned sequentially per team, so
// above-the-ceiling is not a heuristic — it is a proof of non-existence.
//
// It CANNOT catch a citation of a gap BELOW the ceiling: an id in the
// assigned range that was never issued, or an issue since deleted. Closing
// that needs the live workspace, which needs the credential that does not
// exist. `--refresh` is the seam for the day it does.
//
// ── STALENESS IS A FIRST-CLASS VERDICT ────────────────────────────────────
//
// A ceiling that is never refreshed refuses REAL new issues. That is the one
// way this guard can be wrong in the expensive direction, so it is handled
// rather than hoped about: a citation above the ceiling is reported together
// with the ceiling's own age and the exact hand-edit that raises it, and a
// ceiling older than `STALE_AFTER_DAYS` says so on every run, including a
// clean one. The remedy is in the output for the AGL-2486 reason — three
// count-keyed guards went red on `main` in one working day and what cost the
// round trip was not the red, it was the author learning from CI and then
// having to work out what to write.

/**
 * Files where an issue id is DATA rather than a citation.
 *
 * Two kinds, and both would otherwise make the guard fail on work that is
 * correct:
 *
 *  1. This guard's own material. Its fixtures pin real fabricated ids on
 *     purpose — a self-test written against invented ids would prove only that
 *     the parser can read digits — and the decision record and the workflow
 *     comment quote the range they exist to describe.
 *  2. The self-tests of the OTHER guards that parse issue ids, which use
 *     synthetic ones (`AGL-0000` as a placeholder, `AGL-3000` in a parser
 *     case). Those name no work at all, so there is no reader to send
 *     anywhere.
 *
 * Deliberately a short, exact list rather than a pattern. An allowlist is a
 * hole in a guard: `tools/scripts/lib/*.test.mjs` would have covered these six
 * and every future self-test that cites a REAL issue wrongly, which is a
 * different thing and one worth catching.
 */
export const NOT_A_CITATION = Object.freeze([
  'tools/scripts/lib/linear-ids.mjs',
  'tools/scripts/lib/linear-ids.test.mjs',
  'tools/scripts/check-linear-ids.mjs',
  'tools/scripts/linear-issue-ceiling.json',
  'docs/DECISION_LOG.md',
  '.github/workflows/tools-guards.yml',
  // Synthetic fixtures in the sibling guards' self-tests.
  'tools/scripts/lib/decision-log.test.mjs',
  'tools/scripts/lib/dependency-egress.test.mjs',
  'tools/scripts/lib/shipped-not-closed.test.mjs',
])

/**
 * Commits already on `main` whose messages carry a fabricated id.
 *
 * ⚠️ THIS IS THE ONLY PLACE THE GUARD FORGIVES ANYTHING, and it exists because
 * of a decision rather than a limitation: history is not rewritten (see
 * `docs/DECISION_LOG.md`, 2026-08-28). Without it the commit sweep is red
 * forever, and a guard that can never pass is one somebody deletes.
 *
 * Listed by SHA, not exempted by date. A date cut-off would forgive every
 * future commit that happened to predate a moving line; a sha list forgives
 * exactly fourteen known commits, so a fifteenth still fails. The list may
 * shrink — a rebase that drops one — and must never grow.
 *
 * @param {string} sha
 * @param {string[]} known
 */
export function isForgivenCommit(sha, known) {
  const full = String(sha ?? '')
  return (known ?? []).some((one) => one === full || full.startsWith(one))
}

/** Whether a swept path is writing about the ids rather than citing one. */
export function isExemptPath(path) {
  return NOT_A_CITATION.includes(String(path ?? '').replace(/^\.\//, ''))
}

/** Matches an issue citation anywhere in a body of text. */
const CITATION = /\bAGL-(\d+)\b/g

/**
 * Matches ONLY a commit subject that ends in its issue tag.
 *
 * The same anchor `shipped-not-closed.mjs` uses, and for the same reason: a
 * subject like `fix(x): follow-up to AGL-1000 (AGL-2000)` IMPLEMENTS AGL-2000
 * and merely mentions AGL-1000. Both are still validated for existence here —
 * citing a fabricated id in passing is the same lie — but only the anchored
 * one is reported as the commit's own claim.
 */
const SUBJECT_TAG = /\((AGL-\d+)\)\s*$/

/** A ceiling older than this is reported as stale on every run, red or green. */
export const STALE_AFTER_DAYS = 45

export const OK = 'OK'
export const FABRICATED = 'FABRICATED'
export const UNKNOWN = 'UNKNOWN'

/**
 * Every issue id cited in a body of text, deduped, in first-seen order.
 *
 * @param {string} text
 * @returns {{id: string, number: number}[]}
 */
export function parseCitations(text) {
  const seen = new Map()
  for (const match of String(text ?? '').matchAll(CITATION)) {
    const id = `AGL-${match[1]}`
    if (!seen.has(id)) seen.set(id, { id, number: Number(match[1]) })
  }
  return [...seen.values()]
}

/** The issue a commit subject claims to implement, or null. */
export function issueFromSubject(subject) {
  const match = SUBJECT_TAG.exec(String(subject ?? '').trim())
  return match ? match[1] : null
}

/**
 * Whether one citation can possibly name a real issue.
 *
 * `ceiling` is the highest issue number known to exist. A citation ABOVE it
 * cannot exist, because Linear assigns identifiers sequentially per team —
 * this is the one judgement the cache makes with certainty. A citation at or
 * below it is reported OK, which means "not disprovable from here", NOT
 * "verified to exist". See the limits note in the header.
 *
 * @param {{id: string, number: number}} citation
 * @param {number} ceiling
 */
export function classifyCitation(citation, ceiling) {
  if (!Number.isInteger(ceiling) || ceiling <= 0) return UNKNOWN
  if (!citation || !Number.isInteger(citation.number)) return UNKNOWN
  // AGL-0 is not an identifier Linear ever issues, and a leading-zero form
  // like AGL-0042 is not the id it looks like. Both are refused rather than
  // silently normalised.
  if (citation.number <= 0) return FABRICATED
  return citation.number > ceiling ? FABRICATED : OK
}

/**
 * Validate a ceiling record read off disk.
 *
 * Returns `{ ok: false, reason }` rather than throwing, because the caller
 * turns every unusable ceiling into the SAME exit 2 — a guard that cannot
 * read its own baseline must not print a verdict either way.
 */
export function readCeiling(raw) {
  if (raw === null || typeof raw !== 'object')
    return { ok: false, reason: 'the ceiling file is not a JSON object' }
  const { team, highest, verifiedAt } = raw
  if (team !== 'AGL')
    return { ok: false, reason: `unexpected team ${JSON.stringify(team)} (want "AGL")` }
  if (!Number.isInteger(highest) || highest <= 0)
    return { ok: false, reason: `"highest" must be a positive integer, got ${JSON.stringify(highest)}` }
  if (typeof verifiedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(verifiedAt))
    return { ok: false, reason: `"verifiedAt" must be an ISO date, got ${JSON.stringify(verifiedAt)}` }
  const verifiedMs = Date.parse(`${verifiedAt}T00:00:00Z`)
  if (Number.isNaN(verifiedMs))
    return { ok: false, reason: `"verifiedAt" is not a real date: ${verifiedAt}` }
  return { ok: true, ceiling: { team, highest, verifiedAt, verifiedMs, raw } }
}

/** Whole days between the ceiling's verification date and now. */
export function ceilingAgeDays(ceiling, nowMs) {
  return Math.floor((nowMs - ceiling.verifiedMs) / 86_400_000)
}

/**
 * The verdict for one sweep.
 *
 * ⚠️ THE POSITIVE CONTROL IS THE POINT. `scanned` is how many citations the
 * sweep actually looked at. A sweep that examined ZERO of them has not proved
 * the corpus is clean — it has proved nothing, and the two are the same green
 * unless something separates them. This repo has been bitten by that shape
 * repeatedly: `grep` honouring `.gitignore` and returning zero for tracked
 * files, a blocked directory making `grep -r` answer zero, a phase timer
 * naming a function instead of its cost. `assertPositiveControl` in
 * `persisted-synthetic-id.mjs` (AGL-1889) is the same defence.
 *
 * So an empty sweep over a NON-EMPTY corpus is UNKNOWN, never OK. `corpusSize`
 * is what distinguishes "nothing to look at" from "the search broke": a
 * commit range with no commits in it is legitimately empty, a fifty-thousand
 * file tree containing no `AGL-` string at all is a broken search.
 *
 * `scanned` and `fabricated` are passed SEPARATELY rather than derived from
 * one list, because the whole point is that "found no fabrications" and
 * "examined nothing" must not arrive here as the same empty array.
 *
 * @param {object} input
 * @param {{id: string, number: number, where: string}[]} input.fabricated
 * @param {number} input.scanned how many citations were actually examined
 * @param {number} input.corpusSize how many items the sweep covered
 * @param {number} input.ceiling
 * @param {string} input.name for the report
 */
export function sweepVerdict({ fabricated, scanned, corpusSize, ceiling, name }) {
  const bad = fabricated ?? []
  const looked = scanned ?? 0

  // The corpus was non-empty and yielded no citation at all. Either it
  // genuinely cites no issue, or the search mechanism failed — and this guard
  // cannot tell those apart, so it declines to call it clean.
  if (looked === 0 && (corpusSize ?? 0) > 0)
    return {
      name,
      state: UNKNOWN,
      scanned: 0,
      corpusSize,
      fabricated: [],
      detail:
        `covered ${corpusSize} item(s) and examined NO citation at all. That is not a ` +
        'clean result, it is an unproven one — a search that silently matches nothing ' +
        'reports every corpus as fine.',
    }

  return {
    name,
    state: bad.length > 0 ? FABRICATED : OK,
    scanned: looked,
    corpusSize: corpusSize ?? 0,
    fabricated: bad,
    detail:
      bad.length > 0
        ? `${bad.length} citation(s) name an issue that cannot exist`
        : `${looked} citation(s) checked, all at or below AGL-${ceiling}`,
  }
}

/**
 * Fold every sweep into one exit code.
 *
 * UNKNOWN dominates FABRICATED dominates OK. A sweep that could not run must
 * never be averaged away by one that could.
 */
export function overallExitCode(sweeps) {
  if (sweeps.some((one) => one.state === UNKNOWN)) return 2
  if (sweeps.some((one) => one.state === FABRICATED)) return 1
  return 0
}

/**
 * The exact edit that raises a ceiling which is merely BEHIND.
 *
 * Deliberately spells out that the number must be READ OFF LINEAR rather than
 * inferred from the citation that just failed. Raising the ceiling to admit
 * the id that tripped it would launder a fabrication into a fact — the ratchet
 * `--write` trap (AGL-2486) in a different costume, and worse here, because
 * the whole file is one number and one bad edit disarms the guard completely.
 */
export function remedy(ceilingPath, ceiling) {
  return (
    '\nIF THESE IDS ARE REAL, the ceiling is behind the workspace. Raise it by\n' +
    `hand-editing ${ceilingPath}:\n\n` +
    '    "highest": <the highest issue that ACTUALLY exists>,\n' +
    `    "verifiedAt": "<today, ISO>",\n\n` +
    '⛔ Read that number off Linear — newest-first, `includeArchived: true` —\n' +
    '   and do NOT simply raise it to whatever number failed above. Setting the\n' +
    '   ceiling from the citation being checked makes every fabrication\n' +
    '   self-approving and disarms this guard permanently.\n' +
    `   Current ceiling: AGL-${ceiling.highest}, verified ${ceiling.verifiedAt}.\n` +
    '\nIF THESE IDS ARE NOT REAL, fix the citation. An issue-creation freeze is\n' +
    'in force, so a fabricated id may NOT be made real by creating it —\n' +
    'retag the work to the issue that genuinely covers it, or drop the tag.\n' +
    'See docs/DECISION_LOG.md → 2026-08-28, "Fourteen commits cited issue\n' +
    'ids that never existed".\n'
  )
}

/** Human-readable report for every sweep. */
export function formatReport(sweeps, { ceiling, ageDays, ceilingPath }) {
  const lines = []
  lines.push(`Linear citation check — ceiling AGL-${ceiling.highest}, verified ${ceiling.verifiedAt} (${ageDays}d ago)`)
  lines.push('')

  for (const sweep of sweeps) {
    lines.push(`  [${sweep.state}] ${sweep.name}: ${sweep.detail}`)
    for (const one of sweep.fabricated) {
      lines.push(`      ${one.id} — above AGL-${ceiling.highest}, so it was never assigned`)
      lines.push(`        ${one.where}`)
    }
  }

  if (ageDays >= STALE_AFTER_DAYS) {
    lines.push('')
    lines.push(
      `  ⚠️  This ceiling is ${ageDays} days old (stale after ${STALE_AFTER_DAYS}). ` +
        'It will start refusing REAL issues. Refresh it deliberately —\n' +
        `      npm run check:linear-ids -- --refresh   (needs LINEAR_API_KEY)\n` +
        `      or hand-edit ${ceilingPath} after reading the workspace.`,
    )
  }

  return lines.join('\n')
}
