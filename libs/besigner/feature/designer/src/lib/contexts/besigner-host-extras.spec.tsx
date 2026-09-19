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

import { render, screen } from '@testing-library/react'
import {
  BesignerInspectorExtrasContext,
  inspectorExtrasFor,
  useBesignerInspectorExtras,
  type BesignerInspected,
} from './inspector-extras-context'
import {
  BesignerToolbarExtrasContext,
  useBesignerToolbarExtras,
} from './toolbar-extras-context'

function ToolbarProbe() {
  return <div data-testid="toolbar">{useBesignerToolbarExtras()}</div>
}

function PanelProbe(props: BesignerInspected) {
  return <div data-testid="panel">{inspectorExtrasFor(useBesignerInspectorExtras(), props)}</div>
}

const node = { $id: 'node-1', componentId: 'text' } as unknown as BesignerInspected['node']

describe('the host app’s besigner sections (AGL-2984)', () => {
  it('the toolbar draws what the host supplies, and nothing without a host', () => {
    const { unmount } = render(<ToolbarProbe />)
    expect(screen.getByTestId('toolbar').textContent).toBe('')
    unmount()
    render(
      <BesignerToolbarExtrasContext.Provider value={<button>{'Check contrast'}</button>}>
        <ToolbarProbe />
      </BesignerToolbarExtrasContext.Provider>,
    )
    expect(screen.getByRole('button', { name: 'Check contrast' })).toBeTruthy()
  })

  it('the panel hands a function section the selected element', () => {
    const drawn: string[] = []
    render(
      <BesignerInspectorExtrasContext.Provider
        value={(inspected) => {
          drawn.push(inspected.node.$id)
          return <span>{`section for ${inspected.node.$id}`}</span>
        }}
      >
        <PanelProbe node={node} editable />
      </BesignerInspectorExtrasContext.Provider>,
    )
    expect(screen.getByText('section for node-1')).toBeTruthy()
    expect(drawn).toEqual(['node-1'])
  })

  it('the panel hands it whether this editor may change that element (AGL-2908)', () => {
    const seen: boolean[] = []
    const section = (inspected: BesignerInspected) => {
      seen.push(inspected.editable)
      return <span>{inspected.editable ? 'may edit' : 'read only'}</span>
    }
    const { rerender } = render(
      <BesignerInspectorExtrasContext.Provider value={section}>
        <PanelProbe node={node} editable />
      </BesignerInspectorExtrasContext.Provider>,
    )
    expect(screen.getByText('may edit')).toBeTruthy()
    rerender(
      <BesignerInspectorExtrasContext.Provider value={section}>
        <PanelProbe node={node} editable={false} />
      </BesignerInspectorExtrasContext.Provider>,
    )
    expect(screen.getByText('read only')).toBeTruthy()
    expect(seen).toEqual([true, false])
  })

  it('a node section is drawn as it is', () => {
    expect(inspectorExtrasFor(<em>{'plain'}</em>, { node, editable: true })).toEqual(
      <em>{'plain'}</em>,
    )
    expect(inspectorExtrasFor(null, { node, editable: false })).toBeNull()
  })
})
