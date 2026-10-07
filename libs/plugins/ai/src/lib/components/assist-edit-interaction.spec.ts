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

/**
 * An interaction Assist adds (AGL-3603), client half, against the REAL
 * canvas: it lands on the element as an unsaved edit beside what the element
 * already does, never in place of it; an element a step acts on that has
 * gone since refuses the whole apply; and a full element is refused.
 */

import { canvas, CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn'
import { NODE_MAX_INTERACTIONS } from '@aglyn/aglyn/app-utils/node-interactions'
import {
  openEditorSession,
  registerEditorSession,
  resetEditorSessionsForTests,
} from '@aglyn/aglyn/plugin-manager/editor-sessions'
import { applyAssistEdit, type AssistEditCanvas } from './assist-edit-canvas'
import {
  ASSIST_EDIT_ACTION_ID,
  summarizeAssistEditOps,
  type AssistEditAddInteractionOp,
  type AssistEditProposal,
} from '../model/assist-edit'

const ROOT = CANVAS_ROOT_ELEMENT_ID
const EXISTING = { id: 'ai1', name: 'Hover', trigger: { event: 'elementHoverEnter' }, steps: [], enabled: true }
const PAGE = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['cta', 'panel'] },
  cta: { $id: 'cta', parentId: ROOT, componentId: 'muiButton', nodes: [], props: { children: 'Menu' }, interactions: [EXISTING] },
  panel: { $id: 'panel', parentId: ROOT, componentId: 'muiBox', nodes: [] },
}

const ADD: AssistEditAddInteractionOp = {
  op: 'addInteraction',
  nodeId: 'cta',
  componentId: 'muiButton',
  targets: [{ nodeId: 'panel', componentId: 'muiBox' }],
  interaction: {
    id: 'ai1',
    name: 'Toggle the panel',
    trigger: { event: 'elementClick', everyTime: true },
    steps: [{ type: 'toggleElement', selector: '[data-aglyn="leaf:panel"]' }],
    enabled: true,
  },
}

const proposalOf = (op: AssistEditAddInteractionOp = ADD): AssistEditProposal => ({
  id: ASSIST_EDIT_ACTION_ID,
  summary: 'Clicking Menu shows or hides the panel.',
  ops: [op],
  diff: summarizeAssistEditOps([op]),
  dropped: [],
  target: { kind: 'screen', documentId: 'screen-1', versionId: 'v-2', hostId: 'host-1' },
})

let unregister: () => void = () => undefined
beforeEach(() => {
  resetEditorSessionsForTests()
  canvas.reset()
  canvas.setNodes(PAGE as never)
  unregister = registerEditorSession({
    documentKind: 'screen',
    documentId: 'screen-1',
    versionId: 'v-2',
    isLiveVersion: () => false,
    selectedNodeId: () => 'cta',
  })
})
afterEach(() => {
  unregister()
  resetEditorSessionsForTests()
  canvas.reset()
})

const surface = () => canvas as unknown as AssistEditCanvas
const interactionsOf = (id: string) => (canvas.getNode(id) as any)?.interactions ?? []

describe('an interaction Assist adds', () => {
  it('lands beside what the element already does, re-minting an id it already uses', () => {
    const result = applyAssistEdit(surface(), proposalOf(), openEditorSession())
    expect(result).toEqual(expect.objectContaining({ ok: true, opCounts: { interaction: 1 } }))
    const after = interactionsOf('cta')
    expect(after).toHaveLength(2)
    expect(after[0]).toEqual(EXISTING)
    expect(after[1]).toEqual(expect.objectContaining({ name: 'Toggle the panel', trigger: { event: 'elementClick', everyTime: true } }))
    expect(after[1].id).not.toBe('ai1')
  })

  it('refuses the whole apply when an element a step acts on has gone', () => {
    canvas.deleteNode(canvas.getNode('panel') as never)
    const result = applyAssistEdit(surface(), proposalOf(), openEditorSession())
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'stale' }))
    expect(interactionsOf('cta')).toHaveLength(1)
  })

  it('refuses an element that already carries the most interactions it can', () => {
    const full = Array.from({ length: NODE_MAX_INTERACTIONS }, (_, index) => ({ ...EXISTING, id: `x${index}` }))
    canvas.updateNodeFields(canvas.getNode('cta') as never, { interactions: full })
    const result = applyAssistEdit(surface(), proposalOf(), openEditorSession())
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'refused' }))
    expect(interactionsOf('cta')).toHaveLength(NODE_MAX_INTERACTIONS)
  })
})
