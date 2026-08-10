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

/**
 * The listing read behind the social card (AGL-876).
 *
 * Split from `listing-social-card.ts` so the card POLICY is testable without
 * firebase-admin, and so this file — the only part that touches it — states
 * its own two rules:
 *
 * 1. **Admin SDK, not the client SDK or the REST API.** App Check is enforced
 *    on this project, and an unattested server-side read is refused with what
 *    reads like a rules denial. The Admin SDK bypasses both App Check and the
 *    rules, which is exactly why the visibility gate lives in the card builder
 *    rather than being delegated to `allow read: if true`.
 * 2. **It can never throw.** `generateMetadata` runs on the render path; an
 *    unhandled rejection there fails the whole route, and this route's job is
 *    to serve a page whether or not its card resolves. A missing credential
 *    (`getApp()` throws when init was skipped — see `fbserver`, which
 *    deliberately no-ops on partial credentials so a build can load route
 *    modules) degrades to the generic shell instead of a 500.
 */

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { ListingSocialCardSource } from './listing-social-card'

const LISTING_COLLECTION = 'marketplaceListings'

/**
 * Whether a path segment from the URL is safe to hand to `.doc()`.
 *
 * A slash would silently address a SUBCOLLECTION rather than erroring, so an
 * id is checked before it is used, not caught afterwards. `.`/`..` and the
 * `__reserved__` form are refused by Firestore itself; refusing them here
 * keeps the failure a `undefined` rather than a thrown request.
 */
function isReadableListingId(listingId: string): boolean {
  if (!listingId || listingId.length > 1500) return false
  if (listingId === '.' || listingId === '..') return false
  if (/^__.*__$/.test(listingId)) return false
  return !listingId.includes('/')
}

/**
 * Reads the listing document, or `undefined` for anything that is not one.
 *
 * The caller treats "no such listing" and "the read failed" identically, so
 * they are not distinguished here either.
 */
export async function readListingForSocialCard(
  listingId: string,
): Promise<ListingSocialCardSource | undefined> {
  if (!isReadableListingId(String(listingId ?? ''))) return undefined
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection(LISTING_COLLECTION)
      .doc(listingId)
      .get()
    if (!snapshot.exists) return undefined
    return snapshot.data() as ListingSocialCardSource
  } catch {
    return undefined
  }
}
