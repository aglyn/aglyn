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
 * Where conversion attributions are kept, and how an erasure reaches them.
 *
 * ## Why this is a leaf module and not part of the join
 *
 * The erasure runs from `email-delivery-log.ts`, in the same function that
 * drops a person's campaign touches — which is the point, because an
 * attribution is a conclusion drawn from those touches and a conclusion that
 * outlives its evidence is an erasure that did not happen. But the join
 * itself READS that module (`readEmailCampaignTouch` is one half of the
 * last-touch comparison), so putting the erasure beside the join would make
 * the two modules import each other. Under jest that cycle resolves to
 * `undefined` at import time rather than failing loudly, which is how an
 * erasure comes to silently do nothing while its test passes.
 *
 * So the collection name and the sweep live here, importing nothing but
 * Firestore, and both sides import this.
 */

import firebaseAdmin from './firebase-admin'

const defaultFirestore = () => firebaseAdmin.app().firestore()

/** The per-host collection of conversion attribution records. */
export const CAMPAIGN_ATTRIBUTIONS_COLLECTION = 'campaignAttributions'

/** How many records one erasure pass removes per batch. */
const ERASURE_BATCH = 400

/**
 * Removes every conversion attributed to one person, across every site.
 *
 * ## Why an erasure reaches these at all
 *
 * An attribution is a claim about a person: "this human came from that
 * campaign and then did this". It is the same personal fact as the click
 * stamp it was derived from, and the erasure path already deletes those —
 * `eraseEmailDeliveriesForAddresses` drops `campaignTouches` alongside the
 * engagement stamps and says why. A summary that outlived its source would
 * leave an erasure that removed the evidence and kept the conclusion.
 *
 * ## Why a collection-group query
 *
 * The record is per HOST, because that is where a site's own reporting reads
 * it. An erasure arrives as an ADDRESS and knows nothing about which sites
 * that person ever visited. The collection group is the join between the two,
 * and `personKey` is on the record precisely so one exists — declared in
 * `cloud/firebase-firestore.indexes.json` with `COLLECTION_GROUP` scope,
 * because a collection-group query gets no automatic single-field index and
 * would otherwise fail with FAILED_PRECONDITION at the moment somebody asked
 * to be forgotten.
 *
 * ## The order's own record is NOT touched
 *
 * `emailAttributions` holds a commercial fact about a sale, keyed by the
 * order's id and carrying no address — the revenue join says so where it
 * writes it. This holds a record of a person's behavior under a key derived
 * from their address. Different facts, different answers, and the split is
 * why both are defensible.
 *
 * Never throws: an erasure that fails on one leg must still complete the
 * others, and the caller reports what it removed.
 *
 * @returns how many records were removed.
 */
export async function eraseCampaignAttributionsForPersonKey(
  key: string | null | undefined,
  firestore?: any,
): Promise<number> {
  if (!key || typeof key !== 'string') return 0
  const db = firestore ?? defaultFirestore()
  let removed = 0
  try {
    // Bounded rather than `while (true)`: a pathological volume must not be
    // able to hold an erasure request open indefinitely, and the pass that
    // runs next picks up whatever a bounded one left.
    for (let pass = 0; pass < 20; pass += 1) {
      const snapshot = await db
        .collectionGroup(CAMPAIGN_ATTRIBUTIONS_COLLECTION)
        .where('personKey', '==', key)
        .limit(ERASURE_BATCH)
        .get()
      if (snapshot.empty) break
      const batch = db.batch()
      snapshot.docs.forEach((doc: any) => batch.delete(doc.ref))
      await batch.commit()
      removed += snapshot.size
      if (snapshot.size < ERASURE_BATCH) break
    }
  } catch (error) {
    console.error('eraseCampaignAttributionsForPersonKey failed', error)
  }
  return removed
}
