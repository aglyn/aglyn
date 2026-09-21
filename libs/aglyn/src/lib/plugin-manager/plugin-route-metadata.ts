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

/**
 * What a plugin's page says about itself in the `<head>` (AGL-3080).
 *
 * A console page that a plugin draws has its head built by the SHELL: the
 * page is a client component and cannot export metadata, so the nearest
 * server layout does it, and for every plugin route that layout is the
 * generic one. It can title a page from the slugs in the URL and nothing
 * more — which is correct for a hub and wrong for a record. A marketplace
 * listing shared into Slack unfurled as the same generic console card as
 * every other listing until the app grew a hand-written route with a layout
 * of its own, and that route is one of the ~20 that cannot move onto the
 * generic one while this is the only way to have a card.
 *
 * So the plugin declares how to answer for an address under its own route,
 * and the shell asks.
 *
 * ## The head is not a framework's
 *
 * A declaration answers a {@link PluginRouteHead} — a title, a description,
 * an image — and never Next's `Metadata`. Core does not depend on a web
 * framework and a plugin must not have to; more usefully, how a title,
 * description and image become `openGraph` and `twitter` tags is the SHELL's
 * knowledge and the same for every route: which card size degrades without
 * an image, that defining `openGraph` replaces the root layout's wholesale
 * so the site name has to be restated. A plugin that wrote those tags itself
 * would get a different answer per plugin, and the two that got it wrong
 * would look exactly like the two that got it right until somebody shared a
 * link.
 *
 * ## Absent is a real answer, and so is silence
 *
 * `resolve` answers `null` for an address it has nothing to add about — a
 * hub, a tab, a record it must not describe — and the shell keeps the title
 * it would have built. That is the same answer as a plugin that declares
 * nothing at all, deliberately: a head is an enrichment, and a route with no
 * declaration is the ordinary case rather than a degraded one.
 *
 * ⛔ WHICH MAKES THE LOADING ORDER THE WHOLE RISK. This is a runtime
 * registry, and an unfilled one answers "nothing to add" for every address —
 * silently, and indistinguishably from the honest answer. A layout that asked
 * before loading the plugin's server surface would drop every card it was
 * built to produce and stay green. A registry is nonetheless the right shape
 * here, and a compiled table is not: the answer depends on the DOCUMENT
 * behind the address, so it cannot be compiled, and the reader is a server
 * layout that already awaits — so it can load the surface first, which is
 * what `pluginRouteHead` in the console does and what the app's
 * `*-is-registered` spec holds it to.
 *
 * ## One route, one owner
 *
 * A route belongs to the plugin that serves it, so a second plugin's
 * declaration for the same route is refused naming both and the incumbent
 * keeps answering. The same plugin declaring again — a hot reload, a second
 * surface — replaces its own.
 *
 * Server-side: reached by its own subpath, never through
 * `plugin-manager/index.ts`. What a published page does not need, it must
 * not import.
 */

import type { ResolvedSocialImage } from '../app-utils/social-image'
import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/** What one address under a plugin's route says about itself. */
export interface PluginRouteHead {
  /**
   * The page's own title, before the shell's scope and brand are affixed.
   * Absent leaves the title the shell built from the URL.
   */
  title?: string
  /** One or two sentences. Already cut to whatever budget the owner keeps. */
  description?: string
  /**
   * The card image, already resolved and absolute —
   * `resolveSocialImage` answers exactly this shape. A crawler reads it out
   * of band, so a relative URL is not a card, it is a broken one.
   */
  image?: ResolvedSocialImage
}

export interface PluginRouteMetadataDeclaration {
  /**
   * The plugin's own console route, as its `contributes.console.routes`
   * spells it and without the leading slash: `marketplace`.
   */
  route: string
  /**
   * Answers for one address under that route. The segments are what follows
   * the route itself — `['listing-1']` for `/acme/marketplace/listing-1` —
   * so a declaration reads the address it understands and answers `null` for
   * every other, including the route's own hub.
   *
   * ⚠️ IT RUNS ON THE RENDER PATH and must never throw: an unhandled
   * rejection in a layout's metadata fails the whole route, and this route's
   * job is to serve its page whether or not the card resolves. The shell
   * catches anyway, because a plugin's mistake must not cost a page.
   */
  resolve(segments: readonly string[]): Promise<PluginRouteHead | null>
}

/** A declaration with the plugin that made it. */
export type ResolvedPluginRouteMetadata = PluginRouteMetadataDeclaration & {
  pluginId: string
}

export const PLUGIN_ROUTE_METADATA =
  definePluginServiceContract<PluginRouteMetadataDeclaration>(
    'core.route-metadata',
    { multiple: true },
  )

/**
 * Declares how a plugin answers for addresses under one of its routes. The
 * owner is the loader's marker when a register fn is running, else
 * `options.pluginId`.
 */
export function registerPluginRouteMetadata(
  declaration: PluginRouteMetadataDeclaration,
  options?: { pluginId?: string },
): void {
  const key = declaration.route?.trim().replace(/^\/+/, '') ?? ''
  if (!key) throw new Error('a plugin route metadata declaration needs a route')
  if (typeof declaration.resolve !== 'function') {
    throw new Error(`route metadata for "${key}" needs a resolve function`)
  }
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  const incumbent = resolvePluginServices(PLUGIN_ROUTE_METADATA).find(
    (entry) => entry.key === key,
  )
  if (incumbent && pluginId && incumbent.pluginId !== pluginId) {
    throw new Error(
      `route metadata for "${key}" is already declared by ` +
        `"${incumbent.pluginId}"; refused "${pluginId}"`,
    )
  }
  registerPluginService(
    PLUGIN_ROUTE_METADATA,
    { ...declaration, route: key },
    {
      ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
      key,
    },
  )
}

/** The declaration for one route, or `null` when nobody declared one. */
export function pluginRouteMetadata(
  route: string,
): ResolvedPluginRouteMetadata | null {
  const key = String(route ?? '')
    .trim()
    .replace(/^\/+/, '')
  const entry = resolvePluginServices(PLUGIN_ROUTE_METADATA).find(
    (one) => one.key === key,
  )
  return entry ? { ...entry.impl, pluginId: entry.pluginId } : null
}

/**
 * What one address says about itself, or `null` when nothing does.
 *
 * ⚠️ A DECLARATION THAT THROWS COSTS THE PAGE NOTHING. The head is an
 * enrichment of a page that renders without it, and a layout's metadata
 * rejecting fails the route — so the failure is logged and the shell falls
 * back to the title it built itself.
 *
 * ⛔ It asks the registry as it stands. A caller that has not loaded the
 * plugins' server surfaces gets `null` for every address, which is the same
 * answer as a route nobody declared — see the module docblock.
 */
export async function resolvePluginRouteHead(
  route: string,
  segments: readonly string[],
): Promise<PluginRouteHead | null> {
  const declared = pluginRouteMetadata(route)
  if (!declared) return null
  try {
    return (await declared.resolve(segments)) ?? null
  } catch (error) {
    console.error(
      `[route-metadata] "${declared.pluginId}" failed to answer for ` +
        `${route}/${segments.join('/')}`,
      error,
    )
    return null
  }
}

/** Every declared route, with its plugin, in registration order. */
export function listPluginRouteMetadata(): ResolvedPluginRouteMetadata[] {
  return resolvePluginServices(PLUGIN_ROUTE_METADATA).map((entry) => ({
    ...entry.impl,
    pluginId: entry.pluginId,
  }))
}
