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
 * Reading the handoff return fragment (AGL-1902, D1).
 *
 * The return leg carries `#{rid}.{S}`. A fragment is never transmitted to any
 * server — not in the request line, not in `Referer` — which is the whole
 * reason it is the channel: our own edge access logs and their third-party
 * drains are the one place we cannot audit, and a session-grade secret in a
 * log is a long-lived copy in a store many people can read.
 *
 * Split on the FIRST dot only. A base64url secret contains no dots, but the
 * parse should not depend on that: `rid` is a UUID and a `lastIndexOf` split
 * would mis-parse the day either shape changes.
 */
export interface HandoffFragment {
  requestId: string
  secret: string
}

export function parseHandoffFragment(
  hash: string | null | undefined,
): HandoffFragment | null {
  const raw = String(hash ?? '').replace(/^#/, '')
  if (!raw) return null
  const dot = raw.indexOf('.')
  if (dot <= 0 || dot === raw.length - 1) return null
  try {
    const requestId = decodeURIComponent(raw.slice(0, dot))
    const secret = decodeURIComponent(raw.slice(dot + 1))
    if (!requestId || !secret) return null
    return { requestId, secret }
  } catch {
    return null
  }
}

/**
 * Removes the fragment from the address bar without adding a history entry.
 *
 * `replaceState`, not `pushState` and not an assignment to `location.hash`:
 * both of the others leave the secret reachable with the Back button, which is
 * the one history hazard the fragment channel actually has. The window it is
 * exposed for is roughly one frame.
 */
export function stripHandoffFragment(): void {
  try {
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search,
    )
  } catch {
    // A sandboxed or otherwise restricted document — the redemption still
    // works, and refusing to continue over a cosmetic failure would be worse.
  }
}
