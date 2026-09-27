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

import {
  collection,
  type Firestore,
  getDocs,
  query,
  where,
} from 'firebase/firestore'
import * as CommerceModel from '../../model'

/*
 * THE HOST'S SMART COLLECTIONS, AS A PRODUCT WRITER NEEDS THEM (AGL-3321).
 *
 * A product carries `collectionIds` — the smart collections its rules
 * answer — because the storefront reads a smart collection no query can
 * express by that array. So every console path that writes a product's
 * name, tags, categories, variants or type asks the STORE for the host's
 * smart collections at the moment it writes, and stamps the membership
 * `productCollectionIds` computes from them. Asked at write time rather
 * than read off a listener: a listener's rows can be a cached picture, and a
 * membership computed from a stale rule set is the drift this field exists
 * to prevent. When a smart collection itself changes, the
 * `commerce/collection-membership` route re-stamps every product instead.
 */

/**
 * Every smart catalog collection on the host, with the rules membership is
 * computed from. Two equalities, which Firestore's single-field indexes
 * answer without a composite; content collections share the path and are
 * excluded by `kind`.
 */
export async function readSmartCollections(
  firestore: Firestore,
  hostId: string,
): Promise<CommerceModel.SmartCollectionRules[]> {
  const snapshot = await getDocs(
    query(
      collection(firestore, 'hosts', hostId, 'collections'),
      where('kind', '==', 'catalog'),
      where('mode', '==', 'smart'),
    ),
  )
  return snapshot.docs.map((entry) => ({
    id: entry.id,
    rules: entry.get('rules') ?? [],
    matchAll: entry.get('matchAll'),
  }))
}

/**
 * The `collectionIds` field for a product as it is about to be written.
 * Spread it beside the rest of the payload.
 */
export async function productCollectionFields(
  firestore: Firestore,
  hostId: string,
  product: Parameters<typeof CommerceModel.productCollectionIds>[0],
  smartCollections?: readonly CommerceModel.SmartCollectionRules[],
): Promise<{ collectionIds: string[] }> {
  const rules = smartCollections ?? (await readSmartCollections(firestore, hostId))
  return { collectionIds: CommerceModel.productCollectionIds(product, rules) }
}
