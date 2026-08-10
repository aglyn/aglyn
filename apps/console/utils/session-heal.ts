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
 * Tell refused Firestore listeners the session came back (AGL-1066).
 *
 * ## What counts as a heal here, and why it is this and not a token event
 *
 * The signal is the re-auth store leaving its faulted state: `reason`
 * non-null → null. That transition is exactly "a session fault the console
 * itself diagnosed has been resolved" — `clearSessionReauth` is called when
 * the dialog's credential sign-in lands, and when a sibling tab's restore
 * delivers a fresh user to a prompt that was waiting for one.
 *
 * It is deliberately NOT keyed on tokens. Firebase refreshes the ID token
 * roughly hourly and `onIdTokenChanged` fires every time; reopening every
 * listener in the console on that schedule would be a listener storm with no
 * fault to answer. `reason` is only ever set by the console's own verdicts
 * (`revoked`, `signed-out`, `idle`, `stale`), so a healthy session cannot
 * produce this transition at all — the gate is structural, not a threshold
 * somebody has to keep tuned.
 *
 * ## Why a broadcast is needed rather than a remount
 *
 * `AuthenticatedLayout` holds the page MOUNTED for the whole of a pending
 * re-auth (AGL-664) — that is what makes "resume exactly where you were"
 * true, and it is precisely why no listener re-subscribes on its own. A
 * `stale` re-auth signs the same uid back in, so no hook dependency moves
 * either: `useDocData`'s deps are `[ref.firestore, ref.path]`, and the two
 * `deps`-driven hooks are keyed on ids, not on the user.
 *
 * The one session fault that DOES remount is auth being dropped with no
 * prompt pending — `AuthenticatedLayout` sees `!signedIn && !reauthActive`
 * and pushes to `/signin`, tearing the tree down. `useSessionCookie`'s silent
 * custom-token restore lives on that path, which is why it broadcasts
 * nothing: a remount re-subscribes everything by itself.
 */

import { reportFirestoreSessionHeal } from '@aglyn/tenant-feature-instance'
import { getSessionReauth, subscribeSessionReauth } from './session-reauth'

/**
 * Watch the re-auth store and broadcast a heal when a fault is resolved.
 *
 * Returns the unsubscribe, which the console never calls — it registers once
 * at module scope, alongside the other two `session-*` seams. Returned
 * anyway so a test can leave no subscriber behind.
 */
export function watchSessionHeal(): () => void {
  // Seeded BEFORE subscribing: `subscribeSessionReauth` replays the current
  // state to a new listener, and an unfaulted replay must not read as a
  // transition out of a fault that never happened.
  let faulted = getSessionReauth().reason !== null
  return subscribeSessionReauth((state) => {
    const nowFaulted = state.reason !== null
    // Only the falling edge. "Not now" leaves `reason` set and the degraded
    // state standing, so a dismissal is not a heal and must not reopen
    // anything.
    if (faulted && !nowFaulted) reportFirestoreSessionHeal()
    faulted = nowFaulted
  })
}

export default watchSessionHeal
