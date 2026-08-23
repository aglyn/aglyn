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

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * How long the panel survives the pointer leaving, in ms.
 *
 * This is the forgiving path from the card to the panel: the two are
 * separated by a gap, so travelling to a link inside the panel means
 * leaving the card first. Dismissing on `mouseleave` is what makes a
 * floating detail impossible to click — the content moves or vanishes on the
 * way to it. Long enough to cross a gap diagonally, short enough that it
 * does not linger once you have moved on.
 */
export const DETAIL_CLOSE_DELAY_MS = 260

export interface DetailTarget<T> {
  item: T
  anchor: HTMLElement
}

export interface HoverIntent<T> {
  /** What the surface should describe: the pin wins over the pointer. */
  active: DetailTarget<T> | null
  /** True while held open by a click rather than by the pointer. */
  isPinned: boolean
  /** Pointer entered a card. */
  open: (item: T, anchor: HTMLElement) => void
  /** Pointer left a card, or left the floating panel. */
  scheduleClose: () => void
  /** Pointer entered the floating panel — cancels a pending close. */
  keepOpen: () => void
  /** Click a card: holds it open, or releases it if it was already held. */
  togglePin: (item: T, anchor: HTMLElement) => void
  /** Dismiss explicitly (close button, Escape, outside click). */
  dismiss: () => void
  /**
   * Dismiss AND stop responding to the pointer until {@link resume}.
   *
   * For a drag: the panel floats over the canvas, which is where the element
   * is being dropped, so it has to leave the drop path the moment the drag
   * starts — not on drop. Suspending rather than just dismissing is the
   * other half: a drag crosses other cards on its way out, and each of those
   * would otherwise re-open it mid-flight.
   */
  suspend: () => void
  resume: () => void
}

/**
 * Hover-with-intent for a floating detail panel (AGL-2486).
 *
 * Three behaviours, and every one of them exists because the naive version
 * is unusable:
 *
 * - **A pin beats the pointer.** Once clicked, moving across other cards
 *   does not swap the content out from under you. Without this, everything
 *   inside the panel — Learn more, the attribute list — is unreachable,
 *   because reaching for it changes what it says.
 * - **Closing is delayed.** See {@link DETAIL_CLOSE_DELAY_MS}.
 * - **Only one is ever open**, because there is one piece of state, not one
 *   per card.
 */
export function useDetailHoverIntent<T extends { $id?: string }>(): HoverIntent<T> {
  const [hovered, setHovered] = useState<DetailTarget<T> | null>(null)
  const [pinned, setPinned] = useState<DetailTarget<T> | null>(null)
  const [suspended, setSuspended] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  // A pending close must not fire into an unmounted tree.
  useEffect(() => cancel, [cancel])

  const open = useCallback(
    (item: T, anchor: HTMLElement) => {
      if (suspended) return
      cancel()
      setHovered({ item, anchor })
    },
    [cancel, suspended],
  )

  const scheduleClose = useCallback(() => {
    cancel()
    timer.current = setTimeout(() => setHovered(null), DETAIL_CLOSE_DELAY_MS)
  }, [cancel])

  const keepOpen = useCallback(() => cancel(), [cancel])

  const togglePin = useCallback((item: T, anchor: HTMLElement) => {
    if (suspended) return
    cancel()
    setPinned((prev) => (prev && prev.item?.$id === item?.$id ? null : { item, anchor }))
    setHovered({ item, anchor })
  }, [cancel, suspended])

  const dismiss = useCallback(() => {
    cancel()
    setPinned(null)
    setHovered(null)
  }, [cancel])

  const suspend = useCallback(() => {
    cancel()
    setSuspended(true)
    setPinned(null)
    setHovered(null)
  }, [cancel])

  const resume = useCallback(() => setSuspended(false), [])

  return {
    active: suspended ? null : pinned ?? hovered,
    isPinned: Boolean(pinned),
    open,
    scheduleClose,
    keepOpen,
    togglePin,
    dismiss,
    suspend,
    resume,
  }
}

export default useDetailHoverIntent
