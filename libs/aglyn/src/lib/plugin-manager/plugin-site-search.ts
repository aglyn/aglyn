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

import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'
import { runPluginDeclarationsRepair } from './plugin-declarations-repair'

/**
 * WHAT A PLUGIN LETS A PUBLISHED SITE'S SEARCH PAGE FIND.
 *
 * A site's `/search` walks what the platform owns itself: the published
 * pages, the content collections' entries and the rows those pages repeat
 * over. A plugin that serves pages of its own (a store's product pages) had
 * no way in, so a visitor typing a product's name in the header search was
 * told the store holds nothing by that name.
 *
 * The plugin answers here instead, from its `serverDeclarations`, and the
 * search page asks every source whose plugin is on for the site. The plugin
 * decides what a visitor may find (a product that is live, active and sold
 * online) and where it lives (`/products/{slug}`); the search page decides
 * how a typed word matches it, with the same fuzzy matcher a collection
 * entry's title goes through, so the two can never disagree about a typo.
 *
 * A source hands over CANDIDATES rather than matches. It may narrow its read
 * by the query (a name-token lookup, say), but it never decides relevance.
 *
 * A set, not a slot: several plugins may each add a group of results.
 *
 * Reached by its own subpath, never the barrel: only the tenant's search
 * page asks, and the plugin's boot registers.
 */

/** One thing a visitor could find, as the search page matches and shows it. */
export interface PluginSiteSearchItem {
  /** What the result is called. Fuzzy-matched, and the result's heading. */
  title: string
  /**
   * More words a plain substring test finds the item by: a description, a
   * slug, SKUs, tags, category names. Never fuzzy-matched — a description is
   * prose, and fuzzing it finds everything.
   */
  terms?: readonly string[]
  /** The site path the result links to: `/products/hoodie`. */
  url: string
  /** One line under the heading. May be empty. */
  snippet: string
  /** A thumbnail for the result, when it has one. */
  imageUrl?: string
  /** A short caption beside the result, such as its price ("From $45"). */
  caption?: string
}

/** A group of results one plugin adds. */
export interface PluginSiteSearchSource {
  /**
   * The group's key: its `?in=` value on the search page, so one stable,
   * lowercase word (`products`).
   */
  key: string
  /** The group's tab label: "Products". */
  label: string
  /**
   * The items one site offers for this query, at most `limit`. A site with
   * nothing to offer (no store, no products) answers `[]`.
   */
  items(request: {
    hostId: string
    /** What the visitor typed, trimmed and lower-cased. */
    query: string
    limit: number
  }): Promise<PluginSiteSearchItem[]>
}

export interface RegisteredPluginSiteSearchSource {
  pluginId: string
  source: PluginSiteSearchSource
}

export const PLUGIN_SITE_SEARCH = definePluginServiceContract<PluginSiteSearchSource>(
  'core.site-search',
  { multiple: true },
)

/**
 * Registers one group of results. The same plugin registering the same key
 * again replaces it.
 */
export function registerPluginSiteSearchSource(
  source: PluginSiteSearchSource,
  options?: { pluginId?: string },
): void {
  const key = source.key.trim()
  if (!key) throw new Error('a site search source needs a key')
  registerPluginService(PLUGIN_SITE_SEARCH, source, {
    key,
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/**
 * The sources of the plugins in `enabledPluginIds`, in registration order;
 * a second source under a key already listed is dropped.
 *
 * Nothing registered at all runs the app's declarations step once and asks
 * again, so a boot that failed does not quietly take a store's products out
 * of its search.
 */
export async function listPluginSiteSearchSources(
  enabledPluginIds: readonly string[],
): Promise<RegisteredPluginSiteSearchSource[]> {
  if (!enabledPluginIds.length) return []
  if (!resolvePluginServices(PLUGIN_SITE_SEARCH).length) {
    try {
      await runPluginDeclarationsRepair()
    } catch (error) {
      console.error('[site-search] the declarations repair failed', error)
    }
  }
  const on = new Set(enabledPluginIds)
  const seen = new Set<string>()
  const out: RegisteredPluginSiteSearchSource[] = []
  for (const entry of resolvePluginServices(PLUGIN_SITE_SEARCH)) {
    if (!on.has(entry.pluginId)) continue
    const key = entry.impl.key.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ pluginId: entry.pluginId, source: entry.impl })
  }
  return out
}
