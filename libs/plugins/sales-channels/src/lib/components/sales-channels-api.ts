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
import { useCallback } from 'react'
import { SALES_CHANNELS_API_ROUTES } from '../constants/bundle-common'
import type { SalesChannelId } from '../model/channels'
import type { CatalogDiagnostics } from '../model/diagnostics'
import type { SalesChannelSettings } from '../model/settings'

/**
 * The console half's one way to the routes (AGL-3637): the member's own
 * token, JSON both ways, and the route's sentence thrown on a refusal so a
 * card can show it as is.
 */

export type SalesChannelsRoute =
  (typeof SALES_CHANNELS_API_ROUTES)[keyof typeof SALES_CHANNELS_API_ROUTES]

export function useSalesChannelsFetch() {
  const { data: user } = useUser()
  return useCallback(
    async <T,>(
      route: SalesChannelsRoute,
      options: { query?: Record<string, string>; body?: unknown } = {},
    ): Promise<T> => {
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

/** One channel's feed, as the state route answers it. */
export interface ChannelState {
  id: SalesChannelId
  enabled: boolean
  url: string | null
  createdAtMs: number | null
  rotatedAtMs: number | null
  lastFetchAtMs: number | null
  lastFetchAgent: string | null
}

/** A channel API connection, never its token (phase 2). */
export interface ConnectionState {
  provider: 'google' | 'meta'
  targetId: string
  targetName: string
  targets: Array<{ id: string; name: string }>
  connectedAtMs: number
  tokenExpiresAtMs?: number
  lastSyncAtMs?: number
  lastSyncResult?: { sent: number; failed: number; errors: string[]; deleted?: number; partial?: boolean }
}

export interface SalesChannelsState {
  sells: boolean
  store: {
    name: string
    origin: string | null
    currency: string
    productPagesServed: boolean
    carrierPricedCountries: string[]
  } | null
  channels: ChannelState[]
  legacy: { url: string | null; active: boolean }
  settings: SalesChannelSettings
  /** Present only on a deployment that configured a channel API (phase 2). */
  connect?: {
    providers: Array<{ provider: 'google' | 'meta'; connection: ConnectionState | null }>
  }
}

export type { CatalogDiagnostics }
