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

/** Marks the element currently being edited in place, for tests and probes. */
export const IN_PLACE_EDITING_ATTR = 'data-aglyn-editing'

export interface InPlaceEditSurface {
  /** The element the author is typing into — the canvas leaf itself. */
  readonly element: HTMLElement
  /** The selection root to ask for the caret; see {@link selectionOf}. */
  readonly selection: () => Selection | null
  /** Ends the edit and gives the element back to React, untouched. */
  dispose(): void
}

/**
 * The caret, across a CLOSED shadow root.
 *
 * The canvas renders into `mode="closed"` (`viewport-frame.component.tsx`),
 * so `document.getSelection()` cannot see a caret inside it — it retargets to
 * the host, and `host.shadowRoot` is null from outside. What still works is
 * that a node INSIDE the tree can always reach its own root:
 * `Node.getRootNode()` returns the `ShadowRoot` whatever its mode, and Chrome
 * implements `ShadowRoot.getSelection()`. So the caret is readable as long as
 * you ask from an element that is already in there — which the edited leaf
 * is.
 *
 * Falls back to the document selection for a light-DOM element and for
 * engines without the non-standard accessor, so this is never the reason an
 * edit fails.
 */
export function selectionOf(element: Node): Selection | null {
  const root = element.getRootNode() as Document | ShadowRoot
  const scoped = root as { getSelection?: () => Selection | null }
  if (typeof scoped.getSelection === 'function') return scoped.getSelection()
  if (typeof document !== 'undefined') return document.getSelection()
  return null
}

/**
 * Turns the canvas leaf ITSELF into the editing surface (AGL-2486).
 *
 * No don't go back to the inlined boxed
 * editor, just finish the project. He is right, and so is the reason the
 * fallback existed: an overlay is a rectangle, the thing it stands in for is
 * a flow of line boxes, and those two geometries can always disagree. Every
 * bug in this area — the surface wrapping before the element did, the
 * reserved space not growing, an inline run overflowing onto its sibling —
 * is one instance of that disagreement.
 *
 * Editing the element directly does not solve the geometry problem; it
 * deletes it. There is no second rectangle to keep in sync, so the text
 * cannot move, resize or restyle when editing begins, the surrounding layout
 * re-flows because the real element really did grow, and the
 * transparent-if-and-only-if-reserved invariant is satisfied by construction
 * rather than by a check. The sizing ghost this replaces is no longer needed
 * for the same reason.
 *
 * ## Living with React
 *
 * The leaf's children are React's. `contentEditable` hands the same subtree
 * to the browser, which will split, merge and delete those nodes as the
 * author types — so the two owners have to be separated for the duration.
 *
 * The separation is the same one the layout ghost used, and it is the whole
 * trick: the original child nodes are PARKED BY REFERENCE, not serialized.
 * Editing happens on a fresh subtree; on dispose the parked nodes — the very
 * same objects — go back under the very same parent. React's fibers still
 * point at live nodes in their expected places, so a later update or unmount
 * finds what it is looking for instead of throwing `NotFoundError` on a node
 * that was replaced by an equal-looking copy.
 *
 * While the edit is open nothing writes to the store, so React has no reason
 * to reconcile this subtree at all: `props.children` does not change, and a
 * re-render for an unrelated reason (hover, selection) leaves an unchanged
 * text child alone. The single `updateNodeProps` at commit is the only
 * crossing, exactly as it is for the rest of this editor.
 *
 * `contentEditable` is set as a DOM property rather than through React, so a
 * re-render cannot clear it: React only removes properties it set itself.
 */
export function beginInPlaceEdit(
  anchor: Element | undefined | null,
  build: (surface: HTMLElement) => void,
): InPlaceEditSurface | undefined {
  const element = anchor as HTMLElement | null | undefined
  if (!element || typeof element.style !== 'object') return undefined
  if (!element.isConnected || !element.ownerDocument) return undefined

  // Same objects, kept alive off-tree — see "Living with React".
  const parked = Array.from(element.childNodes)
  const previousEditable = element.getAttribute('contenteditable')

  while (element.firstChild) element.removeChild(element.firstChild)
  try {
    build(element)
  } catch {
    // A failed build must not leave the leaf empty on the canvas.
    while (element.firstChild) element.removeChild(element.firstChild)
    for (const child of parked) element.appendChild(child)
    return undefined
  }

  element.setAttribute(IN_PLACE_EDITING_ATTR, '')
  // The ATTRIBUTE, not the property: the property is what a browser reflects
  // from it, and setting it alone leaves nothing for a non-browser DOM (or a
  // serializer, or a test) to see.
  element.setAttribute('contenteditable', 'true')
  element.spellcheck = true

  let disposed = false
  return {
    element,
    selection: () => selectionOf(element),
    dispose() {
      if (disposed) return
      disposed = true
      element.removeAttribute(IN_PLACE_EDITING_ATTR)
      // `removeAttribute`, not `contentEditable = 'false'`: an explicit
      // `false` would override an editable ancestor, which the element did
      // not do before this edit.
      if (previousEditable === null) {
        element.removeAttribute('contenteditable')
      } else {
        element.setAttribute('contenteditable', previousEditable)
      }
      while (element.firstChild) element.removeChild(element.firstChild)
      for (const child of parked) element.appendChild(child)
    },
  }
}
