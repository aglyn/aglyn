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

import { nameSearchToken } from '@aglyn/aglyn/app-utils/name-search'
import {
  registerPluginRecordListSource,
  type PluginRecordListSource,
} from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { BUNDLE_ID } from '../constants/bundle-common'
import { productIndexedRecord } from './product-record'

/**
 * A site's products, FOUND in the console for another plugin's picker
 * (AGL-3080) — a deal adding a product as a line, priced from the catalog.
 *
 * A search, not a listing: the first word typed is matched as a prefix of a
 * word in an ACTIVE product's name, ordered by name — a draft or archived
 * product is not offered for sale. With nothing typed, at the organization,
 * where no catalog lives, and for a listing, from which no product is
 * installed, the source answers none. Each record is `productIndexedRecord`'s,
 * the server index's shape, with its price and its priced variants.
 */
export const productRecordListSource: PluginRecordListSource = {
  query(firestore, request) {
    const token = nameSearchToken(request.search)
    if (!request.hostId || !token || request.installedFrom) return null
    return query(
      collection(firestore, 'hosts', request.hostId, 'products'),
      where('status', '==', 'active'),
      where('nameTokens', 'array-contains', token),
      orderBy('nameLower'),
      limit(request.limit),
    )
  },
  record: productIndexedRecord,
}

/** Called from the console registrar, owner named for a spec that calls it directly. */
export function registerCommerceRecordLists(): void {
  registerPluginRecordListSource('product', productRecordListSource, { pluginId: BUNDLE_ID })
}
