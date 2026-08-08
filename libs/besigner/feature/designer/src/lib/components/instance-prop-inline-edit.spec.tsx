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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { inlineTextEdit } from '../utils/inline-text-edit.store'
import { findInstanceLeafAtPoint } from '../utils/instance-leaf-hit'
import InlineTextEditorComponent from './inline-text-editor.component'

/**
 * Chained round trip for the inline instance-prop edit (AGL-1304), in the
 * style of style-target.spec.ts: each seam has its own spec (the pure
 * hit-test in compose-reusable-components.spec, the DOM hit in
 * instance-leaf-hit.spec, the editor commit in
 * inline-text-editor.component.spec) — this one chains them on the REAL
 * app-level canvas so a drift between the layers cannot pass hop-by-hop:
 *
 * double-click hit-test → binding → inline editor commit on a live canvas
 * → one undo entry → per-node serialization delta (what AGL-677's
 * co-editing shadow diff mirrors) → toJSON → reload → compose renders the
 * new prop text → undo restores the component default.
 */
describe('double-click prop edit round trip (AGL-1304)', () => {
  const definition = {
    rootId: 'root',
    nodes: {
      root: { $id: 'root', componentId: 'muiStack', nodes: ['h'] },
      h: {
        $id: 'h',
        componentId: 'muiTypography',
        parentId: 'root',
        props: { children: '{{prop.headline}}' },
      },
    },
    props: [
      { name: 'headline', type: 'text', defaultValue: 'Headline goes here' },
    ],
  } as any

  /** The DOM shape NodeLeaf renders for the instance's inert preview. */
  function buildPreviewDom() {
    const container = document.createElement('div')
    container.innerHTML = `
      <div data-aglyn-component-preview="">
        <div data-aglyn="leaf:cmp__inst__root">
          <h1 data-aglyn="leaf:cmp__inst__h"></h1>
        </div>
      </div>`
    for (const [selector, rect] of [
      ['[data-aglyn="leaf:cmp__inst__root"]', { left: 0, top: 0, width: 400, height: 300 }],
      ['[data-aglyn="leaf:cmp__inst__h"]', { left: 20, top: 20, width: 360, height: 40 }],
    ] as const) {
      const el = container.querySelector(selector) as HTMLElement
      el.getBoundingClientRect = () =>
        ({
          ...rect,
          right: rect.left + rect.width,
          bottom: rect.top + rect.height,
          x: rect.left,
          y: rect.top,
          toJSON: () => rect,
        }) as DOMRect
    }
    return container
  }

  afterEach(() => {
    act(() => inlineTextEdit.close())
    Aglyn.canvas.reset()
  })

  it('an inline prop edit on a live canvas survives save and reload, renders composed, and undoes', async () => {
    // The document as loaded: an instance with NO overrides yet.
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes({
      [Aglyn.NODE_ROOT_ID]: {
        $id: Aglyn.NODE_ROOT_ID,
        type: Aglyn.NodeType.NODE,
        componentId: 'div',
        nodes: ['inst'],
      },
      inst: {
        $id: 'inst',
        type: Aglyn.NodeType.NODE,
        parentId: Aglyn.NODE_ROOT_ID,
        componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
        props: { refId: 'hero' },
        nodes: [],
      },
    } as any)
    expect(Aglyn.canvas.canUndo).toBe(false)
    const before = Object.fromEntries(
      Object.entries(Aglyn.canvas.toJSON().nodes as Record<string, unknown>).map(
        ([id, node]) => [id, JSON.stringify(node)],
      ),
    )

    // The double-click: geometric hit into the preview, then the pure
    // inverse mapping — exactly what DraggableDroppable does.
    const hit = findInstanceLeafAtPoint(buildPreviewDom(), 40, 30)
    expect(hit?.graftedId).toBe('cmp__inst__h')
    const binding = Aglyn.resolveInstanceLeafBinding(
      hit!.graftedId,
      'inst',
      definition,
    )
    expect(binding).toEqual({ componentInternalId: 'h', boundProp: 'headline' })

    // The inline editor, on the REAL canvas node, anchored on the leaf.
    const node = Aglyn.canvas.getNode('inst')!
    const rect = hit!.element.getBoundingClientRect()
    render(<InlineTextEditorComponent />)
    act(() =>
      inlineTextEdit.open(
        node,
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        {
          propName: binding!.boundProp!,
          initialText: Aglyn.getInstanceEffectivePropText(
            node.props,
            definition.props,
            binding!.boundProp!,
          ),
        },
      ),
    )
    const surface = await screen.findByRole('textbox', { name: 'Edit text' })
    // Opens with the text the author is looking at — the declared default.
    await waitFor(() => expect(surface.textContent).toBe('Headline goes here'))
    surface.textContent = 'Ship faster'
    fireEvent.keyDown(surface, { key: 'Enter' })

    // ONE undo entry, like any plain-node text edit.
    expect(Aglyn.canvas.canUndo).toBe(true)

    // The change rides the INSTANCE node — the per-node serialization
    // delta co-editing's shadow diff publishes (AGL-677) is exactly this
    // node and nothing else.
    const after = Object.fromEntries(
      Object.entries(Aglyn.canvas.toJSON().nodes as Record<string, unknown>).map(
        ([id, node]) => [id, JSON.stringify(node)],
      ),
    )
    expect(
      Object.keys(after).filter((id) => after[id] !== before[id]),
    ).toEqual(['inst'])

    // Save → reload into a FRESH canvas (the closed-and-reopened document
    // path; toJSON is the map both storage forms serialize) → compose.
    const saved = Aglyn.canvas.toJSON().nodes as Record<string, any>
    expect(saved['inst'].props.propValues).toEqual({ headline: 'Ship faster' })
    const reloaded = new Aglyn.CanvasManager(undefined as any)
    reloaded.setNodes(saved as any)
    const composed = Aglyn.composeReusableComponentNodes(
      reloaded.toJSON().nodes as any,
      { hero: definition },
    )
    expect(composed['cmp__inst__h'].props?.['children']).toBe('Ship faster')

    // Undo restores the prior prop value: the override is gone and the
    // graft renders the component's own copy again.
    Aglyn.canvas.undo()
    const reverted = Aglyn.composeReusableComponentNodes(
      Aglyn.canvas.toJSON().nodes as any,
      { hero: definition },
    )
    expect(reverted['cmp__inst__h'].props?.['children']).toBe(
      'Headline goes here',
    )
    expect(
      (Aglyn.canvas.toJSON().nodes as Record<string, any>)['inst'].props
        .propValues,
    ).toBeUndefined()
  })
})
