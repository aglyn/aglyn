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

import { useEffect, useRef } from 'react'

/**
 * USB and Bluetooth barcode scanners in keyboard mode (AGL-3619).
 *
 * A scanner is a keyboard that types very fast and presses Enter. When the
 * register's search box has focus that already works: the code lands in the
 * box and Enter looks it up. But a cashier who just tapped a product, a
 * quantity stepper or a tender button has moved focus off the box, and a
 * scan then went nowhere. This listens on the whole page for that burst —
 * printable keys at machine speed, ending in Enter — while no text field
 * has focus, and hands the code to the same lookup.
 *
 * A person typing is never mistaken for a scanner: a human gap between keys
 * resets the buffer, and anything typed into a field is left to the field.
 */

/** Longest gap between a scanner's keystrokes; people type at 80 ms and up. */
export const WEDGE_MAX_GAP_MS = 50

/** Shortest code a scan can be (EAN-8 is 8; a short SKU label might be 4). */
export const WEDGE_MIN_LENGTH = 4

export interface WedgeDetector {
  /** Feeds one key; answers the scanned code when this key completed one. */
  push(key: string, atMs: number): string | null
  reset(): void
}

export function createWedgeDetector(
  options: { maxGapMs?: number; minLength?: number } = {},
): WedgeDetector {
  const maxGapMs = options.maxGapMs ?? WEDGE_MAX_GAP_MS
  const minLength = options.minLength ?? WEDGE_MIN_LENGTH
  let buffer = ''
  let lastAtMs = -Infinity
  return {
    push(key, atMs) {
      const gap = atMs - lastAtMs
      lastAtMs = atMs
      if (key === 'Enter') {
        const code = gap <= maxGapMs && buffer.length >= minLength ? buffer : null
        buffer = ''
        return code
      }
      if (key.length !== 1) {
        // Shift (for capitals) arrives between a scanner's keys and is not a break.
        if (key !== 'Shift') buffer = ''
        return null
      }
      buffer = gap <= maxGapMs ? buffer + key : key
      return null
    },
    reset() {
      buffer = ''
      lastAtMs = -Infinity
    },
  }
}

/** True when the key is going into something that takes text. */
export function typingIntoField(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || typeof element.tagName !== 'string') return false
  if (element.isContentEditable) return true
  const tag = element.tagName.toLowerCase()
  if (tag === 'textarea' || tag === 'select') return true
  if (tag !== 'input') return false
  const type = String((element as HTMLInputElement).type || 'text').toLowerCase()
  return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(type)
}

/**
 * Calls `onScan` with each code a keyboard-mode scanner types while no text
 * field has focus. Off while `enabled` is false (a dialog that takes cash is
 * open, say).
 */
export function useScannerWedge(onScan: (code: string) => void, enabled = true): void {
  const handler = useRef(onScan)
  handler.current = onScan
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const detector = createWedgeDetector()
    const listener = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return detector.reset()
      if (typingIntoField(event.target)) return detector.reset()
      const code = detector.push(event.key, Date.now())
      if (code) {
        // The Enter must not also press the focused button.
        event.preventDefault()
        handler.current(code)
      }
    }
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [enabled])
}
