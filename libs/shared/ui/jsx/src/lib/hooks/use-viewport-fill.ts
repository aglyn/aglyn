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

import { useCallback, useState } from 'react'
import { useIsomorphicLayoutEffect } from './use-isomorphic-layout-effect'

/** Whether a box takes part in the page's flow, and so in its height. */
const inFlow = (node: Element) => {
  const style = getComputedStyle(node)
  return style.display !== 'none' && style.position !== 'fixed' && style.position !== 'absolute'
}

const px = (value: string) => parseFloat(value) || 0

/**
 * How much of the page lies BELOW `element`: the space from its bottom edge
 * to the end of the document's content — a page container's bottom padding,
 * a footer after it, the margins between them.
 *
 * Measured level by level up to `<body>`: at each one, the distance from the
 * box to the bottom of its last in-flow sibling (margins included), then the
 * parent's bottom padding and border. Each term is a DIFFERENCE between
 * positions that `element`'s own height moves together, and a parent's
 * stretch (a `flex-grow` section, a `min-height: 100vh` shell) is never
 * counted, so sizing the element to the answer cannot change the answer.
 * `scrollHeight` would not do: it clamps to the window whenever the page is
 * shorter than it, which is exactly the state this hook produces.
 */
export function contentBelow(element: HTMLElement) {
  let below = 0
  let node: Element = element
  while (node.parentElement && node !== document.body) {
    const parent: HTMLElement = node.parentElement
    let last: Element = node
    for (let sibling = node.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
      if (inFlow(sibling)) last = sibling
    }
    below +=
      last.getBoundingClientRect().bottom +
      px(getComputedStyle(last).marginBottom) -
      node.getBoundingClientRect().bottom
    const style = getComputedStyle(parent)
    below += px(style.paddingBottom) + px(style.borderBottomWidth)
    node = parent
  }
  return Math.max(0, below)
}

/**
 * The height that makes an element fill the window: from where it starts on
 * the page down to the bottom of the viewport, less whatever the page puts
 * below it, so the whole page — chrome above, the element, a footer below —
 * fits the window and the document does not scroll.
 *
 * `100dvh` is the whole window, so a full-screen tool placed under the
 * console's header, site nav, notices and page title came out taller than
 * the screen by exactly that chrome (AGL-3679), and leaving out the page's
 * bottom padding and footer still left it scrolling by theirs (AGL-3710).
 * The element's top is read in DOCUMENT coordinates and the content below
 * as differences of positions (`contentBelow`), neither of which its own
 * height changes, so resizing to the answer cannot feed back into it.
 *
 * It re-measures when the window resizes, when web fonts finish loading, and
 * when any box around it changes size — every ancestor and every sibling of
 * each (a notice dismissed, the nav wrapping, a footer line added). Watching
 * `<body>` alone is not enough: a page whose `html, body` are `height: 100%`
 * never resizes its body. Below `min` (a short window) it stops shrinking
 * and the page scrolls, which is acceptable there.
 *
 * Until the first measurement (and on the server) it answers `fallback`.
 */
export function useViewportFill(options: { min?: number; fallback?: string } = {}) {
  const { min = 0, fallback = '100dvh' } = options
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  const ref = useCallback((node: HTMLElement | null) => setElement(node), [])

  useIsomorphicLayoutEffect(() => {
    if (!element) return
    let disposed = false
    const measure = () => {
      if (disposed || !element.isConnected) return
      const top = element.getBoundingClientRect().top + window.scrollY
      const next = Math.max(min, Math.floor(window.innerHeight - top - contentBelow(element)))
      setHeight((current) => (current === next ? current : next))
    }
    measure()
    window.addEventListener('resize', measure)
    const fonts = typeof document === 'undefined' ? undefined : document.fonts
    fonts?.addEventListener?.('loadingdone', measure)
    void fonts?.ready?.then(measure)
    // One measurement per frame, after layout settles: answering inside the
    // observer's own callback resizes boxes it is watching, which the browser
    // reports as a ResizeObserver loop.
    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    if (observer) {
      for (let node: Element | null = element; node && node !== document.documentElement; node = node.parentElement) {
        if (node !== element) observer.observe(node)
        for (const sibling of Array.from(node.parentElement?.children ?? [])) {
          if (sibling !== node) observer.observe(sibling)
        }
      }
    }
    return () => {
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      fonts?.removeEventListener?.('loadingdone', measure)
      observer?.disconnect()
    }
  }, [element, min])

  return { ref, height: height === null ? fallback : `${height}px` }
}

export default useViewportFill
