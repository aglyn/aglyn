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

import type { CatalogStore } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { resolveHostEnabledPlugins } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import { getOrgForHost } from '@aglyn/tenant-data-admin'
import { SALES_CHANNELS_API_ROUTES } from '../constants/bundle-common'
import { SALES_CHANNELS, salesChannel, type SalesChannelDefinition, type SalesChannelId } from '../model/channels'
import { diagnoseCatalog } from '../model/diagnostics'
import { normalizeSalesChannelSettings } from '../model/settings'
import { CatalogUnavailableError, readOffers, readStore } from './catalog-source'
import {
  getChannelState,
  getFeed,
  retireLegacyGoogleFeed,
  rotateFeedToken,
  saveSettings,
  setFeedEnabled,
  type FeedDocument,
} from './feed-store'
import { channelsGate, readJsonBody, routeError, routeJson, type RouteActor } from './route-gate'
import { COMMERCE_PLUGIN_ID } from './site-gate'

/**
 * THE SALES CHANNELS CARD'S ROUTES (AGL-3637), served by the console:
 *
 *   GET  sales-channels/state        every channel's feed, its URL and the defaults (viewer)
 *   POST sales-channels/channel      switch one channel's feed on or off (editor)
 *   POST sales-channels/rotate       replace one channel's feed token (admin)
 *   POST sales-channels/legacy       stop the pre-channels Google address (admin)
 *   POST sales-channels/settings     the store's defaults for blank fields (editor)
 *   GET  sales-channels/diagnostics  what each feed leaves out, and why (viewer)
 *
 * Every route climbs {@link channelsGate}. A token is shown only inside its
 * feed's URL, and only to a member who may read the site's settings: a
 * viewer sees the address a channel fetches the same as an editor, since a
 * viewer can already read every product the feed holds.
 */

/** At most this many offers are read for diagnostics; the answer says when there were more. */
export const DIAGNOSTICS_MAX_OFFERS = 5000

/** The feed's address, on the store's own origin. */
export function feedUrl(
  store: Pick<CatalogStore, 'origin'> | null,
  hostId: string,
  channel: SalesChannelDefinition,
  token: string,
): string | null {
  if (!store?.origin || !token) return null
  const path = SALES_CHANNELS_API_ROUTES.feed
    .replace(':channel', channel.id)
    .replace(':file', `${token}.${channel.extension}`)
  return `${store.origin}/api/${path}?hostId=${encodeURIComponent(hostId)}`
}

/** The pre-channels Google address, which carries no token. */
export function legacyFeedUrl(store: Pick<CatalogStore, 'origin'> | null, hostId: string): string | null {
  if (!store?.origin) return null
  return `${store.origin}/api/${SALES_CHANNELS_API_ROUTES.legacyGoogleFeed}?hostId=${encodeURIComponent(hostId)}`
}

/**
 * Whether the pre-channels address answers: until the Google channel is set
 * up it serves as it always did, and after, it follows the Google feed's
 * switch until it is retired.
 */
export function legacyFeedActive(google: FeedDocument | undefined | null): boolean {
  if (!google) return true
  return google.enabled && !google.legacyRetired
}

export interface ChannelView {
  id: SalesChannelId
  enabled: boolean
  url: string | null
  createdAtMs: number | null
  rotatedAtMs: number | null
  lastFetchAtMs: number | null
  lastFetchAgent: string | null
}

function channelView(
  channel: SalesChannelDefinition,
  feed: FeedDocument | undefined | null,
  store: CatalogStore | null,
  hostId: string,
): ChannelView {
  return {
    id: channel.id,
    enabled: Boolean(feed?.enabled),
    url: feed?.token ? feedUrl(store, hostId, channel, feed.token) : null,
    createdAtMs: feed?.createdAtMs || null,
    rotatedAtMs: feed?.rotatedAtMs ?? null,
    lastFetchAtMs: feed?.lastFetchAtMs ?? null,
    lastFetchAgent: feed?.lastFetchAgent ?? null,
  }
}

/** Whether commerce, which owns the catalog, is switched on for the site. */
async function sellsOnSite(actor: RouteActor): Promise<boolean> {
  const resolved = await getOrgForHost(actor.hostId)
  if (!resolved) return false
  return resolveHostEnabledPlugins(
    resolved.org as { enabledPlugins?: string[] },
    actor.host as { disabledPlugins?: string[]; enabledPlugins?: string[] },
  ).includes(COMMERCE_PLUGIN_ID)
}

async function storeOrNull(hostId: string): Promise<CatalogStore | null> {
  try {
    return await readStore(hostId)
  } catch (error) {
    if (error instanceof CatalogUnavailableError) return null
    throw error
  }
}

const methodNotAllowed = (allow: string) =>
  new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: allow, 'Cache-Control': 'no-store' },
  })

function channelFromBody(body: Record<string, unknown>): SalesChannelDefinition | Response {
  const channel = salesChannel(String(body['channel'] ?? ''))
  return channel ?? routeError(400, 'Unknown channel')
}

export async function stateRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  const actor = await channelsGate(request, { role: 'viewer' })
  if (actor instanceof Response) return actor
  try {
    const [sells, store, state] = await Promise.all([
      sellsOnSite(actor),
      storeOrNull(actor.hostId),
      getChannelState(actor.hostId),
    ])
    // The API connections (phase 2): nothing unless the deployment is set up.
    const extras = await (await import('./connect/connect-state')).connectState(actor)
    return routeJson({
      sells: sells && Boolean(store),
      store: store
        ? {
            name: store.name,
            origin: store.origin,
            currency: store.currency,
            productPagesServed: store.productPagesServed,
            carrierPricedCountries: store.carrierPricedCountries ?? [],
          }
        : null,
      channels: SALES_CHANNELS.map((channel) => channelView(channel, state.feeds[channel.id], store, actor.hostId)),
      legacy: {
        url: legacyFeedUrl(store, actor.hostId),
        active: legacyFeedActive(state.feeds.google),
      },
      settings: state.settings,
      ...extras,
    })
  } catch (error) {
    console.error('sales-channels: state failed', error)
    return routeError(500, 'The sales channels could not be read. Try again.')
  }
}

export async function channelRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const body = await readJsonBody(request)
  const actor = await channelsGate(request, { role: 'editor', body })
  if (actor instanceof Response) return actor
  const channel = channelFromBody(body)
  if (channel instanceof Response) return channel
  if (typeof body['enabled'] !== 'boolean') return routeError(400, 'Say whether the feed is on')
  if (body['enabled'] && !(await sellsOnSite(actor))) {
    return routeError(409, 'Turn on Commerce for this site first: the feeds list its products.')
  }
  try {
    const feed = await setFeedEnabled({
      hostId: actor.hostId,
      channel: channel.id,
      enabled: body['enabled'],
      uid: actor.uid,
    })
    const store = await storeOrNull(actor.hostId)
    return routeJson({ channel: channelView(channel, feed, store, actor.hostId) })
  } catch (error) {
    console.error('sales-channels: switch failed', error)
    return routeError(500, 'The feed could not be switched. Try again.')
  }
}

export async function rotateRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const body = await readJsonBody(request)
  const actor = await channelsGate(request, { role: 'admin', body })
  if (actor instanceof Response) return actor
  const channel = channelFromBody(body)
  if (channel instanceof Response) return channel
  try {
    const held = await getFeed(actor.hostId, channel.id)
    if (!held) return routeError(409, 'Turn the feed on first.')
    const feed = await rotateFeedToken({ hostId: actor.hostId, channel: channel.id, uid: actor.uid })
    const store = await storeOrNull(actor.hostId)
    return routeJson({ channel: channelView(channel, feed, store, actor.hostId) })
  } catch (error) {
    console.error('sales-channels: rotate failed', error)
    return routeError(500, 'The feed address could not be replaced. Try again.')
  }
}

export async function legacyRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const body = await readJsonBody(request)
  const actor = await channelsGate(request, { role: 'admin', body })
  if (actor instanceof Response) return actor
  try {
    const feed = await retireLegacyGoogleFeed({ hostId: actor.hostId, uid: actor.uid })
    return routeJson({ legacy: { active: legacyFeedActive(feed) } })
  } catch (error) {
    console.error('sales-channels: retire failed', error)
    return routeError(500, 'The old address could not be turned off. Try again.')
  }
}

export async function settingsRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const body = await readJsonBody(request)
  const actor = await channelsGate(request, { role: 'editor', body })
  if (actor instanceof Response) return actor
  const raw = body['settings']
  if (!raw || typeof raw !== 'object') return routeError(400, 'Missing settings')
  try {
    const settings = await saveSettings({
      hostId: actor.hostId,
      settings: normalizeSalesChannelSettings(raw),
      uid: actor.uid,
    })
    return routeJson({ settings })
  } catch (error) {
    console.error('sales-channels: settings failed', error)
    return routeError(500, 'The defaults could not be saved. Try again.')
  }
}

export async function diagnosticsRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  const actor = await channelsGate(request, { role: 'viewer' })
  if (actor instanceof Response) return actor
  try {
    const [store, state] = await Promise.all([storeOrNull(actor.hostId), getChannelState(actor.hostId)])
    if (!store) return routeError(409, 'This site has no store to list.')
    const { offers, partial } = await readOffers(actor.hostId, DIAGNOSTICS_MAX_OFFERS)
    return routeJson(diagnoseCatalog({ store, settings: state.settings, offers, partial }))
  } catch (error) {
    if (error instanceof CatalogUnavailableError) return routeError(409, 'This site has no store to list.')
    console.error('sales-channels: diagnostics failed', error)
    return routeError(500, 'The products could not be checked. Try again.')
  }
}
