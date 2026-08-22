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

  const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement

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
    await open('Flexbox & Grids')

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
    expect(box('Corner Radius').value).toBe('4px')

    type('Corner Radius', '12px')
    settle()
    expect(live().sx).toEqual({ borderRadius: '12px' })

    await undo()
    expect(live().sx).toEqual({ borderRadius: '4px' })
    expect(box('Corner Radius').value).toBe('4px')

    await redo()
    expect(live().sx).toEqual({ borderRadius: '12px' })
    expect(box('Corner Radius').value).toBe('12px')
  })

  it('does not write the stale reading back on the next edit', async () => {
    // The severity question. A panel showing a value the document no
    // longer has will re-commit it the moment anything else in the same
    // group is touched — the undo is silently reversed.
    const node = seedNode({ borderRadius: '4px', border: '1px solid' })
    render(panel(node))
    await open('Borders & Shadows')

    type('Corner Radius', '12px')
    settle()
    await undo()

    type('Border', '2px dashed')
    settle()
    expect(live().sx).toEqual({
      borderRadius: '4px',
      border: '2px dashed',
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

    type('Corner Radius', '12p')
    act(() => {
      Aglyn.canvas.transact(() => {
        live().sx = { ...(live().sx as object), border: '3px dotted' } as any
      })
    })
    await act(async () => undefined)
    expect(box('Corner Radius').value).toBe('12p')
    // …while the field nobody is typing in DOES take the new value.
    expect(box('Border').value).toBe('3px dotted')
  })

  it('keeps an in-progress edit while the document changes underneath', async () => {
    // The other half: re-syncing from the node on every document change
    // would discard whatever is half-typed. Here the commit for this
    // field has NOT been flushed yet and a change lands on the node from
    // outside — the characters in the box have to survive it.
    const node = seedNode({ borderRadius: '4px' })
    render(panel(node))
    await open('Borders & Shadows')

    type('Corner Radius', '12p')
    act(() => {
      Aglyn.canvas.transact(() => {
        live().sx = { ...(live().sx as object), opacity: '0.5' } as any
      })
    })
    await act(async () => undefined)
    expect(box('Corner Radius').value).toBe('12p')
  })
})
