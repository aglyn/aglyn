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

import { PLUGIN_HOST_COLLECTIONS_DECLARED } from './first-party-plugins.generated'
import { hostResourcePlatformCap } from './plugin-host-resources'

/**
 * A plugin's host collection in the platform's whole-site backup (AGL-3080).
 *
 * `/api/hosts/export` writes one JSON bundle of everything designable on a
 * site and `/api/hosts/import` restores it (AGL-163). The platform's own
 * documents — screens, layouts, components, authors, content collections,
 * media — are the routes' to carry. A plugin whose site documents belong in
 * a backup declares so beside the collection, in the `hostCollections` block
 * of `plugins.config.json` (a host collection's `siteExport`), and both
 * routes walk the declarations: the export reads up to `limit` live documents
 * into the bundle under the collection's own name, and the restore writes each
 * one back through `fields` and counts the result against the collection's
 * declared `resource`.
 *
 * ## `fields` is the round trip, not the create
 *
 * A restore writes with `merge: false`, so the list is every key a live
 * document carries — which can be narrower than what a create admits, and is
 * often wider — and a key left off is ERASED from every restored document
 * (AGL-1382). Nothing the restore stamps (`createdAt`, `updatedAt`,
 * `deletedAt`) or scopes (`visibleTo`) is on it; the generator refuses them.
 *
 * ## Compiled, and counted
 *
 * A backup that silently lacks a collection is worse than a failed one: the
 * file looks whole until the day it is restored. So the declarations are
 * compiled, present the moment this module is imported, and a runtime
 * `registerPluginHostCollections` carrying a `siteExport` throws. A restore
 * creates documents with the Admin SDK, past the rules, so the generator also
 * refuses a `siteExport` on a collection with no `resource`: the resource's
 * plan counter or flat platform cap is what the restore is met against.
 *
 * Reached by its own subpath, never the barrel: its readers are the two
 * console routes.
 */
export interface PluginHostCollectionSiteExport {
  /** The most live documents one bundle carries; a restore writes no more. */
  limit: number
  /** The keys a restore writes back. Anything else a bundle carries is dropped. */
  fields: readonly string[]
}

/** What a restore of a declared collection is counted against. */
export type PluginSiteExportCount =
  /** A plan counter, an `OrgEntitlements` key core resolves. */
  | { quotaKey: string }
  /**
   * A flat platform cap, resolved from the name the resource declares, or
   * `null` for a name core does not hold — which a restore refuses.
   */
  | { max: number | null }

/** A declared collection with the plugin that made it and its count. */
export interface ResolvedPluginSiteExportCollection extends PluginHostCollectionSiteExport {
  pluginId: string
  /** The subcollection under `hosts/{hostId}`, and its key in the bundle. */
  collection: string
  /** Plural, for a restore's refusal: "this backup holds 40 {label}". */
  label: string
  count: PluginSiteExportCount
}

/** Every collection a plugin declares for the site backup, in config order. */
export function listPluginSiteExportCollections(): ResolvedPluginSiteExportCollection[] {
  const out: ResolvedPluginSiteExportCollection[] = []
  for (const row of PLUGIN_HOST_COLLECTIONS_DECLARED) {
    const { siteExport, resource } = row
    if (!siteExport || !resource) continue
    out.push({
      pluginId: row.pluginId,
      collection: row.name,
      limit: siteExport.limit,
      fields: siteExport.fields,
      label: resource.label,
      count: resource.quotaKey
        ? { quotaKey: resource.quotaKey }
        : { max: hostResourcePlatformCap(resource.platformCap ?? '') },
    })
  }
  return out
}
