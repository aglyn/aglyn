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

// A `canvas` for `apply-page-copy.js` backed by a stored `nodes` map instead
// of by the besigner (AGL-2920), so the applier can run where the editor
// cannot — see `pour-page.mjs` for why that is necessary.
//
// Its own file so that `pour-page.mjs` and `verify-pour-canvas.mjs` share ONE
// implementation. The applier already learned that lesson the expensive way:
// a rule written down twice is a rule that drifts.

export const CANVAS_ROOT_ELEMENT_ID = '_@_'

/**
 * `AglynNodeSchema.nodes` is `NodeId[] | AglynNodeSchema[]` — a stored
 * document may hold its children as ids (normalized) or inline (denormalized),
 * and both are valid.
 *
 * The applier walks with `for (const kid of node.nodes ?? []) getNode(kid)`,
 * so an inline child arrives here as the node OBJECT rather than as a key. A
 * lookup that only handled strings would return `undefined` for every child of
 * a denormalized document, the walk would find zero text nodes, and the slot
 * assertion would report a count mismatch — a shape problem wearing a copy
 * problem's clothes. So resolve both, and let the count assertion speak only
 * about real mismatches.
 */
export function firestoreCanvas(nodes) {
  const state = { writes: 0 }
  const canvas = {
    getNode(ref) {
      if (ref && typeof ref === 'object') return ref
      return nodes[ref]
    },
    saveHistory() {},
    /**
     * The real CanvasManager REPLACES the prop bag rather than merging into it
     * (AGL-1227). The applier spreads the existing props itself; modelling the
     * replace here is what keeps that spread load-bearing off the editor too —
     * a merging stub would let a regression through silently.
     */
    updateNodeProps(node, props) {
      node.props = { ...props }
      state.writes += 1
    },
  }
  return { canvas, state }
}
