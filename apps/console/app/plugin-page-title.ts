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
