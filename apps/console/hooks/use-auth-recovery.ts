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

import {
  subscribeFirestoreSessionHeal,
  useAuth,
} from '@aglyn/tenant-feature-instance'
import { onIdTokenChanged } from 'firebase/auth'
import { useEffect } from 'react'

/**
 * Re-run a read that a DEAD SESSION killed, once the session comes back.
 *
 * ## The hole this fills
 *
 * AGL-1200 gave `useHostResolution` a `retry()` and AGL-1260 gave the org
 * membership listen one, and both are still manual. That is the right answer
 * for the cold-load failure those issues were about — a connection that has
 * not warmed up yet gives the app no event to wait for, so a button is
 * honest. It is the wrong answer for an EXPIRED TOKEN, because there the app
 * is told, precisely and by name, that the condition is over. Leaving the
 * user to press "Try again" for something the page already knows has
 * resolved is the defect.
 *
 * Reported shape: a tab left open overnight, the sites read refused, the
 * terminal error rendered, a re-auth dialog raised — and then the dialog
 * vanished on its own about two seconds later, before anything was typed,
 * because a sibling tab's restore delivered a fresh user. A NEW tab loaded
 * the same URL fine. The stale one stayed on the error forever.
 *
 * ## Two signals, because they catch different halves
 *
 * 1. {@link subscribeFirestoreSessionHeal} — the console's own "a session
 *    fault I diagnosed has been resolved" broadcast (AGL-1066), raised by
 *    `utils/session-heal.ts` on the falling edge of the re-auth store. This
 *    is exactly the reported episode: something set `reason`, something
 *    cleared it. Every LISTENER-based hook in the tenant library already
 *    reopens on this; the two latching one-shot/exhausted-budget reads in
 *    the console were simply never wired to it.
 *
 * 2. `onIdTokenChanged` — a token that refreshed with nobody noticing. The
 *    heal broadcast requires the console to have REACHED a verdict first
 *    (`session-health` needs denials across two distinct collections inside
 *    its window, and the banner needs its probe to say `ok`), and a lone
 *    refused host-resolution read clears none of that. So signal 1 alone
 *    would leave the plain case — token quietly expires, Firebase quietly
 *    renews it, no dialog ever shown — still stuck.
 *
 * ## Why the token signal is safe HERE, when `session-heal.ts` rejects it
 *
 * That module explicitly refuses to broadcast on token events, and it is
 * right to: it feeds EVERY listener in the console, so an hourly refresh
 * would be an hourly listener storm answering no fault at all. This hook is
 * the opposite situation on every axis. It subscribes only while `active` —
 * that is, only while a read is sitting in a latched, AUTH-CAUSED failure —
 * it re-runs exactly one read, and the moment that read succeeds `active`
 * goes false and the subscription is gone. A refresh on a healthy page
 * reaches no subscriber, because a healthy page has none.
 *
 * ## The initial emission must not count
 *
 * `onIdTokenChanged` replays the CURRENT user synchronously on subscribe.
 * Since we subscribe the instant the failure latches, that replay is the
 * very token that was just refused — treating it as a recovery would fire a
 * retry immediately, fail, latch, resubscribe, replay, retry… a hot loop
 * against Firestore with no backoff between passes. Hence `seenReplay`: the
 * first emission is the state we already have, and only a LATER one is news.
 *
 * This is an event-driven retry, not a poll: nothing here runs on a timer,
 * and a session that never recovers costs exactly nothing.
 *
 * @param active Whether an auth-caused failure is currently outstanding.
 * @param onRecovered Re-runs the failed read. Must be referentially stable
 *   (the `useCallback`-wrapped `retry` both call sites already expose).
 */
export function useAuthRecovery(active: boolean, onRecovered: () => void) {
  const auth = useAuth()

  useEffect(() => {
    if (!active) return undefined

    let seenReplay = false
    const stopWatchingToken = onIdTokenChanged(auth, (user) => {
      if (!seenReplay) {
        seenReplay = true
        return
      }
      // A `null` emission is a sign-OUT, which is not a recovery — the
      // AuthenticatedLayout handles that one by leaving the route.
      if (user) onRecovered()
    })
    const stopWatchingHeal = subscribeFirestoreSessionHeal(onRecovered)

    return () => {
      stopWatchingToken()
      stopWatchingHeal()
    }
  }, [active, auth, onRecovered])
}

export default useAuthRecovery
