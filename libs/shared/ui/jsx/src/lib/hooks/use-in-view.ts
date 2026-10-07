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

import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseInViewOptions {
  /** Stay true once the element has been seen (default), for work done once. */
  once?: boolean
  /** How far outside the viewport counts as in view, as a CSS margin. */
  rootMargin?: string
}

/**
 * Whether an element is on screen, through an `IntersectionObserver`: hand
 * the returned ref to the element, and start what it needs — an image, a
 * font, a read — once `inView` turns true.
 *
 * Where the browser has no observer (a test, an old engine) the element
 * counts as in view at once, so the work runs rather than never.
 */
export function useInView<T extends Element = HTMLElement>(
  options: UseInViewOptions = {},
): [(node: T | null) => void, boolean] {
  const { once = true, rootMargin = '0px' } = options
  const [inView, setInView] = useState(false)
  const observer = useRef<IntersectionObserver | null>(null)

  useEffect(() => () => observer.current?.disconnect(), [])

  const ref = useCallback(
    (node: T | null) => {
      observer.current?.disconnect()
      observer.current = null
      if (!node) return
      if (typeof IntersectionObserver === 'undefined') {
        setInView(true)
        return
      }
      const watcher = new IntersectionObserver(
        (entries) => {
          const visible = entries.some((entry) => entry.isIntersecting)
          if (visible && once) {
            setInView(true)
            watcher.disconnect()
          } else if (!once) {
            setInView(visible)
          }
        },
        { rootMargin },
      )
      watcher.observe(node)
      observer.current = watcher
    },
    [once, rootMargin],
  )

  return [ref, inView]
}

export default useInView
