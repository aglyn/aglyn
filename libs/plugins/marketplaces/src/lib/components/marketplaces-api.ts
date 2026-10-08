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
import { useMemo } from 'react'
import { MARKETPLACES_API_ROUTES } from '../constants'
import type {
  ListingProblemView,
  MarketplaceConnectionView,
  MarketplaceId,
  MarketplaceLogEntry,
  MarketplaceOrderView,
  MarketplaceSettings,
} from '../model/marketplaces'

/** A marketplace the deployment offers. */
export interface MarketplaceOffer {
  id: MarketplaceId
  sandbox: boolean
}

/** A settings change: any of the settings, or pausing. */
export type MarketplaceSettingsChange = Partial<MarketplaceSettings> & { paused?: boolean }

export interface MarketplaceActivity {
  entries: MarketplaceLogEntry[]
  problems: ListingProblemView[]
  problemsTotal?: number
}

/**
 * The console's one way to the routes (AGL-3638): the member's own token,
 * JSON both ways, the route's sentence thrown on a refusal with its status.
 * A spec hands a component its own object of the same shape.
 */
export interface MarketplacesApi {
  list(): Promise<{ offered: MarketplaceOffer[]; connections: MarketplaceConnectionView[] }>
  connect(marketplace: MarketplaceId, returnTo: string): Promise<string>
  update(marketplace: MarketplaceId, settings: MarketplaceSettingsChange): Promise<MarketplaceConnectionView>
  disconnect(marketplace: MarketplaceId): Promise<void>
  syncNow(marketplace: MarketplaceId): Promise<MarketplaceConnectionView | null>
  activity(marketplace: MarketplaceId): Promise<MarketplaceActivity>
  order(recordId: string): Promise<MarketplaceOrderView | null>
  retry(recordId: string): Promise<MarketplaceOrderView | null>
}

export function useMarketplacesApi(hostId: string): MarketplacesApi {
  const { data: user } = useUser()
  return useMemo(() => {
    const call = async <T,>(
      route: string,
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
      payload: Record<string, unknown> = {},
    ): Promise<T> => {
      const query =
        method === 'GET' ? `?${new URLSearchParams({ hostId, ...(payload as Record<string, string>) }).toString()}` : ''
      const response = await authorizedFetch(user, `/api/${route}${query}`, {
        method,
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
        ...(method === 'GET' ? {} : { body: JSON.stringify({ hostId, ...payload }) }),
      })
      const answer = (await response.json().catch(() => ({}))) as T & { error?: string }
      if (!response.ok) {
        throw Object.assign(new Error(answer?.error ?? 'Something went wrong. Try again.'), { status: response.status })
      }
      return answer
    }
    const routes = MARKETPLACES_API_ROUTES
    return {
      list: () => call(routes.connections, 'GET'),
      connect: async (marketplace, returnTo) => (await call<{ url: string }>(routes.connect, 'POST', { marketplace, returnTo })).url,
      update: async (marketplace, settings) =>
        (await call<{ connection: MarketplaceConnectionView }>(routes.connection, 'PATCH', { marketplace, ...settings })).connection,
      disconnect: async (marketplace) => {
        await call(routes.connection, 'DELETE', { marketplace })
      },
      syncNow: async (marketplace) =>
        (await call<{ connection: MarketplaceConnectionView | null }>(routes.syncNow, 'POST', { marketplace })).connection,
      activity: (marketplace) => call(routes.activity, 'GET', { marketplace }),
      order: async (recordId) => (await call<{ order: MarketplaceOrderView | null }>(routes.order, 'GET', { recordId })).order,
      retry: async (recordId) => (await call<{ order: MarketplaceOrderView | null }>(routes.orderRetry, 'POST', { recordId })).order,
    }
  }, [hostId, user])
}
