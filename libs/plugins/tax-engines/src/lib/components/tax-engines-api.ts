'use client'

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
import { useCallback, useEffect, useState } from 'react'
import type { TaxEnginesRoute } from '../constants/api-routes'
import { TAX_ENGINES_API_ROUTES } from '../constants/api-routes'
import type { TaxEngineConnectionView, TaxEngineProviderId } from '../model/tax-engines'

/**
 * The console half's one way to the routes (AGL-3631): the member's own
 * token, JSON both ways, and the route's sentence thrown on a refusal so a
 * card can show it as is.
 */
export function useTaxEnginesFetch() {
  const { data: user } = useUser()
  return useCallback(
    async <T,>(
      route: TaxEnginesRoute,
      options: { query?: Record<string, string>; body?: unknown } = {},
    ): Promise<T> => {
      const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : ''
      const response = await authorizedFetch(user, `/api/${route}${query}`, {
        method: options.body === undefined ? 'GET' : 'POST',
        headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      })
      const payload = (await response.json().catch(() => ({}))) as T & { error?: string }
      if (!response.ok) {
        throw Object.assign(new Error(payload?.error ?? 'Something went wrong. Try again.'), {
          status: response.status,
        })
      }
      return payload
    },
    [user],
  )
}

export interface TaxEngineConnectionState {
  loading: boolean
  /** Whether this deployment and site can hold a connection at all. */
  available: boolean
  providers: Array<{ id: TaxEngineProviderId; label: string }>
  connection: TaxEngineConnectionView | null
  refresh: () => Promise<void>
  replace: (connection: TaxEngineConnectionView | null) => void
}

/**
 * The site's connection. Every widget draws NOTHING until this says
 * `available`: a deployment without the sealing key, a site whose plan does
 * not sell, or one with tax services switched off shows no tax-service
 * surface at all.
 */
export function useTaxEngineConnection(hostId: string | undefined): TaxEngineConnectionState {
  const request = useTaxEnginesFetch()
  const [state, setState] = useState<Omit<TaxEngineConnectionState, 'refresh' | 'replace'>>({
    loading: true,
    available: false,
    providers: [],
    connection: null,
  })
  const refresh = useCallback(async () => {
    if (!hostId) {
      setState({ loading: false, available: false, providers: [], connection: null })
      return
    }
    try {
      const answer = await request<{
        available: boolean
        providers: Array<{ id: TaxEngineProviderId; label: string }>
        connection: TaxEngineConnectionView | null
      }>(TAX_ENGINES_API_ROUTES.connection, { query: { hostId } })
      setState({ loading: false, ...answer })
    } catch {
      setState({ loading: false, available: false, providers: [], connection: null })
    }
  }, [hostId, request])
  useEffect(() => {
    void refresh()
  }, [refresh])
  const replace = useCallback(
    (connection: TaxEngineConnectionView | null) => setState((current) => ({ ...current, connection })),
    [],
  )
  return { ...state, refresh, replace }
}
