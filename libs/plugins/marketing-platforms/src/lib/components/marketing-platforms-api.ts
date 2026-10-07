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
import { MARKETING_PLATFORMS_API_ROUTES } from '../constants'
import type {
  MarketingConnectionLogEntry,
  MarketingConnectionSettings,
  MarketingConnectionView,
  MarketingProviderId,
} from '../model/connections'

/** What the deployment offers for one provider. */
export interface MarketingProviderOffer {
  id: MarketingProviderId
  apiKey: boolean
  oauth: boolean
}

/**
 * The card's one way to the routes (AGL-3639): the member's own token, JSON
 * both ways, the route's sentence thrown on a refusal. A spec hands the card
 * its own object of the same shape.
 */
export interface MarketingPlatformsApi {
  list(): Promise<{ available: MarketingProviderOffer[]; connections: MarketingConnectionView[] }>
  connect(provider: MarketingProviderId, apiKey: string): Promise<MarketingConnectionView>
  update(provider: MarketingProviderId, settings: MarketingConnectionSettings): Promise<MarketingConnectionView>
  disconnect(provider: MarketingProviderId): Promise<void>
  syncNow(provider: MarketingProviderId): Promise<MarketingConnectionView | null>
  log(provider: MarketingProviderId, before: number | null): Promise<{ entries: MarketingConnectionLogEntry[]; nextBefore: number | null }>
  oauthStart(provider: MarketingProviderId, returnTo: string): Promise<string>
}

export function useMarketingPlatformsApi(hostId: string): MarketingPlatformsApi {
  const { data: user } = useUser()
  return useMemo(() => {
    const call = async <T,>(
      route: string,
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
      payload: Record<string, unknown> = {},
    ): Promise<T> => {
      const query = method === 'GET' ? `?${new URLSearchParams({ hostId, ...(payload as Record<string, string>) }).toString()}` : ''
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
    const routes = MARKETING_PLATFORMS_API_ROUTES
    return {
      list: () => call(routes.connections, 'GET'),
      connect: async (provider, apiKey) =>
        (await call<{ connection: MarketingConnectionView }>(routes.connections, 'POST', { provider, apiKey })).connection,
      update: async (provider, settings) =>
        (await call<{ connection: MarketingConnectionView }>(routes.connection, 'PATCH', { provider, ...settings }))
          .connection,
      disconnect: async (provider) => {
        await call(routes.connection, 'DELETE', { provider })
      },
      syncNow: async (provider) =>
        (await call<{ connection: MarketingConnectionView | null }>(routes.syncNow, 'POST', { provider })).connection,
      log: (provider, before) =>
        call(routes.log, 'GET', { provider, ...(before ? { before: String(before) } : {}) }),
      oauthStart: async (provider, returnTo) =>
        (await call<{ url: string }>(routes.oauthStart, 'POST', { provider, returnTo })).url,
    }
  }, [hostId, user])
}
