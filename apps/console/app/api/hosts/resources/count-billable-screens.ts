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

import { screenClaimsToBeAPage } from '@aglyn/aglyn/server'
import {
  COLLECTION_TEMPLATE_SCREEN_FIELDS,
  collectionListTemplateScreenIds,
  collectionTemplateScreenIds,
  type CollectionTemplateSource,
} from '../../../../constants/collection-templates'

/**
 * The collection fields this counts on: the three a collection can point at a
 * template screen with (`templateScreenId` is the legacy AGL-105 field the
 * tenant runtime still falls back to, so hosts predating the list/entry split
 * are covered), plus the two that say whether a LIST template has a route to
 * serve — the collection's `slug` and its `kind` (AGL-1387). Still one read;
 * a field mask projects, it does not fan out.
 */
const COLLECTION_FIELDS = [
  ...COLLECTION_TEMPLATE_SCREEN_FIELDS,
  'slug',
  'kind',
] as const

/** The shape this reads off a Firestore snapshot — kept structural so the
 * unit test doesn't need the admin SDK. */
interface FieldSnapshot {
  id: string
  get(field: string): unknown
}

/**
 * The host's `screens` routing map (screen id → route path) as
 * `publishScreenRoute` writes it. Only membership is read here, never the path.
 */
export type ScreenRoutingMap = Record<string, unknown> | null | undefined

interface QuerySnapshotLike {
  docs: Array<FieldSnapshot>
}

interface HostRefLike {
  collection(name: string): {
    select(...fields: Array<string>): { get(): Promise<QuerySnapshotLike> }
  }
}

/**
 * Screens that actually spend the plan's screen allowance (AGL-1173).
 *
 * A plain `screens.count()` charged for three things the subscriber never
 * chose to author, and the screens list — which filters them out — then
 * disagreed with the server about how much of the plan was used:
 *
 *  - **Soft-deleted screens.** Delete stamps `deletedAt` rather than
 *    removing the doc, so deleting a screen never freed a slot. On the free
 *    plan (5 screens) that was a dead end with no way out from the UI.
 *  - **Email screens** (`kind: 'email'`), which live on the Emails page and
 *    were already excluded from the list count but not from enforcement.
 *  - **A content collection's list/entry template** — one screen serving
 *    every entry at no URL of its own. Adding a blog cost two of the free
 *    plan's five screens before the first page existed.
 *
 * Counted by subtraction rather than a stored marker so hosts whose
 * templates predate this need no backfill, and so re-pointing a collection
 * at a different screen takes effect immediately. The field mask keeps the
 * read to the two fields the filter looks at.
 *
 * ## The routing map outranks the document (AGL-1383)
 *
 * Two of those three exclusions are ordinary client-writable fields on the
 * screen's OWN document, and the party they are subtracted on behalf of is the
 * party being metered. `updateDoc(screenRef, {kind: 'email'})` — one write, no
 * route change — used to take a live page off a Free plan's five and leave it
 * serving, because nothing else read either field.
 *
 * So the document's account of itself is only consulted for screens the host's
 * routing map does not route. **A routed screen counts, whatever it says about
 * itself**, which is the invariant: what the site serves is what the plan pays
 * for, and the only way to stop paying for a page is to stop publishing it.
 * Since AGL-1383 the runtime refuses to serve an excluded screen too
 * (`screenClaimsToBeAPage` in `getScreen`), so the two answers cannot drift:
 * flipping either field costs the page rather than the slot.
 *
 * ENTRY templates stay excluded even while routed. Publishing is how the
 * compose pipeline picks a template up — it is the reason they HAVE a map
 * entry — but AGL-1267 drops them from routing when the request arrives, so an
 * entry template is not a page of the site by the same reachability test: it
 * serves `/{collection}/{entry}` for every entry and 404s at a slug of its own.
 *
 * ## A LIST template is a page (AGL-1387)
 *
 * The same reachability test answers the other way for a list template, and
 * this is the third exclusion — the one AGL-1383 left standing. `/{slug}`
 * renders that exact screen through `composeCollectionTemplatePage`, so an
 * editor could turn any screen into a free one by creating a collection and
 * designating it. `collectionListTemplateScreenIds` is the condition, and it
 * asks about the ROUTE (a content collection with a slug), not about
 * publishing: the collection branch resolves the screen through `listScreenId`
 * rather than through the routing map, so an unpublished list template serves
 * `/{slug}` exactly like a published one.
 *
 * Gated on the screen's own claim, unlike the routed case: a soft-deleted or
 * `kind: 'email'` template is refused by `getScreen`, so `/{slug}` falls back
 * to the built-in themed list and the template really is not a page. That is
 * the AGL-1383 trade unchanged — the field costs the page, not the slot.
 *
 * Nothing here asks whether the list template is SHADOWED by an ordinary
 * screen published at the same path (which would win the route). That screen
 * counts on its own, and the shadowed template is then a screen the plan sold
 * that nothing serves — the same thing as an unpublished draft, which has
 * always counted.
 *
 * `routingMap` costs no read: both callers hold the host snapshot already.
 */
export async function countBillableScreens(
  hostRef: HostRefLike,
  routingMap?: ScreenRoutingMap,
): Promise<number> {
  const [screens, collections] = await Promise.all([
    hostRef.collection('screens').select('kind', 'deletedAt').get(),
    hostRef.collection('collections').select(...COLLECTION_FIELDS).get(),
  ])

  // Read into the shape the console's own surfaces use, so the API and the
  // screens page's precheck cannot answer this differently (AGL-1269).
  const collectionRows: CollectionTemplateSource[] = collections.docs.map(
    (contentCollection) => ({
      slug: contentCollection.get('slug'),
      kind: contentCollection.get('kind'),
      listScreenId: contentCollection.get('listScreenId'),
      entryScreenId: contentCollection.get('entryScreenId'),
      templateScreenId: contentCollection.get('templateScreenId'),
    }),
  )
  const templateScreenIds = collectionTemplateScreenIds(collectionRows)
  const listTemplateScreenIds = collectionListTemplateScreenIds(collectionRows)

  const routed = new Set(Object.keys(routingMap ?? {}))

  return screens.docs.filter((screen) => {
    const claimsToBeAPage = screenClaimsToBeAPage({
      kind: screen.get('kind') as string,
      deletedAt: screen.get('deletedAt'),
    })
    const servesACollectionList =
      listTemplateScreenIds.has(screen.id) && claimsToBeAPage
    if (templateScreenIds.has(screen.id) && !servesACollectionList) return false
    return routed.has(screen.id) || claimsToBeAPage
  }).length
}
