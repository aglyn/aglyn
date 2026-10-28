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

import {
  BLUEBONNET_EYEBROW,
  BLUEBONNET_FACTS,
  HOLESHOT_EYEBROW,
  HOLESHOT_FACTS,
  HOLESHOT_HOME_PLAN,
  HOLESHOT_HOME_SECTIONS,
  HOLESHOT_TARGETS,
} from '../jobs/fixtures/ai-site-agl4065-plans'
import { aiCompileLayoutPage } from './ai-layout-compiler'
import { AI_LAYOUT_TEXT_LIMITS, aiLayoutFitEyebrow, aiLayoutFitText, aiLayoutWords } from './ai-layout-copy'

/**
 * A hero's eyebrow is fitted whole (AGL-4065). Two booth-kit homes of
 * 2026-10-25 printed theirs cut mid-phrase: Bluebonnet Yard & Landscape's
 * "Lawn care and landscaping in New Braunfels" (42 characters, two over the
 * eyebrow's 40) was cut at its last space, "…in New", the town lost and the
 * line ending on half a name; Holeshot Moto Repair's "San Marcos motorcycle
 * and dirt bike repair" lost its head noun, "…and dirt bike". An eyebrow
 * that is too long now loses a coordinated part before it loses the town,
 * and a cut never ends inside a proper name or on a word that joins.
 */

/** Words no cut eyebrow may end on. */
const JOINING_TAIL = /\b(?:in|of|for|and|at|to|the|a|an|with|&)$/i

describe('a hero eyebrow fits at a word boundary and keeps the town (AGL-4065)', () => {
  it('drops the first of two coordinated services before the town: "Lawn care and landscaping in New Braunfels"', () => {
    expect(aiLayoutWords(BLUEBONNET_EYEBROW, 'eyebrow', BLUEBONNET_FACTS)).toBe('Landscaping in New Braunfels')
  })

  it('drops the middle coordinated element, keeping the town and the head noun: "San Marcos motorcycle and dirt bike repair"', () => {
    expect(aiLayoutWords(HOLESHOT_EYEBROW, 'eyebrow', HOLESHOT_FACTS)).toBe('San Marcos dirt bike repair')
  })

  it('fits the same way given the words to keep directly', () => {
    expect(aiLayoutFitEyebrow(BLUEBONNET_EYEBROW, 'en', ['New Braunfels'])).toBe('Landscaping in New Braunfels')
    expect(aiLayoutFitEyebrow(HOLESHOT_EYEBROW, 'en', ['San Marcos'])).toBe('San Marcos dirt bike repair')
    // A list loses its first element, never the town after it, and never the region beside the town.
    expect(aiLayoutFitEyebrow('Repairs, drywall, fences and decks in Seguin, TX', 'en', ['Seguin', 'TX'])).toBe('Drywall, fences and decks in Seguin, TX')
  })

  it('cuts a long eyebrow with no town at its last clause', () => {
    const line = 'Small-batch soy candles, hand-poured, for slow evenings at home'
    expect(line.length).toBeGreaterThan(60)
    expect(aiLayoutWords(line, 'eyebrow', 'Willow Wick Candles')).toBe('Small-batch soy candles, hand-poured')
  })

  it('leaves an eyebrow that fits as it is', () => {
    for (const line of ['Two Oaks Handyman · Seguin, TX', 'Rut Runners Racing · Lockhart, TX', 'Water-wise yards in New Braunfels']) {
      expect(line.length).toBeLessThanOrEqual(AI_LAYOUT_TEXT_LIMITS.eyebrow)
      expect(aiLayoutWords(line, 'eyebrow', BLUEBONNET_FACTS)).toBe(line)
    }
  })

  it('never ends a cut on in, and or the, and never inside a proper name', () => {
    const long = [
      BLUEBONNET_EYEBROW,
      HOLESHOT_EYEBROW,
      'Native plant beds and xeriscape in New Braunfels',
      'Weekly mowing for busy homeowners in Garden Ridge',
      'Fast, honest repairs for riders around San Marcos',
      'Motocross race team racing out of Lockhart, Texas',
    ]
    for (const line of long) {
      expect(line.length).toBeGreaterThan(AI_LAYOUT_TEXT_LIMITS.eyebrow)
      // With the site's words to keep, and without them (a page with no facts).
      for (const fitted of [aiLayoutWords(line, 'eyebrow', `${BLUEBONNET_FACTS}\n${HOLESHOT_FACTS}`), aiLayoutFitText(line, 'eyebrow')]) {
        expect([line, fitted.length <= AI_LAYOUT_TEXT_LIMITS.eyebrow]).toEqual([line, true])
        expect([line, fitted]).not.toEqual([line, expect.stringMatching(JOINING_TAIL)])
        // "New" is never left without "Braunfels", nor "San" without "Marcos", nor "Garden" without "Ridge".
        expect([line, fitted]).not.toEqual([line, expect.stringMatching(/\b(?:New|San|Garden)$/)])
      }
    }
    // Without a town to keep, the plain cut still stops short of half a name.
    expect(aiLayoutFitText('Native plant beds and xeriscape in New Braunfels', 'eyebrow')).toBe('Native plant beds and xeriscape')
  })

  it('is what the compiled hero shows', () => {
    const compiled = aiCompileLayoutPage(HOLESHOT_HOME_SECTIONS, HOLESHOT_HOME_PLAN, HOLESHOT_TARGETS, {
      reusableComponents: true,
      design: { kind: 'trades', seed: 7, home: true },
    })
    const overlines = Object.values(compiled.tree.nodes)
      .filter((node) => node.componentId === 'muiTypography' && node.props?.['variant'] === 'overline')
      .map((node) => node.props?.['children'])
    expect(overlines).toContain('San Marcos dirt bike repair')
  })
})
