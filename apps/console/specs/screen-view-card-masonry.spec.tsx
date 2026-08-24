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
 * AGL-2486: the screen version view's card layout.
 *
 * The defect was a twelve-column flex ROW: every item in a wrapped row is as
 * tall as the tallest one in it, so `Page Activity` sat in a 741px row cell
 * carrying a 278px card — a 463px hole, 898px wasted across the two rows,
 * measured in Chrome at a 1488px content width.
 *
 * The arrangement that replaced it is ZACH'S, given card by card over three
 * rounds of looking at the rendered page, and it is deliberately not the
 * packing optimum — see the `CARD_WIDE`/`CARD_NARROW` comment on the page for
 * the measurement he overrode and why. This file pins the arrangement so that
 * a later reader who re-measures does not "correct" it back.
 *
 * jsdom performs no layout, so these assert the arrangement the page DECLARES,
 * not geometry. The geometry was measured separately in Chrome against exactly
 * this declaration.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(
  join(
    __dirname,
    '..',
    'app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/view/page.tsx',
  ),
  'utf8',
)

/** The `GridItems` that holds the cards, with the prop that makes it pack. */
const MASONRY = /<GridItems\s+spacing=\{3\}\s+masonry\s+items=\{\[/

/**
 * Every layout item as `[card, span]`, in source order.
 *
 * The `size:` marker is anchored to a WHOLE LINE. An earlier version of this
 * guard matched anywhere and was satisfied by the explanatory comment above
 * the fix, which quotes a `size` verbatim; prose cannot match
 * `^<indent>size: X,$`.
 *
 * Each item's card is identified from the source BETWEEN its own marker and
 * the next one, so a card with no `header` prop (the analytics card) cannot
 * borrow the next item's name.
 */
const SPAN_LINE = /^ *size: (CARD_WIDE|CARD_NARROW|\{ xs: 12 \}),$/gm
const CARD_NAME = /header=\{'([^']+)'\}|<(ScreenAnalyticsCard)\b/

const assignment = (text: string): Array<[string, string]> => {
  const marks = [...text.matchAll(SPAN_LINE)]
  return marks.map((mark, index) => {
    const next = marks[index + 1]
    const slice = text.slice(mark.index, next ? next.index : undefined)
    const found = slice.match(CARD_NAME)
    return [found ? found[1] ?? 'Screen traffic' : '?', mark[1]]
  })
}

/**
 * Zach's spec, verbatim across three messages: "the basic details probably
 * needs to be the smaller column like it was originally, page access can be 1
 * of 3 columns … seo 2 of 3", "the publishing card can move just below basic
 * details and be 1 of 3 columns", "Swap page activity and versions. make
 * activity full".
 */
const EXPECTED: Array<[string, string]> = [
  ['Basic Details', 'CARD_NARROW'],
  ['Publishing', 'CARD_NARROW'],
  ['Page Access', 'CARD_NARROW'],
  ['SEO', 'CARD_WIDE'],
  ['Versions', 'CARD_WIDE'],
  ['Page Activity', '{ xs: 12 }'],
  ['Screen traffic', '{ xs: 12 }'],
  ['Raw JSON', '{ xs: 12 }'],
]

/** Replaces the span marker belonging to a named card. */
const respan = (text: string, card: string, span: string) => {
  const at = text.indexOf(`header={'${card}'}`)
  const before = text.slice(0, at)
  const cut = before.lastIndexOf('                size: ')
  const end = before.indexOf('\n', cut)
  return text.slice(0, cut) + `                size: ${span},` + text.slice(end)
}

describe('the screen version view card layout (AGL-2486)', () => {
  it('reads a real file', () => {
    expect(source.length).toBeGreaterThan(10000)
  })

  it('is MASONRY, not a flex row', () => {
    // The entire defect is this one prop. Without it `GridItems` is a
    // twelve-column flex row and every card is as tall as its neighbour
    // again — and the spans below would still look perfectly reasonable,
    // which is why this is asserted separately from them.
    expect(source).toMatch(MASONRY)
  })

  it('THE CONTROL: dropping `masonry` reddens the check above', () => {
    const withoutMasonry = source.replace(/\n(\s*)masonry\n/, '\n')
    expect(withoutMasonry).not.toBe(source)
    expect(withoutMasonry).not.toMatch(MASONRY)
  })

  it('declares two widths that fill a three-column band', () => {
    expect(source).toMatch(
      /^const CARD_WIDE = \{ xs: 12, md: 6, lg: 8 \} as const$/m,
    )
    expect(source).toMatch(
      /^const CARD_NARROW = \{ xs: 12, md: 6, lg: 4 \} as const$/m,
    )
    // 8 + 4 = 12. A pair that does not fill the band leaves a dead strip.
    expect(8 + 4).toBe(12)
  })

  it('assigns every card the span Zach asked for, in his order', () => {
    expect(assignment(source)).toEqual(EXPECTED)
  })

  it('stacks the narrow column Basic Details, Publishing, Page Access', () => {
    // Masonry stacks in SOURCE order within a width bucket, so the authored
    // order of these three IS the rendered column order. "the publishing card
    // can move just below basic details" is a positional instruction, and
    // this is the only thing enforcing it.
    expect(
      assignment(source)
        .filter(([, span]) => span === 'CARD_NARROW')
        .map(([card]) => card),
    ).toEqual(['Basic Details', 'Publishing', 'Page Access'])
  })

  it('THE CONTROLS: the assignment checks actually discriminate', () => {
    // Guard the guards. Without these, a regex that silently matched nothing
    // would make every assertion above pass vacuously — which is exactly how
    // the first version of this file went green while asserting nothing.
    expect(assignment(source)).toHaveLength(EXPECTED.length)
    expect(assignment(source).every(([card]) => card !== '?')).toBe(true)

    // Moving SEO to the narrow column — the change a later reader would make
    // if they re-derived the layout from packing alone — must fail.
    const seoNarrowed = respan(source, 'SEO', 'CARD_NARROW')
    expect(seoNarrowed).not.toBe(source)
    expect(assignment(seoNarrowed)).not.toEqual(EXPECTED)

    // Widening Publishing must fail too: it pins the narrow column's contents
    // as well as its order.
    const publishingWidened = respan(source, 'Publishing', 'CARD_WIDE')
    expect(publishingWidened).not.toBe(source)
    expect(assignment(publishingWidened)).not.toEqual(EXPECTED)
  })

  it('ends with Raw JSON, collapsed by default', () => {
    // "Raw JSON can be the very last card and it should probably be collapsed
    // by default."
    expect(assignment(source).at(-1)).toEqual(['Raw JSON', '{ xs: 12 }'])
    expect(source).toMatch(/^ *const \[rawJsonOpen, setRawJsonOpen\] = useState\(false\)$/m)
    // `unmountOnExit` is load-bearing, not decoration: it keeps the `<pre>`
    // out of the DOM entirely while closed, so the closed card measures as a
    // plain header instead of reporting a placeholder height.
    expect(source).toContain('<Collapse in={rawJsonOpen} unmountOnExit>')
  })

  it('does not reach for CardColumns, which cannot span', () => {
    // CSS multicol has no column-span, so it cannot express "two wide, one
    // narrow" at all. It is still right for a run of equal-width cards
    // (billing, the staff org page) — this page is not that.
    expect(source).not.toContain('CardColumns')
  })
})
