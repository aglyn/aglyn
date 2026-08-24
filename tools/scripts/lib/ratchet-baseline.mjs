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
 * The ratchet comparison, shared by every per-file-ceiling gate (AGL-2170).
 *
 * Extracted from `hardcoded-colours.mjs` (AGL-2025), which invented the shape,
 * when the brand-literal gate needed exactly the same three verdicts. Copying
 * thirty lines would have been the easy move and the wrong one: the subtle
 * part is that `stale` is RED, and a second copy is a second place for that
 * decision to quietly diverge.
 *
 * `hardcoded-colours.mjs` re-exports this, so its callers and its own test
 * suite are unchanged.
 */

/**
 * Compare a measured census against a baseline of per-file ceilings.
 *
 * Three distinct verdicts, because collapsing them hides the interesting one:
 *
 *  - `regressions` — a file gained literals, or a file with none gained its
 *    first. This is what goes red.
 *  - `improvements` — a file has fewer than its baseline. Not a failure, but
 *    reported, because the baseline should be lowered in the same commit.
 *  - `stale` — a baseline row for a file that is now clean or gone. Also red:
 *    an exemption nobody has read is the AGL-2002 shape.
 *
 * @param {Record<string, number>} counts measured, file → count
 * @param {Record<string, number>} baseline file → allowed ceiling
 */
export function compareToBaseline(counts, baseline) {
  const regressions = []
  const improvements = []
  const stale = []

  for (const [file, count] of Object.entries(counts)) {
    const allowed = baseline[file] ?? 0
    if (count > allowed) regressions.push({ file, count, allowed })
    else if (count < allowed) improvements.push({ file, count, allowed })
  }

  for (const [file, allowed] of Object.entries(baseline))
    if (!counts[file]) stale.push({ file, allowed })

  const by = (a, b) => a.file.localeCompare(b.file)
  return {
    clean: regressions.length === 0 && stale.length === 0,
    regressions: regressions.sort(by),
    improvements: improvements.sort(by),
    stale: stale.sort(by),
  }
}

/**
 * The exact edit that clears a LEGITIMATE regression, printed by the guard
 * that just refused it (AGL-2486).
 *
 * ## Why the remedy has to be in the output
 *
 * On 2026-08-24 three count-keyed guards went red on `main` inside one working
 * day — `check:hardcoded-colours`, `selfhost-hardcoded-hosts` (twice) and
 * `check:brand-literals` — every one of them the same shape: a new file or a
 * new occurrence landed and nobody added its row. The ratchets were right every
 * time. What cost the round trip is that the author learned about it from CI,
 * and then had to go and work out what to write.
 *
 * A guard whose remedy is obvious from its own output stops costing that trip,
 * and nothing about the guard has to get weaker to buy it. This prints the
 * literal JSON line to paste, so the fix is mechanical and — the part that
 * matters — SMALL enough to review.
 *
 * ## ⚠️ Why it steers AWAY from `--write`
 *
 * Both ratchets used to answer a regression with "re-baseline with `--write`
 * and say why in the commit". That advice is actively dangerous and it is the
 * reason this exists.
 *
 * `--write` rewrites EVERY row from the current measurement. Pointed at a
 * regression it does clear the one you were looking at — and silently absorbs
 * any OTHER file that regressed in the same tree, including another agent's
 * uncommitted work in this shared checkout. The resulting diff is dozens of
 * lines in which the one count that went UP is indistinguishable from the ones
 * that went down, and counts going DOWN read as a cleanup, so the diff looks
 * BETTER than the tree it came from. That is a laundering path through the
 * exact control the ratchet is.
 *
 * `--write` remains correct for what it was built for: recording a real
 * cleanup, where every row moves down and the commit says so. It is not the
 * answer to a red.
 *
 * @param {{file: string, count: number}[]} regressions from `compareToBaseline`
 * @param {string} baselinePath absolute path to the baseline JSON
 * @param {string} [rationale] one line on what makes a regression legitimate
 */
export function remedy(regressions, baselinePath, rationale) {
  const rows = regressions
    .map((one) => `    "${one.file}": ${one.count},`)
    .join('\n')
  return (
    `\nIf every occurrence above is legitimate${rationale ? ` (${rationale})` : ''}, ` +
    'record it by HAND-EDITING these exact rows in\n' +
    `  ${baselinePath}\n\n${rows}\n\n` +
    '⛔ Do NOT clear this with `--write`. It rewrites every row from the ' +
    'current tree, so an unrelated regression — including another session\'s ' +
    'uncommitted files in a shared checkout — is absorbed into the same diff, ' +
    'where the count that went UP is the one nobody sees. Hand-edit the rows ' +
    'above and nothing else: a one-line diff is what a reviewer can actually ' +
    'check. `--write` is for recording a cleanup, not for clearing a red.'
  )
}
