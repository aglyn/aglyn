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
 * What the Attributes panel tells a host section about the selection
 * (AGL-2908), against the REAL drag manager rather than a double of it — a
 * double would only prove the helper calls something.
 *
 * `editable` has to be the same answer the panel's own in-place actions are
 * drawn under. If the two ever drift, a host section offers to change an
 * element the editor will not let it change, and the refusal arrives after
 * the person has asked for the work.
 */

import * as Besigner from '@aglyn/besigner'
import { NODE_ROOT_ID } from '@aglyn/aglyn/canvas-manager/canvas-manager'
import { FEATURE_FLAG } from '@aglyn/aglyn/foundation/constants/shared'
import { NodeType } from '@aglyn/aglyn/types/nodes'
import { besignerInspected } from './inspected-selection'
import type { BesignerInspected } from './inspector-extras-context'

type Node = BesignerInspected['node']

const nodeOf = (patch: Record<string, unknown>): Node =>
  ({ $id: 'node-1', componentId: 'div', type: NodeType.NODE, ...patch }) as unknown as Node

/** An ordinary element: its schema allows dragging, so the panel offers its actions. */
const DRAGGABLE = nodeOf({
  componentSchema: { flags: { dragging: FEATURE_FLAG.ENABLED } },
})

/** Locked layout chrome: the same element, with dragging refused by its schema. */
const LOCKED = nodeOf({
  $id: 'node-locked',
  componentSchema: { flags: { dragging: FEATURE_FLAG.DISABLED } },
})

/** The canvas root, which is the document rather than an element in it. */
const ROOT = nodeOf({ $id: NODE_ROOT_ID })

describe('besignerInspected (AGL-2908)', () => {
  it('carries the node it was given, and nothing else about the editor', () => {
    expect(besignerInspected(DRAGGABLE)).toEqual({ node: DRAGGABLE, editable: true })
    expect(Object.keys(besignerInspected(DRAGGABLE) ?? {}).sort()).toEqual(['editable', 'node'])
  })

  it('answers the drag manager’s rule, element for element', () => {
    for (const node of [DRAGGABLE, LOCKED, ROOT]) {
      expect([node.$id, besignerInspected(node)?.editable]).toEqual([
        node.$id,
        Besigner.dnd.canDragNode(node as never),
      ])
    }
  })

  it('refuses the canvas root and locked chrome, and admits an ordinary element', () => {
    // ANTI-VACUITY: the three fixtures do not all answer the same way.
    expect(besignerInspected(DRAGGABLE)?.editable).toBe(true)
    expect(besignerInspected(LOCKED)?.editable).toBe(false)
    expect(besignerInspected(ROOT)?.editable).toBe(false)
  })

  it('has nothing to say about an empty selection', () => {
    expect(besignerInspected(null)).toBeNull()
    expect(besignerInspected(undefined)).toBeNull()
  })
})
