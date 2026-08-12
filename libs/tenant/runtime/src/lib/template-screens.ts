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

import { SCREEN_KIND_TEMPLATE } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'

/**
 * Cached as an ARRAY (a `Set` does not survive the cache's JSON round trip)
 * and rehydrated at the boundary (AGL-1302). Publishing a template screen
 * re-points a collection or the store settings, and both writes ride the
 * same publish flow that busts `tenant-data:{hostId}`; 60s is the backstop.
 */
const TEMPLATE_SCREEN_IDS_TTL_SECONDS = 60

/**
 * The three fields a CONTENT collection can point at a template screen with.
 * `templateScreenId` is the legacy AGL-105 field `resolveCollectionTemplateScreenId`
 * still falls back to, so hosts predating the list/entry split are covered.
 *
 * `apps/console/app/api/hosts/resources/count-billable-screens.ts` subtracts
 * this same set from the plan's screen allowance. It deliberately does NOT
 * subtract the store fields below — what a template costs the subscriber is a
 * separate question from whether it is a page.
 */
export const COLLECTION_TEMPLATE_SCREEN_FIELDS = [
  'listScreenId',
  'entryScreenId',
  'templateScreenId',
] as const

/**
 * The two fields COMMERCE points at a template screen with (AGL-1270). They
 * live on `hosts/{hostId}/settings/store` (AGL-295), not on a collection doc,
 * which is the only reason AGL-1267's fix did not already reach them —
 * `pdpScreenId` renders `/products/{slug}` and `collectionScreenId` renders
 * `/collections/{slug}`, both of which are templates in exactly the same sense.
 *
 * NOT yet mirrored in `apps/console/constants/collection-templates.ts`, which
 * re-declares the collection fields for its `'use client'` readers: publishing a
 * PDP template still toasts the author a route it does not have (the AGL-1269
 * half of AGL-1270). Widening it is a console change and belongs with that file.
 */
export const STORE_TEMPLATE_SCREEN_FIELDS = [
  'pdpScreenId',
  'collectionScreenId',
] as const

/** The shape this reads off a Firestore snapshot — kept structural so unit
 * tests don't need the admin SDK. */
interface FieldSnapshotLike {
  get(field: string): unknown
}

interface QuerySnapshotLike {
  docs: Array<FieldSnapshotLike>
}

/** Screen documents that say what they are — only the id is read. */
interface IdSnapshotLike {
  id: string
}

/**
 * Every screen id this host treats as a template — the screens that SAY so
 * (`kind: 'template'`), plus a content collection's list/entry screens and
 * commerce's PDP and catalog-collection screens. Pure, so the routing rule can
 * be tested without Firestore.
 *
 * A UNION, and each half covers what the other cannot (AGL-1400):
 *
 *  - The `kind` half reaches a template no pointer names any more. Clearing a
 *    collection's `entryScreenId` deliberately does NOT promote the screen back
 *    to a page — promotion is a gated act — so without this an orphaned
 *    template would become reachable at its own slug again, rendering raw
 *    `{{entry.*}}` tokens: AGL-1267, back.
 *  - The pointer half reaches the templates that are NOT `kind: 'template'`,
 *    and there are two kinds of those on purpose. A collection's LIST template
 *    is a page (AGL-1387) — billable, and served at `/{collectionSlug}` — but
 *    it must still 404 at the slug it was published under. Commerce's PDP and
 *    catalog templates are billable today too, and re-pricing them is a
 *    separate decision from this one.
 *
 * Any source may be absent (`null`/`undefined`): a host with no store settings
 * doc, or a read that failed on its own while the others succeeded.
 */
export function collectTemplateScreenIds(sources: {
  collections?: QuerySnapshotLike | null
  storeSettings?: FieldSnapshotLike | null
  templateScreens?: { docs: Array<IdSnapshotLike> } | null
}): Set<string> {
  const ids = new Set<string>()
  const add = (screenId: unknown) => {
    if (typeof screenId === 'string' && screenId) ids.add(screenId)
  }
  for (const screen of sources.templateScreens?.docs ?? []) add(screen.id)
  for (const contentCollection of sources.collections?.docs ?? []) {
    for (const field of COLLECTION_TEMPLATE_SCREEN_FIELDS) {
      add(contentCollection.get(field))
    }
  }
  if (sources.storeSettings) {
    for (const field of STORE_TEMPLATE_SCREEN_FIELDS) {
      add(sources.storeSettings.get(field))
    }
  }
  return ids
}

/**
 * Screens that must NOT resolve as pages of the site (AGL-1267, AGL-1270).
 *
 * A template screen is a composition input, not a page. It only has meaning
 * against a routed subject — `/{collection}/{entry}` substitutes `{{entry.*}}`,
 * `/products/{slug}` substitutes `{{product.*}}` — so there is no request for
 * which serving it at its own slug produces something correct. Publishing one
 * is what makes the compose pipeline pick it up (`publishScreenRoute` stamps
 * `publishedAt`), but publishing ALSO writes `hosts/{hostId}.screens[screenId]`,
 * which is the tenant router's whole route table. That second write is the bug:
 * publishing the blog's entry template put a live `/blog-entry-template` page on
 * the site rendering seven raw `{{entry.*}}` tokens as body text, and publishing
 * a PDP template does the same with `{{product.*}}`.
 *
 * A stored marker AND the pointers (AGL-1400): `kind: 'template'` is the fact
 * for an entry template, and the pointers still answer for the two template
 * kinds that stay pages — a collection's LIST template (AGL-1387) and
 * commerce's PDP/catalog templates. See {@link collectTemplateScreenIds} for
 * why neither half subsumes the other. Re-pointing a collection (or the store)
 * at a different screen still takes effect on the next revalidate.
 *
 * THREE reads, not one — and one read cannot cover them. The template screens
 * and the collection templates are QUERIES over different subcollections; the
 * store templates are a single document at `hosts/{h}/settings/store`. Firestore
 * has no read that spans a query and a document in a different subcollection
 * (`getAll` batches document refs only, and cannot take the query). So they are
 * issued CONCURRENTLY: three RPCs, one round trip of latency, which is what the
 * cold-start budget cares about (AGL-1152). Both queries carry a field mask —
 * the screens one projects to ids alone — and the store doc is a single small
 * doc read whole, since `select` is a Query method and there is nothing to
 * project on a document get.
 *
 * Fails OPEN — an empty set on error, and PER SOURCE. This sits on the critical
 * path of every tenant page render, and a transient Firestore error must degrade
 * to "the template is briefly reachable again", never to a site-wide 404. Per
 * source because a store-settings failure has no business re-exposing the blog's
 * entry template, or vice versa.
 */
export async function getTemplateScreenIds(options: {
  hostId: string
}): Promise<Set<string>> {
  try {
    const ids = await withRenderCache({
      key: ['tenant-template-screens', options.hostId],
      revalidate: TEMPLATE_SCREEN_IDS_TTL_SECONDS,
      tags: [tenantDataTag(options.hostId)],
      read: async () => [...(await readTemplateScreenIds(options))],
    })
    return new Set(ids)
  } catch (error) {
    // The contract is "never rejects" — a cache failure degrades to the
    // uncached read, which itself fails open to an empty set.
    console.error('template screen lookup failed:', error)
    return readTemplateScreenIds(options)
  }
}

async function readTemplateScreenIds(options: {
  hostId: string
}): Promise<Set<string>> {
  try {
    const hostRef = firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(options.hostId)

    const [templateScreens, collections, storeSettings] = await Promise.all([
      // The screens that say so (AGL-1400). `select()` with no fields returns
      // ids only, and the equality filter rides Firestore's automatic
      // single-field index — no composite index, and no read of the 100+ screen
      // documents a large site has.
      hostRef
        .collection('screens')
        .where('kind', '==', SCREEN_KIND_TEMPLATE)
        .select()
        .limit(200)
        .get()
        .catch((error: unknown) => {
          console.error('template screen kind lookup failed:', error)
          return null
        }),
      hostRef
        .collection('collections')
        .select(...COLLECTION_TEMPLATE_SCREEN_FIELDS)
        .limit(100)
        .get()
        .catch((error: unknown) => {
          console.error('collection template lookup failed:', error)
          return null
        }),
      // A host with commerce disabled — or one that never opened Store
      // settings — has no doc here. A missing doc is not an error: `get()`
      // resolves with `exists: false` and every field read returns undefined,
      // so it contributes nothing and costs nothing else.
      hostRef
        .collection('settings')
        .doc('store')
        .get()
        .catch((error: unknown) => {
          console.error('store template lookup failed:', error)
          return null
        }),
    ])

    return collectTemplateScreenIds({ templateScreens, collections, storeSettings })
  } catch (error) {
    // The ref construction itself threw (no initialised admin app, say).
    console.error('template screen lookup failed:', error)
    return new Set<string>()
  }
}

export default getTemplateScreenIds
