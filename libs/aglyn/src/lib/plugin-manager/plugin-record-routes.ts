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

import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * Where a plugin's records live, published by the plugin that owns them
 * (AGL-3124).
 *
 * A surface that is not the record's own routinely wants to link to it: an
 * inbox row to the person it is from, a form's page to the people who filled
 * it in, an assistant's job list to the campaign it wrote. Today each of those
 * builds the other plugin's address itself — four plugins spell each other's
 * URLs, and the core carries a fifth copy for the console app, which may not
 * import a plugin at all.
 *
 * Every copy is the same bug waiting: an address is the owner's to change, and
 * a section that moves leaves a link that still resolves, to the wrong place.
 *
 * So the owner publishes its addresses under the RECORD KIND, and a caller
 * asks for a kind. `plugin-record-facts` already keys a reader by resource
 * name and `plugin-record-timeline` already files an entry on a record; this
 * is the third question about the same record — where a person reads it — and
 * it is keyed the same way, so a plugin that owns `contact` registers the
 * facts reader and the route together and a caller names `contact` for both.
 *
 * ## What a caller passes, and why it is the two route params
 *
 * Every site console page is addressed by `/{orgSlug}/hosts/{host}/…`, and both
 * segments are already in the URL the calling surface is rendered on. Building
 * from them costs nothing; resolving them from a host id costs two document
 * reads on every render of a card, to draw a link. `host: null` asks for the
 * ORGANIZATION-level address, which some kinds have and some do not — a route
 * answers `null` for a scope it does not serve, and the caller renders text
 * rather than a link to nowhere.
 *
 * ## One kind, one owner
 *
 * A record kind belongs to the plugin that models it, so a second plugin
 * publishing addresses for a kind another already publishes is refused naming
 * both, and the incumbent keeps serving. The same plugin registering again —
 * a second surface, a hot reload — replaces its own.
 *
 * The registry knows nothing about permissions: a link is not access, and the
 * page at the far end applies its own gates, as it does for a person who typed
 * the address.
 */

/** The scope an address is asked for. */
export interface PluginRecordRouteContext {
  /** The organization's path slug, as the console URL spells it. */
  orgSlug: string
  /** The site's subdomain, or `null` for the organization-level address. */
  host: string | null
}

/**
 * The addresses one record kind publishes. Every member answers `null` for a
 * scope the owner does not serve — an org-level page a host-scoped kind has
 * no address for, a list a kind does not have.
 */
export interface PluginRecordRoute {
  /** The list the kind lives on. */
  list(context: PluginRecordRouteContext): string | null
  /** One record's own page. */
  record(context: PluginRecordRouteContext, id: string): string | null
  /**
   * The list opened on the one person with an address, where the owner offers
   * it — for a caller that holds an email and no record id.
   */
  byEmail?(context: PluginRecordRouteContext, email: string): string | null
  /**
   * The list narrowed by one of the owner's own filters, where the owner
   * offers it: `filter` and `value` are the owner's words, and a filter it
   * does not know answers `null` rather than a list showing everything.
   */
  filtered?(
    context: PluginRecordRouteContext,
    filter: string,
    value: string,
  ): string | null
}

/** A route with the plugin that publishes it. */
export interface ResolvedPluginRecordRoute {
  /** The plugin that owns the kind. */
  pluginId: string
  route: PluginRecordRoute
}

export const PLUGIN_RECORD_ROUTES =
  definePluginServiceContract<PluginRecordRoute>('core.record-routes', {
    multiple: true,
  })

/**
 * Publishes the addresses for one record kind. The owner is the loader's
 * marker when a register fn is running, else `options.pluginId`; with neither
 * the registration throws. A kind another plugin publishes throws naming both.
 */
export function registerPluginRecordRoute(
  kind: string,
  route: PluginRecordRoute,
  options?: { pluginId?: string },
): void {
  const key = kind.trim()
  if (!key) throw new Error('a record route needs a record kind')
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  const incumbent = resolvePluginServices(PLUGIN_RECORD_ROUTES).find(
    (entry) => entry.key === key,
  )
  if (incumbent && pluginId && incumbent.pluginId !== pluginId) {
    throw new Error(
      `record kind "${key}" already publishes routes from ` +
        `"${incumbent.pluginId}"; refused "${pluginId}"`,
    )
  }
  registerPluginService(PLUGIN_RECORD_ROUTES, route, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
    key,
  })
}

/** The route for a kind, with its owner, or `null` when no plugin publishes it. */
export function pluginRecordRoute(
  kind: string,
): ResolvedPluginRecordRoute | null {
  const key = kind.trim()
  const entry = resolvePluginServices(PLUGIN_RECORD_ROUTES).find(
    (one) => one.key === key,
  )
  return entry ? { pluginId: entry.pluginId, route: entry.impl } : null
}

/** Every kind with a published route, in registration order. */
export function listPluginRecordRouteKinds(): Array<{
  kind: string
  pluginId: string
}> {
  return resolvePluginServices(PLUGIN_RECORD_ROUTES).map((entry) => ({
    kind: entry.key ?? '',
    pluginId: entry.pluginId,
  }))
}

/**
 * One record's page, or `null` — no plugin publishes the kind, or the owner
 * has no address for it at this scope. A caller renders text for `null`
 * rather than a link, which is what every one of these surfaces already does
 * while its route params settle.
 */
export function pluginRecordHref(
  kind: string,
  context: PluginRecordRouteContext,
  id: string,
): string | null {
  return pluginRecordRoute(kind)?.route.record(context, id) ?? null
}

/** The list a kind lives on, on the same terms as {@link pluginRecordHref}. */
export function pluginRecordListHref(
  kind: string,
  context: PluginRecordRouteContext,
): string | null {
  return pluginRecordRoute(kind)?.route.list(context) ?? null
}

/**
 * The list opened on one person's address, or `null` — including when the
 * owner publishes routes for the kind but offers no address lookup.
 */
export function pluginRecordByEmailHref(
  kind: string,
  context: PluginRecordRouteContext,
  email: string,
): string | null {
  const found = pluginRecordRoute(kind)
  return found?.route.byEmail?.(context, email) ?? null
}

/**
 * The list narrowed by one of the owner's filters, or `null` — including for
 * a filter the owner does not know, which it answers `null` for rather than
 * serving a list that ignores the narrowing.
 */
export function pluginRecordFilteredHref(
  kind: string,
  context: PluginRecordRouteContext,
  filter: string,
  value: string,
): string | null {
  const found = pluginRecordRoute(kind)
  return found?.route.filtered?.(context, filter, value) ?? null
}
