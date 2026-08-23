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
// The panel's BoxStyler reads `palette.surface`, which only the editor's
// own theme carries — a bare `createTheme()` renders the panel not at all.
import { consoleThemeCssVar, ThemeProvider } from '@aglyn/shared-ui-theme'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'

import { PADDING_CHIP_MIN_WIDTH } from '../box-styler/components/box-diagram'
import ElementStylesForm from './element-styles-form.component'

/**
 * The box/spacing styler, consolidated (AGL-2486, item 5).
 *
 * Two stylers used to render one above the other in this panel, both
 * editing the same eight properties. They did not agree: the second was
 * built on `parseCssMeasurement`, which takes a string, so an element
 * carrying a theme spacing step — a NUMBER, which every `Box`, `Paper` and
 * section preset ships — showed its padding in the first diagram and
 * "default" in the second, and touching it there replaced the step with a
 * flattened `Npx` string.
 *
 * These tests hold the three things that fixes: there is one diagram, it
 * can READ a step, and it can WRITE one.
 */
describe('the box styler in the styles panel (AGL-2486)', () => {
  const seedNode = (sx: Record<string, any>) => {
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes({
      root: { $id: 'root', componentId: 'muiStack', nodes: ['meta'] },
      meta: { $id: 'meta', componentId: 'muiStack', parentId: 'root', sx },
    } as any)
    return Aglyn.canvas.getNode('meta') as Aglyn.NodeSchema
  }
  const live = () => Aglyn.canvas.getNode('meta') as Aglyn.NodeSchema

  const renderPanel = async (sx: Record<string, any> = {}) => {
    render(
      <ThemeProvider theme={consoleThemeCssVar}>
        <ElementStylesForm node={seedNode(sx)} />
      </ThemeProvider>,
    )
    await act(async () => undefined)
  }

  /** Open one side's editor by clicking that side of the diagram. */
  const openSide = async (label: string) => {
    act(() => {
      fireEvent.click(screen.getByLabelText(label))
    })
    await act(async () => undefined)
  }

  /** Pick an option from a MUI select by its visible text. */
  const pick = async (selectLabel: string, optionText: string) => {
    act(() => {
      fireEvent.mouseDown(screen.getByLabelText(`${selectLabel} value`))
    })
    await act(async () => undefined)
    act(() => {
      fireEvent.click(
        within(screen.getByRole('listbox')).getByText(optionText),
      )
    })
    await act(async () => undefined)
  }

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    Aglyn.canvas.reset()
  })

  describe('there is one styler, not two', () => {
    it('renders each of the eight sides exactly once', async () => {
      await renderPanel({})
      // Two diagrams meant two controls per side. Counting by the
      // accessible name is what makes a re-introduced second one fail,
      // rather than a check that some control exists.
      for (const side of [
        'Space outside — top',
        'Space outside — right',
        'Space outside — bottom',
        'Space outside — left',
        'Space inside — top',
        'Space inside — right',
        'Space inside — bottom',
        'Space inside — left',
      ]) {
        expect(screen.getAllByLabelText(side)).toHaveLength(1)
      }
    })

    it('labels the four regions ON the diagram itself', async () => {
      await renderPanel({})
      // The first version of this test asked only whether the words
      // appeared ANYWHERE, and passed with the diagram's Border label
      // deleted — the swatch legend alone satisfied it. Scoping to the
      // diagram is what makes it a check. That legend is gone now: four
      // regions that name themselves do not need a key, and it was
      // repeating what the on-region labels already said.
      // Scoped to the diagram ROOT (the border ring's own ancestor)
      // rather than to the panel, so the assertion cannot be satisfied by
      // these words appearing anywhere else on the page.
      const diagram = document.querySelector('.borderRing')
        ?.parentElement as HTMLElement
      expect(diagram).toBeTruthy()
      for (const region of ['Margin', 'Border', 'Padding', 'Contents']) {
        expect(within(diagram).getAllByText(region).length).toBeGreaterThan(0)
      }
    })

    it('puts the border label inside the border ring it names', async () => {
      await renderPanel({})
      const label = screen.getByText('Border', { selector: '.label.border' })
      expect(label.closest('.borderRing')).toBeTruthy()
      // and the padding label is inside the padding box, same rule
      const padding = screen.getByText('Padding', {
        selector: '.label.padding',
      })
      expect(padding.closest('.paddingContainer')).toBeTruthy()
    })

    it('names the sides in words, not in sx shorthand', async () => {
      await renderPanel({})
      // `mt` / `ml` / `mr` / `mb` are MUI prop names and meant nothing to
      // anyone who has not written sx.
      for (const abbreviation of ['mt', 'ml', 'mr', 'mb']) {
        expect(screen.queryByText(abbreviation)).toBeNull()
      }
    })
  })

  describe('it can read what is already stored', () => {
    it('shows a theme spacing step resolved, where the old one showed nothing', async () => {
      // This is the exact shape that was broken: numeric padding, which
      // `muiBox` and `muiPaper` ship by default.
      await renderPanel({ paddingTop: 2, paddingLeft: 4 })
      expect(
        within(screen.getByLabelText('Space inside — top')).getByText('16px'),
      ).toBeTruthy()
      expect(
        within(screen.getByLabelText('Space inside — left')).getByText('32px'),
      ).toBeTruthy()
    })

    it('shows a zero step as a measurement, not as an empty side', async () => {
      // `0` is falsy and strictNullChecks is off repo-wide, so this is
      // where a stray `if (!value)` would read "no space" as "not set".
      await renderPanel({ marginTop: 0 })
      const side = screen.getByLabelText('Space outside — top')
      expect(within(side).getByText('0px')).toBeTruthy()
      expect(within(side).queryByText('Top')).toBeNull()
    })

    it('shows the side name when nothing is set', async () => {
      await renderPanel({})
      expect(
        within(screen.getByLabelText('Space outside — top')).getByText('Top'),
      ).toBeTruthy()
    })

    it('passes a custom amount through as written', async () => {
      await renderPanel({ marginBottom: '1.5rem' })
      expect(
        within(screen.getByLabelText('Space outside — bottom')).getByText(
          '1.5rem',
        ),
      ).toBeTruthy()
    })
  })

  describe('it writes a step the theme keeps resolving', () => {
    it('stores a NUMBER when a step is picked', async () => {
      await renderPanel({})
      await openSide('Space inside — top')
      await pick('Space inside — top', 'Medium')
      // A number, not '24px'. MUI multiplies it by `theme.spacing` at
      // render, so a retuned theme still reaches this element; a
      // flattened string would have stopped following it.
      expect(live().sx).toEqual({ paddingTop: 3 })
      expect(typeof (live().sx as any).paddingTop).toBe('number')
    })

    it('stores None as 0, which is a value — not as a clear', async () => {
      await renderPanel({ paddingTop: 3 })
      await openSide('Space inside — top')
      await pick('Space inside — top', 'None')
      expect(live().sx).toEqual({ paddingTop: 0 })
    })

    it('removes the property on Not set, which IS a clear', async () => {
      await renderPanel({ paddingTop: 3 })
      await openSide('Space inside — top')
      await pick('Space inside — top', 'Not set')
      expect(live().sx).toEqual({})
    })

    it('fans a step out across the scope, same as any other value', async () => {
      await renderPanel({})
      act(() => {
        fireEvent.click(screen.getByText('All'))
      })
      await openSide('Space inside — top')
      await pick('Space inside — top', 'Small')
      expect(live().sx).toEqual({
        paddingTop: 2,
        paddingRight: 2,
        paddingBottom: 2,
        paddingLeft: 2,
      })
    })
  })

  describe('the interaction defects Zach reported (2026-08-23)', () => {
    it('marks the selected side with a fill, and only one at a time', async () => {
      await renderPanel({})
      const top = screen.getByLabelText('Space inside — top')
      expect(top.getAttribute('aria-pressed')).toBe('false')
      await openSide('Space inside — top')
      expect(top.getAttribute('aria-pressed')).toBe('true')

      // Selecting another side releases the first — an outline that
      // lingered would read as two selections in a figure already full
      // of lines.
      await openSide('Space inside — left')
      expect(top.getAttribute('aria-pressed')).toBe('false')
      expect(
        screen.getByLabelText('Space inside — left').getAttribute('aria-pressed'),
      ).toBe('true')
      expect(
        screen.getAllByLabelText(/^Space (inside|outside)/).filter(
          (side) => side.getAttribute('aria-pressed') === 'true',
        ),
      ).toHaveLength(1)
    })

    it('keeps the editor mounted while the panel collapses', async () => {
      // The close had no animation because the child went to `null` the
      // instant `editing` did, leaving Collapse nothing to animate out.
      await renderPanel({ paddingTop: 3 })
      await openSide('Space inside — top')
      expect(screen.getByLabelText('Space inside — top value')).toBeTruthy()

      act(() => {
        fireEvent.click(screen.getByLabelText('Space inside — top'))
      })
      // Still in the tree for the length of the exit transition.
      expect(screen.queryByLabelText('Space inside — top value')).toBeTruthy()
    })

    it('settles on ONE tooltip however the pointer crosses the figure', async () => {
      // The regions overlap, so a pointer crossing the figure enters
      // several hit areas in quick succession. Independently controlled
      // tooltips stacked up; one piece of state cannot.
      //
      // `waitFor` rather than a bare assertion because a tooltip on its
      // way OUT is still in the DOM for the length of its fade — the
      // guarantee is what it settles to, and asserting before the fade
      // finished is what made the first version of this test flaky
      // (green alone, red in the full file).
      await renderPanel({ paddingTop: 2, marginTop: 1 })
      for (const side of ['Space inside — top', 'Space outside — top']) {
        act(() => {
          fireEvent.mouseEnter(screen.getByLabelText(side))
        })
        act(() => jest.advanceTimersByTime(500))
      }
      await waitFor(() =>
        expect(screen.queryAllByRole('tooltip')).toHaveLength(1),
      )
      // And it is the LAST one entered, not the first.
      expect(screen.getByRole('tooltip').textContent).toContain(
        'Space outside — top',
      )
    })

    it('waits before opening a tooltip, so crossing the box does not spray them', async () => {
      // Controlled `open` makes MUI ignore its own enterDelay, so the
      // delay has to live in the state that drives it. A pointer that
      // passes through opens nothing.
      await renderPanel({ paddingTop: 2 })
      act(() => {
        fireEvent.mouseEnter(screen.getByLabelText('Space inside — top'))
      })
      act(() => jest.advanceTimersByTime(100))
      expect(screen.queryAllByRole('tooltip')).toHaveLength(0)
      act(() => {
        fireEvent.mouseLeave(screen.getByLabelText('Space inside — top'))
      })
      act(() => jest.advanceTimersByTime(1000))
      expect(screen.queryAllByRole('tooltip')).toHaveLength(0)
    })
  })

  describe('the custom amount still works, and still stores a string', () => {
    it('keeps a unit-bearing value as CSS text', async () => {
      await renderPanel({})
      await openSide('Space outside — left')
      await pick('Space outside — left', 'Custom amount…')
      fireEvent.change(screen.getByLabelText('Space outside — left amount'), {
        target: { value: '12' },
      })
      await act(async () => undefined)
      expect(live().sx).toEqual({ marginLeft: '12px' })
    })

    it('shows a step the ladder has no rung for, instead of going blank', async () => {
      // `p: 10` on a hero: 10 is not a rung, and with no option carrying
      // it the select rendered EMPTY while the diagram beside it read
      // 80px — so the control claimed "not set" about a value that was
      // set, and the next pick would have overwritten it unseen.
      await renderPanel({ paddingTop: 10 })
      await openSide('Space inside — top')
      expect(
        within(screen.getByLabelText('Space inside — top')).getByText('80px'),
      ).toBeTruthy()
      const select = screen.getByLabelText('Space inside — top value')
      expect(select.textContent).toContain('80px')
    })

    it('opens in custom mode for a value that is already custom', async () => {
      await renderPanel({ marginLeft: '2rem' })
      await openSide('Space outside — left')
      // Derived from the value, not remembered — a latched mode would
      // show the ladder here and lose the rem on the first touch.
      expect(
        (screen.getByLabelText('Space outside — left amount') as HTMLInputElement)
          .value,
      ).toBe('2')
    })
  })

  describe('the BORDER label chip (Zach, 2026-08-23)', () => {
    /**
     * The CSS emotion actually emitted for one selector, whitespace
     * removed.
     *
     * Read from the emitted RULES rather than from `getComputedStyle`,
     * because jsdom does not resolve `var(--mui-palette-*)` — a computed
     * background would be empty whether the declaration is there or not,
     * i.e. a check that could only ever pass. Emotion inserts through
     * `sheet.insertRule` here, so the `<style>` tags carry no text and the
     * rules have to come off `document.styleSheets`.
     */
    const cssFor = (selector: string) => {
      const rules: string[] = []
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules)) {
            const text = `${(rule as CSSRule).cssText}`.replace(/\s+/g, '')
            if (text.includes(`${selector}{`)) rules.push(text)
          }
        } catch {
          // A sheet jsdom cannot read has nothing to contribute.
        }
      }
      return rules.join(' | ')
    }

    /** Every rule emitted, whitespace removed. */
    const allCss = () => {
      const rules: string[] = []
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules)) {
            rules.push(`${(rule as CSSRule).cssText}`.replace(/\s+/g, ''))
          }
        } catch {
          // A sheet jsdom cannot read has nothing to contribute.
        }
      }
      return rules.join(' | ')
    }

    /**
     * Everything the diagram hides, as `[at-rule, selector]` pairs, with
     * the emotion hash stripped.
     *
     * This is the LIST form, and the first version of the test did not
     * have it: it asked whether a handful of named selectors were hidden,
     * which cannot see a rule hiding something it never thought to name.
     * Hiding `.paddingTop .sideValue` — the value itself, the exact thing
     * this fix exists to protect — sailed straight through it. Enumerating
     * what is hidden and pinning the whole list is the check that fails.
     */
    const everythingHidden = () => {
      // Scoped to the DIAGRAM's own class, found by the one declaration
      // only it makes — otherwise this collects MUI's own `display:none`
      // rules (scrollbars, Accordion separators) and says nothing.
      let root = ''
      const eachRule = (fn: (rule: any, enclosing: string) => void) => {
        const walk = (rules: CSSRuleList, enclosing: string) => {
          for (const rule of Array.from(rules)) {
            const inner = (rule as any).cssRules as CSSRuleList | undefined
            if (inner) {
              walk(
                inner,
                `${(rule as any).conditionText ?? ''}`.replace(/\s+/g, ''),
              )
              continue
            }
            fn(rule, enclosing)
          }
        }
        for (const sheet of Array.from(document.styleSheets)) {
          try {
            walk(sheet.cssRules, '')
          } catch {
            // unreadable sheet
          }
        }
      }
      eachRule((rule) => {
        if (root) return
        if (!`${rule.cssText}`.replace(/\s+/g, '').includes('container-type:inline-size')) return
        root = `${rule.selectorText ?? ''}`.trim()
      })
      expect(root).toMatch(/^\.css-[a-z0-9]+$/i)

      const found: Array<[string, string]> = []
      eachRule((rule, enclosing) => {
        const selector = `${rule.selectorText ?? ''}`
        if (!selector.includes(root)) return
        if (!/[;{]display:none/.test(`${rule.cssText}`.replace(/\s+/g, ''))) {
          return
        }
        found.push([enclosing, selector.split(root).join('').trim()])
      })
      return found
    }

    /**
     * What hides `selector`, and under which at-rule — `''` for a rule at
     * the top level. Answers "is this chip hidden, and by what", which is
     * the question; a plain substring search could not tell a container
     * query from a viewport media query.
     */
    const hiddenBy = (selector: string) => {
      const found: string[] = []
      const walk = (rules: CSSRuleList, enclosing: string) => {
        for (const rule of Array.from(rules)) {
          const inner = (rule as any).cssRules as CSSRuleList | undefined
          if (inner) {
            walk(
              inner,
              `${(rule as any).conditionText ?? ''}`.replace(/\s+/g, '') ||
                `${(rule as any).cssText}`.slice(0, 40),
            )
            continue
          }
          const text = `${(rule as CSSRule).cssText}`.replace(/\s+/g, '')
          const target = `${(rule as any).selectorText ?? ''}`.replace(
            /^\.css-[a-z0-9]+\s*/i,
            '',
          )
          if (target === selector && text.includes('display:none')) {
            found.push(enclosing)
          }
        }
      }
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          walk(sheet.cssRules, '')
        } catch {
          // unreadable sheet
        }
      }
      return found
    }

    it('sits on the same opaque chip as MARGIN and PADDING', async () => {
      // Zach: "the border label on the box styler needs a background to
      // make it more legible just like padding and margin labels". The
      // chip painted the band's own stripes, and because `background` is
      // a SHORTHAND that also reset the base chip's opaque paper ground —
      // so the one label sitting on the figure's only patterned region
      // was the one label without a ground of its own.
      await renderPanel({})
      const base = cssFor('.label')
      expect(base).not.toBe('')
      expect(base).toContain(
        'background-color:var(--mui-palette-background-paper)',
      )

      const chip = cssFor('.label.border')
      expect(chip).not.toBe('')
      // No texture, and no `background` shorthand to wipe the ground out.
      expect(chip).not.toContain('repeating-linear-gradient')
      expect(chip).not.toMatch(/[;{]background:/)
      // Still identifiably the border's: the band's own dashed info edge.
      expect(chip).toContain('border-style:dashed')
    })

    it('sits TOP-LEFT, stepping inward with the other two', async () => {
      // Superseding the earlier bottom-right placement, which existed
      // only because the chip had to overlap two regions to be read. All
      // three chips now take the same corner of their own band, so they
      // step inward along the left edge as the regions nest.
      await renderPanel({})
      const chip = cssFor('.label.border')
      // The base rule IS the placement; the chip releases none of it.
      expect(cssFor('.label')).toContain('left:2px')
      expect(cssFor('.label')).toContain('top:2px')
      for (const escape of ['top:auto', 'left:auto', 'bottom:-1px', 'right:']) {
        expect(chip).not.toContain(escape)
      }
    })

    /**
     * Measured in a real browser, in the BAND's own coordinates — the
     * padding band, not the padding box, is what the chip and the value
     * actually share. Keyed by PANEL width; the diagram is the panel less
     * ~33px of surrounding chrome.
     *
     * 375px is the panel's stock width; 260px is the narrow end the
     * resizable panel reaches, and the width the state-pill row in this
     * same panel was tuned against.
     */
    const DIAGRAM_WIDTH = { 260: 227, 300: 267, 320: 287, 340: 307, 375: 342 }
    /** `value.left - chip.right` in the padding band, measured, unclipped. */
    const NATURAL_GAP = { 300: -12, 320: -5.4, 340: 1.3, 375: 12.8 }

    it('drops the PADDING chip exactly where its band stops fitting both', async () => {
      // The defect: at a 260px panel the padding band is 83px and the chip
      // is 54px of it, so the chip covered `paddingTop`'s value outright.
      //
      // The threshold has to sit ABOVE the width where they merely stop
      // touching. 307px is where the value clears by 1.3px, which is a
      // coincidence rather than a clearance, and it would not survive a
      // value one character longer.
      for (const panel of [300, 320] as const) {
        expect(NATURAL_GAP[panel]).toBeLessThan(0)
        expect(DIAGRAM_WIDTH[panel]).toBeLessThan(PADDING_CHIP_MIN_WIDTH)
      }
      // 340 is the width that clears by a hair — still below the
      // threshold, deliberately.
      expect(NATURAL_GAP[340]).toBeGreaterThan(0)
      expect(NATURAL_GAP[340]).toBeLessThan(4)
      expect(DIAGRAM_WIDTH[340]).toBeLessThan(PADDING_CHIP_MIN_WIDTH)

      // and the stock panel is well clear of the boundary, so an ordinary
      // author never meets it.
      expect(DIAGRAM_WIDTH[375]).toBeGreaterThan(PADDING_CHIP_MIN_WIDTH)
      expect(DIAGRAM_WIDTH[375] - PADDING_CHIP_MIN_WIDTH).toBeGreaterThan(20)
    })

    it('asks the FIGURE how wide it is, not the window', async () => {
      // The panel is resizable, so a viewport media query would measure
      // the wrong thing entirely — a 260px panel and a 375px panel sit in
      // the same window, and the figure would answer the same for both.
      await renderPanel({})
      expect(allCss()).toContain('container-type:inline-size')
      expect(hiddenBy('.label.padding')).toEqual([
        `aglynBoxDiagram(max-width:${PADDING_CHIP_MIN_WIDTH - 1}px)`,
      ])
    })

    it('drops only the chip that cannot fit, and never a value', async () => {
      // MARGIN's band is the full width of the diagram and BORDER's
      // carries no value at all, so neither can ever reach one. Hiding
      // them would remove information for no reason — and hiding a VALUE
      // would remove the very data this fix exists to protect, which is
      // why the assertion is the WHOLE list rather than a few names.
      await renderPanel({})
      expect(everythingHidden()).toEqual([
        [
          `aglynBoxDiagram(max-width:${PADDING_CHIP_MIN_WIDTH - 1}px)`,
          '.label.padding',
        ],
      ])
    })

    it('positions each chip against its OWN region, so the step is geometry', async () => {
      // What makes three chips in the same corner read as nesting rather
      // than as a stack: each is absolute inside a different offset
      // parent, so the inward step falls out of the regions themselves.
      await renderPanel({})
      expect(
        screen
          .getByText('Border', { selector: '.label.border' })
          .closest('.borderRing'),
      ).toBeTruthy()
      expect(
        screen
          .getByText('Padding', { selector: '.label.padding' })
          .closest('.paddingContainer'),
      ).toBeTruthy()
      for (const selector of ['.borderRing', '.paddingContainer']) {
        expect(cssFor(selector)).toContain('position:relative')
      }
    })
  })

  describe('auto is on the list, for margins only (Zach, 2026-08-23)', () => {
    /** Open one side's select and read the options it offers. */
    const optionsFor = async (side: string) => {
      act(() => {
        fireEvent.mouseDown(screen.getByLabelText(`${side} value`))
      })
      await act(async () => undefined)
      return within(screen.getByRole('listbox'))
    }

    it('offers Auto on a margin side', async () => {
      await renderPanel({})
      await openSide('Space outside — left')
      const options = await optionsFor('Space outside — left')
      expect(options.getByText('Auto')).toBeTruthy()
      // Its own group: `auto` is not a size, and listing it among the
      // rungs would put "let the browser decide" in a ladder of amounts.
      expect(options.getByText('Automatic')).toBeTruthy()
      // and the three genuinely different answers stay distinguishable.
      expect(options.getByText('Not set')).toBeTruthy()
      expect(options.getByText('None')).toBeTruthy()
    })

    it('does NOT offer it on a padding side, where it is not valid CSS', async () => {
      // `padding: auto` is dropped by the browser, so the entry would be
      // a menu row that silently does nothing.
      await renderPanel({})
      await openSide('Space inside — top')
      const options = await optionsFor('Space inside — top')
      expect(options.queryByText('Auto')).toBeNull()
      expect(options.queryByText('Automatic')).toBeNull()
      // The list is otherwise the same one.
      expect(options.getByText('Custom amount…')).toBeTruthy()
    })

    it('stores the auto KEYWORD rather than clearing the side', async () => {
      // `Number('auto')` is NaN, and the step branch turns a non-finite
      // number into `undefined` — so picking Auto without its own branch
      // would silently REMOVE the property the author just set.
      await renderPanel({})
      await openSide('Space outside — left')
      await pick('Space outside — left', 'Auto')
      expect(live().sx).toEqual({ marginLeft: 'auto' })
    })

    it('reads back as Auto, not as a custom amount', async () => {
      // A string value is a custom amount by default, so without the
      // keyword case the list answer would round-trip into the other
      // control the moment it was stored.
      await renderPanel({ marginLeft: 'auto' })
      await openSide('Space outside — left')
      expect(
        screen.getByLabelText('Space outside — left value').textContent,
      ).toContain('Auto')
      expect(screen.queryByLabelText('Space outside — left amount')).toBeNull()
      // and the diagram, which already understood the value, shows it.
      expect(
        within(screen.getByLabelText('Space outside — left')).getByText('auto'),
      ).toBeTruthy()
    })

    it('still shows an auto that somehow reached a PADDING side', async () => {
      // Not offering it is not the same as hiding it: a padding side
      // holding `auto` from a hand-written sx must not read as unset.
      await renderPanel({ paddingLeft: 'auto' })
      await openSide('Space inside — left')
      expect(
        (screen.getByLabelText('Space inside — left unit') as HTMLElement)
          .textContent,
      ).toContain('auto')
    })
  })
})
