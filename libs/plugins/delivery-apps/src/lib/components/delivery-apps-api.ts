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
import { DELIVERY_APPS_API_ROUTES } from '../constants'
import type {
  DeliveryCatalogOption,
  DeliveryItemMatchView,
  DeliveryOrderAction,
  DeliveryOrderView,
  DeliveryQueueAnswer,
  DeliveryServiceId,
  DeliveryStoreSettings,
  DeliveryStoresAnswer,
  DeliveryStoreView,
} from '../model/delivery-apps'

/**
 * The console's one way to the routes (AGL-3644): the member's own token,
 * JSON both ways, the route's sentence thrown on a refusal with its status.
 * A spec hands a component its own object of the same shape.
 */
export interface DeliveryAppsApi {
  stores(): Promise<DeliveryStoresAnswer>
  connect(service: DeliveryServiceId, externalStoreId: string, settings: DeliveryStoreSettings): Promise<DeliveryStoreView>
  update(service: DeliveryServiceId, settings: DeliveryStoreSettings): Promise<DeliveryStoreView>
  disconnect(service: DeliveryServiceId): Promise<void>
  sendMenu(service: DeliveryServiceId): Promise<number>
  items(service: DeliveryServiceId): Promise<DeliveryItemMatchView[]>
  match(service: DeliveryServiceId, item: DeliveryItemMatchView, option: DeliveryCatalogOption | null): Promise<void>
  searchCatalog(query: string): Promise<DeliveryCatalogOption[]>
  queue(): Promise<DeliveryQueueAnswer>
  act(orderId: string, action: DeliveryOrderAction, reason?: string): Promise<{ message: string | null; order: DeliveryOrderView | null }>
}

export function useDeliveryAppsApi(hostId: string): DeliveryAppsApi {
  const { data: user } = useUser()
  return useMemo(() => {
    const call = async <T,>(route: string, method: 'GET' | 'POST' | 'DELETE', payload: Record<string, unknown> = {}): Promise<T> => {
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
    const R = DELIVERY_APPS_API_ROUTES
    return {
      stores: () => call(R.stores, 'GET'),
      connect: async (service, externalStoreId, settings) =>
        (await call<{ store: DeliveryStoreView }>(R.store, 'POST', { service, externalStoreId, settings })).store,
      update: async (service, settings) => (await call<{ store: DeliveryStoreView }>(R.store, 'POST', { service, settings })).store,
      disconnect: async (service) => {
        await call(R.store, 'DELETE', { service })
      },
      sendMenu: async (service) => (await call<{ items: number }>(R.menu, 'POST', { service })).items,
      items: async (service) => (await call<{ items: DeliveryItemMatchView[] }>(R.items, 'GET', { service })).items,
      match: async (service, item, option) => {
        await call(R.items, 'POST', {
          service,
          externalItemId: item.externalItemId,
          name: item.name,
          ...(option
            ? { productId: option.productId, variantId: option.variantId, title: option.title }
            : { clear: true }),
        })
      },
      searchCatalog: async (q) => (await call<{ options: DeliveryCatalogOption[] }>(R.catalog, 'GET', { q })).options,
      queue: () => call(R.queue, 'GET'),
      act: async (orderId, action, reason) =>
        call<{ message: string | null; order: DeliveryOrderView | null }>(R.orderAction, 'POST', {
          orderId,
          action,
          ...(reason ? { reason } : {}),
        }),
    }
  }, [hostId, user])
}
