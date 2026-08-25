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
import { act, fireEvent, render, screen, within } from '@testing-library/react'

import { ATTRIBUTE_COMMIT_DEBOUNCE_MS } from './element-props-form.component'
import ElementStylesForm from './element-styles-form.component'

/**
 * Undo and redo have to reach the open styles panel (AGL-2486).
 *
 * The canvas rolled back and the panel did not: its fields kept showing
 * the value that had just been undone, and the next edit wrote that stale
 * reading back over the restored one.
 *
 * The mechanism is one indirection. Undo restores a whole-document
 * snapshot through `CanvasManager.setNodes`, which MINTS FRESH NODE
 * INSTANCES and replaces the map. The selection (`Besigner.focus`) holds a
 * node OBJECT, not an id, and the aside panel hands that object straight
 * to this component — so after an undo the panel was reading a detached
 * copy of the node that nothing else in the app renders any more. Every
 * field was correct about the object it had; the object was the problem.
 *
 * These specs therefore keep the SAME node reference across the undo, the
 * way the selection does. Re-rendering with a freshly looked-up node would
 * assert nothing: it would fix the bug in the harness.
 */
describe('styles panel undo/redo re-sync (AGL-2486)', () => {
  /** Seeds a single styled node on the live canvas. */
  const seedNode = (sx: Record<string, any>) => {
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes({
      root: { $id: 'root', componentId: 'muiStack', nodes: ['meta'] },
      meta: {
        $id: 'meta',
        componentId: 'muiStack',
        parentId: 'root',
        sx,
      },
    } as any)
    return Aglyn.canvas.getNode('meta') as Aglyn.NodeSchema
  }

  const panel = (node: Aglyn.NodeSchema) => (
    <ThemeProvider theme={consoleThemeCssVar}>
      <ElementStylesForm node={node} />
    </ThemeProvider>
  )

  /** Opens one accordion; the field editors are code-split. */
  const open = async (summary: string) => {
    act(() => {
      fireEvent.click(screen.getByText(summary))
    })
    await act(async () => undefined)
  }

  /** The live node, whatever instance currently holds that id. */
  const live = () => Aglyn.canvas.getNode('meta') as Aglyn.NodeSchema

  const control = (label: string) =>
    screen.getByText(label).closest('.MuiFormControl-root') as HTMLElement

  const pressed = (label: string) =>
    within(control(label))
      .queryAllByRole('button', { pressed: true })
      .map((button) => button.getAttribute('value'))

  const box = (label: string) =>
    screen.getByLabelText(label) as HTMLInputElement

  /**
   * Corner Radius is a preset picker with a raw escape hatch (AGL-2486), so
   * a hand-authored `4px` lives in the control's OWN text box rather than
   * in the field's only input. The visible label names the select, so the
   * raw box carries a qualified one.
   */
  const rawBox = (label: string) => box(`${label} custom value`)

  /** Border is a thickness box + line-style picker (AGL-2486). */
  const borderThickness = () => box('Border thickness')
  const setBorderThickness = (value: string) => {
    fireEvent.change(borderThickness(), { target: { value } })
  }

  const type = (label: string, value: string) => {
    fireEvent.change(box(label), { target: { value } })
  }

  const settle = () =>
    act(() => jest.advanceTimersByTime(ATTRIBUTE_COMMIT_DEBOUNCE_MS))

  const undo = async () => {
    act(() => {
      Aglyn.canvas.undo()
    })
    await act(async () => undefined)
  }

  const redo = async () => {
    act(() => {
      Aglyn.canvas.redo()
    })
    await act(async () => undefined)
  }

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    Aglyn.canvas.reset()
  })

  it('rolls a toggle back with the document', async () => {
    const node = seedNode({ justifyContent: 'center' })
    render(panel(node))
    await open('Flexbox & Grid')

    act(() => {
      fireEvent.click(
        within(control('Justify content')).getByRole('button', {
          name: /flex.end/i,
        }),
      )
    })
    expect(pressed('Justify content')).toEqual(['flex-end'])
    expect(live().sx).toEqual({ justifyContent: 'flex-end' })

    await undo()
    // The canvas rolled back...
    expect(live().sx).toEqual({ justifyContent: 'center' })
    // ...and so must the control the author is looking at.
    expect(pressed('Justify content')).toEqual(['center'])
  })

  it('rolls a text field back, and forward again on redo', async () => {
    const node = seedNode({ borderRadius: '4px' })
    render(panel(node))
    await open('Borders & Shadows')
    // A hand-authored radius opens the control's raw box holding it — the
    // round-trip promise, checked here through the live panel rather than
    // only in the control's own spec.
    expect(rawBox('Corner Radius').value).toBe('4px')

    fireEvent.change(rawBox('Corner Radius'), { target: { value: '12px' } })
    settle()
    expect(live().sx).toEqual({ borderRadius: '12px' })

    await undo()
    expect(live().sx).toEqual({ borderRadius: '4px' })
    expect(rawBox('Corner Radius').value).toBe('4px')

    await redo()
    expect(live().sx).toEqual({ borderRadius: '12px' })
    expect(rawBox('Corner Radius').value).toBe('12px')
  })

  it('does not write the stale reading back on the next edit', async () => {
    // The severity question. A panel showing a value the document no
    // longer has will re-commit it the moment anything else in the same
    // group is touched — the undo is silently reversed.
    const node = seedNode({ borderRadius: '4px', border: '1px solid' })
    render(panel(node))
    await open('Borders & Shadows')

    fireEvent.change(rawBox('Corner Radius'), { target: { value: '12px' } })
    settle()
    await undo()

    setBorderThickness('2')
    settle()
    expect(live().sx).toEqual({
      borderRadius: '4px',
      border: '2px solid',
    })
  })

  it('keeps an in-progress edit when a SIBLING field changes underneath', async () => {
    // The hard half. A change to another key in the SAME group moves that
    // group's initial values, which is exactly what re-seeds the form —
    // and a re-seed that does not spare the field being typed in would
    // swallow the characters mid-word. The commit for this field has not
    // been flushed yet, so nothing has stored them anywhere else.
    const node = seedNode({ borderRadius: '4px', border: '1px solid' })
    render(panel(node))
    await open('Borders & Shadows')

    fireEvent.change(rawBox('Corner Radius'), { target: { value: '12p' } })
    act(() => {
      Aglyn.canvas.transact(() => {
        live().sx = { ...(live().sx as object), border: '3px dotted' } as any
      })
    })
    await act(async () => undefined)
    expect(rawBox('Corner Radius').value).toBe('12p')
    // …while the field nobody is typing in DOES take the new value. The
    // border editor shows it split across its two controls now, so the
    // thickness box is where the 3 lands.
    expect(borderThickness().value).toBe('3')
  })

  /**
   * The half the first pass could not see (AGL-2486, items 9 + 10 together).
   *
   * Every test above uses values carrying a unit — `4px`, `12px` — and they
   * pass. Give the same fields a BARE NUMBER and the undo stops arriving,
   * because the two fixes for this issue landed three minutes apart and
   * cancel:
   *
   * - item 10 stores a purely numeric value as a NUMBER, which is what
   *   makes `gap: 2` mean 16px;
   * - a form control can only ever hand back a STRING, so the form's `'2'`
   *   never again equals its initial `2`;
   * - react-final-form's definition of dirty is exactly that inequality, so
   *   every numeric field is permanently dirty;
   * - and `keepDirtyOnReinitialize` — item 9's guard against a re-seed
   *   eating characters mid-word — then correctly declines to re-seed it.
   *
   * Nothing was wrong with either half. The seed simply has to be stated in
   * the domain the controls speak, so that a field nobody has touched really
   * is pristine. Swept across the control TYPES rather than one field,
   * because each one holds its own draft state and could re-introduce the
   * dirtiness on its own.
   */
  describe('a value stored as a NUMBER', () => {
    it('rolls a free-text field back', async () => {
      // Flex Grow: a unitless number, and one of the fields still on free
      // text because no theme scale answers it. Gap used to stand here; it
      // is a spacing picker now (Zach 2026-08-25), and the preset case is
      // covered by Corner Radius below.
      const node = seedNode({ flexGrow: 2 })
      render(panel(node))
      await open('Flexbox & Grid')
      expect(box('Flex Grow').value).toBe('2')

      type('Flex Grow', '4')
      settle()
      expect(live().sx).toEqual({ flexGrow: 4 })

      await undo()
      expect(live().sx).toEqual({ flexGrow: 2 })
      expect(box('Flex Grow').value).toBe('2')
    })

    it('rolls a theme-scale field back', async () => {
      // The theme-scale control is an Autocomplete, and typing in one opens
      // a listbox that its own label also names — so the query has to say
      // it means the INPUT, or it goes ambiguous the moment the field is
      // used.
      const zIndex = () =>
        screen
          .getAllByLabelText('Z-Index')
          .find((node) => node.tagName === 'INPUT') as HTMLInputElement
      const node = seedNode({ zIndex: 3 })
      render(panel(node))
      await open('Position & Overflow')
      expect(zIndex().value).toBe('3')

      fireEvent.change(zIndex(), { target: { value: '9' } })
      settle()
      expect(live().sx).toEqual({ zIndex: 9 })

      await undo()
      expect(live().sx).toEqual({ zIndex: 3 })
      expect(zIndex().value).toBe('3')
    })

    it('rolls the border editor back', async () => {
      // And the value here is ZERO, which is the shape most likely to be
      // lost on the way: it is falsy, `strictNullChecks` is off repo-wide,
      // and `border: 0` is a real authored value — the way you cancel a
      // border a theme put there.
      const node = seedNode({ border: 0 })
      render(panel(node))
      await open('Borders & Shadows')
      expect(borderThickness().value).toBe('0')

      setBorderThickness('2')
      settle()

      await undo()
      expect(live().sx).toEqual({ border: 0 })
      // Not empty. An emptied box reads as "no border set" and is a
      // different document from `border: 0`.
      expect(borderThickness().value).toBe('0')
    })

    it('rolls a preset picker back', async () => {
      const node = seedNode({ borderRadius: 2 })
      render(panel(node))
      await open('Borders & Shadows')
      const radius = () => screen.getByLabelText('Corner Radius')
      expect(radius().textContent).toContain('Rounded')

      act(() => {
        fireEvent.mouseDown(radius())
      })
      act(() => {
        fireEvent.click(
          within(screen.getByRole('listbox')).getByText('More rounded'),
        )
      })
      settle()
      expect(live().sx).toEqual({ borderRadius: 3 })

      await undo()
      expect(live().sx).toEqual({ borderRadius: 2 })
      expect(radius().textContent).toContain('Rounded')
      expect(radius().textContent).not.toContain('More rounded')
    })

    it('rolls BACK TO zero, which is not the same as back to empty', async () => {
      const node = seedNode({ opacity: 0 })
      render(panel(node))
      await open('Position & Overflow')
      expect(box('Opacity').value).toBe('0')

      type('Opacity', '1')
      settle()
      expect(live().sx).toEqual({ opacity: 1 })

      await undo()
      expect(live().sx).toEqual({ opacity: 0 })
      expect(box('Opacity').value).toBe('0')
    })

    it('still keeps an in-progress edit on a numeric field', async () => {
      // The guard the seed must not have traded away: a field the author IS
      // typing in stays theirs, even though it now starts pristine.
      const node = seedNode({ flexGrow: 2, flexShrink: 1 })
      render(panel(node))
      await open('Flexbox & Grid')

      type('Flex Grow', '4')
      act(() => {
        Aglyn.canvas.transact(() => {
          live().sx = { ...(live().sx as object), flexShrink: 5 } as any
        })
      })
      await act(async () => undefined)
      expect(box('Flex Grow').value).toBe('4')
      expect(box('Flex Shrink').value).toBe('5')
    })
  })

  it('keeps an in-progress edit while the document changes underneath', async () => {
    // The other half: re-syncing from the node on every document change
    // would discard whatever is half-typed. Here the commit for this
    // field has NOT been flushed yet and a change lands on the node from
    // outside — the characters in the box have to survive it.
    const node = seedNode({ borderRadius: '4px' })
    render(panel(node))
    await open('Borders & Shadows')

    fireEvent.change(rawBox('Corner Radius'), { target: { value: '12p' } })
    act(() => {
      Aglyn.canvas.transact(() => {
        live().sx = { ...(live().sx as object), opacity: '0.5' } as any
      })
    })
    await act(async () => undefined)
    expect(rawBox('Corner Radius').value).toBe('12p')
  })
})
