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
 * AGL-1413: the media library may only tell an author an asset is unused when
 * it actually looked everywhere.
 *
 * `/api/media/references` now reports how much of the corpus it read, and the
 * whole value of that flag is that these two sentences respect it. A panel
 * that branches on `references.length === 0` throws the information away at
 * the very last step — which is what the endpoint did before this issue, and
 * what the delete confirmation did by saying nothing at all.
 *
 * So the guard is written over the CROSS PRODUCT of coverage and result,
 * against both surfaces, and the assertion is not "this string is right" but
 * "the unqualified claim is unreachable from an incomplete scan". A future
 * edit that collapses the three answers back into one has to fail here.
 */

import {
  coverageOf,
  deleteConfirmationNote,
  type MediaScanCoverage,
  mediaUsageAssurance,
  provesUnused,
  usagePanelEmptyMessage,
} from './media-usage-copy'

const COVERAGES: MediaScanCoverage[] = ['full', 'published', 'partial']

/**
 * A sentence that hedges. Every answer except the exhaustive one has to carry
 * one of these; the unqualified sentence is what an author acts on.
 */
const HEDGES = ['could not', 'not all checked']
const hedges = (text: string) =>
  HEDGES.some((hedge) => text.toLowerCase().includes(hedge))

describe('what the scan is allowed to claim', () => {
  it('only FULL coverage can state an asset is unused', () => {
    const levels = COVERAGES.map((coverage) => [
      coverage,
      mediaUsageAssurance({ coverage, count: 0 }),
    ])
    expect(levels).toEqual([
      ['full', 'none'],
      ['published', 'none-published'],
      ['partial', 'unknown'],
    ])
  })

  it('a failed scan is the same answer as one that could not finish', () => {
    expect(mediaUsageAssurance(null)).toBe('unknown')
    expect(mediaUsageAssurance({ coverage: 'partial', count: 0 })).toBe(
      'unknown',
    )
  })

  /**
   * Finding a reference is decisive whatever the coverage: the scan stopping
   * early cannot un-find something it already found.
   */
  it('a found reference is reported under every coverage', () => {
    for (const coverage of COVERAGES) {
      expect(mediaUsageAssurance({ coverage, count: 2 })).toBe('used')
    }
  })
})

describe('the sentences themselves', () => {
  it('hedges in both surfaces unless the scan was exhaustive', () => {
    for (const coverage of COVERAGES) {
      const panel = usagePanelEmptyMessage(coverage)
      const confirmation = deleteConfirmationNote({ coverage, names: [] })
      const exhaustive = coverage === 'full'
      expect({ coverage, panel: hedges(panel) }).toEqual({
        coverage,
        panel: !exhaustive,
      })
      expect({ coverage, confirmation: hedges(confirmation) }).toEqual({
        coverage,
        confirmation: !exhaustive,
      })
    }
  })

  /**
   * The delete confirmation is never silent now. Silence after a check reads
   * as a clean bill of health, and that is the sentence this issue is about.
   */
  it('never returns an empty note, whatever happened', () => {
    for (const scan of [
      null,
      { coverage: 'full' as const, names: [] },
      { coverage: 'published' as const, names: [] },
      { coverage: 'partial' as const, names: [] },
      { coverage: 'full' as const, names: ['Home'] },
    ]) {
      expect(deleteConfirmationNote(scan).trim().length).toBeGreaterThan(0)
    }
  })

  it('names what it found, and counts it in English', () => {
    expect(
      deleteConfirmationNote({ coverage: 'full', names: ['Home'] }),
    ).toContain('referenced in 1 place (Home)')
    expect(
      deleteConfirmationNote({ coverage: 'full', names: ['Home', 'Pricing'] }),
    ).toContain('referenced in 2 places (Home, Pricing)')
  })
})

describe('reading the coverage off a response', () => {
  it('recognizes the two values that permit a claim', () => {
    expect(coverageOf('full')).toBe('full')
    expect(coverageOf('published')).toBe('published')
  })

  /**
   * The load-bearing default. An older deployment, a changed response shape,
   * a proxy that dropped the field — the endpoint not saying how far it got
   * has to mean "we could not determine this", never "nothing uses it".
   */
  it('treats anything else as partial, including absent', () => {
    for (const value of [undefined, null, '', 'complete', true, 1, {}]) {
      expect(coverageOf(value)).toBe('partial')
      expect(provesUnused(coverageOf(value))).toBe(false)
    }
  })
})
