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
 * The few constants the admin-bar STUB and the lazily loaded bar both need
 * (admin edit bar, AGL-1302 follow-on). Kept to a handful of strings on
 * purpose — this module is bundled into the stub, which rides the critical
 * path of every anonymous page view.
 */

/** Query param that arms the bar without the keyboard chord. */
export const EDIT_PARAM = 'aglyn-edit'

/** `postMessage` payload type from the console's /edit-access popup. */
export const EDIT_MESSAGE_TYPE = 'aglyn-edit-access'

/** sessionStorage only — the scheme promises NO new standing cookies. */
export function editTokenStorageKey(hostId: string): string {
  return `aglyn-edit-access:${hostId}`
}

export interface StoredEditToken {
  token: string
  expiresAtMs: number
  siteName?: string
}

/** Reads (and prunes) the stored token; null when absent or expired. */
export function readStoredEditToken(hostId: string): StoredEditToken | null {
  try {
    const raw = window.sessionStorage.getItem(editTokenStorageKey(hostId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredEditToken
    if (!parsed?.token || Number(parsed.expiresAtMs) <= Date.now()) {
      window.sessionStorage.removeItem(editTokenStorageKey(hostId))
      return null
    }
    return parsed
  } catch {
    return null
  }
}
