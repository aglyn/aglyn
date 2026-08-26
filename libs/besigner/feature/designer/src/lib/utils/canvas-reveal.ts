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
import * as Besigner from '@aglyn/besigner'

/**
 * Canvas visibility for elements that start hidden on the published site
 * (AGL-592).
 *
 * An element carrying {@link Aglyn.ELEMENT_HIDDEN_CLASS} — a mega-menu panel,
 * a drawer, anything an interaction reveals at runtime — is `display: none`
 * on the live page from the first paint. The canvas hides it too, so what an
 * author sees matches what a visitor sees, and then reveals it on demand so
 * it can be designed.
 *
 * The decision is made HERE, in JS, and stamped on the element itself rather
 * than expressed as a relationship between elements in a selector. A rule
 * that hides `.aglyn-hidden` unless a marker sits on its DOM PARENT depends
 * on the rendered tree matching the node tree one-for-one, which it does not:
 * any component whose render wraps its children puts a wrapper between the
 * marked element and the hidden one, and the reveal silently stops matching.
 * A flag on the hidden element cannot come apart that way.
 */

/** Node shape these helpers read; the canvas node class satisfies it. */
type RevealNode = {
  $id?: string
  className?: string
  props?: Record<string, unknown>
  parent?: RevealNode
} | null

/** The class names a node contributes to its rendered element. */
function nodeClassNames(node: RevealNode): string[] {
  return [node?.props?.['className'], node?.className]
    .filter((value): value is string => typeof value === 'string')
    .flatMap((value) => value.split(/\s+/))
    .filter(Boolean)
}

/**
 * Whether a node starts hidden on the published site — the state the eye
 * affordance in the hierarchy reports and the canvas reveal overrides.
 */
export function isNodeHiddenOnSite(node: RevealNode): boolean {
  return nodeClassNames(node).includes(Aglyn.ELEMENT_HIDDEN_CLASS)
}

/**
 * Whether the canvas shows a hidden node right now.
 *
 * Two ways in, and both are canvas-only:
 *
 * - the author turned it on from the hierarchy, so its id sits in
 *   `revealedNodeIds`;
 * - the selection is inside the node's PARENT — the wrapper, the trigger
 *   beside it, the node itself or anything within it — which reveals a panel
 *   for as long as it is being worked on without asking for a click.
 *
 * The selection path stops at the parent rather than walking further up
 * because every node is inside the root: a check against an ancestor would
 * show every hidden element on the page the moment anything was selected. A
 * node whose parent IS the root falls back to its own subtree for the same
 * reason.
 */
export function isNodeRevealedOnCanvas(
  node: RevealNode,
  revealedNodeIds?: readonly string[],
): boolean {
  if (!node) return false
  if (revealedNodeIds?.some((id) => id === node.$id)) return true
  const parent = node.parent
  const scope = parent && parent.$id !== Aglyn.NODE_ROOT_ID ? parent : node
  return Besigner.focus.isNodeOrDescendantSelected(scope as never)
}

/**
 * The reveal list with one node flipped. Returns a new array so the flag's
 * subscribers see a changed value, and never mutates the one passed in.
 */
export function toggleRevealedNodeId(
  revealedNodeIds: readonly string[] | undefined,
  nodeId: string,
): string[] {
  const current = revealedNodeIds ?? []
  return current.some((id) => id === nodeId)
    ? current.filter((id) => id !== nodeId)
    : [...current, nodeId]
}
