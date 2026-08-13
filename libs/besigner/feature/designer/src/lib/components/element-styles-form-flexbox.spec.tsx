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

import ElementStylesForm from './element-styles-form.component'

/**
 * The Flexbox & Grids toggles' READ-BACK (AGL-1458).
 *
 * `ToggleButtonFormControl` has always accepted a `value` prop and seeded
 * its local state from it — the styles panel simply never passed one, for
 * any of the eight container toggles. So every one of them opened at `''`:
 * no segment pressed, and the helper line reading `- not set` on a node
 * that demonstrably has the property.
 *
 * The asymmetry that makes this a bug rather than a design is one control
 * away: `Text Alignment` is a bespoke group in the same panel, and it IS
 * handed `effectiveValues['textAlign']`. On the node that surfaced this
 * (`blogEntryTmpl`'s Entry Meta, storing `{textAlign: 'center',
 * justifyContent: 'center'}`) Text Alignment highlighted Center while
 * Justify content beside it read "not set" — same node, same panel, same
 * moment.
 *
 * Why it is worse than a blank control: unlike the recorded
 * `backgroundColor`-vs-`bgcolor` trap, the toggle and the stored value use
 * the SAME key. An author who believes "not set" and clicks a segment is
 * writing over a value they were told did not exist.
 *
 * These specs drive the real panel on a real canvas node, so they assert
 * the wiring, not the control in isolation — the control was never broken.
 */
describe('styles panel Flexbox & Grids read-back (AGL-1458)', () => {
  /** Every container toggle: its label, the sx key it owns, a value. */
  const CONTAINER_TOGGLES: Array<[label: string, key: string, value: string]> =
    [
      ['Align items', 'alignItems', 'center'],
      ['Align content', 'alignContent', 'space-between'],
      ['Align self', 'alignSelf', 'stretch'],
      ['Flex wrap', 'flexWrap', 'wrap'],
      ['Flex direction', 'flexDirection', 'column'],
      ['Justify items', 'justifyItems', 'center'],
      ['Justify content', 'justifyContent', 'center'],
      ['Justify self', 'justifySelf', 'end'],
    ]

  /** Seeds a single styled node on the live canvas and selects it. */
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

  /**
   * Opens the accordion the way an author does. It starts collapsed, and a
   * collapsed MUI panel is hidden from the a11y tree — so every role query
   * below would answer "nothing pressed" for the wrong reason without this.
   */
  const openFlexbox = async () => {
    act(() => {
      fireEvent.click(screen.getByText('Flexbox & Grids'))
    })
    // The style-group field editors are code-split (next/dynamic).
    await act(async () => undefined)
  }

  const renderPanel = async (sx: Record<string, any>) => {
    const node = seedNode(sx)
    render(panel(node))
    await openFlexbox()
    return node
  }

  /** The control's own fieldset — label, buttons and helper line. */
  const control = (label: string) =>
    screen.getByText(label).closest('.MuiFormControl-root') as HTMLElement

  /** Which segment the control reports as chosen, or null. */
  const pressed = (label: string) =>
    within(control(label))
      .queryAllByRole('button', { pressed: true })
      .map((button) => button.getAttribute('value'))

  /** The `- <value>` the helper line prints under the control. */
  const readsBack = (label: string) =>
    (control(label).querySelector('b') as HTMLElement | null)?.textContent

  const click = (label: string, value: string) => {
    act(() => {
      fireEvent.click(
        within(control(label)).getByRole('button', {
          name: new RegExp(value.replace('-', '[- ]'), 'i'),
        }),
      )
    })
  }

  afterEach(() => Aglyn.canvas.reset())

  it('reads justifyContent back on the node that surfaced this', async () => {
    // The shipped Entry Meta node, verbatim.
    await renderPanel({ textAlign: 'center', justifyContent: 'center' })
    // Its sibling always worked — this is the control the asymmetry is
    // measured against, so it is asserted in the same breath.
    expect(pressed('Text Alignment')).toEqual(['center'])
    expect(pressed('Justify content')).toEqual(['center'])
    expect(readsBack('Justify content')).toBe('- center')
  })

  it('is the whole group, not one control', async () => {
    // The filed observation could only see `justifyContent`, because it was
    // the only key on that node the group owns. Author one of each and the
    // scope stops being a guess.
    await renderPanel(
      Object.fromEntries(
        CONTAINER_TOGGLES.map(([, key, value]) => [key, value]),
      ),
    )
    for (const [label, , value] of CONTAINER_TOGGLES) {
      expect([label, pressed(label)]).toEqual([label, [value]])
      expect([label, readsBack(label)]).toEqual([label, `- ${value}`])
    }
  })

  it('still says "not set" for a property the node really lacks', async () => {
    // The blank state has to keep meaning blank, or the fix trades a
    // false negative for a false positive.
    await renderPanel({ justifyContent: 'center' })
    expect(pressed('Align items')).toEqual([])
    expect(readsBack('Align items')).toBe('- not set')
  })

  it('overwrites the existing key rather than appending a second one', async () => {
    // The severity question. A duplicate key would render correctly and
    // corrupt the document, so this asserts the STORED map, not the render.
    const node = await renderPanel({
      textAlign: 'center',
      justifyContent: 'center',
    })
    click('Justify content', 'flex-end')
    expect(node.sx).toEqual({ textAlign: 'center', justifyContent: 'flex-end' })
    expect(Object.keys(node.sx as object)).toHaveLength(2)
    // And the control now reports what was actually stored.
    expect(readsBack('Justify content')).toBe('- flex-end')
  })

  it('re-reads when the selection moves to another node', async () => {
    // The same missing prop froze the toggles' local state: with nothing
    // to sync to, a segment pressed on one node stayed pressed over the
    // next one — the read-back lying in the other direction.
    const { rerender } = render(panel(seedNode({ justifyContent: 'center' })))
    await openFlexbox()
    expect(pressed('Justify content')).toEqual(['center'])

    Aglyn.canvas.setNodes({
      root: { $id: 'root', componentId: 'muiStack', nodes: ['plain'] },
      plain: { $id: 'plain', componentId: 'muiStack', parentId: 'root' },
    } as any)
    rerender(panel(Aglyn.canvas.getNode('plain') as Aglyn.NodeSchema))
    await act(async () => undefined)
    expect(pressed('Justify content')).toEqual([])
    expect(readsBack('Justify content')).toBe('- not set')
  })
})
