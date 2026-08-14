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
'use client'

import { useIsomorphicLayoutEffect } from '@aglyn/shared-ui-jsx'
import { useState } from 'react'

export interface AnchoredRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Tracks where an anchor element actually is, for the fixed overlays that edit
 * a canvas element in place (AGL-1644).
 *
 * ## The bug this fixes
 *
 * `inline-text-editor` and `inline-markdown-editor` both anchored on a
 * `getBoundingClientRect()` taken ONCE, when the double-click opened them. The
 * rect was never recomputed, so scrolling the canvas — or resizing the window,
 * or switching the artboard's device preview — left the editor sitting over
 * unrelated chrome while the element it was editing had moved away. It matters
 * most for the markdown editor, where the document is routinely taller than the
 * viewport and scrolling mid-edit is ordinary rather than exceptional.
 *
 * ## Why the live rect IS "the canvas's own coordinate system"
 *
 * The overlays render outside the canvas' CLOSED shadow root, so viewport
 * coordinates are the only frame of reference the two sides share — there is no
 * canvas-space transform to be had from outside. `getBoundingClientRect()` on
 * the live element is that shared frame, continuously: it already accounts for
 * every ancestor's scroll, for the shadow host's own layout, and for any CSS
 * transform in between.
 *
 * That last point is the pan/zoom answer. `ZoomablePanningComponent` is NOT
 * currently mounted — the only reference to it in the canvas is a commented-out
 * import in `viewport-canvas.component.tsx` — so there is no transform to
 * handle today. If one is ever mounted, a live rect follows it with no further
 * work, which a stored rect plus a hand-written transform never would.
 *
 * ## The listeners, and why they are the ones NodeOverlay already uses
 *
 * This is deliberately the same recipe as `node-overlay.tsx`, which solved this
 * exact problem for the selection outline: a `ResizeObserver` on the element and
 * on its shadow host, `resize` on the window, and — the one that matters here —
 * a CAPTURE-phase `scroll` listener, because scroll does not bubble and the
 * scrolling ancestor may be the canvas container, a panel, or the page body.
 *
 * ## The anchor is passed in, not looked up
 *
 * `Besigner.refs.get($id)` would cover three of the four ways these editors
 * open, and silently miss the fourth: an instance prop edit (AGL-1304) anchors
 * on a GRAFTED preview leaf, which is not a canvas node and has no ref. The
 * call site already holds the exact element it measured, so it hands it over.
 *
 * With no anchor — a store opened without one, or a test — the fallback rect is
 * returned unchanged, so the previous behavior is what a caller gets for free.
 */
export function useAnchoredRect(
  anchor: Element | undefined,
  fallback: AnchoredRect,
): AnchoredRect {
  const [rect, setRect] = useState<AnchoredRect | null>(null)

  useIsomorphicLayoutEffect(() => {
    if (!anchor || typeof anchor.getBoundingClientRect !== 'function') {
      setRect(null)
      return
    }
    const update = () => {
      const next = anchor.getBoundingClientRect()
      setRect({
        left: next.left,
        top: next.top,
        width: next.width,
        height: next.height,
      })
    }
    update()

    // ResizeObserver is not in every jsdom setup; the listeners below still
    // carry the case this issue is actually about.
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(anchor)
    const shadowHost = (anchor.getRootNode() as ShadowRoot | null)?.host ?? null
    if (shadowHost) observer?.observe(shadowHost)

    window.addEventListener('resize', update, { passive: true })
    // Scroll does not bubble: only a capture-phase listener on the window sees
    // an ancestor scroll, and an ancestor scroll is the whole bug.
    window.addEventListener('scroll', update, { passive: true, capture: true })

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, { capture: true })
    }
  }, [anchor])

  return rect ?? fallback
}

/**
 * Keeps a following overlay reachable when its anchor leaves the viewport.
 *
 * The clamp is not a substitute for the tracking above and is not a second one:
 * AGL-1624 clamped a rect that never changed, which is why its own author
 * called it a floor rather than a fix. Applied to a LIVE rect it means what it
 * says — while the element is off-screen the editor waits at the nearest edge,
 * and it slides back onto the element the moment the element is visible again.
 *
 * Reading the viewport size at render is safe precisely because the hook above
 * re-renders on every scroll and resize, so the value is never stale.
 */
export function clampToViewport(
  value: number,
  size: number,
  extent: number,
  margin = 8,
): number {
  const max = extent - size - margin
  // A viewport smaller than the overlay has no satisfying answer; pin to the
  // near edge rather than letting the clamp invert and push it off the other.
  if (max <= margin) return margin
  return Math.min(Math.max(value, margin), max)
}

export default useAnchoredRect
