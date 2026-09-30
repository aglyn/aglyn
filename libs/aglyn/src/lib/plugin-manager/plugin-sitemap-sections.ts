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

import { PLUGIN_SITEMAP_SECTIONS_DECLARED } from './first-party-plugins.generated'

/**
 * A child sitemap a plugin's documents fill, declared by that plugin
 * (AGL-3080).
 *
 * The tenant's `/sitemap.xml` is an index over one child per section (AGL-2520):
 * the site's pages, its content collections and its authors are the platform's
 * and are built by the route itself. A plugin that serves pages of its own — a
 * product at `/products/{slug}` — had its section written into that route by
 * hand: the collection, the filter, the store setting that switches it on, the
 * address and the date field were all core's knowledge of one plugin's model.
 *
 * So the plugin declares the section, and the route builds every declared one
 * the same way: counted for the index, paged by document id for the child.
 *
 * ## Compiled, because the reader is a published page's
 *
 * The sitemap is what a search engine is told the site holds. A section
 * registered at runtime would be missing from any process that had not loaded
 * the plugin, and a crawler reads a missing section as pages that no longer
 * exist — the products drop out of the index silently, on a live site. So
 * sections are compiled from `plugins.config.json` by
 * `tools/scripts/generate-plugin-manifests.mjs`, present the moment this
 * module is imported, and there is no registrar.
 *
 * ## What a declaration can say
 *
 * Only what a sitemap needs and a query can express: one equality filter, the
 * setting that must be set for the pages to render at all, the address with
 * `{slug}` in it, a field that drops a row (a soft delete), and the date
 * fields to try in order. A row without a slug addresses nothing and is left
 * out. Anything richer belongs to the plugin's own page, not to its sitemap.
 *
 * Reached by its own subpath, never the barrel.
 */
export interface PluginSitemapSectionDeclaration {
  /** The section's path segment: `/sitemaps/{section}/{page}.xml`. */
  section: string
  /** The subcollection under `hosts/{hostId}` whose documents are the pages. */
  collection: string
  /** The one equality a document must meet to be a page. */
  where?: { field: string; equals: string | number | boolean }
  /**
   * A `collection/doc` under the host and a field on it that must be set for
   * the section to exist: the template the pages render through. Unset, the
   * section is left out rather than listing addresses that 404.
   */
  enabledBy?: { doc: string; field: string }
  /** The page's site path, with `{slug}` standing for the document's slug. */
  path: string
  /** The field holding the slug; `slug` when absent. */
  slugField?: string
  /** A field whose truthy value leaves the row out, for a soft delete the filter cannot see. */
  skipWhen?: string
  /** The fields a row's `lastmod` is read from, first present wins. */
  lastmod?: readonly string[]
}

/** A declaration with the plugin that made it. */
export type ResolvedPluginSitemapSection = PluginSitemapSectionDeclaration & {
  pluginId: string
}

/** Every declared section, in config order — the order the index lists them. */
export function listPluginSitemapSections(): readonly ResolvedPluginSitemapSection[] {
  return PLUGIN_SITEMAP_SECTIONS_DECLARED
}

/** One declared section by its name, or `null`. */
export function pluginSitemapSection(
  section: string,
): ResolvedPluginSitemapSection | null {
  return PLUGIN_SITEMAP_SECTIONS_DECLARED.find((one) => one.section === section) ?? null
}

/** The site path of one row, or `null` for a row with no slug. */
export function pluginSitemapSectionPath(
  declaration: PluginSitemapSectionDeclaration,
  slug: unknown,
): string | null {
  if (typeof slug !== 'string' || !slug) return null
  return declaration.path.replace('{slug}', slug)
}
