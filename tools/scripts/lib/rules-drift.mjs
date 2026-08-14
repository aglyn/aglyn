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
        throw new Error(`git diff --no-index failed: ${error.message}`)
      }
    }
    return out
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
