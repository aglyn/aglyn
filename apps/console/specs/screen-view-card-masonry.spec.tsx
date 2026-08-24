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
 * AGL-2486: the screen version view lays its detail cards out as a THREE-column
 * band of unequal columns.
 *
 * The defect was a twelve-column flex row: every item in a wrapped row is as
 * tall as the tallest one in it, so `Page Activity` sat in a 741px row cell
 * carrying a 278px card — a 463px hole, 898px wasted across the two rows,
 * measured in Chrome at a 1488px content width.
 *
 * Zach on the first fix, which packed the cards into two balanced columns:
 * "I like that this before had 3 columns, we just don't need to make all of 3
 * columns, some could be 2 columns and 1". So: three columns, one group two
 * wide and one group one wide, via `GridItems masonry` — which buckets items
 * by `size`, making the two widths the arrangement itself.
 *
 * jsdom performs no layout, so this asserts the ARRANGEMENT the page declares
 * rather than the geometry. The geometry was measured separately in Chrome
 * against exactly this declaration; the numbers quoted here came from that
 * run.
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

/**
 * The `size:` markers on the layout items, in source order.
 *
 * Anchored to a whole line, because the previous version of this guard was
 * satisfied by the explanatory COMMENT above the fix, which quotes the old
 * `size` verbatim. Prose cannot match `^<indent>size: X,$`.
 */
const sizeSequence = (text: string) =>
  [...text.matchAll(/^ *size: (CARD_WIDE|CARD_NARROW|\{ xs: 12 \}),$/gm)].map(
    (match) => match[1],
  )

/** The `GridItems` that holds the cards, with the prop that makes it pack. */
const MASONRY = /<GridItems\s+spacing=\{3\}\s+masonry\s+items=\{\[/

/** The arrangement: three cards two columns wide, two cards one column wide. */
const EXPECTED = [
  'CARD_WIDE', // Basic Details
  'CARD_WIDE', // Publishing
  'CARD_WIDE', // Page Access
  'CARD_NARROW', // SEO
  'CARD_NARROW', // Page Activity
  '{ xs: 12 }', // Versions
  '{ xs: 12 }', // Raw JSON
]

describe('the screen version view card band (AGL-2486)', () => {
  it('reads a real file', () => {
    expect(source.length).toBeGreaterThan(10000)
  })

  it('is MASONRY, not a flex row', () => {
    // The entire defect is this one prop. Without it `GridItems` is a
    // twelve-column flex row and every card is as tall as its neighbour
    // again — and the `size` values below would still look perfectly
    // reasonable, which is exactly why this is asserted separately.
    expect(source).toMatch(MASONRY)
  })

  it('THE CONTROL: dropping `masonry` reddens the check above', () => {
    // A source guard that matches whatever the file happens to say is not a
    // guard. Deleting the one prop that makes this a masonry layout must
    // fail, so mutate the source and prove the matcher notices.
    const withoutMasonry = source.replace(/\n(\s*)masonry\n/, '\n')
    expect(withoutMasonry).not.toBe(source)
    expect(withoutMasonry).not.toMatch(MASONRY)
  })

  it('declares two unequal widths that fill a three-column band', () => {
    expect(source).toMatch(
      /^const CARD_WIDE = \{ xs: 12, md: 6, lg: 8 \} as const$/m,
    )
    expect(source).toMatch(
      /^const CARD_NARROW = \{ xs: 12, md: 6, lg: 4 \} as const$/m,
    )
    // 8 + 4 = 12. A pair that does not fill the band leaves a dead strip.
    expect(8 + 4).toBe(12)
  })

  it('puts the image-led SEO card in the NARROW column', () => {
    // Content-driven, and the content says the opposite of what it looks
    // like: measured in Chrome, `SEO` grows with width — 738px at a 354px
    // column, 764px at 480px, 857px at 732px, 989px at 984px — because it is
    // dominated by a fixed-aspect social-image preview. `Publishing` shrinks
    // (279px → 241px) as its chips and buttons stop wrapping. Putting `SEO`
    // in the wide column instead was measured at a 1291px band against
    // 1066px, so this order is load-bearing, not cosmetic.
    expect(sizeSequence(source)).toEqual(EXPECTED)
  })

  it('THE CONTROL: the sequence check actually discriminates', () => {
    // Guard the guard twice over. Without the first assertion a regex that
    // matched nothing would make the check above pass vacuously; without the
    // second, a check that ignored the ORDER would accept `SEO` being moved
    // into the wide column — the regression the measurement rules out.
    expect(sizeSequence(source).length).toBe(EXPECTED.length)
    const seoMovedWide = source.replace(
      /^ *size: CARD_NARROW,$/m,
      '                size: CARD_WIDE,',
    )
    expect(seoMovedWide).not.toBe(source)
    expect(sizeSequence(seoMovedWide)).not.toEqual(EXPECTED)
  })

  it('leaves Versions and Raw JSON full width, below the band', () => {
    // A version table and a JSON dump earn the whole row. `masonry` gives a
    // full-width item a band of its own, which is what keeps them BELOW the
    // cards instead of being pulled into a column.
    expect(source).toContain("header={'Versions'}")
    expect(source).toContain("header={'Raw JSON'}")
    expect(sizeSequence(source).slice(-2)).toEqual(['{ xs: 12 }', '{ xs: 12 }'])
  })

  it('does not reach for CardColumns, which cannot span', () => {
    // CSS multicol has no column-span, so it cannot express "two wide, one
    // narrow" at all. It is still right for a run of equal-width cards
    // (billing, the staff org page) — this page is not that.
    expect(source).not.toContain('CardColumns')
  })
})
