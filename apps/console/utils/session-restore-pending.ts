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

import { useSyncExternalStore } from 'react'

/**
 * THE LOAD-TIME SESSION RESTORE, AS SOMETHING THE AUTH GUARD CAN WAIT FOR
 * (AGL-4117).
 *
 * Firebase client auth is per-origin, so a phone that verified on
 * `auth.aglyn.com` reaches `app.aglyn.com/` with no local user. The shared
 * `__session` cookie signs it in (`useSessionCookie`), but that takes a
 * request and a custom-token sign-in, and the console's auth guard saw the
 * first `signedIn: false` and pushed `/signin` before the restore answered.
 * The account came back a beat later through `/signin`, but the page that
 * provisions a sign-up's workspace had been torn down and remounted on the
 * way, which is the path that left a verified account with its held name and
 * no workspace (production, 2026-11-04 23:11Z: restore 200 at :04.4,
 * `/signin` at :06.7, no `orgs/create`).
 *
 * The console shell opens this at module load; `useSessionCookie` settles it
 * once its load-time verdict is in (a live local user, or the restore
 * answered either way). The guard holds its `/signin` bounce while it is
 * open. Capped, so a restore that never answers costs a few seconds of
 * splash, never a stuck page.
 */
export const SESSION_RESTORE_PENDING_MAX_MS = 8_000

let pending = false
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** Open the wait. Browser only; a second call while open is a no-op. */
export function beginSessionRestore(
  maxMs = SESSION_RESTORE_PENDING_MAX_MS,
): void {
  if (typeof window === 'undefined' || pending) return
  pending = true
  timer = setTimeout(settleSessionRestore, maxMs)
  notify()
}

/** Close it. Safe to call when nothing is open. */
export function settleSessionRestore(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
  if (!pending) return
  pending = false
  notify()
}

export function isSessionRestorePending(): boolean {
  return pending
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The guard's live view of it. The server render never waits. */
export function useSessionRestorePending(): boolean {
  return useSyncExternalStore(subscribe, isSessionRestorePending, () => false)
}
