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

/** Marks the sizing stand-in, so it is findable and never mistaken for content. */
export const LAYOUT_GHOST_ATTR = 'data-aglyn-layout-ghost'

export interface InlineEditLayoutGhost {
  /** Re-size the document to `text`, painting nothing. */
  update(text: string): void
  /** Give the element its own text back. */
  dispose(): void
}

/**
 * Makes the surrounding layout track the text as it is typed (AGL-2486).
 *
 * Zach: *"When updating text the original allocated space is not reflecting
 * changes until after you click out"*. Editing a card heading that grew to
 * two lines, the editing surface overlapped the paragraph beneath it: the
 * card had not grown, the grid row had not grown, and the sibling cards had
 * not moved. Everything reflowed only on commit.
 *
 * That is what an overlay costs. A fixed-position surface contributes
 * nothing to layout, so the document keeps rendering the OLD text's geometry
 * while the new text is drawn on top of it — worst exactly where it matters
 * most, inside grids and cards where a heading gaining a line should push
 * its own card taller and its equal-height siblings with it.
 *
 * The fix is to keep a stand-in IN the document that carries the live text.
 * `<aglyn-text>` (the element's own text node holder) goes `display: none`,
 * and a hidden span in its place is sized by whatever the author has typed
 * so far. Nothing is painted twice — the ghost is `visibility: hidden` and
 * the overlay paints the only visible copy — but every box between the leaf
 * and the page now measures the new text, so the card grows, the row grows
 * and the siblings move, live.
 *
 * **Reflow is not commit, and they must stay different.** The ghost is DOM
 * only. It never touches the node, so the co-editing mirror (a mobx autorun
 * over the serialized node map) sees nothing, `saveHistory` records nothing,
 * and a keystroke stays a keystroke. Only the editor's single
 * `updateNodeProps` at commit reaches the store, the mirror and undo.
 *
 * **React safety.** Both mutations are the two React tolerates: an inline
 * style property React never set (it removes only properties it set itself),
 * and an extra child appended AFTER everything React rendered (the
 * reconciler positions by the nodes it owns, so a trailing stranger is not
 * in its way). Nothing React created is replaced or reparented.
 *
 * Returns `undefined` for the rich-text case — `props.html` renders straight
 * onto the leaf through `dangerouslySetInnerHTML` and there is no
 * `<aglyn-text>` to stand in for. That element keeps the plain hide, and its
 * layout still catches up on commit as it does today; a ghost there would
 * have to duplicate markup React owns, which is the one mutation that is not
 * safe.
 */
export function createInlineEditLayoutGhost(
  anchor: Element | undefined | null,
): InlineEditLayoutGhost | undefined {
  const text = anchor?.querySelector('aglyn-text') as HTMLElement | null
  if (!text || !text.parentElement) return undefined
  const host = text.parentElement

  const previousDisplay = text.style.getPropertyValue('display')
  const previousPriority = text.style.getPropertyPriority('display')

  const ghost = host.ownerDocument.createElement('span')
  ghost.setAttribute(LAYOUT_GHOST_ATTR, '')
  ghost.setAttribute('aria-hidden', 'true')
  // Hidden, not absent: the whole point is that it still takes up room.
  ghost.style.setProperty('visibility', 'hidden')
  // Everything else — font, wrapping, alignment — is inherited from the
  // element, which is what makes the ghost measure the same as the real run.
  ghost.textContent = text.textContent ?? ''

  host.appendChild(ghost)
  text.style.setProperty('display', 'none', 'important')

  let disposed = false
  return {
    update(next: string) {
      if (disposed) return
      ghost.textContent = next
    },
    dispose() {
      if (disposed) return
      disposed = true
      ghost.remove()
      if (previousDisplay) {
        text.style.setProperty('display', previousDisplay, previousPriority)
      } else {
        text.style.removeProperty('display')
      }
    },
  }
}
