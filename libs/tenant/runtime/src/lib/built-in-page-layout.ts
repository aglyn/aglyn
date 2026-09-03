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
import getScreenVersion from './get-screen-version'

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
    /*
      The home screen's layout, which is the closest thing a site has to a
      site-wide default.

      ## Version-first, then the screen

      This used to read `screen.layoutId` alone, on the stated grounds that
      "screens carry their own `layoutId`". They frequently do not. The
      binding lives on the VERSION document whenever a layout was chosen while
      editing — key-present on the version wins over the screen's, which is
      the precedence `composeScreenNodes` applies on every published page —
      and a screen whose layout was only ever set that way has no `layoutId`
      of its own at all.

      So the fallback resolved to `undefined` for those hosts and every
      built-in page rendered with NO CHROME, which is precisely the defect
      AGL-2513 existed to fix. It was invisible for a while because nothing
      linked to a built-in page; AGL-2518 made every byline on every article
      link to one, and `aglyn.com` turned out to be exactly this shape — a
      home page bound to "Marketing base" on its version, an unset
      `builtInPageLayoutId`, and a chrome-less `/search` nobody had reason to
      visit.

      `null` on the version is a deliberate "no layout" and is honoured as
      such rather than falling through to the screen — same as composition.
    */
    const screensMap = (host?.screens ?? {}) as Record<string, string>
    const homeEntry = Object.entries(screensMap).find(
      ([, path]) => path === Aglyn.SCREEN_ROOT_PATH,
    )
    if (!homeEntry) return undefined
    const homeRes = await getScreen({ hostId, screenId: homeEntry[0] })
    const screen = homeRes.screen as
      | { layoutId?: string | null; versionId?: string }
      | undefined
    if (!screen) return undefined
    if (screen.versionId) {
      // Fail-open to the screen's own binding, exactly as composition does:
      // a version read that throws must not cost the page its chrome.
      const versionRes = await getScreenVersion({
        hostId: hostId as never,
        screenId: homeEntry[0] as never,
        versionId: screen.versionId as never,
      }).catch(() => null)
      const version = versionRes?.version as
        | { layoutId?: string | null }
        | undefined
      if (version && 'layoutId' in version) {
        return version.layoutId ? String(version.layoutId) : undefined
      }
    }
    return screen.layoutId ? String(screen.layoutId) : undefined
  } catch (error) {
    console.error('built-in page layout lookup failed', error)
    return undefined
  }
}

export default resolveBuiltInPageLayoutId
