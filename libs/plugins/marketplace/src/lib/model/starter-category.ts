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

import { SITE_STYLES } from '@aglyn/aglyn/app-utils/site-styles'

/**
 * What a site starter is filed under (AGL-4049): the kind of site it is, by
 * the style names a person picks a style by ("Home services & trades"). The
 * platform's seed files each kind's starters under that name, and the starter
 * shelf groups by it.
 *
 * A starter keeps its category in its own `category` field, as its publish
 * writes it — never the plugin taxonomy's `categories` list, whose fixed
 * values ("analytics", "seo", …) describe what a plugin does, not a site.
 *
 * Pure data and readers, safe for any surface to import.
 */

/** The kinds of site a starter can be filed under, in the order a person sees the styles. */
export const SITE_STARTER_CATEGORIES: readonly string[] = SITE_STYLES.map(
  (style) => style.name,
)

/** The most characters a category holds, as the starter publish caps it. */
export const SITE_STARTER_CATEGORY_MAX = 40

const currentOf = (current: unknown): string =>
  typeof current === 'string' ? current.trim() : ''

/**
 * The Category menu for a starter: every kind of site, and the category it
 * already has when that is not one of them — a publisher's own words, or an
 * older listing's — so the menu never opens on a value it does not offer.
 */
export function siteStarterCategoryOptions(current: unknown): string[] {
  const kept = currentOf(current)
  return kept && !SITE_STARTER_CATEGORIES.includes(kept)
    ? [...SITE_STARTER_CATEGORIES, kept]
    : [...SITE_STARTER_CATEGORIES]
}

/** What a starter's listing edit does to its category. */
export type SiteStarterCategoryUpdate =
  /** `undefined`: the save names no category; `null`: it clears it. */
  | { ok: true; category: string | null | undefined }
  | { ok: false; error: string }

/**
 * A listing edit's category for a starter, from `category`, or from the first
 * of `categories` as the native listing editors send it. A kind of site is
 * taken, and so is the category the starter already has; an empty value
 * clears it. Anything else is refused in the words the editor's field uses.
 */
export function siteStarterCategoryUpdate(
  body: { category?: unknown; categories?: unknown },
  current: unknown,
): SiteStarterCategoryUpdate {
  const raw =
    body.category !== undefined
      ? body.category
      : Array.isArray(body.categories)
        ? (body.categories[0] ?? '')
        : undefined
  if (raw === undefined) return { ok: true, category: undefined }
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Pick the kind of site this starter is from the Category menu' }
  }
  const next = raw.trim()
  if (!next) return { ok: true, category: null }
  if (
    next.length <= SITE_STARTER_CATEGORY_MAX &&
    (SITE_STARTER_CATEGORIES.includes(next) || next === currentOf(current))
  ) {
    return { ok: true, category: next }
  }
  return { ok: false, error: 'Pick the kind of site this starter is from the Category menu' }
}
