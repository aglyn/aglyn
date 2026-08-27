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
  hidden?: boolean
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

/**
 * The class list a node would carry with the hidden class added or removed.
 *
 * Returns the props object to assign, or `null` when nothing would change —
 * so a caller never writes an identical value and never puts a second copy of
 * the class on an element that already has one.
 *
 * Reads and writes `props.className` only. `node.className` is also consulted
 * when ASKING whether an element is hidden, because a component may
 * contribute one of its own, but that is the component's business and not a
 * value an author's toggle may edit.
 */
export function nodePropsWithHiddenOnSite(
  node: RevealNode,
  hidden: boolean,
): Record<string, unknown> | null {
  if (!node) return null
  const current = String(node.props?.['className'] ?? '')
    .split(/\s+/)
    .filter(Boolean)
  const has = current.includes(Aglyn.ELEMENT_HIDDEN_CLASS)
  if (has === hidden) return null
  const next = hidden
    ? [...current, Aglyn.ELEMENT_HIDDEN_CLASS]
    : current.filter((name) => name !== Aglyn.ELEMENT_HIDDEN_CLASS)
  const props: Record<string, unknown> = { ...(node.props ?? {}) }
  if (next.length) props['className'] = next.join(' ')
  else delete props['className']
  return props
}

/**
 * Whether an ANCESTOR already hides this node, so the published site never
 * renders it whatever its own class list says.
 *
 * The hierarchy dims a hidden layer and everything under it — a container
 * that does not ship takes its contents with it, and a full-strength child
 * row inside a dimmed parent reads as "this one still ships", which is the
 * opposite of true. Only the OUTERMOST hidden ancestor draws the dim: CSS
 * opacity multiplies through nesting, so letting each hidden level apply its
 * own would fade a panel inside a hidden drawer to near-invisible.
 */
export function isAncestorHiddenOnSite(node: RevealNode): boolean {
  let current = node?.parent
  while (current) {
    if (isNodeHiddenOnSite(current)) return true
    current = current.parent
  }
  return false
}


/**
 * Whether the AUTHOR has hidden this element (AGL-1479).
 *
 * The plain switch behind the eye on the hierarchy row: `display: none` on
 * the canvas and on the published site, with nothing that reveals it.
 * Deliberately not {@link isNodeHiddenOnSite}, which asks a different
 * question — "does this start hidden for an interaction to show" — about a
 * class that is part of a runtime contract.
 */
export function isNodeHiddenByAuthor(node: RevealNode): boolean {
  return Boolean(node?.hidden)
}

/**
 * Whether an ANCESTOR is hidden, by either switch, so the published site
 * never renders this node whatever its own state says.
 *
 * Replaces the class-only walk: an element inside a container the author hid
 * is exactly as absent as one inside a container that starts hidden, and the
 * hierarchy dims both the same way.
 */
export function isAncestorHidden(node: RevealNode): boolean {
  let current = node?.parent
  while (current) {
    if (isNodeHiddenByAuthor(current) || isNodeHiddenOnSite(current)) return true
    current = current.parent
  }
  return false
}
