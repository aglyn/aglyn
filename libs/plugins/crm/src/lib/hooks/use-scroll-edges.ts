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

import { useCallback, useEffect, useState } from 'react'

export interface ScrollEdges {
  /** Callback ref for the box that scrolls sideways. */
  ref: (node: HTMLElement | null) => void
  /** Whether there is more to the left of what is in view. */
  start: boolean
  /** Whether there is more to the right of what is in view. */
  end: boolean
  /** Scrolls most of a view's width toward the start (`-1`) or the end (`1`). */
  page: (direction: -1 | 1) => void
}

/**
 * Which way a sideways-scrolling box has more to show, and a way to page
 * it — the facts a pair of scroll arrows needs, the way MUI's Tabs draws
 * them. A scrollbar alone says nothing on a trackpad Mac, where it stays
 * hidden until the reader already knows to scroll.
 *
 * Re-measured on scroll and whenever the box or its content changes size,
 * so a column collapsing, a deal arriving or the window narrowing moves the
 * arrows with it. A page is most of a view rather than all of it, so the
 * column at the edge stays in sight as a landmark.
 */
export function useScrollEdges(): ScrollEdges {
  const [node, setNode] = useState<HTMLElement | null>(null)
  const [edges, setEdges] = useState({ start: false, end: false })

  useEffect(() => {
    if (!node) return
    const measure = () => {
      const max = node.scrollWidth - node.clientWidth
      const start = node.scrollLeft > 1
      const end = node.scrollLeft < max - 1
      setEdges((previous) =>
        previous.start === start && previous.end === end ? previous : { start, end },
      )
    }
    measure()
    node.addEventListener('scroll', measure, { passive: true })
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(node)
    if (node.firstElementChild) observer?.observe(node.firstElementChild)
    return () => {
      node.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [node])

  const page = useCallback(
    (direction: -1 | 1) => {
      node?.scrollBy({ left: direction * node.clientWidth * 0.8, behavior: 'smooth' })
    },
    [node],
  )

  return { ref: setNode, start: edges.start, end: edges.end, page }
}
