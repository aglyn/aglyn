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

/** One step on the trail: what it is called, and where it goes. */
export interface BreadcrumbCrumb {
  /** The DISPLAY name — a collection's title, an entry's headline. */
  name: string
  /** Site-relative path, e.g. `/blog` or `/blog/hello`. */
  path: string
}

/**
 * `schema.org/BreadcrumbList` for a trail of crumbs (AGL-2535).
 *
 * ## Why content routes needed their own
 *
 * The tenant already emitted a breadcrumb, for nested SCREEN paths only, built
 * by splitting the routing-map path — so its crumb names are URL segments
 * (`/company/about` publishes "company" and "about"). That is passable for a
 * screen, whose slug is usually its title in lower case, and it is the wrong
 * mechanism entirely for content: `/blog/from-a-form-to-a-dataset-in-five-minutes`
 * would publish that slug as a crumb name when the entry's actual headline is
 * sitting right there in the loader's result.
 *
 * So this takes NAMES rather than a path, and the caller supplies them from
 * whatever it knows — a collection's `displayName`, an entry's `title`, a
 * category's resolved label.
 *
 * ## Fewer than two crumbs emits nothing
 *
 * A one-item breadcrumb is not a trail, it is the page restating its own
 * title, and Google's own guidance treats a single-element list as ineligible.
 * Returning `undefined` lets a caller spread the result unconditionally
 * instead of counting first — the same shape every other serializer in this
 * codebase uses.
 *
 * ## Absolute urls, because a crawler reads this without a page
 *
 * `item` must resolve on its own. With no origin to resolve against, this
 * emits nothing rather than a list of relative paths a consumer would silently
 * ignore — the rule `contentAuthorJsonLd` states about images, applied to
 * links.
 */
export function breadcrumbListJsonLd(
  crumbs: readonly BreadcrumbCrumb[] | null | undefined,
  origin: string | null | undefined,
): Record<string, unknown> | undefined {
  const base = String(origin ?? '').trim().replace(/\/+$/, '')
  if (!base) return undefined
  const usable = (crumbs ?? []).filter(
    (crumb) => String(crumb?.name ?? '').trim() && String(crumb?.path ?? '').trim(),
  )
  if (usable.length < 2) return undefined
  return {
    '@type': 'BreadcrumbList',
    itemListElement: usable.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: String(crumb.name).trim(),
      item: `${base}/${String(crumb.path).trim().replace(/^\/+/, '')}`,
    })),
  }
}

export default breadcrumbListJsonLd
