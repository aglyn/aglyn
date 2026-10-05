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
 * A sign-up that is still landing holds the auth layout's redirect
 * (AGL-3578).
 *
 * `AuthenticatingLayout` pushes a signed-in visitor to `/` the moment the
 * credential lands, and the sign-up doors still have work to do at that
 * moment: the acquisition record, the workspace, and the hard navigation into
 * it. On a phone the push reaches the server before the session cookie
 * exists, the server answers with `/signin`, and that becomes a full page
 * load which kills the sign-up mid-flight. Every phone Google sign-up from
 * 2026-10-03 on ended there: Terms recorded, no acquisition, no workspace.
 *
 * The door that is landing raises a hold and the layout waits while one is
 * up. The door releases it when it settles, and normally it never gets the
 * chance, because a successful landing navigates away first.
 *
 * ## The cap
 *
 * A hold that is never released would leave a signed-in person on a
 * spinner, so each one lapses after {@link SIGN_UP_LANDING_HOLD_MAX_MS}. The
 * cap is longer than the slowest step a door awaits (attribution gives up
 * at five seconds) plus the workspace create, and the worst case after it
 * is the redirect that shipped before this hold existed.
 *
 * ## Why module state
 *
 * The page raises the hold and the layout above it reads it, and the layout
 * is mounted by the route group, so no prop runs between them. The state is
 * per tab, like the landing it guards.
 */
export const SIGN_UP_LANDING_HOLD_MAX_MS = 20_000

const holds = new Map<string, ReturnType<typeof setTimeout>>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * Raise the hold named `key`. Idempotent per key: raising it again restarts
 * its cap instead of stacking a second hold that the one release would miss.
 */
export function holdSignUpLanding(
  key: string,
  maxMs = SIGN_UP_LANDING_HOLD_MAX_MS,
): void {
  const existing = holds.get(key)
  if (existing !== undefined) clearTimeout(existing)
  holds.set(
    key,
    setTimeout(() => releaseSignUpLanding(key), maxMs),
  )
  if (existing === undefined) notify()
}

/** Release the hold named `key`. A key that is not held is a no-op. */
export function releaseSignUpLanding(key: string): void {
  const timer = holds.get(key)
  if (timer === undefined) return
  clearTimeout(timer)
  holds.delete(key)
  notify()
}

/** Whether any sign-up is landing on this tab right now. */
export function isSignUpLandingHeld(): boolean {
  return holds.size > 0
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * {@link isSignUpLandingHeld} as React state, so a layout re-runs its
 * redirect effect the moment the last hold is released.
 */
export function useSignUpLandingHeld(): boolean {
  return useSyncExternalStore(subscribe, isSignUpLandingHeld, () => false)
}
