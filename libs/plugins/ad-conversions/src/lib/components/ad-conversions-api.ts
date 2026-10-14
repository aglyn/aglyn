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
import { AD_CONVERSIONS_API_ROUTES } from '../constants'
import type { AdConnectionSettings, AdConnectionView, AdProviderId, AdSiteSetup } from '../model/connections'

/**
 * The card's one way to the routes (AGL-3694): the member's own token, JSON
 * both ways, the route's sentence thrown on a refusal. A spec hands the card
 * its own object of the same shape.
 */
export interface AdConversionsApi {
  list(): Promise<{ available: boolean; setup: AdSiteSetup; connections: AdConnectionView[] }>
  connect(
    provider: AdProviderId,
    input: { accessToken: string; adAccountId?: string | null; testEventCode?: string | null },
  ): Promise<AdConnectionView>
  update(provider: AdProviderId, settings: AdConnectionSettings): Promise<AdConnectionView>
  disconnect(provider: AdProviderId): Promise<void>
  testEvent(provider: AdProviderId): Promise<AdConnectionView>
}

export function useAdConversionsApi(hostId: string): AdConversionsApi {
  const { data: user } = useUser()
  return useMemo(() => {
    const call = async <T,>(
      route: string,
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
      payload: Record<string, unknown> = {},
    ): Promise<T> => {
      const query = method === 'GET' ? `?${new URLSearchParams({ hostId }).toString()}` : ''
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
    const routes = AD_CONVERSIONS_API_ROUTES
    return {
      list: () => call(routes.connections, 'GET'),
      connect: async (provider, input) =>
        (await call<{ connection: AdConnectionView }>(routes.connections, 'POST', { provider, ...input })).connection,
      update: async (provider, settings) =>
        (await call<{ connection: AdConnectionView }>(routes.connection, 'PATCH', { provider, ...settings })).connection,
      disconnect: async (provider) => {
        await call(routes.connection, 'DELETE', { provider })
      },
      testEvent: async (provider) =>
        (await call<{ connection: AdConnectionView }>(routes.testEvent, 'POST', { provider })).connection,
    }
  }, [hostId, user])
}
