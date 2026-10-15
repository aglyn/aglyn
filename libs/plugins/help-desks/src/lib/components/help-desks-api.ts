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
import { HELP_DESKS_API_ROUTES } from '../constants'
import type {
  HelpDeskConnectionSettings,
  HelpDeskConnectionView,
  HelpDeskCredentialInput,
  HelpDeskLogEntry,
  HelpDeskProviderId,
} from '../model/connections'

/**
 * The card's one way to the routes (AGL-3824): the member's own token, JSON
 * both ways, the route's sentence thrown on a refusal. A spec hands the card
 * its own object of the same shape.
 */
export interface HelpDesksApi {
  list(): Promise<{ available: HelpDeskProviderId[]; connections: HelpDeskConnectionView[] }>
  connect(provider: HelpDeskProviderId, credential: HelpDeskCredentialInput): Promise<HelpDeskConnectionView>
  update(provider: HelpDeskProviderId, settings: HelpDeskConnectionSettings): Promise<HelpDeskConnectionView>
  disconnect(provider: HelpDeskProviderId): Promise<void>
  syncNow(provider: HelpDeskProviderId): Promise<HelpDeskConnectionView | null>
  log(provider: HelpDeskProviderId, before: number | null): Promise<{ entries: HelpDeskLogEntry[]; nextBefore: number | null }>
}

export function useHelpDesksApi(hostId: string): HelpDesksApi {
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
    const routes = HELP_DESKS_API_ROUTES
    return {
      list: () => call(routes.connections, 'GET'),
      connect: async (provider, credential) =>
        (await call<{ connection: HelpDeskConnectionView }>(routes.connections, 'POST', { provider, ...credential })).connection,
      update: async (provider, settings) =>
        (await call<{ connection: HelpDeskConnectionView }>(routes.connection, 'PATCH', { provider, ...settings })).connection,
      disconnect: async (provider) => {
        await call(routes.connection, 'DELETE', { provider })
      },
      syncNow: async (provider) =>
        (await call<{ connection: HelpDeskConnectionView | null }>(routes.syncNow, 'POST', { provider })).connection,
      log: (provider, before) => call(routes.log, 'GET', { provider, ...(before ? { before: String(before) } : {}) }),
    }
  }, [hostId, user])
}
