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

import type { AglynNodeSchema, NodeId } from '../foundation'
import { NODE_ROOT_ID } from '../canvas-manager/canvas-manager'
import { LAYOUT_SLOT_COMPONENT_ID } from './compose-layout-nodes'

/**
 * WHERE A PUBLISHED PAGE'S `main` LANDMARK GOES (AGL-2486).
 *
 * The tenant root layout used to wrap every document in one `<main>`. That
 * guaranteed the landmark existed, and put the site nav and the site footer
 * INSIDE it — which is the one thing `main` is defined as excluding, and it
 * makes "skip to content" skip to the top of the chrome it was meant to skip.
 * It also made `main` unofferable anywhere else: the Section element picker
 * and the author-HTML allowlist both drop it, because a second `main` is
 * worse than none, and the root layout already owned the first.
 *
 * So the landmark moves to the region it names, and composition decides where
 * that is:
 *
 * 1. An element the AUTHOR chose wins. The Document layer and the Layout Slot
 *    both offer an HTML-element picker; if either says `main`, that is the
 *    landmark. When both do, the OUTER one keeps it and the inner is demoted
 *    to a plain container — the invariant is one per document, and silently
 *    shipping two is the failure this whole rule exists to prevent.
 * 2. Otherwise the slot takes it, because a layout's slot is by construction
 *    "the page content between the chrome".
 * 3. With no layout there is no slot, so the screen's own root takes it.
 *
 * The screens that do NOT compose author nodes — the root error and
 * not-found boundaries — carry their own; see `StatusScreenPlain` and
 * `SiteStatusScreen`.
 *
 * Inputs are never mutated.
 */
export const DOCUMENT_LANDMARK_ELEMENT = 'main'

/** What a node renders as when it is not the landmark. */
const PLAIN_ELEMENT = 'div'

/**
 * The element a node was told to render as. `component`, the name Box and
 * Typography already use for it — Section's `element` is the outlier, and it
 * cannot mint a `main` anyway.
 */
const elementOf = (node: AglynNodeSchema | undefined): string =>
  String((node?.props as { component?: unknown } | undefined)?.component ?? '')

/** Assign the document's single `main` landmark. See the module comment. */
export function stampDocumentLandmark<
  N extends AglynNodeSchema = AglynNodeSchema,
>(nodes: Record<NodeId, N>): Record<NodeId, N> {
  if (!nodes) return nodes
  const slotId = Object.keys(nodes).find(
    (id) => nodes[id]?.componentId === LAYOUT_SLOT_COMPONENT_ID,
  )
  const rootId = nodes[NODE_ROOT_ID] ? NODE_ROOT_ID : undefined
  // Nothing to hang it on. A tree with neither is not a page — an empty
  // fragment, a preview of one subtree — and inventing a landmark for it
  // would be the duplicate this function exists to prevent.
  if (!slotId && !rootId) return nodes

  const rootDeclares = rootId ? elementOf(nodes[rootId]) === 'main' : false
  const slotDeclares = slotId ? elementOf(nodes[slotId]) === 'main' : false

  // Outermost author choice first, then the first node that has not already
  // been given an element: a slot an author deliberately made a `section`
  // keeps it, and the landmark falls to the root rather than overruling them.
  // When both were chosen away from `main`, the page ships without one — the
  // author said so twice, and quietly reinstating it would make the picker a
  // suggestion rather than a choice.
  const landmarkId = rootDeclares
    ? rootId
    : slotDeclares
      ? slotId
      : slotId && !elementOf(nodes[slotId])
        ? slotId
        : rootId && !elementOf(nodes[rootId])
          ? rootId
          : undefined
  // Exactly one: an author who put `main` on both the Document layer and the
  // slot gets the outer one, and the inner renders as a plain container.
  const demoteId =
    rootDeclares && slotDeclares ? slotId : undefined

  const next: Record<NodeId, N> = { ...nodes }
  if (landmarkId && elementOf(next[landmarkId]) !== DOCUMENT_LANDMARK_ELEMENT) {
    next[landmarkId] = {
      ...next[landmarkId],
      props: {
        ...(next[landmarkId].props as object),
        component: DOCUMENT_LANDMARK_ELEMENT,
      },
    } as N
  }
  if (demoteId) {
    next[demoteId] = {
      ...next[demoteId],
      props: { ...(next[demoteId].props as object), component: PLAIN_ELEMENT },
    } as N
  }
  return next
}

export default stampDocumentLandmark
