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

// Finds a commit that quietly deleted a file ANOTHER issue had just added
// (AGL-2344). Pure functions only — no git — so the self-test can pin the
// real incidents as fixtures.
//
// THE PROBLEM THIS EXISTS FOR. Several agents share one checkout. When one of
// them commits from a stale or contended working tree, files it never meant
// to touch ride along at their OLD content — and if that old content is
// "absent", the commit DELETES another agent's just-landed work while
// reporting a subject about something else entirely. Nothing fails. Tests,
// lint and typecheck all pass, because the deleted thing was itself the guard
// that would have complained.
//
// What it costs is the history. `git log --follow` then attributes the
// deletion to an issue that had nothing to do with it, the changelog and the
// PR manifest inherit that attribution, and the next reader is sent to the
// wrong issue. That is the AGL-2344 shape: work permanently filed under a
// number that does not own it.
//
// THREE REAL INCIDENTS, all inside 1200 commits, all pinned in the .test.mjs:
//
//   1. 2026-08-20 00:10–00:13. `54c9b066b` (AGL-2418), `48bb05eba` (AGL-1889)
//      and `95ab9d4cd` (AGL-1448) each swept AGL-2422's storage-backup guard
//      backwards — ~986 lines across seven files, three times in four
//      minutes. Restored by `4599734b4`.
//   2. `38e61ed35` (AGL-1890) deleted two files AGL-1993 had added one commit
//      earlier. Caught by hand and restored by `9ee2252bd`, whose subject
//      says so outright: "restore AGL-1993, which 38e61ed35 reverted by
//      accident".
//   3. `4e0bdc729` (AGL-2444), a commit about server-side permission
//      enforcement, also deleted `apps/docs/jest.config.ts`,
//      `apps/docs/specs/error-beacon.spec.ts` (270 lines),
//      `apps/docs/project.json`, `cloud/functions/project.json` and
//      `tools/scripts/lib/rules-drift.test.mjs` — every one of them added two
//      commits earlier under AGL-2377. This one was never filed; the check
//      found it.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────────
//
// AGL-2344 also asks about the MISLABEL case: `715599d69` carries the subject
// `chore(deps): … (AGL-2480)` while its entire diff is AGL-2479's
// `eslint.config.mjs` work. Two detectors for that were built and MEASURED
// against 1200 commits of real history, and both were rejected:
//
//   * "the added lines cite an issue id that is not the subject's" —
//     42 flags in 511 eligible commits (8%), and tightening it to a SOLE
//     foreign citation still gave 23 in 140 (16%). Every one was a legitimate
//     prior-art reference: a fix annotating the earlier issue whose code it
//     touches. No text rule separates "cites AGL-2240 as context" from "is
//     AGL-2240's work".
//   * "the diff shares no file with the issue's other commits" — the form the
//     issue proposes. 228 flags in 489 evaluable commits (47%), because an
//     issue's commits legitimately touch different files (a feature, then its
//     spec fix, then its docs). It is also inapplicable to 621 of 790 issues,
//     which have exactly one commit and therefore no siblings to compare
//     against.
//
// Both are noise generators, and a guard people learn to ignore is worse than
// no guard. So mislabelling by SUBJECT is left to review, and only the
// accidental sweep — which is mechanically decidable, and which caused the
// worse damage — is checked here.
//
// This also catches only a WHOLE-FILE deletion. The AGL-2422 sweep reverted
// content inside surviving files too, and that half is invisible here; it is
// detected only because one file vanished outright. A commit that reverts
// another's edits without removing a file will not be flagged.

import { issueFromSubject } from './shipped-not-closed.mjs'

/**
 * How far back to look for the commit that added a deleted file.
 *
 * The window is what keeps ordinary cleanup out of the report: deleting a
 * file added last month is housekeeping, deleting one added twenty minutes
 * ago while claiming to do something else is a sweep. All three known
 * incidents deleted a file added 1–2 commits earlier.
 */
export const DEFAULT_WINDOW = 40

/**
 * Whether a commit message accounts for removing this path.
 *
 * Naming the file — full path or basename — is the whole exemption, and it is
 * deliberately narrow. An earlier version excused any subject containing a
 * removal word, which let incident 3 through: `4e0bdc729`'s body has a
 * "REMOVED:" section about a permission key, and nothing about the five
 * unrelated files it also deleted. Saying "I removed something" must not
 * excuse removing something else.
 */
export function messageAccountsFor(message, path) {
  const text = String(message ?? '')
  const file = String(path ?? '')
  if (!file) return false
  if (text.includes(file)) return true
  const base = file.split('/').pop()
  return Boolean(base) && text.includes(base)
}

/**
 * Find the sweeps in a range of commits.
 *
 * @param commits `[{ sha, subject, message, added, deleted }]` in OLDEST to
 *   NEWEST order. `added`/`deleted` are path arrays.
 * @param options `{ window }`
 * @returns `[{ sha, subject, issue, swept: [{ path, addedBy, addedByIssue,
 *   distance }] }]` — one row per suspect commit.
 */
export function findSweptFiles(commits, { window = DEFAULT_WINDOW } = {}) {
  const list = commits ?? []
  const findings = []

  for (let i = 0; i < list.length; i++) {
    const commit = list[i]
    const issue = issueFromSubject(commit?.subject)
    // A commit with no issue tag cannot be a MISATTRIBUTION: there is no
    // wrong issue for the history to file it under. Reported by neither rule.
    if (!issue) continue

    const swept = []
    for (const path of commit?.deleted ?? []) {
      if (messageAccountsFor(commit?.message ?? commit?.subject, path)) continue

      // Walk back to whoever most recently ADDED this path. Only the nearest
      // adder matters: an older add that was already deleted and re-added is
      // not the work being swept.
      for (let j = i - 1; j >= Math.max(0, i - window); j--) {
        if (!(list[j]?.added ?? []).includes(path)) continue
        const adder = list[j]
        const adderIssue = issueFromSubject(adder?.subject)
        if (adderIssue && adderIssue !== issue) {
          swept.push({
            path,
            addedBy: adder.sha,
            addedByIssue: adderIssue,
            distance: i - j,
          })
        }
        break
      }
    }

    if (swept.length > 0)
      findings.push({ sha: commit.sha, subject: commit.subject, issue, swept })
  }
  return findings
}

/** Exit code: 1 when anything was swept, else 0. */
export function overallExitCode(findings) {
  return (findings ?? []).length > 0 ? 1 : 0
}

/** Human-readable report. */
export function formatReport(findings, { scanned = 0 } = {}) {
  const rows = findings ?? []
  const lines = []
  if (rows.length === 0) {
    lines.push(`No swept files in ${scanned} commit(s).`)
    return lines.join('\n')
  }

  lines.push(
    `${rows.length} commit(s) in ${scanned} scanned deleted another issue's just-added files:`,
  )
  for (const row of rows) {
    lines.push(
      '',
      `  ${String(row.sha).slice(0, 9)}  [${row.issue}]  ${row.subject}`,
    )
    for (const file of row.swept) {
      lines.push(
        `      deletes  ${file.path}`,
        `        added ${file.distance} commit(s) earlier by ${String(file.addedBy).slice(0, 9)} [${file.addedByIssue}], and this message never names it`,
      )
    }
  }
  lines.push(
    '',
    'Each row is a CANDIDATE. A deletion can be deliberate and simply unmentioned.',
    'Read the diff before acting.',
    '',
    'If a sweep is real, DO NOT rewrite history — main is shared and rewriting is',
    'how work gets lost. Restore the content in a NEW commit tagged with the issue',
    'that owns it (`4599734b4` is the worked example), and record on the swept',
    'issue that its work briefly reverted, so the changelog and PR manifest',
    'attribute it correctly.',
  )
  return lines.join('\n')
}
