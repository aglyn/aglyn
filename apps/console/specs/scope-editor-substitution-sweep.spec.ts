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
 * AGL-1484: the substitution, swept for across the WHOLE repo rather than one
 * file at a time.
 *
 * ```ts
 * Array.isArray(doc.visibleTo) ? doc.visibleTo : [ORG_SCOPE_TOKEN]
 * ```
 *
 * Five call sites in three files each wrote that longhand, and each one
 * rendered "All sites" over a document no site could see — because both
 * enforcement layers fail CLOSED on the missing field. AGL-1466 removed two
 * of them, AGL-1480 removed two more and added `Aglyn.storedScope` so a fifth
 * would not be written by hand, and AGL-1484 removed the last pair, in the
 * Data plugin's schema dialog.
 *
 * Each of those was found by a person sweeping after the previous fix. The
 * per-file specs that existed at the time all passed: `media-folder-scope-
 * wiring.spec.ts` named two callbacks by hand and the third surface was in
 * the region its comment stripper had deleted (AGL-1479), and neither spec
 * could see into another app at all. **The guarantee is corpus-wide, so the
 * assertion has to be too** — which is the one thing four issues of
 * per-surface fixes never had.
 *
 * Asserted on the FILE LIST, not on a count: a failure names the file that
 * grew a sixth copy, and the allowlist below states why each survivor is not
 * one.
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { code } from './source-text'

const REPO_ROOT = resolve(__dirname, '../../..')

/**
 * The shape, spanning lines — matched against whitespace-collapsed source so
 * the windows below stay tight whatever the formatter did.
 *
 * Two deliberate choices, each made against a copy that actually shipped:
 *
 * - The `visibleTo` name is NOT required. Three of the five copies reached
 *   the property through a cast (`(dataset as { visibleTo?: string[] })
 *   .visibleTo`) or through a local (`installedScope`), and a pattern that
 *   only matched the tidy spelling would have missed the ones in the field.
 * - The **ternary is** required. A window that merely put `Array.isArray`
 *   near `[ORG_SCOPE_TOKEN]` flagged `backfill-scope.ts`, whose
 *   `needsScopeStamp` is `!Array.isArray(data.visibleTo)` — a predicate 40
 *   lines above an unrelated constant, and not a substitution at all. An
 *   allowlist entry for a match a file does not really contain is a
 *   permanent lie about that file, so the pattern is what got narrowed.
 */
const SUBSTITUTION =
  /Array\.isArray\([\s\S]{0,140}?\)\s*\?[\s\S]{0,200}?:\s*\[(?:Aglyn\.)?ORG_SCOPE_TOKEN\]/

/**
 * The survivors, and why each is not a display seed.
 *
 * Exactly one entry, and it is a **write**: the scope a newly forked
 * marketplace copy is CREATED with. A create has to answer the question, and
 * `[ORG_SCOPE_TOKEN]` is a stated default rather than an assumption about
 * what somebody already chose — the inverse of the editors above. Reviewed
 * during the AGL-1480 sweep and left alone, and again here.
 *
 * `apps/console/utils/server/backfill-scope.ts` is worth naming for its
 * absence. AGL-1484 expected it here, and a looser pattern did flag it — but
 * only by spanning from `needsScopeStamp`'s `!Array.isArray(data.visibleTo)`
 * across forty lines to an unrelated `[ORG_SCOPE_TOKEN]`. The file writes the
 * stamp without ever writing the ternary, so it belongs in neither list, and
 * the pattern was narrowed rather than the allowlist widened.
 */
const ALLOWED = ['libs/plugins/marketplace/src/lib/server/update-artifact.ts']

describe('AGL-1484 · nothing substitutes the org token for an absent scope', () => {
  /**
   * Every tracked source file, narrowed to the ones that could possibly
   * match before any of them is stripped.
   *
   * The narrowing is not only speed. `code()`'s bounds are calibrated against
   * whole guarded sources, and running it over 15,000 files would eventually
   * trip its `MAX_STRIPPED_SPAN` bound on a legitimate 5,000-character
   * module header and fail this spec for a reason that has nothing to do
   * with scopes. The sixteen files that name `ORG_SCOPE_TOKEN` at all are the
   * only ones the pattern can match, and the longest single comment among
   * them is 1,735 characters.
   */
  const candidates = (): string[] =>
    execSync('git ls-files "*.ts" "*.tsx" "*.mjs"', {
      cwd: REPO_ROOT,
      maxBuffer: 64 * 1024 * 1024,
    })
      .toString()
      .split('\n')
      .filter(Boolean)
      .filter((file) =>
        readFileSync(join(REPO_ROOT, file), 'utf8').includes('ORG_SCOPE_TOKEN'),
      )

  it('finds the substitution only where it is a deliberate write default', () => {
    const offenders = candidates().filter((file) => {
      // Stripped, because the comments below every one of these fixes NAME
      // the shape they replaced — a sweep over raw text would match the
      // explanation of the bug rather than the bug. `0` for the kept
      // fraction is the documented setting for a sweep over many files
      // (AGL-1479); the span bound is the one that bites and still applies.
      const source = code(
        readFileSync(join(REPO_ROOT, file), 'utf8'),
        file,
        0,
      )
      return SUBSTITUTION.test(source.replace(/\s+/g, ' '))
    })

    expect(offenders.sort()).toEqual([...ALLOWED].sort())
  })

  /**
   * The positive half, and the one that stops the next copy being written
   * correctly-but-again. Every editor that reads a STORED scope asks
   * `storedScope`, so "absent means nothing is stored" is decided once.
   */
  it('reads stored scopes through the one helper', () => {
    const readers = [
      'apps/console/components/media/media-library.component.tsx',
      'libs/plugins/data/src/lib/components/dataset-schema-dialog.component.tsx',
    ]
    for (const file of readers) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8')
      expect({ file, uses: /storedScope\(/.test(source) }).toEqual({
        file,
        uses: true,
      })
    }
  })
})
