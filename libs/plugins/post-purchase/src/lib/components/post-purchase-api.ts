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
import { POST_PURCHASE_API_ROUTES } from '../constants/api-routes'
import type { PostPurchaseVendor } from '../constants/bundle-common'

/**
 * The console half's one way to the routes (AGL-3635): the member's own
 * token, JSON both ways, and the route's sentence thrown on a refusal so a
 * card can show it as is.
 */

export type PostPurchaseRoute = (typeof POST_PURCHASE_API_ROUTES)[keyof typeof POST_PURCHASE_API_ROUTES]

export function usePostPurchaseFetch() {
  const { data: user } = useUser()
  return useCallback(
    async <T,>(route: PostPurchaseRoute, options: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> => {
      const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : ''
      const response = await authorizedFetch(user, `/api/${route}${query}`, {
        method: options.body === undefined ? 'GET' : 'POST',
        headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      })
      const payload = (await response.json().catch(() => ({}))) as T & { error?: string }
      if (!response.ok) throw new Error(payload?.error ?? 'Something went wrong. Try again.')
      return payload
    },
    [user],
  )
}

export interface PostPurchaseAvailability {
  loading: boolean
  available: boolean
  vendors: PostPurchaseVendor[]
}

/**
 * Which services exist for this site. Every card draws nothing until this
 * says `available`: a deployment that offers none shows no surface at all.
 */
export function usePostPurchaseAvailability(hostId: string | undefined): PostPurchaseAvailability {
  const request = usePostPurchaseFetch()
  const [state, setState] = useState<PostPurchaseAvailability>({ loading: true, available: false, vendors: [] })
  useEffect(() => {
    let live = true
    if (!hostId) {
      setState({ loading: false, available: false, vendors: [] })
      return
    }
    request<{ available: boolean; vendors: PostPurchaseVendor[] }>(POST_PURCHASE_API_ROUTES.availability, {
      query: { hostId },
    })
      .then((answer) => {
        if (live) setState({ loading: false, available: Boolean(answer.available), vendors: answer.vendors ?? [] })
      })
      .catch(() => {
        if (live) setState({ loading: false, available: false, vendors: [] })
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
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}
