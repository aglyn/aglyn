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

/** Marks the parked original content of a rich-text leaf. */
export const LAYOUT_GHOST_HOLDER_ATTR = 'data-aglyn-layout-parked'

export interface InlineEditLayoutGhost {
  /** Re-size the document to what `surface` currently holds, painting nothing. */
  update(surface: HTMLElement): void
  /** Give the element its own text back. */
  dispose(): void
}

/**
 * Makes the surrounding layout track the text as it is typed (AGL-2486).
 *
 * Zach: *"When updating text the original allocated space is not reflecting
 * changes until after you click out"*, and then *"The reserved space is
 * still not updating as we are editing text live"* — the second time with
 * two texts drawn over each other, an overflowing `presence.` sharing pixels
 * with the sibling `One canvas.`
 *
 * That is what an overlay costs. A fixed-position surface contributes
 * nothing to layout, so the document keeps rendering the OLD text's geometry
 * while the new text is drawn on top of it. The fix is to keep a stand-in IN
 * the document carrying the live text: the element's own content leaves the
 * layout and a hidden span in its place is sized by whatever has been typed
 * so far. Nothing is painted twice — the ghost is `visibility: hidden` and
 * the overlay paints the only visible copy — but every box between the leaf
 * and the page now measures the new text, so the card grows, the row grows
 * and the siblings move, live.
 *
 * `display`, not `visibility`, for the content it replaces: a merely hidden
 * run still occupies its OLD box, so the element could never shrink.
 *
 * **Reflow is not commit, and they must stay different.** The ghost is DOM
 * only. It never touches the node, so the co-editing mirror (a mobx autorun
 * over the serialized node map) sees nothing, `saveHistory` records nothing,
 * and a keystroke stays a keystroke. Only the editor's single
 * `updateNodeProps` at commit reaches the store, the mirror and undo.
 *
 * ## Why an INLINE element gets no ghost
 *
 * Returning `undefined` here is what tells the editor it may not go
 * transparent, and inline is the case that taught us the rule. The overlay is
 * positioned and sized from `getBoundingClientRect()`, and for an inline run
 * on one line that rect is the width of the TEXT — not the width available
 * to it. So the surface wraps as soon as the typing exceeds the run's
 * current width, while the real text, which wraps at the parent's width,
 * has not wrapped at all. The surface gains a line the reserved box has not
 * gained, and that line lands on whatever is beneath. A ghost cannot fix it,
 * because the mismatch is in the OVERLAY's geometry, not the document's.
 *
 * Fixing it properly means giving up the single-rectangle overlay: an inline
 * run is a set of line fragments (`getClientRects()`), not a box, and
 * editing it in place faithfully means either one surface per fragment or a
 * genuinely contentEditable leaf. Both are real work and neither is this
 * change. Until then the editor keeps its opaque box for inline text, which
 * is honest: it covers what it replaces instead of blending with it.
 */
export function createInlineEditLayoutGhost(
  anchor: Element | undefined | null,
): InlineEditLayoutGhost | undefined {
  const host = anchor as HTMLElement | null | undefined
  if (!host || typeof host.style !== 'object' || !host.isConnected) {
    return undefined
  }
  if (typeof window === 'undefined') return undefined
  // See "Why an INLINE element gets no ghost" above.
  const display = window.getComputedStyle(host).display
  if (!display || display.startsWith('inline')) return undefined

  const doc = host.ownerDocument
  const ghost = doc.createElement('span')
  ghost.setAttribute(LAYOUT_GHOST_ATTR, '')
  ghost.setAttribute('aria-hidden', 'true')
  // Hidden, not absent: the whole point is that it still takes up room.
  ghost.style.setProperty('visibility', 'hidden')
  // Everything else — font, wrapping, alignment — is inherited from the
  // element, which is what makes the ghost measure the same as the real run.

  const text = host.querySelector('aglyn-text') as HTMLElement | null

  if (text && text.parentElement) {
    // PLAIN text. React owns `<aglyn-text>`, so the only safe mutations are
    // an inline style property React never set, and a child appended after
    // everything React rendered. Nothing React created is replaced or
    // reparented.
    const parent = text.parentElement
    const previousDisplay = text.style.getPropertyValue('display')
    const previousPriority = text.style.getPropertyPriority('display')
    ghost.textContent = text.textContent ?? ''
    parent.appendChild(ghost)
    text.style.setProperty('display', 'none', 'important')

    let disposed = false
    return {
      update(surface: HTMLElement) {
        if (disposed) return
        ghost.textContent = surface.textContent ?? ''
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

  // RICH text. `props.html` is rendered with `dangerouslySetInnerHTML`, and
  // React does not track those children individually — it re-sets
  // `innerHTML` wholesale when the html prop changes and otherwise leaves
  // the subtree alone. So parking them is safe here in a way it would never
  // be for children React created.
  //
  // The ghost carries MARKUP rather than text for this case: the breaks are
  // in the markup, and a plain-text stand-in would measure a two-line
  // heading as one line — understating exactly the height that matters.
  const holder = doc.createElement('span')
  holder.setAttribute(LAYOUT_GHOST_HOLDER_ATTR, '')
  holder.style.setProperty('display', 'none')
  while (host.firstChild) holder.appendChild(host.firstChild)
  ghost.innerHTML = holder.innerHTML
  host.appendChild(holder)
  host.appendChild(ghost)

  let disposed = false
  return {
    update(surface: HTMLElement) {
      if (disposed) return
      ghost.innerHTML = surface.innerHTML
    },
    dispose() {
      if (disposed) return
      disposed = true
      // Only if React has not already re-rendered this subtree from a new
      // `html` prop. If it has, our nodes are gone, the DOM is already
      // correct, and putting the OLD markup back would overwrite the edit
      // that was just committed.
      if (ghost.parentElement !== host || holder.parentElement !== host) return
      ghost.remove()
      while (holder.firstChild) host.appendChild(holder.firstChild)
      holder.remove()
    },
  }
}
