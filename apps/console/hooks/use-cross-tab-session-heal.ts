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

import { onIdTokenChanged } from 'firebase/auth'
import { useEffect, useRef } from 'react'
import {
  reportFirestoreSessionHeal,
  useAuth,
} from '@aglyn/tenant-feature-instance'

/**
 * The OTHER tab's heal (AGL-2486).
 *
 * `watchSessionHeal` broadcasts when THIS tab's re-auth store leaves a fault.
 * That covers the tab holding the dialog and nothing else — and the tab
 * holding the dialog is not the one people complain about.
 *
 * The complaint is the sibling: a console left open on a second monitor while
 * the session is repaired somewhere else. That tab never faulted, so it never
 * heals; its listeners were refused while the old session was dead and stay
 * refused, because `browserLocalPersistence` hands it a working user without
 * re-subscribing anything. Nothing in the tree remounts — that is the whole
 * design of AGL-664 — so the page sits there authenticated and empty until
 * someone reloads it by hand. "Reload the other tab" was advice, not a fix.
 *
 * ## Why the uid, and only the uid
 *
 * `onIdTokenChanged` also fires on the hourly refresh, and answering that
 * would reopen every listener in the console on a schedule with no fault to
 * answer — the listener storm `session-heal` deliberately avoids. A uid
 * TRANSITION cannot happen on a refresh: it means the account behind this tab
 * was signed out and back in, or swapped. That is structural evidence, not a
 * threshold anybody has to keep tuned.
 *
 * Three transitions, and only one is a heal:
 *
 *   - `undefined → x` — the first observation. Not a change; the listeners
 *     are subscribing against it right now.
 *   - `x → null` — a sign-OUT. The layout and the re-auth prompt own that
 *     path, and telling refused listeners to retry against no session at all
 *     would just spend reads on certain denials.
 *   - `null → x`, `x → y` — somebody re-authenticated. This is the one.
 */
export function useCrossTabSessionHeal(): void {
  const auth = useAuth()
  /** `undefined` until the SDK has said anything at all. */
  const seenUid = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (!auth) return undefined
    return onIdTokenChanged(auth, (user) => {
      const uid = user?.uid ?? null
      const previous = seenUid.current
      seenUid.current = uid
      if (previous === undefined || previous === uid || !uid) return
      reportFirestoreSessionHeal()
    })
  }, [auth])
}

export default useCrossTabSessionHeal
