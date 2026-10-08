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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useEffect, useRef, useState } from 'react'
import { POD_API_ROUTES, type PodRoute } from '../constants/api-routes'
import type { StatusTone } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import type { PodConnectionView, PodOrderStatus, PodProviderId } from '../model/print-on-demand'

/**
 * The console half's one way to the routes (AGL-3641): the member's own
 * token, JSON both ways, and the route's sentence thrown on a refusal so a
 * widget can show it as is.
 *
 * The function's identity follows the member's uid, not their session
 * object, and it reads the member at call time: an effect that loads through
 * it runs again when someone signs in or out, and not each time the session
 * object is rebuilt — which would otherwise reload, re-render and reload
 * without end.
 */
export function usePodFetch() {
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const uid = (user as { uid?: string } | null | undefined)?.uid ?? null
  return useCallback(
    async <T,>(route: PodRoute, options: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> => {
      const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : ''
      const response = await authorizedFetch(userRef.current, `/api/${route}${query}`, {
        method: options.body === undefined ? 'GET' : 'POST',
        headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      })
      const payload = (await response.json().catch(() => ({}))) as T & { error?: string }
      if (!response.ok) {
        throw Object.assign(new Error(payload?.error ?? 'Something went wrong. Try again.'), {
          status: response.status,
          payload,
        })
      }
      return payload
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `uid` is the identity on purpose; the call reads `userRef`.
    [uid],
  )
}

export interface PodProviderOffer {
  id: PodProviderId
  label: string
  tokenHelp: { label: string; url: string; steps: string }
}

export interface PodConnectionsState {
  loading: boolean
  /** Whether this deployment and site can hold a connection at all. */
  available: boolean
  storeCurrency: string
  providers: PodProviderOffer[]
  connections: PodConnectionView[]
  refresh: () => Promise<void>
}

/**
 * The site's connections. Every widget draws NOTHING until this says
 * `available`: a deployment without the sealing key, a site whose plan does
 * not sell, or one with print on demand switched off shows no surface at all.
 */
export function usePodConnections(hostId: string | undefined): PodConnectionsState {
  const request = usePodFetch()
  const [state, setState] = useState<Omit<PodConnectionsState, 'refresh'>>({
    loading: true,
    available: false,
    storeCurrency: 'USD',
    providers: [],
    connections: [],
  })
  const refresh = useCallback(async () => {
    if (!hostId) {
      setState((current) => ({ ...current, loading: false, available: false }))
      return
    }
    try {
      const answer = await request<{
        available: boolean
        storeCurrency: string
        providers: PodProviderOffer[]
        connections: PodConnectionView[]
      }>(POD_API_ROUTES.connections, { query: { hostId } })
      setState({ loading: false, ...answer })
    } catch {
      setState({ loading: false, available: false, storeCurrency: 'USD', providers: [], connections: [] })
    }
  }, [hostId, request])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { ...state, refresh }
}

/** An amount in its currency, as the member's locale writes it. */
export function formatMoney(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined) return '—'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(minor / 100)
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}

/** A date, short. */
export function formatDate(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The tone each order status is shown in. */
export const POD_STATUS_TONE: Record<PodOrderStatus, StatusTone> = {
  queued: 'info',
  draft: 'warning',
  submitted: 'info',
  on_hold: 'warning',
  in_production: 'info',
  partially_shipped: 'info',
  shipped: 'success',
  canceled: 'neutral',
  failed: 'error',
}
