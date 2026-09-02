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

import * as Aglyn from '@aglyn/aglyn/server'
import getScreen from './get-screen'

/**
 * Which shared layout wraps the pages the platform builds rather than the
 * author does (AGL-2513) — site search today, and the collection article a
 * site with no entry template falls back to.
 *
 * ## Why a setting and not just the home screen's layout
 *
 * The home screen's layout was already the implicit answer for the collection
 * fallback, and it is the right DEFAULT — a site with one layout needs to
 * configure nothing, and every site has a home page. It is the wrong RULE.
 * Plenty of sites give the home page a layout of its own: a transparent
 * header over a hero, no breadcrumb, a fat marketing footer. Search results
 * inheriting that is how `/search` ends up with a header designed to sit on
 * top of an image it does not have.
 *
 * `host.builtInPageLayoutId` is the escape hatch, and it is a LAYOUT id
 * rather than a screen id on purpose. What a built-in page needs is the
 * site's chrome around a body the platform composes; designating a screen
 * would mean designating a page whose content is ignored — a slot the author
 * cannot fill and cannot see the shape of.
 *
 * Returns `undefined` when neither is available, and every caller treats that
 * as "render the body with no chrome" rather than as a failure: a search page
 * without a header is worse than one with, and a search page that 500s
 * because a layout was deleted is worse than both.
 */
export const BUILT_IN_PAGE_LAYOUT_FIELD = 'builtInPageLayoutId' as const

export async function resolveBuiltInPageLayoutId(options: {
  hostId: string
  host: any
}): Promise<string | undefined> {
  const { hostId, host } = options
  const designated = String(host?.[BUILT_IN_PAGE_LAYOUT_FIELD] ?? '').trim()
  if (designated) return designated
  try {
    // The home screen's layout, which is the closest thing a site has to a
    // site-wide default: screens carry their own `layoutId`, and there is no
    // host-level one to read.
    const screensMap = (host?.screens ?? {}) as Record<string, string>
    const homeEntry = Object.entries(screensMap).find(
      ([, path]) => path === Aglyn.SCREEN_ROOT_PATH,
    )
    if (!homeEntry) return undefined
    const homeRes = await getScreen({ hostId, screenId: homeEntry[0] })
    const layoutId = (homeRes.screen as { layoutId?: string })?.layoutId
    return layoutId ? String(layoutId) : undefined
  } catch (error) {
    console.error('built-in page layout lookup failed', error)
    return undefined
  }
}

export default resolveBuiltInPageLayoutId
