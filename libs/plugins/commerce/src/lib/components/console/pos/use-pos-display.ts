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

import { useCallback, useEffect, useRef, useState } from 'react'
import type * as CommerceModel from '../../../model'
import { newAttemptKey, posDisplayCall } from './pos-api'

type User = Parameters<typeof posDisplayCall>[0]

/**
 * The tip the customer screen shows beside the sale (AGL-3608): the tips
 * already on its payments, plus one chosen for the payment about to be taken
 * (on the display or by the cashier), which the ledger does not hold until
 * that payment is recorded. Without the second part the screen read the
 * sale's total right after the customer added a tip, short by that tip.
 */
export function posDisplayTipCents(
  sale: { status: string; tipCents: number } | null | undefined,
  pendingTipCents: number,
): number {
  if (!sale) return 0
  const pending = sale.status === 'paid' ? 0 : Math.max(0, Math.round(pendingTipCents) || 0)
  return Math.max(0, sale.tipCents) + pending
}

/** How long the register waits for the customer to answer a prompt. */
export const POS_DISPLAY_ANSWER_TIMEOUT_MS = 3 * 60 * 1000

export interface PosDisplayControl {
  /** A display for this register polled within the last two minutes. */
  connected: boolean
  /** The prompt the register is waiting on, if any. */
  asking: CommerceModel.PosDisplayMode | null
  /** Shows something on the display with no answer expected. */
  show: (state: Omit<CommerceModel.PosDisplayState, 'updatedAtMs' | 'promptId'>) => Promise<void>
  /**
   * Asks the customer (a tip or a receipt) and resolves with their answer,
   * or null when the cashier cancels or the customer does not answer.
   */
  ask: (
    state: Omit<CommerceModel.PosDisplayState, 'updatedAtMs' | 'promptId'>,
  ) => Promise<CommerceModel.PosDisplayResponse | null>
  cancelAsk: () => void
  /** A fresh six-digit pairing code for a new display. */
  pairingCode: () => Promise<{ code: string; expiresAtMs: number }>
}

/**
 * The register's half of the customer display (AGL-3608). It writes the
 * display's state through `commerce/pos-display` and reads answers back the
 * same way; nothing here talks to Firestore, because the display state is
 * server-only (it can hold a customer's typed email address).
 */
export function usePosDisplay(
  user: User | null | undefined,
  hostId: string,
  registerId: string,
): PosDisplayControl {
  const [connected, setConnected] = useState(false)
  const [asking, setAsking] = useState<CommerceModel.PosDisplayMode | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  // The poll reads the latest session through a ref and is keyed on the uid,
  // so a refreshed user object does not restart it.
  const userRef = useRef(user)
  userRef.current = user
  const uid = (user as { uid?: string } | null | undefined)?.uid ?? ''

  useEffect(() => {
    if (!uid || !registerId) return undefined
    let active = true
    const check = async () => {
      const signedIn = userRef.current
      if (!signedIn) return
      try {
        const result = await posDisplayCall<{ connected: boolean }>(
          signedIn,
          { action: 'state', hostId, registerId },
          'GET',
        )
        if (active) setConnected(Boolean(result.connected))
      } catch {
        if (active) setConnected(false)
      }
    }
    void check()
    const timer = setInterval(check, 15_000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [uid, hostId, registerId])

  const show = useCallback<PosDisplayControl['show']>(
    async (state) => {
      if (!user || !registerId || !connected) return
      await posDisplayCall(user, { action: 'push', hostId, registerId, state }).catch(() => undefined)
    },
    [user, hostId, registerId, connected],
  )

  const cancelAsk = useCallback(() => {
    cancelRef.current?.()
  }, [])

  const ask = useCallback<PosDisplayControl['ask']>(
    async (state) => {
      if (!user || !registerId) return null
      cancelRef.current?.()
      const promptId = newAttemptKey().slice(0, 32)
      await posDisplayCall(user, {
        action: 'push',
        hostId,
        registerId,
        state: { ...state, promptId },
      })
      setAsking(state.mode)
      return await new Promise<CommerceModel.PosDisplayResponse | null>((resolve) => {
        let done = false
        const finish = (answer: CommerceModel.PosDisplayResponse | null) => {
          if (done) return
          done = true
          clearInterval(timer)
          clearTimeout(timeout)
          cancelRef.current = null
          setAsking(null)
          resolve(answer)
        }
        const timer = setInterval(async () => {
          try {
            const result = await posDisplayCall<{
              state: CommerceModel.PosDisplayState | null
            }>(user, { action: 'state', hostId, registerId }, 'GET')
            const response = result.state?.response
            if (response && response.promptId === promptId) finish(response)
          } catch {
            // A missed poll is retried on the next tick.
          }
        }, 1000)
        const timeout = setTimeout(() => finish(null), POS_DISPLAY_ANSWER_TIMEOUT_MS)
        cancelRef.current = () => finish(null)
      })
    },
    [user, hostId, registerId],
  )

  const pairingCode = useCallback(async () => {
    if (!user) throw new Error('Not signed in')
    const result = await posDisplayCall<{ code: string; expiresAtMs: number }>(user, {
      action: 'pairing-code',
      hostId,
      registerId,
    })
    return result
  }, [user, hostId, registerId])

  return { connected, asking, show, ask, cancelAsk, pairingCode }
}
