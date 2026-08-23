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

/**
 * Live-vs-baseline rules comparison (AGL-1509, motivated by AGL-1489).
 *
 * Firebase security rules deploy manually (tools/scripts/deploy-*-rules.mjs),
 * outside the git pipeline, so a merged commit touching cloud/firebase-*.rules
 * is NOT evidence the ruleset shipped. This module decides whether a live
 * ruleset and its committed counterpart have actually drifted, and renders the
 * evidence when they have.
 *
 * The committed side is a BASELINE ref, not necessarily HEAD (AGL-1690). The
 * deploy runs from a checkout pinned to the PROMOTED SHA, so on `main` the
 * ruleset live is the one at `origin/production`; comparing against `main`
 * reports the promotion window itself as drift. `baselineLabel` only names the
 * ref in the prose — the caller decides which text to pass — and defaults to
 * 'HEAD' so a pinned checkout reads exactly as before.
 *
 * NORMALIZATION — what does NOT count as drift, and why:
 *  - line endings (CRLF/CR → LF), and
 *  - the file's trailing whitespace/newline tail (normalized to exactly one
 *    trailing newline).
 * During the AGL-1489 sweep the live STORAGE ruleset was byte-identical to
 * HEAD except a trailing newline. A byte-compare that cries wolf on that
 * would get ignored within a week, and an ignored drift alarm is worse than
 * none. Every other byte difference — including inner whitespace, since the
 * rules language is not whitespace-normalizable by us safely — IS drift.
 *
 * For RTDB rules (strict JSON in this repo), a difference that disappears
 * under JSON.parse deep-equality is reported as formatting-only and not
 * drift: the Firebase console reserializes rules, and semantically identical
 * JSON must not page anyone.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

/**
 * Normalize a rules text for comparison: line endings to LF, and the
 * trailing whitespace tail to exactly one newline (empty input stays empty).
 */
export function normalizeRulesText(text) {
  const lf = String(text).replace(/\r\n?/g, '\n')
  const body = lf.replace(/\s+$/, '')
  return body === '' ? '' : `${body}\n`
}

/**
 * Which side is ahead? Compares the two texts as line multisets.
 *
 * @param {string} liveText the live ruleset source.
 * @param {string} headText the baseline (committed) counterpart.
 * @param {string} [baselineLabel] how to name the baseline ref in the prose.
 * @returns {{
 *   direction: 'head-ahead' | 'live-ahead' | 'diverged',
 *   headOnlyLines: number,
 *   liveOnlyLines: number,
 *   summary: string,
 * }}
 */
export function describeDirection(liveText, headText, baselineLabel = 'HEAD') {
  const countLines = (text) => {
    const map = new Map()
    for (const line of text.split('\n')) {
      map.set(line, (map.get(line) ?? 0) + 1)
    }
    return map
  }
  const live = countLines(normalizeRulesText(liveText))
  const head = countLines(normalizeRulesText(headText))
  let headOnlyLines = 0
  let liveOnlyLines = 0
  for (const [line, n] of head) {
    const inLive = live.get(line) ?? 0
    if (n > inLive) headOnlyLines += n - inLive
  }
  for (const [line, n] of live) {
    const inHead = head.get(line) ?? 0
    if (n > inHead) liveOnlyLines += n - inHead
  }
  if (headOnlyLines > 0 && liveOnlyLines === 0) {
    return {
      direction: 'head-ahead',
      headOnlyLines,
      liveOnlyLines,
      summary:
        `${baselineLabel} is ahead of live: ${headOnlyLines} committed ` +
        `line(s) are not deployed. A commit in ${baselineLabel} touched the ` +
        `rules file and nobody ran the deploy script (the AGL-1489 gap).`,
    }
  }
  if (liveOnlyLines > 0 && headOnlyLines === 0) {
    return {
      direction: 'live-ahead',
      headOnlyLines,
      liveOnlyLines,
      summary:
        `Live is ahead of ${baselineLabel}: ${liveOnlyLines} live line(s) ` +
        `exist in no commit. Someone edited rules outside the repo (Firebase ` +
        `console hot-fix?) — commit them or redeploy from ${baselineLabel}.`,
    }
  }
  return {
    direction: 'diverged',
    headOnlyLines,
    liveOnlyLines,
    summary:
      headOnlyLines === 0 && liveOnlyLines === 0
        ? `Live and ${baselineLabel} contain the same lines in a different ` +
          `arrangement (ordering/inner whitespace). Still drift: redeploy ` +
          `from ${baselineLabel} to re-converge.`
        : `Live and ${baselineLabel} have DIVERGED: ${headOnlyLines} line(s) ` +
          `exist only in ${baselineLabel} and ${liveOnlyLines} only live. ` +
          `Read the '-' lines before believing there are live-only edits ` +
          `worth preserving: a line MODIFIED on one side counts once on each ` +
          `side, so a plain edit reads as a divergence. Genuine live-only ` +
          `edits must be reconciled by hand — a blind redeploy destroys them.`,
  }
}

/**
 * The verdict for one surface.
 *
 * @param {object} input
 * @param {string} input.liveText the live ruleset source.
 * @param {string} input.headText the `git show <baseline>:cloud/...`
 *   counterpart.
 * @param {boolean} [input.jsonAware] treat JSON-deep-equal texts as
 *   formatting-only (RTDB).
 * @param {string} [input.baselineLabel] how to name the baseline ref in the
 *   prose (default 'HEAD').
 * @returns {{ drift: boolean, formattingOnly?: boolean, direction?: string,
 *   headOnlyLines?: number, liveOnlyLines?: number, summary?: string }}
 */
export function compareRules({
  liveText,
  headText,
  jsonAware = false,
  baselineLabel = 'HEAD',
}) {
  const live = normalizeRulesText(liveText)
  const head = normalizeRulesText(headText)
  if (live === head) return { drift: false }
  if (jsonAware) {
    let liveJson
    let headJson
    let bothParse = true
    try {
      liveJson = JSON.parse(live)
      headJson = JSON.parse(head)
    } catch {
      bothParse = false
    }
    if (bothParse && isDeepStrictEqual(liveJson, headJson)) {
      return { drift: false, formattingOnly: true }
    }
  }
  return { drift: true, ...describeDirection(live, head, baselineLabel) }
}

/**
 * Live-versus-baseline, with the one benign explanation checked before drift
 * is declared (AGL-2486).
 *
 * `compareRules` answers "does live match the promoted ruleset". When it does
 * not, there are three possible worlds and only two of them are faults:
 *
 *   1. live is BEHIND — a rules deploy was skipped at promotion (AGL-1489).
 *   2. live was EDITED OUTSIDE THE REPO — a Firebase console hot-fix, which
 *      matches no commit anywhere.
 *   3. live is exactly a commit this checkout carries and the baseline does
 *      not — someone deployed rules ahead of the promotion.
 *
 * The third is the mirror image of the PENDING DEPLOY ledger the checker
 * already prints as information, and it stays red for the WHOLE promotion
 * window — days, on a daily schedule. This file's own header says why that
 * matters: "a check that goes red on every rules commit for the whole
 * promotion window is one people mute, and a muted alarm misses the real
 * drift". It went red on `main` for exactly this reason after two rules
 * commits landed on 2026-08-23 and were deployed before promoting.
 *
 * So it is reported, loudly and by name, and it is not a failure. The
 * narrowing is deliberate and cannot launder case 2: live must byte-match
 * HEAD *and* HEAD must descend from the baseline. A console hot-fix matches
 * no commit, so it is still drift; a deploy that was skipped leaves live
 * behind both refs, so it is still drift.
 *
 * @param {object} input
 * @param {string} input.liveText the live ruleset source.
 * @param {string} input.baselineText `git show <baseline>:cloud/…`.
 * @param {string} [input.headText] `git show HEAD:cloud/…`. Omit when the
 *   baseline IS head — there is no third world to check.
 * @param {boolean} [input.headIsAhead] whether HEAD carries commits the
 *   baseline does not, on shared history. Passing `false` (or omitting it)
 *   disables case 3, so an unrelated ref can never be used to explain live
 *   away. The caller computes it; see check-rules-drift.mjs for why the
 *   obvious `--is-ancestor <baseline> HEAD` is the WRONG direction under a
 *   merge-commit promotion flow.
 * @param {boolean} [input.jsonAware]
 * @param {string} [input.baselineLabel]
 * @returns {{state: 'match'|'ahead-of-promotion'|'drift'} & ReturnType<typeof compareRules>}
 */
export function classifyRulesState({
  liveText,
  baselineText,
  headText,
  headIsAhead = false,
  jsonAware = false,
  baselineLabel = 'HEAD',
}) {
  const againstBaseline = compareRules({
    liveText,
    headText: baselineText,
    jsonAware,
    baselineLabel,
  })
  if (!againstBaseline.drift) return { state: 'match', ...againstBaseline }

  if (typeof headText === 'string' && headIsAhead) {
    const againstHead = compareRules({
      liveText,
      headText,
      jsonAware,
      baselineLabel: 'HEAD',
    })
    if (!againstHead.drift) {
      return { state: 'ahead-of-promotion', ...againstHead }
    }
  }

  return { state: 'drift', ...againstBaseline }
}

/**
 * A unified diff of live → baseline, via `git diff --no-index` on temp files
 * (git is a given both locally and in CI; hand-rolling a diff is the kind of
 * second implementation this tool exists to avoid). `+` lines exist only in
 * the baseline (committed, not deployed); `-` lines exist only live.
 *
 * @returns {string} the diff body, or '' when the normalized texts match.
 */
export function renderUnifiedDiff(
  liveText,
  headText,
  { fileName, baselineLabel = 'HEAD' },
) {
  const dir = mkdtempSync(join(tmpdir(), 'rules-drift-'))
  try {
    const liveDir = join(dir, 'live')
    // A ref name can contain '/' (origin/production); it names a diff-side
    // DIRECTORY here, so flatten it rather than nesting a tree.
    const headDir = join(dir, baselineLabel.replace(/[^\w.-]+/g, '-') || 'HEAD')
    mkdirSync(liveDir)
    mkdirSync(headDir)
    writeFileSync(join(liveDir, fileName), normalizeRulesText(liveText))
    writeFileSync(join(headDir, fileName), normalizeRulesText(headText))
    let out = ''
    try {
      out = execFileSync(
        'git',
        [
          '-c',
          'core.autocrlf=false',
          'diff',
          '--no-index',
          '--unified=3',
          '--',
          join('live', fileName),
          join(basename(headDir), fileName),
        ],
        { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
    } catch (error) {
      // git diff exits 1 when the files differ — that IS the diff.
      if (error.status === 1 && typeof error.stdout === 'string') {
        out = error.stdout
      } else {
        throw new Error(`git diff --no-index failed: ${error.message}`, {
          cause: error,
        })
      }
    }
    return out
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
