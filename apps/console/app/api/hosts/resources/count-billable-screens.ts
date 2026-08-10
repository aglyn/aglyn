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

/**
 * The three fields a content collection can point at a template screen
 * with. `templateScreenId` is the legacy AGL-105 field the tenant runtime
 * still falls back to, so hosts predating the list/entry split are covered.
 */
const TEMPLATE_SCREEN_FIELDS = [
  'listScreenId',
  'entryScreenId',
  'templateScreenId',
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
 * Template screens stay excluded even while routed. Publishing is how the
 * compose pipeline picks a template up — it is the reason they HAVE a map
 * entry — but AGL-1267 drops them from routing when the request arrives, so a
 * template is not a page of the site by the same reachability test.
 *
 * `routingMap` costs no read: both callers hold the host snapshot already.
 */
export async function countBillableScreens(
  hostRef: HostRefLike,
  routingMap?: ScreenRoutingMap,
): Promise<number> {
  const [screens, collections] = await Promise.all([
    hostRef.collection('screens').select('kind', 'deletedAt').get(),
    hostRef.collection('collections').select(...TEMPLATE_SCREEN_FIELDS).get(),
  ])

  const templateScreenIds = new Set<string>()
  for (const contentCollection of collections.docs) {
    for (const field of TEMPLATE_SCREEN_FIELDS) {
      const screenId = contentCollection.get(field)
      if (typeof screenId === 'string' && screenId) {
        templateScreenIds.add(screenId)
      }
    }
  }

  const routed = new Set(Object.keys(routingMap ?? {}))

  return screens.docs.filter(
    (screen) =>
      !templateScreenIds.has(screen.id) &&
      (routed.has(screen.id) ||
        screenClaimsToBeAPage({
          kind: screen.get('kind') as string,
          deletedAt: screen.get('deletedAt'),
        })),
  ).length
}
