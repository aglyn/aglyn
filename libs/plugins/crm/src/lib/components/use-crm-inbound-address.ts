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

import { useCallback, useEffect, useState } from 'react'
import { useCrmApi } from './use-crm-api'

/** What the address route has answered so far. */
export type CrmInboundAddressState =
  | { status: 'idle' | 'loading'; address: null; error: null }
  | { status: 'ready'; address: string; error: null }
  | { status: 'error'; address: null; error: string }

export type CrmInboundRotateResult =
  | { ok: true; address: string }
  | { ok: false; error: string }

export interface CrmInboundAddress {
  status: CrmInboundAddressState['status']
  address: string | null
  error: string | null
  /** Replaces the token; the new address is in the answer and in `address`. */
  rotate: () => Promise<CrmInboundRotateResult>
  rotating: boolean
}

const READ_FAILED = 'The capture address could not be read.'
const ROTATE_FAILED = 'The capture address could not be rotated.'

const addressOf = (payload: Record<string, unknown>): string =>
  typeof payload['address'] === 'string' ? payload['address'] : ''

/**
 * The workspace's email capture address (AGL-2657), asked of
 * `crm/inbound-address` when `enabled` turns on — a dialog's open, a
 * settings card's mount — and never before: the first ask mints the token,
 * and a surface that asked on every paint would mint on behalf of members
 * who never wanted the address.
 *
 * The site is whatever the surface is mounted under; at the organization
 * level `null`, and the route's org variant answers, because the address
 * is the organization's whichever site asks.
 */
export function useCrmInboundAddress(
  hostId: string | null,
  options: { enabled: boolean },
): CrmInboundAddress {
  const { enabled } = options
  const crmApi = useCrmApi(hostId)
  const [state, setState] = useState<CrmInboundAddressState>({
    status: 'idle',
    address: null,
    error: null,
  })
  const [rotating, setRotating] = useState(false)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    setState({ status: 'loading', address: null, error: null })
    void crmApi('inbound-address', {})
      .then(({ response, payload }) => {
        if (cancelled) return
        const address = addressOf(payload)
        if (!response.ok || !address) {
          setState({
            status: 'error',
            address: null,
            error: String(payload['error'] ?? READ_FAILED),
          })
          return
        }
        setState({ status: 'ready', address, error: null })
      })
      .catch((cause) => {
        console.error(cause)
        if (!cancelled) setState({ status: 'error', address: null, error: READ_FAILED })
      })
    return () => {
      cancelled = true
    }
  }, [enabled, crmApi])

  const rotate = useCallback(async (): Promise<CrmInboundRotateResult> => {
    setRotating(true)
    try {
      const { response, payload } = await crmApi('inbound-address', { rotate: true })
      const address = addressOf(payload)
      if (!response.ok || !address) {
        return { ok: false, error: String(payload['error'] ?? ROTATE_FAILED) }
      }
      setState({ status: 'ready', address, error: null })
      return { ok: true, address }
    } catch (cause) {
      console.error(cause)
      return { ok: false, error: ROTATE_FAILED }
    } finally {
      setRotating(false)
    }
  }, [crmApi])

  return { ...state, rotate, rotating }
}

export default useCrmInboundAddress
