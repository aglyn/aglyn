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
import { useEffect, useMemo, useState } from 'react'
import { COURIERS_API_ROUTES } from '../constants'
import type {
  CourierConnectionView,
  CourierKeyMode,
  CourierOrderView,
  CourierProviderId,
} from '../model/couriers'

/** What the connection route answers: whether the deployment and site offer couriers, and the site's connection. */
export interface CourierConnectionAnswer {
  available: boolean
  providers: Array<{ id: CourierProviderId; label: string; product: string; portal: string }>
  connection: CourierConnectionView | null
}

export interface CourierKeysInput {
  developerId: string
  keyId: string
  signingSecret: string
}

/**
 * The console's one way to the routes (AGL-3695): the member's own token,
 * JSON both ways, the route's sentence thrown on a refusal with its status.
 * A spec hands a component its own object of the same shape.
 */
export interface CouriersApi {
  connection(): Promise<CourierConnectionAnswer>
  connect(
    provider: CourierProviderId,
    keys: Partial<Record<CourierKeyMode, CourierKeysInput>>,
  ): Promise<{ connection: CourierConnectionView; webhookToken: string | null }>
  test(provider: CourierProviderId): Promise<CourierConnectionView>
  settings(provider: CourierProviderId, settings: { pickupPhone: string; pickupNote: string }): Promise<CourierConnectionView>
  webhookToken(provider: CourierProviderId): Promise<{ connection: CourierConnectionView; webhookToken: string }>
  disconnect(provider: CourierProviderId): Promise<void>
  order(orderId: string): Promise<CourierOrderView>
  quote(orderId: string, provider: CourierProviderId): Promise<CourierOrderView>
  dispatch(orderId: string, idempotencyKey: string): Promise<CourierOrderView>
  cancel(orderId: string): Promise<CourierOrderView>
  refresh(orderId: string): Promise<CourierOrderView>
}

export function useCouriersApi(hostId: string): CouriersApi {
  const { data: user } = useUser()
  return useMemo(() => {
    const call = async <T,>(route: string, method: 'GET' | 'POST', payload: Record<string, unknown> = {}): Promise<T> => {
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
    const routes = COURIERS_API_ROUTES
    return {
      connection: () => call(routes.connection, 'GET'),
      connect: (provider, keys) => call(routes.connect, 'POST', { provider, ...keys }),
      test: async (provider) => (await call<{ connection: CourierConnectionView }>(routes.test, 'POST', { provider })).connection,
      settings: async (provider, settings) =>
        (await call<{ connection: CourierConnectionView }>(routes.settings, 'POST', { provider, ...settings })).connection,
      webhookToken: (provider) => call(routes.webhookToken, 'POST', { provider }),
      disconnect: async (provider) => {
        await call(routes.disconnect, 'POST', { provider })
      },
      order: (orderId) => call(routes.order, 'GET', { orderId }),
      quote: (orderId, provider) => call(routes.quote, 'POST', { orderId, provider }),
      dispatch: (orderId, idempotencyKey) => call(routes.dispatch, 'POST', { orderId, idempotencyKey }),
      cancel: (orderId) => call(routes.cancel, 'POST', { orderId }),
      refresh: (orderId) => call(routes.refresh, 'POST', { orderId }),
    }
  }, [hostId, user])
}

/**
 * One answer per site for a minute, shared by every queue row and the order
 * dialog, so a queue of fifty deliveries asks once whether couriers exist.
 */
const cache = new Map<string, { atMs: number; answer: Promise<CourierConnectionAnswer> }>()
const CACHE_MS = 60_000

const UNAVAILABLE: CourierConnectionAnswer = { available: false, providers: [], connection: null }

/** Forgets the cached answer for a site: after a connect, a disconnect or a settings change. */
export function forgetCourierConnection(hostId: string): void {
  cache.delete(hostId)
}

/** The site's courier connection, or `null` while loading. Unavailable on any refusal. */
export function useCourierConnection(hostId: string, api: CouriersApi | null): CourierConnectionAnswer | null {
  const [answer, setAnswer] = useState<CourierConnectionAnswer | null>(null)
  useEffect(() => {
    if (!api) return
    let live = true
    const cached = cache.get(hostId)
    const entry =
      cached && Date.now() - cached.atMs < CACHE_MS
        ? cached
        : { atMs: Date.now(), answer: api.connection().catch(() => UNAVAILABLE) }
    cache.set(hostId, entry)
    void entry.answer.then((value) => {
      if (live) setAnswer(value)
    })
    return () => {
      live = false
    }
  }, [api, hostId])
  return answer
}

/** A fresh key for one booking attempt; a retry reuses it. */
export const newAttemptKey = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '')
