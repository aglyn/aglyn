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
  PLUGIN_SURFACE_RECORD_TITLES,
  PLUGIN_SURFACE_SECTIONS,
  PLUGIN_SURFACE_TITLES,
} from '../constants/plugins.titles.generated'

/**
 * The DISPLAYED name for a console plugin page, from its URL slug (AGL-2184).
 *
 * Read from the generated titles manifest, NOT from the plugin registry. The
 * callers are SERVER layouts, and pulling the registry there drags the whole
 * plugin graph — every nav item's client component — into the server
 * compile. Measured, not assumed: `nx build console` failed with six
 * Turbopack "Ecmascript file had an error". The manifest is the plugins' own
 * nav labels and section lists written down as data by
 * `tools/scripts/generate-plugin-manifests.mjs`, so a label changes in the
 * plugin and nowhere else.
 */

/** `record[key]` when `key` is the record's own, never a prototype member. */
function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined
}

/** `email-campaigns` -> `Email Campaigns`. Wrong for acronyms, by design. */
export function titleCaseSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * The tab title for a plugin slug: its nav item's label, then Title Case for
 * a slug no plugin declares.
 */
export function pluginPageTitle(slug: string): string {
  return own(PLUGIN_SURFACE_TITLES, slug) ?? titleCaseSlug(slug)
}

/**
 * The display name for a section beneath `surfaceSlug`, or `''` when that
 * segment names no declared section — an entity id, or a typo the page itself
 * answers with a 404.
 *
 * What the section list is FOR is telling a section from an entity id. The
 * route beneath a plugin surface is a catch-all, so the segment after the
 * surface is a declared section on a hub (`/marketing/campaigns`) and a
 * document id on a surface that owns its subtree (`/forms/{formId}`). Only the
 * first has a name worth putting in a browser tab; the second is left out,
 * which keeps an id off the tab rather than Title Casing it into something
 * that is no longer the id.
 */
export function pluginSectionTitle(
  surfaceSlug: string,
  sectionSlug: string,
): string {
  const sections = own(PLUGIN_SURFACE_SECTIONS, surfaceSlug)
  return (sections && own(sections, sectionSlug)) ?? ''
}

/**
 * The noun for one record's page beneath `surfaceSlug` (AGL-3596) — what a
 * nav item that owns its subtree declares as its `recordTitle` — or `''` when
 * it declares none, and the surface's own name stands.
 */
export function pluginRecordTitle(surfaceSlug: string): string {
  return own(PLUGIN_SURFACE_RECORD_TITLES, surfaceSlug) ?? ''
}
