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
import { FULFILLMENT_NETWORKS_API_ROUTES } from '../constants'
import type {
  NetworkConnectionSettings,
  NetworkConnectionStatus,
  NetworkConnectionView,
  NetworkLogEntry,
  NetworkOrderView,
  NetworkProviderId,
} from '../model/networks'

/** A network the deployment offers. */
export interface NetworkOffer {
  id: NetworkProviderId
  sandbox: boolean
}

/** Where an API-key network's webhooks go, and the secret they are signed with: answered once. */
export interface NetworkWebhookSetup {
  url: string | null
  secret: string
}

/** Where one order stands, and the connections that could take it. */
export interface NetworkOrderAnswer {
  connections: Array<{ provider: NetworkProviderId; status: NetworkConnectionStatus; sandbox: boolean }>
  routings: NetworkOrderView[]
}

/**
 * The console's one way to the routes (AGL-3634): the member's own token,
 * JSON both ways, the route's sentence thrown on a refusal with its status.
 * A spec hands a component its own object of the same shape.
 */
export interface FulfillmentNetworksApi {
  list(): Promise<{ offered: NetworkOffer[]; connections: NetworkConnectionView[] }>
  connect(provider: NetworkProviderId, returnTo: string): Promise<string>
  /** Connects a network with the merchant's own API key (ShipMonk, AGL-3697). */
  connectKey(
    provider: NetworkProviderId,
    input: { apiKey: string; storeId: string },
  ): Promise<{ connection: NetworkConnectionView | null; webhook: NetworkWebhookSetup | null }>
  /** A new webhook signing secret, shown once. */
  rotateWebhookSecret(provider: NetworkProviderId): Promise<NetworkWebhookSetup>
  update(provider: NetworkProviderId, settings: NetworkConnectionSettings): Promise<NetworkConnectionView>
  disconnect(provider: NetworkProviderId): Promise<void>
  syncNow(provider: NetworkProviderId): Promise<NetworkConnectionView | null>
  log(provider: NetworkProviderId): Promise<{ entries: NetworkLogEntry[] }>
  order(recordId: string): Promise<NetworkOrderAnswer>
  send(recordId: string, provider: NetworkProviderId): Promise<NetworkOrderAnswer>
  cancel(recordId: string, provider: NetworkProviderId): Promise<NetworkOrderAnswer>
}

export function useFulfillmentNetworksApi(hostId: string): FulfillmentNetworksApi {
  const { data: user } = useUser()
  return useMemo(() => {
    const call = async <T,>(
      route: string,
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
      payload: Record<string, string | boolean | undefined> = {},
    ): Promise<T> => {
      const query =
        method === 'GET'
          ? `?${new URLSearchParams({ hostId, ...(payload as Record<string, string>) }).toString()}`
          : ''
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
    const routes = FULFILLMENT_NETWORKS_API_ROUTES
    return {
      list: () => call(routes.connections, 'GET'),
      connect: async (provider, returnTo) => (await call<{ url: string }>(routes.connect, 'POST', { provider, returnTo })).url,
      connectKey: (provider, input) => call(routes.connectKey, 'POST', { provider, apiKey: input.apiKey, storeId: input.storeId }),
      rotateWebhookSecret: async (provider) =>
        (await call<{ webhook: NetworkWebhookSetup }>(routes.webhookSecret, 'POST', { provider })).webhook,
      update: async (provider, settings) =>
        (await call<{ connection: NetworkConnectionView }>(routes.connection, 'PATCH', { provider, ...settings })).connection,
      disconnect: async (provider) => {
        await call(routes.connection, 'DELETE', { provider })
      },
      syncNow: async (provider) =>
        (await call<{ connection: NetworkConnectionView | null }>(routes.syncNow, 'POST', { provider })).connection,
      log: (provider) => call(routes.log, 'GET', { provider }),
      order: (recordId) => call(routes.order, 'GET', { recordId }),
      send: (recordId, provider) => call(routes.orderSend, 'POST', { recordId, provider }),
      cancel: (recordId, provider) => call(routes.orderCancel, 'POST', { recordId, provider }),
    }
  }, [hostId, user])
}
