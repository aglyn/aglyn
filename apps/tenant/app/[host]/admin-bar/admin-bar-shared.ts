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
 * The few constants and storage helpers the admin-bar STUB and the lazily
 * loaded bar both need (admin edit bar, AGL-1302 follow-on; auto-appearance
 * AGL-1829). Kept small on purpose — this module is bundled into the stub,
 * which rides the critical path of every anonymous page view.
 *
 * Storage is localStorage (was sessionStorage until AGL-1829): a
 * sessionStorage token is per-TAB, so a returning editor opening the site in
 * a new tab lost the bar and had to reconnect — half the perceived
 * flakiness. localStorage keeps the token across tabs for its short TTL,
 * pruned on read. The scheme's "no new standing cookies on tenant visitors"
 * promise is intact: browser storage is not a cookie, travels on no request,
 * and only ever exists in a browser that completed the console handshake.
 */

/** Query param that arms the bar without the keyboard chord. */
export const EDIT_PARAM = 'aglyn-edit'

/** `postMessage` payload type from the console's /edit-access page. */
export const EDIT_MESSAGE_TYPE = 'aglyn-edit-access'

/**
 * `postMessage` type of the silent probe's content-free failure notice
 * (AGL-1829); mirrored in the console's /edit-access page.
 */
export const EDIT_RESULT_MESSAGE_TYPE = 'aglyn-edit-access-result'

/**
 * The console's editor-presence hint cookie (AGL-1829): set on the
 * REGISTRABLE domain (`.aglyn.com`/`.aglyn.io`) while a console session
 * exists, cleared on sign-out. Only first-party tenant hosts that are
 * same-site with the console can ever see it — `*.aglyn.app` tenants and
 * customer custom domains are cross-site, where the browser (correctly)
 * keeps the two worlds apart; those keep the chord/param/stored-token
 * paths. Never a credential: the silent probe re-proves everything
 * server-side before any token exists.
 */
export const EDITOR_HINT_COOKIE = 'aglyn_editor'

export function editTokenStorageKey(hostId: string): string {
  return `aglyn-edit-access:${hostId}`
}

/**
 * The explicit-disconnect marker (AGL-1829): with the hint cookie present
 * the bar would otherwise re-appear on the next pageview right after the
 * editor dismissed it. Cleared by the explicit opt-ins (`?aglyn-edit`, the
 * chord), which outrank a remembered "no".
 */
export function editOptOutStorageKey(hostId: string): string {
  return `aglyn-edit-access-off:${hostId}`
}

export interface StoredEditToken {
  token: string
  expiresAtMs: number
  siteName?: string
  /** Display hint only — who connected; carried from the console payload. */
  userEmail?: string
}

function parseStoredToken(raw: string | null): StoredEditToken | null {
  if (!raw) return null
  const parsed = JSON.parse(raw) as StoredEditToken
  if (!parsed?.token || Number(parsed.expiresAtMs) <= Date.now()) return null
  return parsed
}

/**
 * Reads (and prunes) the stored token; null when absent or expired. Reads
 * localStorage first, then the legacy sessionStorage slot (pre-AGL-1829
 * connects), migrating a still-valid legacy token forward so those editors
 * keep their bar across the storage move.
 */
export function readStoredEditToken(hostId: string): StoredEditToken | null {
  const key = editTokenStorageKey(hostId)
  try {
    const current = parseStoredToken(window.localStorage.getItem(key))
    if (current) return current
    window.localStorage.removeItem(key)
    const legacy = parseStoredToken(window.sessionStorage.getItem(key))
    window.sessionStorage.removeItem(key)
    if (legacy) {
      window.localStorage.setItem(key, JSON.stringify(legacy))
      return legacy
    }
    return null
  } catch {
    return null
  }
}

/** Persists a fresh token; storage refusal (private mode) is non-fatal. */
export function writeStoredEditToken(
  hostId: string,
  stored: StoredEditToken,
): void {
  try {
    window.localStorage.setItem(
      editTokenStorageKey(hostId),
      JSON.stringify(stored),
    )
  } catch {
    // The bar still works for this pageview from memory.
  }
}

/** Removes the token from BOTH stores (disconnect, 401/403 fallbacks). */
export function clearStoredEditToken(hostId: string): void {
  try {
    window.localStorage.removeItem(editTokenStorageKey(hostId))
  } catch {
    // Ignore storage refusal.
  }
  try {
    window.sessionStorage.removeItem(editTokenStorageKey(hostId))
  } catch {
    // Ignore storage refusal.
  }
}

/** Whether the console's editor-presence hint cookie is on this site. */
export function hasEditorHint(): boolean {
  try {
    return document.cookie
      .split(';')
      .some((part) => part.trim() === `${EDITOR_HINT_COOKIE}=1`)
  } catch {
    return false
  }
}

export function isEditOptedOut(hostId: string): boolean {
  try {
    return window.localStorage.getItem(editOptOutStorageKey(hostId)) === '1'
  } catch {
    return false
  }
}

export function setEditOptOut(hostId: string): void {
  try {
    window.localStorage.setItem(editOptOutStorageKey(hostId), '1')
  } catch {
    // Ignore storage refusal.
  }
}

export function clearEditOptOut(hostId: string): void {
  try {
    window.localStorage.removeItem(editOptOutStorageKey(hostId))
  } catch {
    // Ignore storage refusal.
  }
}
