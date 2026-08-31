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
 * The DISPLAYED name for a console plugin page, from its URL slug (AGL-2184).
 *
 * Deliberately a local table plus Title Case, NOT a call into the plugin
 * registry. Calling `resolveConsolePluginPage` is the obvious fix and it does
 * not build: the only caller is a SERVER layout, and pulling the registry
 * drags the whole plugin graph — every nav item's client component — into the
 * server compile. Measured, not assumed: `nx build console` failed with six
 * Turbopack "Ecmascript file had an error".
 *
 * `plugin-page-title.spec.ts` asserts this module against the registry's own
 * labels for every registered slug, so the copy cannot drift. A second copy
 * nothing checks is duplication; a second copy with a guard is a cache.
 */

/**
 * Slugs whose display name Title Case cannot produce.
 *
 * `pos` is the whole reason this table exists: the registry declares `POS`,
 * and no amount of casing a URL slug recovers an acronym.
 */
export const PLUGIN_TITLES: Readonly<Record<string, string>> = {
  pos: 'POS',
}

/** `email-campaigns` -> `Email Campaigns`. Wrong for acronyms, by design. */
export function titleCaseSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** The tab title for a plugin slug: the table first, then Title Case. */
export function pluginPageTitle(slug: string): string {
  return PLUGIN_TITLES[slug] ?? titleCaseSlug(slug)
}

/**
 * The sections each plugin surface declares, keyed by the surface's URL slug.
 *
 * A local copy for the same reason {@link PLUGIN_TITLES} is one: the only
 * caller is a SERVER layout, and reaching the registry there drags every nav
 * item's client component into the server compile. `plugin-page-title.spec.ts`
 * asserts this against the plugin sources, so a section added, renamed or
 * removed without touching this table turns that suite red.
 *
 * What it is FOR is telling a section from an entity id. The route beneath a
 * plugin surface is a catch-all, so the segment after the surface is a
 * declared section on a hub (`/marketing/campaigns`) and a document id on a
 * surface that owns its subtree (`/forms/{formId}`). Only the first has a name
 * worth putting in a browser tab; the second is looked up by nothing here and
 * left out, which keeps an id off the tab rather than Title Casing it into
 * something that is no longer the id.
 */
export const PLUGIN_SECTIONS: Readonly<Record<string, readonly string[]>> = {
  products: [
    'catalog',
    'orders',
    'promotions',
    'reservations',
    'settings',
    'analytics',
  ],
  emails: [
    'messages',
    'templates',
    'audiences',
    'topics',
    'sending',
    'suppressions',
  ],
  marketing: [
    'overview',
    'campaigns',
    'conversions',
    'overlays',
    'experiments',
  ],
  automation: ['workflows', 'actions', 'webhooks'],
}

/**
 * Section labels Title Case cannot produce, keyed `surface/section`.
 *
 * Scoped to the surface rather than keyed on the section id alone: two
 * surfaces are free to declare a section of the same id, and a flat key would
 * make one of them wear the other's label.
 */
export const PLUGIN_SECTION_TITLES: Readonly<Record<string, string>> = {
  // An acronym and a slash, neither of which is in the slug.
  'marketing/experiments': 'A/B testing',
}

/**
 * The display name for a section beneath `surfaceSlug`, or `''` when that
 * segment names no declared section — an entity id, or a typo the page itself
 * answers with a 404.
 */
export function pluginSectionTitle(
  surfaceSlug: string,
  sectionSlug: string,
): string {
  if (!PLUGIN_SECTIONS[surfaceSlug]?.includes(sectionSlug)) return ''
  return (
    PLUGIN_SECTION_TITLES[`${surfaceSlug}/${sectionSlug}`] ??
    titleCaseSlug(sectionSlug)
  )
}
