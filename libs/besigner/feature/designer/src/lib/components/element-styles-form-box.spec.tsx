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

    it('labels the four regions ON the diagram, not just in the legend', async () => {
      await renderPanel({})
      // The first version of this test asked only whether the words
      // appeared ANYWHERE, and passed with the diagram's Border label
      // deleted — the legend alone satisfied it. Scoping to the diagram
      // is what makes it a check. Zach hit the same confusion from the
      // other side: a BORDER label parked outside the ring reads as
      // "the border is outside the margin".
      // Scoped to the diagram ROOT (the border ring's own ancestor), not
      // to the panel — the legend repeats all four words, so a page-wide
      // query passes with the diagram's labels deleted.
      const diagram = document.querySelector('.borderRing')
        ?.parentElement as HTMLElement
      expect(diagram).toBeTruthy()
      for (const region of ['Margin', 'Border', 'Padding', 'Content']) {
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
})
