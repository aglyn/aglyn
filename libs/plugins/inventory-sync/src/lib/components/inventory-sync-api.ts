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
import { INVENTORY_SYNC_API_ROUTES } from '../constants'
import type {
  InventoryConnectionSettings,
  InventoryConnectionStatus,
  InventoryConnectionView,
  InventoryLocation,
  InventoryLogEntry,
  InventoryOrderView,
  InventoryProviderId,
} from '../model/inventory-sync'

/** What the deployment offers and the site's connection. */
export interface InventoryConnectionAnswer {
  offered: Array<{ id: InventoryProviderId }>
  connection: InventoryConnectionView | null
  capabilities: { importProducts: boolean }
}

/** Where one order stands, and the connection that could take it. */
export interface InventoryOrderAnswer {
  connection: { provider: InventoryProviderId; status: InventoryConnectionStatus } | null
  order: InventoryOrderView | null
}

/**
 * The console's one way to the routes (AGL-3642): the member's own token,
 * JSON both ways, the route's sentence thrown on a refusal with its status.
 * A spec hands a component its own object of the same shape.
 */
export interface InventorySyncApi {
  connection(): Promise<InventoryConnectionAnswer>
  connectKeys(provider: InventoryProviderId, keys: Record<string, string>): Promise<InventoryConnectionAnswer>
  connectOAuth(accountCode: string, returnTo: string): Promise<string>
  update(settings: InventoryConnectionSettings): Promise<InventoryConnectionView>
  disconnect(): Promise<void>
  locations(): Promise<InventoryLocation[]>
  syncNow(): Promise<InventoryConnectionView | null>
  log(): Promise<{ entries: InventoryLogEntry[] }>
  failedOrders(): Promise<{ orders: InventoryOrderView[] }>
  order(recordId: string): Promise<InventoryOrderAnswer>
  send(recordId: string): Promise<{ order: InventoryOrderView | null }>
}

export function useInventorySyncApi(hostId: string): InventorySyncApi {
  const { data: user } = useUser()
  return useMemo(() => {
    const call = async <T,>(
      route: string,
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
      payload: Record<string, string | boolean | null | undefined> = {},
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
    const routes = INVENTORY_SYNC_API_ROUTES
    return {
      connection: () => call(routes.connection, 'GET'),
      connectKeys: (provider, keys) => call(routes.connectKeys, 'POST', { provider, ...keys }),
      connectOAuth: async (accountCode, returnTo) =>
        (await call<{ url: string }>(routes.connectOAuth, 'POST', { accountCode, returnTo })).url,
      update: async (settings) =>
        (await call<{ connection: InventoryConnectionView }>(routes.settings, 'PATCH', { ...settings })).connection,
      disconnect: async () => {
        await call(routes.settings, 'DELETE')
      },
      locations: async () => (await call<{ locations: InventoryLocation[] }>(routes.locations, 'GET')).locations ?? [],
      syncNow: async () => (await call<{ connection: InventoryConnectionView | null }>(routes.syncNow, 'POST')).connection,
      log: () => call(routes.log, 'GET'),
      failedOrders: () => call(routes.orders, 'GET'),
      order: (recordId) => call(routes.order, 'GET', { recordId }),
      send: (recordId) => call(routes.orderSend, 'POST', { recordId }),
    }
  }, [hostId, user])
}
