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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * The three fields a content collection can point at a template screen with.
 * `templateScreenId` is the legacy AGL-105 field `resolveCollectionTemplateScreenId`
 * still falls back to, so hosts predating the list/entry split are covered.
 *
 * Kept in step with `apps/console/app/api/hosts/resources/count-billable-screens.ts`,
 * which subtracts the same set from the plan's screen allowance.
 */
export const COLLECTION_TEMPLATE_SCREEN_FIELDS = [
  'listScreenId',
  'entryScreenId',
  'templateScreenId',
] as const

/** The shape this reads off a Firestore snapshot — kept structural so unit
 * tests don't need the admin SDK. */
interface FieldSnapshotLike {
  get(field: string): unknown
}

interface QuerySnapshotLike {
  docs: Array<FieldSnapshotLike>
}

/**
 * Every screen id any collection on this host designates as a list or entry
 * template. Pure, so the routing rule can be tested without Firestore.
 */
export function collectTemplateScreenIds(
  collections: QuerySnapshotLike,
): Set<string> {
  const ids = new Set<string>()
  for (const contentCollection of collections.docs) {
    for (const field of COLLECTION_TEMPLATE_SCREEN_FIELDS) {
      const screenId = contentCollection.get(field)
      if (typeof screenId === 'string' && screenId) ids.add(screenId)
    }
  }
  return ids
}

/**
 * Screens that must NOT resolve as pages of the site (AGL-1267).
 *
 * A collection's list/entry template is a composition input, not a page. It
 * only has meaning against a routed entry — `/{collection}/{entry}` substitutes
 * `{{entry.*}}` into it — so there is no request for which serving it at its
 * own slug produces something correct. Publishing one is what makes the
 * compose pipeline pick it up (`publishScreenRoute` stamps `publishedAt`), but
 * publishing ALSO writes `hosts/{hostId}.screens[screenId]`, which is the
 * tenant router's whole route table. That second write is the bug: publishing
 * the blog's entry template put a live `/blog-entry-template` page on the site
 * rendering seven raw `{{entry.*}}` tokens as body text.
 *
 * Computed by subtraction rather than a stored marker, exactly like
 * `countBillableScreens`: hosts whose templates predate this need no backfill,
 * and re-pointing a collection at a different screen takes effect on the next
 * revalidate. The field mask keeps the read to the three fields it looks at.
 *
 * Fails OPEN — an empty set on error. This sits on the critical path of every
 * tenant page render, and a transient Firestore error must degrade to "the
 * template is briefly reachable again", never to a site-wide 404.
 */
export async function getCollectionTemplateScreenIds(options: {
  hostId: string
}): Promise<Set<string>> {
  try {
    const collections = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(options.hostId)
      .collection('collections')
      .select(...COLLECTION_TEMPLATE_SCREEN_FIELDS)
      .limit(100)
      .get()
    return collectTemplateScreenIds(collections)
  } catch (error) {
    console.error('collection template lookup failed:', error)
    return new Set<string>()
  }
}

export default getCollectionTemplateScreenIds
