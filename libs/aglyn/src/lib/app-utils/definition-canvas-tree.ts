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

import { CANVAS_ROOT_ELEMENT_ID } from '../foundation/constants/canvas'

type Nodes = Record<string, any>

/**
 * Adapt a reusable-component definition for the canvas, and back (AGL-680).
 *
 * The canvas requires its root to be the canonical `_@_` node — `setNodes`
 * stores whatever it is handed and `rootNode` looks up that exact id, so a
 * tree without it has no root and renders nothing.
 *
 * A definition's root is NOT `_@_`: `promoteToComponent` walks a selected
 * subtree, so the root is whichever node was selected. Loading one straight
 * into the canvas therefore produced an empty editor with "Error rendering
 * undefined" in the console — found by the editor smoke test, not by
 * typechecking, because both shapes are `Record<string, node>`.
 *
 * So the definition is wrapped under a synthetic canvas root on the way in
 * and unwrapped on the way out. The wrapper is never published: the tenant
 * runtime grafts from `rootId`, and an extra always-empty container in
 * every instance would be both wrong and wasteful.
 */
export function definitionToCanvasTree(definition: {
  rootId?: string
  nodes?: Nodes
}): Nodes {
  const nodes = definition?.nodes ?? {}
  // Already canvas-shaped (a tree saved by this editor) — leave it alone.
  if (nodes[CANVAS_ROOT_ELEMENT_ID]) return nodes

  const rootId =
    definition?.rootId && nodes[definition.rootId]
      ? definition.rootId
      : Object.keys(nodes).find((id) => !nodes[id]?.parentId)
  if (!rootId) return nodes

  return {
    ...nodes,
    [rootId]: { ...nodes[rootId], parentId: CANVAS_ROOT_ELEMENT_ID },
    [CANVAS_ROOT_ELEMENT_ID]: {
      $id: CANVAS_ROOT_ELEMENT_ID,
      componentId: 'box',
      parentId: null,
      nodes: [rootId],
    },
  }
}

/**
 * Recover the definition shape from a canvas tree.
 *
 * Returns the single child of the synthetic root as `rootId` and drops the
 * wrapper. A canvas root with several children means the author added
 * siblings at the top level — there is no single definition root to name,
 * so the wrapper is kept and reported, letting the caller refuse rather
 * than silently publishing only the first child.
 */
export function canvasTreeToDefinition(nodes: Nodes | undefined): {
  rootId?: string
  nodes: Nodes
  ambiguousRoot: boolean
} {
  const map = nodes ?? {}
  const canvasRoot = map[CANVAS_ROOT_ELEMENT_ID]
  if (!canvasRoot) {
    const rootId = Object.keys(map).find((id) => !map[id]?.parentId)
    return { rootId, nodes: map, ambiguousRoot: false }
  }

  const children: string[] = Array.isArray(canvasRoot.nodes)
    ? canvasRoot.nodes.filter((id: string) => map[id])
    : []
  if (children.length !== 1) {
    return {
      rootId: CANVAS_ROOT_ELEMENT_ID,
      nodes: map,
      ambiguousRoot: true,
    }
  }

  const rootId = children[0]
  const stripped: Nodes = {}
  for (const [id, node] of Object.entries(map)) {
    if (id === CANVAS_ROOT_ELEMENT_ID) continue
    stripped[id] = id === rootId ? { ...node, parentId: null } : node
  }
  return { rootId, nodes: stripped, ambiguousRoot: false }
}
