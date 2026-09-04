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

/**
 * The `localStorage` seam shared by the two besigner clipboards (elements
 * and styles).
 *
 * The mirror IS the clipboard, not a fallback for it. Hydrating from it once
 * per document is enough to survive a navigation, but not to survive a second
 * tab: two besigner documents open side by side never reload, so a document
 * that only reads the mirror on its first paste keeps serving that first
 * clipping no matter how many times the tab next door copies something new
 * (AGL-2507). Every document therefore follows the mirror for as long as it
 * is open, which is what {@link watchMirror} is for.
 */

/** `window.localStorage`, or null when it is unavailable. */
export const localStore = (): Storage | null => {
  try {
    // SSR and privacy-mode both make this throw rather than return null.
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/**
 * Parse a mirrored entry, dropping anything a different build wrote. A
 * corrupt or foreign entry is no entry — this never throws.
 *
 * @param raw - The stored JSON, or null when the key is absent.
 * @param version - The format version this build understands.
 */
export function parseMirrored<T extends { version: number }>(
  raw: string | null,
  version: number,
): T | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as T
    return parsed?.version === version ? parsed : null
  } catch {
    return null
  }
}

/**
 * Call `onValue` whenever another document on this origin writes `key`.
 *
 * `storage` fires only in the OTHER documents, never in the one that wrote,
 * so a copy made here is never round-tripped back through the parser.
 *
 * @returns An unsubscribe function. Nothing calls it today — the clipboards
 *   are module singletons that live as long as the document — but a listener
 *   with no way off the window is a leak waiting for the first consumer that
 *   does need one.
 */
export function watchMirror(
  key: string,
  onValue: (raw: string | null) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined

  const listener = (event: StorageEvent): void => {
    // A null key is another tab calling `localStorage.clear()`, which clears
    // this key along with everything else.
    if (event.key !== null && event.key !== key) return
    // `sessionStorage` raises this event too, and it is a different clipboard.
    const store = localStore()
    if (store && event.storageArea && event.storageArea !== store) return
    onValue(event.key === null ? null : event.newValue)
  }

  window.addEventListener('storage', listener)
  return () => window.removeEventListener('storage', listener)
}
