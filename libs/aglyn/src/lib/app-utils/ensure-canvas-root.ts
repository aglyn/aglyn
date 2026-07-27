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
 * Guarantee the canvas gets a root (AGL-931).
 *
 * `setNodes` stores whatever it is handed and `rootNode` looks up
 * `_@_` exactly, so a map without it leaves the editor with no root: the
 * hierarchy renders 'Invalid node' and Add Element is disabled. That is not
 * merely an empty editor — it is one with no way out, so the document can
 * never be repaired from the UI. AGL-753 hit this with a component stored as
 * `nodes: {}`; screens and layouts had no equivalent guard at all.
 *
 * A rootless map keeps its content rather than being replaced: every node
 * with no resolvable parent is adopted by the synthetic root. Recovering
 * into an editable document beats discarding what is there, and for a screen
 * or layout the result is the shape it should have had all along.
 *
 * Deliberately NOT `definitionToCanvasTree`: that one is about the
 * definition shape, where a single promoted root is wrapped and unwrapped
 * again on publish. This is the shared floor under every editor.
 */
export function ensureCanvasRoot(nodes: Nodes | undefined): Nodes {
  const map = nodes ?? {}
  if (map[CANVAS_ROOT_ELEMENT_ID]) return map

  // A parent that is not itself in the map is no parent — that node is as
  // much a root as one with no `parentId` at all.
  const roots = Object.keys(map).filter(
    (id) => !map[id]?.parentId || !map[map[id].parentId],
  )

  return {
    ...Object.fromEntries(
      Object.entries(map).map(([id, node]) => [
        id,
        roots.includes(id) ? { ...node, parentId: CANVAS_ROOT_ELEMENT_ID } : node,
      ]),
    ),
    [CANVAS_ROOT_ELEMENT_ID]: {
      $id: CANVAS_ROOT_ELEMENT_ID,
      componentId: 'div',
      parentId: null,
      nodes: roots,
    },
  }
}

export default ensureCanvasRoot
