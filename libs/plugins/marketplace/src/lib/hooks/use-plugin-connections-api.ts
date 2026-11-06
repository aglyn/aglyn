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
import { useMemo } from 'react'
import type { PluginConnectionCardView } from '../model/plugin-connection-card'
import {
  PLUGIN_CONNECTIONS_API_ROUTES,
  type PluginConnectionCredentialsStatus,
  type PluginConnectionStatusEntry,
} from '../model/plugin-connections'

/** Why a connection route refused, as the routes name it. */
export type PluginConnectionRefusal =
  | 'permission'
  | 'plan'
  | 'credentials'
  | 'not-connected'
  | 'reconnect'
  | 'provider'
  | 'choose-first'
  | 'no-sync'
  | 'too-soon'

/** A route's refusal: its own sentence, its HTTP status and, when it says, why. */
export class PluginConnectionRouteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: PluginConnectionRefusal | null,
    /** The rest of the refusal's JSON: `retryAfterMs` and the view on a `too-soon`. */
    readonly body: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
    this.name = 'PluginConnectionRouteError'
  }
}

export interface PluginConnectionsStatusAnswer {
  configured: boolean
  planAllows: boolean
  connections: PluginConnectionStatusEntry[]
}

export interface PluginConnectionCredentialsAnswer {
  configured: boolean
  credentials: PluginConnectionCredentialsStatus[]
}

/** The site's connection routes, for one site. */
export interface PluginConnectionsApi {
  status(listingId: string): Promise<PluginConnectionsStatusAnswer>
  connectStart(input: { listingId: string; connectionId: string; returnTo: string }): Promise<{ authorizeUrl: string }>
  resources(input: { listingId: string; connectionId: string; resource: string }): Promise<{ items: Array<{ id: string; label: string }> }>
  choose(input: { listingId: string; connectionId: string; resource: string; id: string }): Promise<{ connection: PluginConnectionCardView | null }>
  sync(input: { listingId: string; connectionId: string }): Promise<{ connection: PluginConnectionCardView | null; synced: boolean }>
  disconnect(input: { listingId: string; connectionId: string }): Promise<{ connection: null }>
}

/** A listing's OAuth app credentials, for its publisher. */
export interface PluginConnectionCredentialsApi {
  read(listingId: string): Promise<PluginConnectionCredentialsAnswer>
  save(input: { listingId: string; connectionId: string; clientId: string; clientSecret: string }): Promise<PluginConnectionCredentialsAnswer>
  clear(input: { listingId: string; connectionId: string }): Promise<PluginConnectionCredentialsAnswer>
}

const FALLBACK = 'That did not work. Try again.'
const REASONS: ReadonlySet<string> = new Set([
  'permission',
  'plan',
  'credentials',
  'not-connected',
  'reconnect',
  'provider',
  'choose-first',
  'no-sync',
  'too-soon',
])

/** One call to a connection route: the answer, or the route's refusal as a {@link PluginConnectionRouteError}. */
export async function callPluginConnectionsRoute<T>(
  user: unknown,
  path: string,
  init: { method: 'GET' | 'POST'; query?: Record<string, string>; body?: Record<string, unknown> },
): Promise<T> {
  const search = init.query ? `?${new URLSearchParams(init.query).toString()}` : ''
  let response: Response
  try {
    response = await authorizedFetch(user as never, `/api/${path}${search}`, {
      method: init.method,
      ...(init.body
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }
        : {}),
    })
  } catch {
    throw new PluginConnectionRouteError(FALLBACK, 0, null)
  }
  const data = (await response.json().catch(() => null)) as (Record<string, unknown> & { error?: unknown; reason?: unknown }) | null
  if (!response.ok) {
    const reason = typeof data?.reason === 'string' && REASONS.has(data.reason) ? (data.reason as PluginConnectionRefusal) : null
    const message = typeof data?.error === 'string' && data.error ? data.error : FALLBACK
    throw new PluginConnectionRouteError(message, response.status, reason, data ?? {})
  }
  return (data ?? {}) as T
}

/** The connection routes for one site, as the signed-in member. */
export function usePluginConnectionsApi(hostId: string): PluginConnectionsApi {
  const { data: user } = useUser()
  return useMemo<PluginConnectionsApi>(
    () => ({
      status: (listingId) =>
        callPluginConnectionsRoute(user, PLUGIN_CONNECTIONS_API_ROUTES.status, { method: 'GET', query: { hostId, listingId } }),
      connectStart: (input) =>
        callPluginConnectionsRoute(user, PLUGIN_CONNECTIONS_API_ROUTES.connectStart, { method: 'POST', body: { hostId, ...input } }),
      resources: (input) =>
        callPluginConnectionsRoute(user, PLUGIN_CONNECTIONS_API_ROUTES.resources, { method: 'GET', query: { hostId, ...input } }),
      choose: (input) =>
        callPluginConnectionsRoute(user, PLUGIN_CONNECTIONS_API_ROUTES.choose, { method: 'POST', body: { hostId, ...input } }),
      sync: (input) =>
        callPluginConnectionsRoute(user, PLUGIN_CONNECTIONS_API_ROUTES.sync, { method: 'POST', body: { hostId, ...input } }),
      disconnect: (input) =>
        callPluginConnectionsRoute(user, PLUGIN_CONNECTIONS_API_ROUTES.disconnect, { method: 'POST', body: { hostId, ...input } }),
    }),
    [user, hostId],
  )
}

/** A listing's credentials routes, as the signed-in member. */
export function usePluginConnectionCredentialsApi(): PluginConnectionCredentialsApi {
  const { data: user } = useUser()
  return useMemo<PluginConnectionCredentialsApi>(
    () => ({
      read: (listingId) =>
        callPluginConnectionsRoute(user, PLUGIN_CONNECTIONS_API_ROUTES.credentials, { method: 'GET', query: { listingId } }),
      save: (input) =>
        callPluginConnectionsRoute(user, PLUGIN_CONNECTIONS_API_ROUTES.credentials, { method: 'POST', body: { ...input } }),
      clear: (input) =>
        callPluginConnectionsRoute(user, PLUGIN_CONNECTIONS_API_ROUTES.credentials, {
          method: 'POST',
          body: { ...input, clear: true },
        }),
    }),
    [user],
  )
}
