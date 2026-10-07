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

import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useEffect, useRef, useState } from 'react'
import { callPosOps } from './pos-ops-api'
import type { PosStaffAssertion } from './pos-pin-pad.component'

/** Refresh a cashier assertion this long before it expires. */
const REFRESH_MARGIN_MS = 3 * 60 * 1000
/** How often the register checks the idle clock and the expiry. */
const TICK_MS = 15 * 1000

export interface PosCashierState {
  /** The member a PIN switched in, or `null` for whoever is signed in. */
  cashier: PosStaffAssertion | null
  /** The assertion every register call carries, or `undefined`. */
  assertion: string | undefined
  /** The register is locked and waits for a PIN. */
  locked: boolean
  switchTo: (assertion: PosStaffAssertion) => void
  /** Back to the signed-in member. */
  signOutCashier: () => void
  lock: () => void
  /** Lifts a lock without a PIN: only for a site where nobody has one. */
  unlock: () => void
}

/**
 * Who is at the register (AGL-3609).
 *
 * Holds the cashier a PIN switched in, refreshes their assertion while they
 * keep working (the server re-checks their role on every refresh), and LOCKS
 * the register after `autoLockMinutes` without a tap or a key — dropping the
 * assertion, so the next person has to enter their own PIN. An expired
 * assertion the refresh could not renew drops back to the signed-in member
 * rather than ringing sales under a name the server would refuse.
 */
export function usePosCashier(options: {
  hostId: string
  registerId: string
  autoLockMinutes: number
}): PosCashierState {
  const { hostId, registerId, autoLockMinutes } = options
  const { data: user } = useUser()
  const [cashier, setCashier] = useState<PosStaffAssertion | null>(null)
  const [locked, setLocked] = useState(false)
  const lastActivity = useRef(Date.now())
  const refreshing = useRef(false)

  // A different register is a different till: nobody carries over.
  useEffect(() => {
    setCashier(null)
    setLocked(false)
  }, [hostId, registerId])

  useEffect(() => {
    const touch = () => {
      lastActivity.current = Date.now()
    }
    window.addEventListener('pointerdown', touch, { passive: true })
    window.addEventListener('keydown', touch)
    return () => {
      window.removeEventListener('pointerdown', touch)
      window.removeEventListener('keydown', touch)
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      if (autoLockMinutes > 0 && !locked && now - lastActivity.current > autoLockMinutes * 60_000) {
        setCashier(null)
        setLocked(true)
        return
      }
      if (!cashier) return
      if (now >= cashier.expiresAtMs) {
        setCashier(null)
        return
      }
      if (cashier.expiresAtMs - now > REFRESH_MARGIN_MS || refreshing.current) return
      // Only a cashier who is still working earns a fresh assertion.
      if (now - lastActivity.current > REFRESH_MARGIN_MS) return
      refreshing.current = true
      void callPosOps<{ assertion?: string; expiresAtMs?: number }>(user, 'pos-staff-pin', {
        hostId,
        registerId,
        action: 'refresh',
        assertion: cashier.assertion,
      }).then((answer) => {
        refreshing.current = false
        if (answer.ok && answer.body.assertion && answer.body.expiresAtMs) {
          setCashier((current) =>
            current && current.memberUid === cashier.memberUid
              ? { ...current, assertion: answer.body.assertion!, expiresAtMs: answer.body.expiresAtMs! }
              : current,
          )
        } else if (answer.status === 401 || answer.status === 403) {
          setCashier(null)
        }
      })
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [autoLockMinutes, locked, cashier, user, hostId, registerId])

  const switchTo = useCallback((assertion: PosStaffAssertion) => {
    lastActivity.current = Date.now()
    setCashier(assertion)
    setLocked(false)
  }, [])
  const signOutCashier = useCallback(() => setCashier(null), [])
  const lock = useCallback(() => {
    setCashier(null)
    setLocked(true)
  }, [])
  const unlock = useCallback(() => {
    lastActivity.current = Date.now()
    setLocked(false)
  }, [])

  return { cashier, assertion: cashier?.assertion, locked, switchTo, signOutCashier, lock, unlock }
}
