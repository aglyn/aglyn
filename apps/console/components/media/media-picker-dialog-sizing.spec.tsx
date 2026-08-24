/**
 * @jest-environment jsdom
 */

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
 * AGL-2486: the DAM is a browsing surface, and has to be sized like one.
 *
 * Two separate defects made the same complaint — "too narrow", "the cards are
 * just getting squished":
 *
 *   the dialog  `maxWidth="md"` capped the paper at 900px.
 *   the grid    a twelve-column `<Grid size={{ …, lg: 2 }}>` fixed SIX
 *               columns, against VIEWPORT breakpoints rather than the
 *               dialog's own width — so a narrow dialog on a wide monitor
 *               kept six columns and compressed them.
 *
 * ## Why this reads the emitted CSS rather than a computed style
 *
 * jsdom does not lay out, so `getBoundingClientRect()` is 0x0 here and
 * `getComputedStyle` does not resolve `aspect-ratio` or `calc()`. What jsdom
 * CAN be trusted with is that the component rendered and emotion emitted a
 * rule — so the claim asserted is "the paper carries these declarations",
 * which is the half a unit test can actually own.
 *
 * The half it cannot own — that the box ends up 1200x900 and that the tiles
 * stop shrinking at 160px and drop a column instead — was measured in a real
 * browser against the running console (1200x900 paper; column counts
 * 5/4/3/2/1 as the paper narrowed 1200→380, tile width never below 160px),
 * from BOTH entry points, the setup page's logo card and the besigner's
 * media picker, which are different `cssVariables` surfaces.
 *
 * That division is deliberate rather than lazy: a browser build can drop a
 * JSX prop that jest keeps, so a green result here is evidence the props are
 * declared, never evidence of a rendered layout.
 */

import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { code } from '../../specs/source-text'
import MediaPickerDialog from './media-picker-dialog.component'

jest.mock('./media-library.component', () => ({
  __esModule: true,
  default: () => <div data-testid="library-stub" />,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useHostOrgId: () => undefined,
}))
jest.mock('notistack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

/**
 * Every emotion declaration that lands on the dialog's paper, split by
 * whether it sits inside a media query.
 *
 * Read off `document.styleSheets`, NOT off the `<style>` elements' text:
 * emotion inserts through `CSSOM.insertRule` here, which leaves `textContent`
 * empty. That difference is silent — a reader of the text finds nothing and
 * reports an empty string, which looks exactly like a declaration that was
 * never written.
 */
function paperRules(): { base: string; small: string } {
  const paper = document.querySelector('.MuiDialog-paper')
  if (!paper) throw new Error('the dialog paper never rendered')
  const classes = Array.from(paper.classList).filter((c) => /^css-/.test(c))
  if (classes.length === 0) throw new Error('the paper carries no emotion class')

  const squash = (s: string) => s.replace(/\s+/g, '')
  const mine = (text: string) => classes.some((c) => text.includes(`.${c}`))
  let base = ''
  let small = ''

  const walk = (rules: CSSRuleList | undefined, media: string | null) => {
    for (const rule of Array.from(rules ?? []) as any[]) {
      if (rule.cssRules) {
        walk(rule.cssRules, rule.conditionText ?? rule.media?.mediaText ?? '')
        continue
      }
      if (!rule.cssText || !mine(rule.cssText)) continue
      const body = squash(rule.cssText.slice(rule.cssText.indexOf('{') + 1))
      // `@media print` also targets this class (MUI's own); only the width
      // query is the small-screen branch this file is about.
      if (media === null) base += body
      else if (/max-width/.test(media)) small += body
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk((sheet as CSSStyleSheet).cssRules, null)
    } catch {
      /* a cross-origin sheet cannot be read, and carries none of our rules */
    }
  }
  return { base, small }
}

describe('the media picker fills the screen instead of a 900px slot (AGL-2486)', () => {
  beforeEach(() => {
    render(
      <MediaPickerDialog
        hostId="h1"
        open
        onClose={() => undefined}
        onPick={() => undefined}
      />,
    )
  })

  it('is ~80% of the viewport, capped at 1200px', () => {
    const { base } = paperRules()
    expect(base).toContain('width:80vw')
    expect(base).toContain('max-width:1200px')
  })

  it('prefers 4:3', () => {
    expect(paperRules().base).toContain('aspect-ratio:4/3')
  })

  /**
   * The assertion the whole thing turns on. A rigid 4:3 at the 1200px cap is
   * 900px tall, which does not fit a 1440x760 laptop — the Cancel button ends
   * up below the fold. The ratio has to be the thing that gives.
   */
  it('but yields to a short viewport rather than pushing the buttons off it', () => {
    expect(paperRules().base).toContain('max-height:calc(100vh-64px)')
  })

  /** 80% of a phone is a peephole. Below `sm` it is a full-bleed sheet. */
  it('goes full-bleed on a small screen instead of insetting 80%', () => {
    const { small } = paperRules()
    // Anchored, so `max-width:100%` cannot stand in for the width itself.
    expect(small).toMatch(/(^|;)width:100%/)
    expect(small).toMatch(/(^|;)margin:0(px)?;/)
    expect(small).toContain('aspect-ratio:auto')
  })

  /** `md` is what capped it at 900px; leaving it would undo all of the above. */
  it('does not re-impose a named maxWidth preset', () => {
    const paper = document.querySelector('.MuiDialog-paper')
    expect(paper?.className).not.toMatch(/MuiDialog-paperWidth(Xs|Sm|Md|Lg|Xl)\b/)
  })
})

const LIBRARY = code(
  readFileSync(join(__dirname, 'media-library.component.tsx'), 'utf8'),
  'media-library.component.tsx',
)

/**
 * The grid's half. It lives in a 3,700-line component that mounts Firestore
 * listeners and a dnd-kit surface, so it is asserted the way the AGL-1462
 * spec beside it asserts that component's other declarations — over the
 * source with comments stripped, so a comment mentioning `Grid` cannot pass
 * for a `Grid` still being used.
 */
describe('the tile grid reflows instead of compressing (AGL-2486)', () => {
  it('sizes columns from the tile, not from a twelve-column split', () => {
    expect(LIBRARY).toContain(
      'repeat(auto-fill, minmax(${TILE_MIN_WIDTH}px, 1fr))',
    )
  })

  /**
   * `auto-fit` would collapse the empty tracks and let `1fr` stretch what is
   * left, so a folder holding one file would draw a single full-width card.
   */
  it('keeps its empty tracks, so a short folder still lines up', () => {
    expect(LIBRARY).not.toContain('auto-fit')
  })

  /**
   * The actual defect: `size={{ xs: 6, sm: 4, md: 3, lg: 2 }}` is six across
   * at every width in the `lg` band, and that band is measured against the
   * VIEWPORT — which the dialog is not.
   */
  it('no longer splits the row into twelfths', () => {
    expect(LIBRARY).not.toMatch(/size=\{\{\s*xs:\s*6/)
    expect(LIBRARY).not.toMatch(/<Grid\b/)
  })

  it('and the minimum is a real number the tile can be drawn at', () => {
    expect(LIBRARY).toMatch(/const TILE_MIN_WIDTH = \d{3}\b/)
  })
})
