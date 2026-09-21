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
import { act, fireEvent, render, screen } from '@testing-library/react'

import CustomCssForm, {
  resetPendingCustomCssDrafts,
} from './custom-css-form.component'

/**
 * The JSS (sx) tab says which records it is editing (AGL-3218).
 *
 * A node can hold TWO sx records — a `props.sx` its component or preset
 * authored, and its own `sx` — and the tab shows them merged while writing
 * only the difference back into `node.sx` (`writeComposedNodeSx`). Every
 * part of that is deliberate and none of it is visible: the caption said
 * "Full sx document", which is the one thing the box is not.
 *
 * The cost is paid outside the UI. Editing the aglyn.com footer band this
 * way put `rowGap` in `node.sx` while `props.sx` kept the three properties
 * the preset wrote; a check that read `props.sx` reported the edit as
 * missing, and the author has no way to learn otherwise from this panel.
 */
describe('CustomCssForm discloses a composed sx (AGL-3218)', () => {
  const seed = (node: Record<string, any>) => {
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes({
      root: { $id: 'root', componentId: 'muiStack', nodes: ['band'] },
      band: { $id: 'band', componentId: 'muiStack', parentId: 'root', ...node },
    } as any)
    return Aglyn.canvas.getNode('band') as Aglyn.NodeSchema
  }

  const openJss = () => {
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'JSS (sx)' }))
    })
  }

  /** The disclosure, matched on the claim that carries the whole point. */
  const notice = () =>
    screen.queryByText(/stores styles in two places/i)

  beforeEach(() => resetPendingCustomCssDrafts())
  afterEach(() => {
    Aglyn.canvas.reset()
    resetPendingCustomCssDrafts()
  })

  it('names the second record, and stops claiming to be the whole document', () => {
    const node = seed({
      props: { sx: { flexWrap: 'wrap', justifyContent: 'space-between' } },
      sx: { rowGap: { md: '40px' } },
    })
    render(<CustomCssForm node={node} breakpoint={null} />)
    openJss()

    expect(notice()).not.toBeNull()
    expect(notice()!.textContent).toContain('props.sx')
    expect(screen.queryByText(/Full sx document/)).toBeNull()
    expect(screen.queryByText(/The effective sx/)).not.toBeNull()
  })

  it('stays quiet for the ordinary node, which has one record', () => {
    // The control: nearly every node in the corpus is this one, and a
    // caption that always showed would be noise that teaches nothing.
    const node = seed({ sx: { rowGap: { md: '40px' } } })
    render(<CustomCssForm node={node} breakpoint={null} />)
    openJss()

    expect(notice()).toBeNull()
    expect(screen.queryByText(/Full sx document/)).not.toBeNull()
  })

  it('the box still shows BOTH records merged, which is what it describes', () => {
    // The disclosure is only true if the reading really is composed — if
    // this ever regressed to `node.sx` alone the caption would be a lie.
    const node = seed({
      props: { sx: { flexWrap: 'wrap' } },
      sx: { rowGap: { md: '40px' } },
    })
    render(<CustomCssForm node={node} breakpoint={null} />)
    openJss()

    const editor = (screen.getAllByRole('textbox') as HTMLTextAreaElement[])
      .find((el) => el.tagName === 'TEXTAREA')!
    const shown = JSON.parse(editor.value)
    expect(shown).toEqual({ flexWrap: 'wrap', rowGap: { md: '40px' } })
  })
})
