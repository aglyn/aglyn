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

import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import {
  PLUGIN_CONNECTIONS_API_PREFIX,
  PLUGIN_CONNECTIONS_API_ROUTES,
  type PluginConnectionStatusEntry,
  type PluginConnectionView,
} from './plugin-connections'

/*
 * WHAT THE CONNECTION CARDS SAY (AGL-4196), kept apart from React so the
 * console card, the publisher's credentials card and their specs read one
 * answer. Pure: no Firestore, no fetch, no window.
 */

/**
 * "Sync now", served by the marketplace beside the other connection routes.
 * Named here until the route table carries it; the shape is
 * `POST { hostId, listingId, connectionId }` → `{ connection }`.
 */
export const PLUGIN_CONNECTIONS_SYNC_ROUTE: string =
  (PLUGIN_CONNECTIONS_API_ROUTES as Readonly<Record<string, string>>)['sync'] ?? `${PLUGIN_CONNECTIONS_API_PREFIX}/sync`

/** The address a publisher registers at the provider as the OAuth app's redirect URI. */
export function pluginConnectionRedirectUri(origin: string = platformConsoleOrigin()): string {
  return `${origin.replace(/\/+$/, '')}/api/${PLUGIN_CONNECTIONS_API_ROUTES.connectCallback}`
}

/** A view as the card reads it: the sync may also say when it runs next. */
export type PluginConnectionCardView = PluginConnectionView & { nextSyncAtMs?: number | null }

/**
 * Where one declared connection stands for a site, in the order the card
 * checks: a deployment without the key first, then the site's own grant,
 * then what the publisher has set up.
 */
export type PluginConnectionPhase =
  | 'not-configured'
  | 'not-set-up'
  | 'not-connected'
  | 'choosing'
  | 'connected'
  | 'reconnect'
  | 'error'

export function pluginConnectionPhase(entry: PluginConnectionStatusEntry, configured: boolean): PluginConnectionPhase {
  if (!configured) return 'not-configured'
  const connection = entry.connection
  if (!connection) return entry.credentialsSet ? 'not-connected' : 'not-set-up'
  if (connection.status === 'reconnect_required') return 'reconnect'
  if (connection.status === 'error') return 'error'
  return connection.ready ? 'connected' : 'choosing'
}

/** The first declared resource the site has not chosen yet, in order. */
export function nextResourceToChoose(
  entry: Pick<PluginConnectionStatusEntry, 'resources' | 'connection'>,
): { id: string; label: string } | null {
  const choices = entry.connection?.choices ?? {}
  return entry.resources.find((resource) => !choices[resource.id]) ?? null
}

/** The status chip each phase wears. */
export const PLUGIN_CONNECTION_PHASE_CHIP: Readonly<
  Record<PluginConnectionPhase, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'error' }>
> = {
  'not-configured': { label: 'Not available yet', tone: 'neutral' },
  'not-set-up': { label: 'Waiting on the publisher', tone: 'neutral' },
  'not-connected': { label: 'Not connected', tone: 'neutral' },
  choosing: { label: 'Finish setting up', tone: 'info' },
  connected: { label: 'Connected', tone: 'success' },
  reconnect: { label: 'Reconnect needed', tone: 'warning' },
  error: { label: 'Sync failed', tone: 'error' },
}

/** What a site owner is told when a deployment cannot run connections. */
export const PLUGIN_CONNECTIONS_NOT_CONFIGURED_TEXT =
  'Connecting plugins to other services is not available here yet.'

/** What a site owner is told while the publisher has not set the connection up. */
export function pluginConnectionNotSetUpText(label: string): string {
  return `The plugin's publisher has not finished setting up ${label} yet. You can connect once they have.`
}

/** The query the connect callback adds to the page it returns to. */
export const PLUGIN_CONNECTION_RETURN_PARAMS = {
  listing: 'pluginConnectionListing',
  connection: 'pluginConnection',
  result: 'pluginConnectionResult',
} as const

export type PluginConnectionResult = 'connected' | 'denied' | 'expired' | 'failed' | 'not-permitted' | 'not-set-up'

const RESULT_MESSAGES: Readonly<
  Record<PluginConnectionResult, { variant: 'success' | 'warning' | 'error'; message: (label: string) => string }>
> = {
  connected: { variant: 'success', message: (label) => `Connected ${label}.` },
  denied: { variant: 'warning', message: (label) => `Access to ${label} was not granted, so nothing was connected.` },
  expired: { variant: 'error', message: () => 'The connection took too long or was already used. Connect again.' },
  failed: { variant: 'error', message: (label) => `${label} could not be connected. Try again.` },
  'not-permitted': {
    variant: 'error',
    message: () => 'You can no longer connect this here: the site, its plan or your permissions changed.',
  },
  'not-set-up': { variant: 'error', message: (label) => pluginConnectionNotSetUpText(label) },
}

export interface PluginConnectionReturn {
  listingId: string
  connectionId: string
  result: PluginConnectionResult
  /** The page's address without the three parameters. */
  cleanUrl: string
}

/**
 * The outcome the connect callback left on `href` for `listingId`, and the
 * address to replace it with, or `null` when it carries none for it.
 */
export function readPluginConnectionReturn(href: string, listingId: string): PluginConnectionReturn | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  const params = url.searchParams
  const result = params.get(PLUGIN_CONNECTION_RETURN_PARAMS.result)
  if (params.get(PLUGIN_CONNECTION_RETURN_PARAMS.listing) !== listingId) return null
  if (!result || !(result in RESULT_MESSAGES)) return null
  const connectionId = params.get(PLUGIN_CONNECTION_RETURN_PARAMS.connection) ?? ''
  for (const key of Object.values(PLUGIN_CONNECTION_RETURN_PARAMS)) params.delete(key)
  return {
    listingId,
    connectionId,
    result: result as PluginConnectionResult,
    cleanUrl: `${url.pathname}${url.search}${url.hash}`,
  }
}

/** The snackbar a returned connect shows. */
export function pluginConnectionResultMessage(
  result: PluginConnectionResult,
  label: string,
): { variant: 'success' | 'warning' | 'error'; message: string } {
  const entry = RESULT_MESSAGES[result]
  return { variant: entry.variant, message: entry.message(label) }
}

/**
 * When the next scheduled sync runs: what the sync recorded when it says,
 * else the last one plus the pinned manifest's interval. A connection with
 * every choice made and no sync yet runs on the next pass.
 */
export function pluginConnectionNextSyncAtMs(
  view: PluginConnectionCardView | null,
  intervalHours: number | null | undefined,
): number | 'soon' | null {
  if (!view || view.status === 'reconnect_required' || !view.ready) return null
  if (typeof view.nextSyncAtMs === 'number') return view.nextSyncAtMs
  if (!intervalHours || intervalHours <= 0) return null
  if (view.lastSyncAtMs === null) return 'soon'
  return view.lastSyncAtMs + intervalHours * 3_600_000
}

/** The sync interval a pinned manifest declares for one connection, if any. */
export function declaredSyncIntervalHours(manifest: unknown, connectionId: string): number | null {
  const connections = (manifest as { connections?: unknown } | null | undefined)?.connections
  if (!Array.isArray(connections)) return null
  const found = connections.find(
    (one): one is { id: string; sync?: { intervalHours?: unknown } } =>
      Boolean(one) && typeof one === 'object' && (one as { id?: unknown }).id === connectionId,
  )
  const hours = found?.sync?.intervalHours
  return typeof hours === 'number' && Number.isFinite(hours) ? hours : null
}

/** The connections a pinned manifest declares, by id and label: what the card can name before the status answers. */
export function declaredPluginConnections(manifest: unknown): Array<{ id: string; label: string; description?: string }> {
  const connections = (manifest as { connections?: unknown } | null | undefined)?.connections
  if (!Array.isArray(connections)) return []
  return connections.flatMap((one) => {
    if (!one || typeof one !== 'object') return []
    const { id, label, description } = one as { id?: unknown; label?: unknown; description?: unknown }
    if (typeof id !== 'string' || !id || typeof label !== 'string' || !label) return []
    return [{ id, label, ...(typeof description === 'string' && description ? { description } : {}) }]
  })
}

/** A date and time as the cards print it. */
export function formatConnectionTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
