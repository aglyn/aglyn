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

/**
 * The height that takes an element from where it starts on the page to the
 * bottom of the viewport.
 *
 * `100dvh` is the whole window, so a full-screen tool placed under the
 * console's header, site nav, notices and page title came out taller than
 * the screen by exactly that chrome, and the page scrolled to reach its own
 * bottom (the POS register). This measures the element's top in DOCUMENT
 * coordinates, which its own height never changes, so resizing to the
 * answer cannot feed back into the measurement. It re-measures when the
 * window resizes and when anything above it changes size (a notice
 * dismissed, the nav wrapping).
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
    const measure = () => {
      const top = element.getBoundingClientRect().top + window.scrollY
      const next = Math.max(min, Math.floor(window.innerHeight - top))
      setHeight((current) => (current === next ? current : next))
    }
    measure()
    window.addEventListener('resize', measure)
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(document.body)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [element, min])

  return { ref, height: height === null ? fallback : `${height}px` }
}

export default useViewportFill
