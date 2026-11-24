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

import { SCREEN_ROOT_PATH } from './screen-slug'

/*
 * WHICH SHARED LAYOUT A NEW PAGE STARTS WITH (AGL-4241).
 *
 * A page made from Pages ▸ Create new page used to start with no layout at
 * all, so it had no header and no footer until its author found Properties ▸
 * Shared layout in the editor. A new site is born with a "Site header and
 * footer" layout and its Home page bound to it; a page added next to Home
 * should look like it belongs to the same site.
 *
 * There is no separate "default layout for new pages" setting, and this adds
 * none. The site already answers "which layout is this site's chrome" for the
 * pages the platform builds (search results, untemplated articles:
 * `resolveBuiltInPageLayoutId`, AGL-2513), and a new page asks the same
 * question. So the rule is that one, in the same order:
 *
 *   1. the site's Built-in page layout setting (`host.builtInPageLayoutId`),
 *   2. else the layout the home page uses, version first,
 *   3. else, only when the site has exactly ONE live layout, that layout.
 *
 * Step 3 is for a site whose home page is not routed yet (an AI-drafted
 * site, a site whose Home was unpublished). It never chooses among several
 * layouts: with two or more and nothing naming one, the page starts with
 * none, as it did before. A layout that is deleted or not on the site is
 * never chosen, whatever names it.
 */

/** A layout as the picker lists it: its id, and whether it was deleted. */
export interface NewPageLayoutCandidate {
  id: string
  deletedAt?: unknown
}

/** The site's home page id: the routing-map entry at `/`, if any. */
export function homeScreenIdOf(
  routingMap: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!routingMap || typeof routingMap !== 'object') return undefined
  const entry = Object.entries(routingMap).find(
    ([, path]) => path === SCREEN_ROOT_PATH,
  )
  return entry?.[0]
}

/**
 * The layout a screen renders inside, as composition reads it: a version
 * that carries the key wins (an explicit `null` is a deliberate "no layout"
 * and does NOT fall through), otherwise the screen's own binding.
 *
 * `null` means no layout.
 */
export function screenLayoutBinding(
  screen: { layoutId?: unknown } | null | undefined,
  version: { layoutId?: unknown } | null | undefined,
): string | null {
  if (version && typeof version === 'object' && 'layoutId' in version) {
    return typeof version.layoutId === 'string' && version.layoutId
      ? version.layoutId
      : null
  }
  return typeof screen?.layoutId === 'string' && screen.layoutId
    ? screen.layoutId
    : null
}

/**
 * The layout a new page should start with, or `undefined` for none.
 * Deterministic, and `undefined` whenever the site has no live layout.
 */
export function newPageLayoutId(input: {
  /** `host.builtInPageLayoutId`, the site's designated chrome. */
  designatedLayoutId?: unknown
  /** The home page's binding (`screenLayoutBinding`), when it has one. */
  homeLayoutId?: string | null
  /** The site's layouts; deleted ones are skipped. */
  layouts: ReadonlyArray<NewPageLayoutCandidate> | null | undefined
}): string | undefined {
  const live = (input.layouts ?? []).filter(
    (layout) => layout && typeof layout.id === 'string' && layout.id && !layout.deletedAt,
  )
  const isLive = (id: unknown): id is string =>
    typeof id === 'string' && live.some((layout) => layout.id === id)
  const designated =
    typeof input.designatedLayoutId === 'string'
      ? input.designatedLayoutId.trim()
      : ''
  if (isLive(designated)) return designated
  if (isLive(input.homeLayoutId)) return input.homeLayoutId
  return live.length === 1 ? live[0].id : undefined
}
