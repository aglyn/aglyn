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

import * as Aglyn from '@aglyn/aglyn'
import { useMemo } from 'react'
import type { UseCollectionTemplatesResult } from './use-collection-templates'

export interface UseScreenLinkRoutesOptions {
  /**
   * This host's collection templates, from `useCollectionTemplates`. Passed
   * in rather than read here so a surface that already needs it (the screen
   * besigner, which labels a template's publish button with the routes it
   * renders) does not open a second live subscription to the same collection.
   */
  templates: UseCollectionTemplatesResult
  /** The host's `screens` map, straight off the host document. */
  routingMap?: Record<string, string> | null
  /** The host's screen documents — only `kind` is read (AGL-1400). */
  screens?: ReadonlyArray<{ $id?: string; kind?: unknown } | null | undefined>
}

/**
 * The routing map the besigner's link surfaces resolve against (AGL-1998).
 *
 * Every editor surface — the canvas's rendered hrefs, the Tabs strip's per-tab
 * link picker, the Screen Link element, every `Link`-typed component prop —
 * read the host's raw `screens` map, which is written by publishing and says
 * where each screen was published, not where the site SERVES it. The tenant
 * router disagrees with it in both directions, and the picker inherited both
 * halves of the disagreement:
 *
 *  - it offered `Blog — List Template (/blog-list-template)`, a path the live
 *    site 404s, and offered NOTHING that resolved to `/blog`, so no screen
 *    link on aglyn.com could point at the site's own blog index; and
 *  - it offered every entry template the same way — an author picking one gets
 *    a dead anchor that looks exactly like a live one, which is worse than the
 *    screen simply not being offered.
 *
 * So the picker is fed the same corrected map the renderer now gets, derived
 * by the one shared `linkableScreenRoutes` from the same two facts the router
 * uses. A screen this cannot place is left exactly where publishing put it.
 *
 * NOT yet covered: commerce's `pdpScreenId` / `collectionScreenId`, which live
 * on `hosts/{h}/settings/store` and are still offered at slugs that 404. The
 * tenant runtime drops them (AGL-1270) and this does not, for the reason
 * `COLLECTION_TEMPLATE_SCREEN_FIELDS` is re-declared in
 * `constants/collection-templates.ts` at all: reading them here means another
 * live subscription, and it is the same widening AGL-1269 still owes.
 */
export function useScreenLinkRoutes(
  options: UseScreenLinkRoutesOptions,
): Record<string, string> | undefined {
  const { templates, routingMap, screens } = options
  const { templateScreenIds, listTemplateScreenIds, listRoutesByScreenId } =
    templates
  return useMemo(() => {
    const unrouted = new Set<string>()
    for (const id of templateScreenIds) {
      // A LIST template is the one template kind that is still a page — at the
      // collection's address, which the override below supplies. Dropping it
      // here and re-adding it there would work, but only by accident of
      // ordering, and a reader would have to hold both halves at once.
      if (!listTemplateScreenIds.has(id)) unrouted.add(id)
    }
    // The screens that say so (AGL-1400) — the half the pointers cannot reach,
    // because clearing a collection's `entryScreenId` deliberately does not
    // promote the screen back to a page.
    for (const screen of screens ?? []) {
      if (!screen?.$id) continue
      if (screen.kind === Aglyn.SCREEN_KIND_TEMPLATE) unrouted.add(screen.$id)
    }
    return Aglyn.linkableScreenRoutes(routingMap, {
      routedElsewhere: listRoutesByScreenId,
      unrouted,
    })
  }, [
    routingMap,
    screens,
    templateScreenIds,
    listTemplateScreenIds,
    listRoutesByScreenId,
  ])
}

export default useScreenLinkRoutes
