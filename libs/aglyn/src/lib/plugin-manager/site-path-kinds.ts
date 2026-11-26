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
import type { PluginRecordRouteContext } from './plugin-record-routes'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * What a site address a plugin composes IS, for the site's Analytics page.
 *
 * Pageviews are counted per URL path (`analytics/{day}.paths`). A path the
 * site's routing map names is one of its own pages, and a content
 * collection's `/{collection}/{entry}` is the core's to read. A path a
 * plugin composes — commerce's `/products/{slug}` — is neither, so the
 * Analytics page used to show it only under the TEMPLATE screen that drew
 * it: every product as one `cr-product` row. The plugin that owns the
 * address declares it here instead, and the page reads each visited record's
 * own name without naming the plugin.
 *
 * Declarative on purpose: the console reads the records itself, one
 * `where(slugField, 'in', visitedSlugs)` per kind, so a site with 300
 * products pays for the ones that were visited, not the catalog.
 */
export interface SitePathKind {
  /**
   * The first path segment the plugin serves records under: `products` for
   * `/products/{slug}`. Only two-segment paths match.
   */
  segment: string
  /** The grouping the Analytics page files these under: `Products`. */
  groupLabel: string
  /** What one record is called, lower case: `product`. */
  noun: string
  /** The collection under `hosts/{hostId}` its records live in. */
  collection: string
  /** The field holding the address slug. Default `slug`. */
  slugField?: string
  /** The field holding the record's display name. Default `name`. */
  titleField?: string
  /**
   * Whether a document found by slug is one of THIS kind's records — a
   * collection shared with another kind (store collections live beside
   * content collections) filters here. Default: every document.
   */
  accepts?: (data: Record<string, unknown>) => boolean
  /** Where the record is edited in the console; `null` for nowhere. */
  editHref?: (context: PluginRecordRouteContext, id: string) => string | null
}

export interface ResolvedSitePathKind extends SitePathKind {
  pluginId: string
}

export const PLUGIN_SITE_PATH_KINDS = definePluginServiceContract<SitePathKind>(
  'core.site-path-kinds',
  { multiple: true },
)

/**
 * Declares the records a plugin serves at `/{segment}/{slug}`. One segment
 * has one owner: a second plugin claiming it throws naming both, and the
 * incumbent keeps serving.
 */
export function registerSitePathKind(
  kind: SitePathKind,
  options?: { pluginId?: string },
): void {
  const key = kind.segment.trim().replace(/^\/+|\/+$/g, '')
  if (!key || key.includes('/')) {
    throw new Error('a site path kind needs one path segment')
  }
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  const incumbent = resolvePluginServices(PLUGIN_SITE_PATH_KINDS).find(
    (entry) => entry.key === key,
  )
  if (incumbent && pluginId && incumbent.pluginId !== pluginId) {
    throw new Error(
      `site path segment "${key}" is already declared by ` +
        `"${incumbent.pluginId}"; refused "${pluginId}"`,
    )
  }
  registerPluginService(
    PLUGIN_SITE_PATH_KINDS,
    { ...kind, segment: key },
    { ...(options?.pluginId ? { pluginId: options.pluginId } : {}), key },
  )
}

/** Every declared kind, with its owner. */
export function listSitePathKinds(): ResolvedSitePathKind[] {
  return resolvePluginServices(PLUGIN_SITE_PATH_KINDS).map((entry) => ({
    ...entry.impl,
    pluginId: entry.pluginId,
  }))
}

/**
 * A page a plugin serves at one fixed address with no page of the site's own
 * behind it — commerce's `/order-status` — so the Analytics page names it
 * rather than filing it under addresses nothing answers (AGL-4253).
 */
export interface SiteBuiltInPage {
  /** The address, one segment: `order-status`. */
  path: string
  /** What the page is called: `Order status`. */
  title: string
}

export const PLUGIN_SITE_BUILT_IN_PAGES = definePluginServiceContract<SiteBuiltInPage>(
  'core.site-built-in-pages',
  { multiple: true },
)

/** Declares a page a plugin serves at a fixed address. One owner per address. */
export function registerSiteBuiltInPage(
  page: SiteBuiltInPage,
  options?: { pluginId?: string },
): void {
  const key = page.path.trim().replace(/^\/+|\/+$/g, '')
  if (!key || key.includes('/')) {
    throw new Error('a built-in site page needs one path segment')
  }
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  const incumbent = resolvePluginServices(PLUGIN_SITE_BUILT_IN_PAGES).find(
    (entry) => entry.key === key,
  )
  if (incumbent && pluginId && incumbent.pluginId !== pluginId) {
    throw new Error(
      `built-in site page "${key}" is already declared by ` +
        `"${incumbent.pluginId}"; refused "${pluginId}"`,
    )
  }
  registerPluginService(
    PLUGIN_SITE_BUILT_IN_PAGES,
    { ...page, path: key },
    { ...(options?.pluginId ? { pluginId: options.pluginId } : {}), key },
  )
}

/** Every declared built-in page, by address. */
export function listSiteBuiltInPages(): SiteBuiltInPage[] {
  return resolvePluginServices(PLUGIN_SITE_BUILT_IN_PAGES).map((entry) => entry.impl)
}
