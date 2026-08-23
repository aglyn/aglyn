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

import * as Aglyn from '@aglyn/aglyn'
import { consoleThemeCssVar, ThemeProvider } from '@aglyn/shared-ui-theme'
import { DndContext } from '@dnd-kit/core'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'

import { DETAIL_CLOSE_DELAY_MS } from '../hooks/use-detail-hover-intent'
import ComponentAccordionList from './component-accordion-list'
import ComponentPicker from './component-picker'

const theme = consoleThemeCssVar

const HOLDER_ID = 'surfaces-holder'
const ONLY_CHILD_ID = 'surfaces-only-child'
const PLAIN_ID = 'surfaces-plain'

const COMPONENTS: any[] = [
  {
    $id: HOLDER_ID,
    pluginId: 'mui',
    displayName: 'Surfaces Holder',
    description: 'A holder that only takes one kind of child.',
    category: Aglyn.ComponentCategory.SURFACE,
    restrictChildren: [
      Aglyn.LinealDirectiveFlag.LIMIT_TO,
      { components: [ONLY_CHILD_ID] },
    ],
  },
  {
    $id: ONLY_CHILD_ID,
    pluginId: 'mui',
    displayName: 'Surfaces Only Child',
    category: Aglyn.ComponentCategory.SURFACE,
  },
  {
    $id: PLAIN_ID,
    pluginId: 'mui',
    displayName: 'Surfaces Plain',
    category: Aglyn.ComponentCategory.LAYOUT,
  },
]

/** The picker lists PRESETS, so each component gets one. */
const PRESETS = COMPONENTS.map((schema) => ({
  $id: `${schema.$id}-preset`,
  type: Aglyn.NodeType.PRESET,
  displayName: schema.displayName,
  description: schema.description,
  category: schema.category,
  data: { $id: null, componentId: schema.$id, props: {} },
}))

const cardFor = (name: string) =>
  Array.from(document.querySelectorAll('.MuiCard-root')).find(
    (card) => (card.textContent || '').trim() === name,
  ) as HTMLElement

const details = () =>
  Array.from(document.querySelectorAll('[data-testid="element-detail"]'))

const previews = () =>
  Array.from(document.querySelectorAll('[data-testid="element-preview"]'))

const renderPanel = () =>
  render(
    <ThemeProvider theme={theme}>
      <DndContext>
        <ComponentAccordionList />
      </DndContext>
    </ThemeProvider>,
  )

describe('element detail in both picker surfaces (AGL-2486)', () => {
  beforeAll(() => {
    COMPONENTS.forEach((schema) =>
      Aglyn.components.registerComponent((() => null) as any, schema),
    )
  })
  beforeEach(() => Aglyn.components.registerPreset(PRESETS as any))
  afterEach(() => {
    cleanup()
    Aglyn.components.unregisterPreset(PRESETS.map((p) => p.$id) as any)
  })

  describe('the Choose element dialog', () => {
    it('shows real detail on selecting, before Confirm', () => {
      render(
        <ThemeProvider theme={theme}>
          <ComponentPicker open />
        </ThemeProvider>,
      )
      // Nothing selected: no detail, and no Confirm to press.
      expect(details().length).toBe(0)

      fireEvent.click(cardFor('Surfaces Holder'))

      // The authored line...
      expect(
        screen.getByText('A holder that only takes one kind of child.'),
      ).toBeTruthy()
      // ...and a fact nobody wrote, read off restrictChildren.
      expect(screen.getByText('Only accepts Surfaces Only Child')).toBeTruthy()
      // All of it BEFORE the commit.
      expect(screen.getByText('Confirm')).toBeTruthy()
    })

    it('shows derived facts for an element with no prose at all', () => {
      render(
        <ThemeProvider theme={theme}>
          <ComponentPicker open />
        </ThemeProvider>,
      )
      fireEvent.click(cardFor('Surfaces Plain'))
      expect(details().length).toBe(1)
      expect(screen.getByText('Holds other elements')).toBeTruthy()
    })

    it('links to the catalog section for the element category', () => {
      render(
        <ThemeProvider theme={theme}>
          <ComponentPicker open />
        </ThemeProvider>,
      )
      fireEvent.click(cardFor('Surfaces Plain'))
      const link = screen.getByText('Learn more') as HTMLAnchorElement
      expect(link.getAttribute('href')).toContain(
        '/building-sites/besigner/element-catalog',
      )
      // Layout category → the catalog's Layout section, derived not mapped.
      expect(link.getAttribute('href')).toContain('#layout')
    })
  })

  describe('the Elements panel', () => {
    it('shows the same detail on hover', () => {
      renderPanel()
      expect(details().length).toBe(0)

      fireEvent.mouseEnter(cardFor('Surfaces Holder').parentElement)
      expect(screen.getByText('Only accepts Surfaces Only Child')).toBeTruthy()
    })

    it('keeps exactly one detail open across several hovers', () => {
      renderPanel()
      fireEvent.mouseEnter(cardFor('Surfaces Holder').parentElement)
      fireEvent.mouseEnter(cardFor('Surfaces Plain').parentElement)
      fireEvent.mouseEnter(cardFor('Surfaces Only Child').parentElement)
      // The bug this design avoids: several tips open at once.
      expect(details().length).toBe(1)
    })

    it('floats clear of the grid rather than covering it', () => {
      renderPanel()
      const card = cardFor('Surfaces Holder')
      fireEvent.mouseEnter(card.parentElement)
      const region = details()[0]
      // Portalled out of the panel entirely: it cannot be clipped by the
      // column's own overflow, cannot push the grid, and — being anchored
      // right-start — cannot sit on top of the card it describes.
      expect(region.contains(card)).toBe(false)
      expect(card.contains(region)).toBe(false)
      expect(document.body.contains(region)).toBe(true)
    })

    it('holds the pinned element while the pointer crosses other cards', async () => {
      renderPanel()
      fireEvent.click(cardFor('Surfaces Holder').parentElement)
      fireEvent.mouseLeave(cardFor('Surfaces Holder').parentElement)

      // THE load-bearing behaviour. Reaching for "Learn more" means leaving
      // the card and crossing whatever is between; without the pin winning,
      // the content swaps under the pointer and nothing in it is clickable.
      fireEvent.mouseEnter(cardFor('Surfaces Plain').parentElement)
      fireEvent.mouseEnter(cardFor('Surfaces Only Child').parentElement)

      // Scoped to the panel itself: the name also appears on the card, and
      // asserting globally would pass on the card alone.
      expect(details().length).toBe(1)
      expect(details()[0].textContent).toContain('Surfaces Holder')
      expect(details()[0].textContent).toContain('Only accepts Surfaces Only Child')
      expect(details()[0].textContent).not.toContain('Surfaces Plain')
    })

    it('survives the pointer leaving the card on the way to the panel', async () => {
      renderPanel()
      fireEvent.mouseEnter(cardFor('Surfaces Holder').parentElement)
      // Leaving the card starts a close; arriving in the panel cancels it.
      fireEvent.mouseLeave(cardFor('Surfaces Holder').parentElement)
      fireEvent.mouseEnter(details()[0])

      await new Promise((r) => setTimeout(r, DETAIL_CLOSE_DELAY_MS + 60))
      expect(details().length).toBe(1)
    })

    it('closes after the delay once the pointer has really gone', async () => {
      renderPanel()
      fireEvent.mouseEnter(cardFor('Surfaces Holder').parentElement)
      expect(details().length).toBe(1)

      fireEvent.mouseLeave(cardFor('Surfaces Holder').parentElement)
      // Not instant — an instant dismiss is what makes these unusable.
      expect(details().length).toBe(1)

      await waitFor(() => expect(details().length).toBe(0))
    })

    it('unpins on clicking the same card again', async () => {
      renderPanel()
      fireEvent.click(cardFor('Surfaces Holder').parentElement)
      fireEvent.mouseLeave(cardFor('Surfaces Holder').parentElement)
      expect(screen.getByText('Only accepts Surfaces Only Child')).toBeTruthy()

      fireEvent.click(cardFor('Surfaces Holder').parentElement)
      // Still pointing at the card, so it stays up as a plain hover...
      expect(details().length).toBe(1)
      // ...and now closes on the normal delay rather than being held.
      fireEvent.mouseLeave(cardFor('Surfaces Holder').parentElement)
      await waitFor(() => expect(details().length).toBe(0))
    })

    it('dismisses a pinned panel on Escape', async () => {
      renderPanel()
      fireEvent.click(cardFor('Surfaces Holder').parentElement)
      expect(details().length).toBe(1)

      fireEvent.keyDown(window, { key: 'Escape' })
      await waitFor(() => expect(details().length).toBe(0))
    })

    it('leaves the search usable while the detail floats', () => {
      renderPanel()
      fireEvent.mouseEnter(cardFor('Surfaces Holder').parentElement)
      expect(details().length).toBe(1)
      // The overlay is portalled and anchored into the canvas, so the
      // panel's own header is neither covered nor unmounted.
      expect(screen.getByLabelText('search elements')).toBeTruthy()
    })
  })

  describe('the rendered preview', () => {
    it('appears in the dialog on selecting, and only for the selection', () => {
      render(
        <ThemeProvider theme={theme}>
          <ComponentPicker open />
        </ThemeProvider>,
      )
      expect(previews().length).toBe(0)
      fireEvent.click(cardFor('Surfaces Holder'))
      expect(previews().length).toBe(1)
    })

    it('appears in the panel on hover, one at a time across several', () => {
      renderPanel()
      fireEvent.mouseEnter(cardFor('Surfaces Holder').parentElement)
      fireEvent.mouseEnter(cardFor('Surfaces Plain').parentElement)
      fireEvent.mouseEnter(cardFor('Surfaces Only Child').parentElement)
      // Every preview builds its own CanvasManager and mounts a shadow root;
      // several at once would be the expensive version of the tooltip bug.
      expect(previews().length).toBe(1)
    })
  })

  /**
   * jsdom has no layout, so none of this can be measured here — the column
   * count and the wrapping were measured in a real browser. What these guard
   * is the input to that layout: the rules the browser is handed. Each one
   * fails against the code as it stood when Zach reported the dialog.
   */
  describe('the dialog gives the grid room instead of taking it (AGL-2486)', () => {
    /**
     * Every CSS rule that mentions one of this element's own classes.
     *
     * Read out of `document.styleSheets` rather than the `<style>` tags:
     * emotion inserts through the CSSOM, which leaves the tag's
     * `textContent` empty. A `cssFor` that read the tags returned `''` for
     * every element, so every `toContain` on it passed vacuously and every
     * `not.toContain` passed for the wrong reason.
     */
    const cssFor = (el: Element) => {
      const own = (el.getAttribute('class') || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((c) => '.' + c)
      const out: string[] = []
      const walk = (rules: CSSRuleList) => {
        Array.from(rules || []).forEach((rule: any) => {
          if (rule.selectorText) {
            if (own.some((c) => rule.selectorText.includes(c))) {
              out.push(rule.cssText)
            }
            return
          }
          if (rule.cssRules?.length) walk(rule.cssRules)
        })
      }
      Array.from(document.styleSheets).forEach((sheet) => {
        try {
          walk(sheet.cssRules)
        } catch {
          /* cross-origin sheet — nothing of ours lives there */
        }
      })
      // Runs of whitespace collapsed to one space, and every assertion
      // below written with `\s*`, so none of them turns on how a serialiser
      // chose to space a value.
      return out.join('\n').replace(/[^\S\n]+/g, ' ')
    }

    const openPicker = () =>
      render(
        <ThemeProvider theme={theme}>
          <ComponentPicker open />
        </ThemeProvider>,
      )

    it('is the widest paper the theme offers, not a confirm box', () => {
      openPicker()
      const paper = document.querySelector('.MuiDialog-paper')
      // `md` (900px) minus a 420px detail pane left the grid 448px — less
      // than the whole dialog had before the pane existed.
      expect(paper.className).toContain('MuiDialog-paperWidthXl')
      // And `fullWidth`, not `width: 100%`: `100%` ignores the paper's own
      // 32px margins, so it overflows the viewport below its cap.
      expect(paper.className).toContain('MuiDialog-paperFullWidth')
    })

    it('sizes the tiles off the pane they are in, not the viewport', () => {
      openPicker()
      const grid = document.querySelector('[data-testid="picker-element-grid"]')
      expect(grid).toBeTruthy()

      // The whole point: `auto-fill` asks the container how much room there
      // is. A 12-column `size={{ xs: 4, sm: 3 }}` asks the VIEWPORT, which
      // cannot see the detail pane, so the pane came out of the tiles.
      const css = cssFor(grid)
      expect(css).toMatch(/display:\s*grid/)
      const track = css.match(
        /grid-template-columns:\s*repeat\(\s*auto-fill\s*,\s*minmax\(\s*(\d+)px\s*,\s*1fr\s*\)\s*\)/,
      )
      expect(track).toBeTruthy()
      // The tile floor is what Zach lost twice — once to the detail pane,
      // once to the even split. Pinned so neither can quietly take it again.
      expect(Number(track[1])).toBeGreaterThanOrEqual(150)

      // And the tiles are the grid's own children — a `Grid` item wrapper
      // around each card would reintroduce the fixed 12-column track and
      // make the rule above decorative.
      const cards = Array.from(document.querySelectorAll('.MuiCard-root'))
      expect(cards.length).toBeGreaterThan(0)
      cards.forEach((card) => {
        expect(card.closest('.MuiGrid-root')).toBeNull()
      })
    })

    it('splits the width evenly, and neither pane is a fixed number', () => {
      openPicker()
      fireEvent.click(cardFor('Surfaces Plain'))
      const content = document.querySelector('.MuiDialogContent-root')
      const [gridPane, detailPane] = Array.from(content.children)

      // The preview is sized by its pane and nothing else — the stage
      // composes at 1280 and scales by `paneWidth / 1280` — so an even
      // split IS the "bigger preview". A fixed px pane cannot deliver it:
      // it hands every pixel the dialog gains to the grid.
      ;[gridPane, detailPane].forEach((pane) => {
        expect(cssFor(pane)).toMatch(/flex:\s*1\s+1\s+50%/)
      })
      expect(cssFor(detailPane)).not.toMatch(/width:\s*\d+px/)
    })

    it('never hides the pane that holds Confirm', () => {
      openPicker()
      fireEvent.click(cardFor('Surfaces Plain'))
      const confirm = screen.getByText('Confirm')
      const pane = confirm.closest('.MuiDialogContent-root > *')
      expect(pane).toBeTruthy()

      // The pane used to be `display: { xs: 'none', sm: 'flex' }`, and
      // Confirm lives inside it — so below `sm` the dialog could be browsed
      // and never used. It stacks under the grid now instead of vanishing.
      const css = cssFor(pane)
      expect(css).not.toMatch(/display:\s*none/)
      expect(css).toMatch(/width:\s*100%/)
    })

    it('stacks the panes rather than squeezing both, below the pane width', () => {
      openPicker()
      const content = document.querySelector('.MuiDialogContent-root')
      const css = cssFor(content)
      // Two panes side by side need more width than a laptop in a split
      // view has. Column below `md`, row above it.
      expect(css).toMatch(/flex-direction:\s*column/)
      expect(css).toMatch(/flex-direction:\s*row/)
    })
  })
})
