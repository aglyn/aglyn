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

import { SCREEN_KIND_TEMPLATE, screenClaimsToBeAPage } from '@aglyn/aglyn/server'

/** The shape this reads off a Firestore snapshot — kept structural so the
 * unit test doesn't need the admin SDK. */
interface FieldSnapshot {
  id: string
  get(field: string): unknown
}

/**
 * One screen, reduced to the two things the rule below asks about.
 *
 * Exported over rows rather than run as a query (AGL-1390) because the
 * enforcement points ask about a state that does not exist yet: a promotion is
 * checked against the count it WOULD leave behind. A function that does its own
 * reads can only answer for the present.
 */
export interface BillableScreenSource {
  id: string
  kind?: unknown
  deletedAt?: unknown
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
 *  - **A collection's ENTRY template** — one screen serving every entry at no
 *    URL of its own. Adding a blog cost two of the free plan's five screens
 *    before the first page existed.
 *
 * ## ONE document answers it now (AGL-1400)
 *
 * The third exclusion used to be a JOIN: this function read the `collections`
 * collection and subtracted whatever screen ids the template pointers named.
 * That shape produced four issues in one arc, because the other side of the
 * join is editable and each new way to edit it was a new bypass — AGL-1173
 * created the exclusion, AGL-1383 froze the two fields the screen itself
 * carried, AGL-1387 found the list template was a page after all, and AGL-1390
 * found the pointer could be toggled to mint permanent slots and had to move
 * the write server-side and evaluate the cap against the post-state.
 *
 * Since AGL-1400 an entry template says so on its own document
 * (`kind: 'template'`), stamped by /api/hosts/screens and frozen in the rules
 * exactly as `kind: 'email'` is. So this reads the `screens` collection and
 * nothing else: the pointer is a pointer again, freely writable, and it excuses
 * nothing. `screenClaimsToBeAPage` is the whole rule, which is the property
 * that keeps the count and the serve path (`getScreen`) from ever disagreeing.
 *
 * What did NOT change is what anybody pays. A collection's LIST template stays
 * a page — `/{collectionSlug}` renders that exact screen (AGL-1387) — so it is
 * never stamped and still counts, and an entry template stays excluded
 * (AGL-1173's charge is not reinstated).
 *
 * ## The routing map outranks the document (AGL-1383)
 *
 * `deletedAt` and `kind: 'email'` are ordinary client-writable fields on the
 * screen's OWN document, and the party they are subtracted on behalf of is the
 * party being metered. `updateDoc(screenRef, {kind: 'email'})` — one write, no
 * route change — used to take a live page off a Free plan's five and leave it
 * serving, because nothing else read either field. So for those two the
 * document's account of itself is consulted only for screens the routing map
 * does not route: **a routed screen counts, whatever it says about itself**.
 *
 * `kind: 'template'` is deliberately outside that rule, and it is the one value
 * that can be. A template is routed ON PURPOSE — publishing is how the compose
 * pipeline picks it up, and AGL-1267 drops it from routing when the request
 * arrives — so the map cannot be the arbiter for it. What makes trusting it
 * safe is that no client writes it: the demotion that sets it always succeeds
 * (it lowers the count) and the promotion that clears it is checked exactly
 * like a create (it raises it), so there is no toggle to run a loop through.
 *
 * `routingMap` costs no read: every caller holds the host snapshot already.
 *
 * ## What the scan costs (AGL-1440)
 *
 * ONE BILLED READ PER SCREEN DOCUMENT, unbounded. The `select()` below is a
 * projection: it keeps whole documents off the wire, and it does not reduce the
 * read count by one. Callers that already hold the rows must use
 * `billableScreenIds` directly rather than calling this — see
 * `measureScreenCaps`, which was scanning the same collection a second time on
 * the same sweep.
 */
export async function countBillableScreens(
  hostRef: HostRefLike,
  routingMap?: ScreenRoutingMap,
): Promise<number> {
  const screens = await hostRef
    .collection('screens')
    .select('kind', 'deletedAt')
    .get()
  return billableScreenIds(
    screens.docs.map((screen) => ({
      id: screen.id,
      kind: screen.get('kind'),
      deletedAt: screen.get('deletedAt'),
    })),
    routingMap,
  ).size
}

/**
 * The rule itself, over rows: WHICH screens spend the plan's allowance.
 *
 * The ids rather than the count, because an enforcement point that cannot name
 * the screen it is refusing over is a refusal the person reading it cannot act
 * on.
 */
export function billableScreenIds(
  screens: ReadonlyArray<BillableScreenSource>,
  routingMap?: ScreenRoutingMap,
): Set<string> {
  const routed = new Set(Object.keys(routingMap ?? {}))
  const billable = new Set<string>()
  for (const screen of screens) {
    if (screen.kind === SCREEN_KIND_TEMPLATE) continue
    const claimsToBeAPage = screenClaimsToBeAPage({
      kind: screen.kind as string,
      deletedAt: screen.deletedAt,
    })
    if (routed.has(screen.id) || claimsToBeAPage) billable.add(screen.id)
  }
  return billable
}
