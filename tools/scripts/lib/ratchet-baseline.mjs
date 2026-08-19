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
