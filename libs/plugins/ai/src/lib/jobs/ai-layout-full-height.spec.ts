/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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

import { validateAiDoctrineTree } from '../runtime/ai-doctrine-validators'
import { AI_LAYOUT_FRAME_ID, aiLayoutWithFullHeight } from './ai-layout-full-height'

/** A header, the slot inside a main wrapper, a footer: what a model answers with. */
const LAYOUT = {
  rootId: 'root',
  nodes: {
    root: { componentId: 'div', nodes: ['header', 'body', 'footer'] },
    header: { componentId: 'muiAppBar', props: { position: 'sticky' }, nodes: ['bar'] },
    bar: { componentId: 'muiToolbar', nodes: ['brand'] },
    brand: { componentId: 'muiTypography', props: { variant: 'h6', component: 'p', children: 'Hillside Dog Grooming' } },
    body: { componentId: 'muiBox', sx: { bgcolor: 'background.default' }, nodes: ['slot'] },
    slot: { componentId: 'layoutSlot' },
    footer: { componentId: 'section', props: { element: 'footer' }, nodes: ['line'] },
    line: { componentId: 'muiTypography', props: { variant: 'body2', children: 'Gentle grooming in Austin.' } },
  },
}

type Tree = { rootId: string; nodes: Record<string, { componentId: string; sx?: Record<string, unknown>; nodes?: string[] }> }

describe('a layout at least as tall as the window (AGL-3596)', () => {
  it('puts the layout in a full-height column whose slot-holding part takes the room left, so a short page keeps its footer at the bottom', () => {
    const tree = aiLayoutWithFullHeight(LAYOUT) as Tree
    expect(tree.nodes['root'].nodes).toEqual([AI_LAYOUT_FRAME_ID])
    expect(tree.nodes[AI_LAYOUT_FRAME_ID]).toEqual({
      componentId: 'muiStack',
      sx: { minHeight: '100vh' },
      nodes: ['header', 'body', 'footer'],
    })
    expect(tree.nodes['body'].sx).toEqual({ bgcolor: 'background.default', flexGrow: 1 })
    expect(tree.nodes['header'].sx).toBeUndefined()
    // Held by the layout doctrine like any other node.
    expect(validateAiDoctrineTree(tree, 'layout', {}).violations).toEqual([])
  })

  it('leaves a layout that already sets its height, holds no slot, or is no node map as it came', () => {
    const framed = aiLayoutWithFullHeight(LAYOUT)
    expect(aiLayoutWithFullHeight(framed)).toBe(framed)
    const slotless = { rootId: 'root', nodes: { root: { componentId: 'div', nodes: ['line'] }, line: LAYOUT.nodes.line } }
    expect(aiLayoutWithFullHeight(slotless)).toBe(slotless)
    expect(aiLayoutWithFullHeight('not a tree')).toBe('not a tree')
  })
})
