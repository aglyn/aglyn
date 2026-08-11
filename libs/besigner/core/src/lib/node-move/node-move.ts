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
import {
  confirmValidLinealRelationship,
  describeInvalidLinealRelationship,
  type LinealItem,
} from '../dnd-manager/confirm-valid-lineal-relationship'

/**
 * Moving an existing node between containers by CLICKING (AGL-1405).
 *
 * Until this existed, every reparent in the editor went through one gesture —
 * drag-and-drop — and a node that ended up in the wrong container could only
 * be rescued through the Raw JSON editor. That is not a repair path a
 * click-built workflow can use at all, and AGL-1388 made it matter: the
 * moment a component starts REFUSING children, everything already inside one
 * is stranded with no way out.
 *
 * Two actions are enough to reach anywhere in the tree, because the hierarchy
 * already has Shift up / Shift down:
 *
 *   - `moveNodeOut` lifts a node out of its container, landing it just after
 *     that container among its aunts and uncles.
 *   - `moveNodeIn` tucks a node into the sibling directly above it.
 *
 * Out, shift, in. Both refuse — rather than strand — anything the renderer
 * could not draw, which is the entire reason the /press screenshots are
 * stuck: `nodeAcceptsChildren` and the lineal rules are checked BEFORE
 * anything is written, exactly as `pasteInto` checks them.
 */

/**
 * A plain result object rather than a discriminated union, matching
 * `PasteResult`: an `ok: true | false` union stops narrowing once it crosses
 * a library boundary. Callers test `error`.
 */
export interface MoveResult {
  /** The moved node — absent when `error` is set and nothing was written. */
  node?: Aglyn.NodeSchema<any>
  /** Set when the move was refused, explaining why. */
  error?: string
}

/** Where a move would land, or why it is not offered. */
interface MoveTarget {
  parent?: Aglyn.NodeSchema<any>
  index?: number
  error?: string
}

function linealActor(node: Aglyn.NodeSchema<any>): LinealItem {
  return {
    pluginId: node?.pluginId,
    componentId: node?.componentId,
    restrictChildren: node?.componentSchema?.restrictChildren,
    restrictParent: node?.componentSchema?.restrictParent,
  }
}

/**
 * The shared refusal set. `nodeAcceptsChildren` is the AGL-1388 gate — a
 * `markdown` block, a Reusable Component instance, a Layout Slot, a List Item
 * Text or any leaf renders its own content and nothing else, so a node moved
 * inside one is saved forever and drawn never. The lineal rules are the
 * placement rules drag-and-drop and paste already enforce; skipping them here
 * would let a click build an arrangement a drag then (correctly) refuses.
 */
function confirmTarget(
  node: Aglyn.NodeSchema<any>,
  parent: Aglyn.NodeSchema<any>,
  index: number,
): MoveTarget {
  if (!Aglyn.canvas.nodeAcceptsChildren(parent)) {
    return { error: `${parent.labelShort} can't hold other elements` }
  }
  const item = linealActor(node)
  const into = linealActor(parent)
  const [valid, reason] = confirmValidLinealRelationship(item, into)
  if (!valid) {
    return { error: describeInvalidLinealRelationship(item, into, reason) }
  }
  return { parent, index }
}

/**
 * Resolve "Move out of container": the node becomes the next sibling of the
 * container it is currently in.
 *
 * Landing it right AFTER its old parent rather than appending to the
 * grandparent keeps the node where the author is looking — the /press images
 * belong beside their markdown block, not at the bottom of the section.
 */
export function resolveMoveOut(node: Aglyn.NodeSchema<any>): MoveTarget {
  if (!node || Aglyn.canvas.isRootNode(node)) {
    return { error: 'There is nothing to move' }
  }
  const parent = node.parent
  if (!parent) return { error: 'This element has no container' }
  if (Aglyn.canvas.isRootNode(parent)) {
    return { error: 'This element is already at the top level' }
  }
  const grandparent = parent.parent
  if (!grandparent) return { error: 'This element is already at the top level' }

  const at = Aglyn.canvas.getNodeIndex(parent)
  return confirmTarget(node, grandparent, at > -1 ? at + 1 : NaN)
}

/**
 * Resolve "Move into previous": the node is appended to the sibling directly
 * above it. The inverse of `resolveMoveOut`, and the half that lets a click
 * put something INTO a container rather than only lift it out.
 */
export function resolveMoveIn(node: Aglyn.NodeSchema<any>): MoveTarget {
  if (!node || Aglyn.canvas.isRootNode(node)) {
    return { error: 'There is nothing to move' }
  }
  const parent = node.parent
  if (!parent) return { error: 'This element has no container' }

  const at = Aglyn.canvas.getNodeIndex(node)
  if (at < 1) return { error: 'There is no element above this one' }
  const previous = Aglyn.canvas.getNode(parent.nodes?.[at - 1])
  if (!previous) return { error: 'There is no element above this one' }

  // NaN appends, so the node lands at the end of its new container — where
  // it reads as "the last thing added", matching the Insert menu.
  return confirmTarget(node, previous, NaN)
}

function apply(target: MoveTarget, node: Aglyn.NodeSchema<any>): MoveResult {
  if (target.error) return { error: target.error }
  // `reparentNode`, not delete-and-recreate: the node keeps its id, its
  // subtree and its place in history (`deleteNode` recurses over the whole
  // subtree, so rebuilding would re-mint every id beneath it and break any
  // interaction that referenced one).
  return { node: Aglyn.canvas.reparentNode(node, target.parent!, target.index) }
}

/** Lift `node` out of its container, landing it just after that container. */
export function moveNodeOut(node: Aglyn.NodeSchema<any>): MoveResult {
  return apply(resolveMoveOut(node), node)
}

/** Tuck `node` into the sibling directly above it. */
export function moveNodeIn(node: Aglyn.NodeSchema<any>): MoveResult {
  return apply(resolveMoveIn(node), node)
}

/** Whether the action is offered at all — for a menu item's `disabled`. */
export function canMoveNodeOut(node: Aglyn.NodeSchema<any>): boolean {
  return !resolveMoveOut(node).error
}

/** Whether the action is offered at all — for a menu item's `disabled`. */
export function canMoveNodeIn(node: Aglyn.NodeSchema<any>): boolean {
  return !resolveMoveIn(node).error
}
