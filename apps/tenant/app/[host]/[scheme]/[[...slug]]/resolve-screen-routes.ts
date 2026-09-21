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
import { resolveEntryLinkRoutes } from '@aglyn/tenant-runtime/entry-link-routes'
import { getTemplateScreenRouting } from '@aglyn/tenant-runtime/template-screens'
import type { Props } from './types'

/**
 * Screen links resolve against the routing map the ROUTER honours, not the one
 * publishing wrote (AGL-1998).
 *
 * `host.screens` carries every screen under its own published slug, and the
 * loader then edits that table at serve time: template screens are dropped,
 * and a collection's list template answers at `/{collectionSlug}` instead of
 * the slug it was published under. A screen link rendered from the raw map
 * therefore emitted an href the site itself 404s — on aglyn.com, every link
 * pointing at the blog's list template said `/blog-list-template`.
 *
 * Derived at the point the props become a CLIENT prop, and it costs no
 * Firestore read: `load-page-data` has already asked for the same cache entry
 * on this request (it is how the route was matched), so this is a hit on
 * `unstable_cache` rather than a second trip.
 *
 * The ENTRIES the page links to join it (AGL-3118), read from the whole
 * composed document — a withheld lazy panel is still this page's — and from
 * the entry body the legacy article renders with no node to carry it. A page
 * that links no entry reads nothing more; one that does pays one cached batch
 * of exactly those documents.
 *
 * Lifted out of `page.tsx` (AGL-3205) so the live-site preview route resolves
 * links through the SAME table. A preview whose nav pointed at slugs the site
 * 404s would be a preview of a page nobody is ever served, and a second copy
 * of this sequence is a second copy to keep in step with the loader's edits.
 *
 * Answers `undefined` when the props name no host, which is the shape the
 * client already treats as "this page cannot say".
 */
export async function resolveScreenRoutes(
  props: Props,
): Promise<Record<string, string> | undefined> {
  const routedHost = props.data?.host as
    | { $id?: string; screens?: Record<string, string> }
    | undefined
  if (!routedHost?.$id) return undefined
  const routing = await getTemplateScreenRouting({ hostId: routedHost.$id })
  const entryRefs = Aglyn.collectEntryLinkRefs({
    nodes: [props.nodes],
    markdown: [props.content?.entry?.body],
  })
  const entryRoutes = entryRefs.length
    ? await resolveEntryLinkRoutes({
        hostId: routedHost.$id,
        refs: entryRefs,
        collectionSlugs: routing.collectionListings,
      })
    : undefined
  return Aglyn.linkableScreenRoutes(routedHost.screens, {
    routedElsewhere: routing.listRoutes,
    unrouted: routing.templateScreenIds,
    collectionListings: routing.collectionListings,
    entryRoutes,
  })
}
