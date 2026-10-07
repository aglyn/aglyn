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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useEffect, useState } from 'react'
import { SHIPPING_API_ROUTES } from '../constants/api-routes'

/**
 * The console half's one way to the routes (AGL-3612): the member's own
 * token, JSON both ways, and the route's sentence thrown on a refusal so a
 * card can show it as is.
 */

export type ShippingRoute = (typeof SHIPPING_API_ROUTES)[keyof typeof SHIPPING_API_ROUTES]

export function useShippingFetch() {
  const { data: user } = useUser()
  return useCallback(
    async <T,>(
      route: ShippingRoute,
      options: { query?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {},
    ): Promise<T> => {
      const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : ''
      const response = await authorizedFetch(user, `/api/${route}${query}`, {
        method: options.body === undefined ? 'GET' : 'POST',
        headers: {
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(options.headers ?? {}),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      })
      const payload = (await response.json().catch(() => ({}))) as T & { error?: string }
      if (!response.ok) throw new Error(payload?.error ?? 'Something went wrong. Try again.')
      return payload
    },
    [user],
  )
}

export interface ShippingAvailability {
  loading: boolean
  /** A platform to ship through exists for the workspace. */
  available: boolean
  provider?: string
  testMode?: boolean
  /** That platform is the merchant's own Easyship or Sendcloud account (AGL-3632). */
  ownAccount?: boolean
  /** The deployment offers merchant-account services to connect (AGL-3632). */
  ownAccounts?: boolean
  /** The deployment has a platform provider to fall back to without one. */
  platform?: boolean
}

/**
 * Whether labels and carrier rates exist for this site. Every card draws
 * nothing until this says `available`: a deployment with no provider shows no
 * shipping surface at all.
 */
export function useShippingAvailability(hostId: string | undefined): ShippingAvailability {
  const request = useShippingFetch()
  const [state, setState] = useState<ShippingAvailability>({ loading: true, available: false })
  useEffect(() => {
    let live = true
    if (!hostId) {
      setState({ loading: false, available: false })
      return
    }
    request<Omit<ShippingAvailability, 'loading'>>(SHIPPING_API_ROUTES.availability, {
      query: { hostId },
    })
      .then((answer) => {
        if (live) setState({ loading: false, ...answer })
      })
      .catch(() => {
        if (live) setState({ loading: false, available: false })
      })
    return () => {
      live = false
    }
  }, [hostId, request])
  return state
}

/** Integer cents as money a merchant reads. */
export function formatCents(cents: number, currency = 'usd'): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(
      cents / 100,
    )
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}

/** A key one purchase attempt carries across its retries. */
export function newAttemptKey(prefix = 'lbl'): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  return `${prefix}_${random}`.slice(0, 80)
}
