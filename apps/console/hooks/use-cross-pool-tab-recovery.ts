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

import { useEffect } from 'react'
import { useAuth } from '@aglyn/tenant-feature-instance'
import {
  isCrossPoolDesync,
  reloadForCrossPoolRecovery,
  shouldReloadForCrossPoolDesync,
} from '../utils/cross-pool-desync'

/**
 * Heals the tab a CROSS-POOL sign-in elsewhere desynced (AGL-3280).
 *
 * `useCrossTabSessionHeal` beside this one answers the sibling whose
 * listeners were refused and never retried. This answers the sibling that
 * stopped receiving the events those listeners would heal on at all: the SDK
 * threw `auth/tenant-id-mismatch` inside its own storage listener, so this
 * tab never learned the browser had signed in somewhere else. The reasoning
 * for a reload, and the three fences around it, are in
 * `utils/cross-pool-desync.ts`.
 *
 * The rejection is OBSERVED, never handled — `preventDefault` is deliberately
 * not called. The error beacon reports it either way, and a fault we recover
 * from is still a fault worth seeing in the log; silencing it would turn the
 * one signal that this is happening into the absence of one.
 *
 * A tab that is visible when the rejection lands keeps waiting: the desync is
 * real and does not expire, so it reloads the next time it is hidden rather
 * than never.
 */
export function useCrossPoolTabRecovery(): void {
  const auth = useAuth()

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    let pending = false

    const recover = () => {
      if (!pending) return
      if (
        !shouldReloadForCrossPoolDesync({
          signedIn: Boolean(auth?.currentUser),
          visibility: document.visibilityState,
        })
      ) {
        return
      }
      pending = false
      reloadForCrossPoolRecovery()
    }

    const onRejection = (event: PromiseRejectionEvent) => {
      try {
        if (!isCrossPoolDesync(event.reason)) return
        pending = true
        recover()
      } catch {
        // Never throw from a rejection handler.
      }
    }

    window.addEventListener('unhandledrejection', onRejection)
    document.addEventListener('visibilitychange', recover)
    return () => {
      window.removeEventListener('unhandledrejection', onRejection)
      document.removeEventListener('visibilitychange', recover)
    }
  }, [auth])
}

export default useCrossPoolTabRecovery
