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
  registerPluginRecordCardReader,
  type PluginRecordCard,
} from '@aglyn/aglyn/plugin-manager/plugin-record-cards'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { BUNDLE_ID } from '../constants/bundle-common'
import { productPriceRange } from '../model'

/**
 * What a product looks like in one line and one image, for a surface that is
 * not this plugin's own — a designed email that features it, today.
 *
 * The rule that matters is the caption: a product's "from" price is the lowest
 * variant price, and {@link productPriceRange} is the one place that is worked
 * out. A caller that read the product document itself would have to import it
 * to agree, which is how the marketing plugin came to depend on this one.
 */
export function productCard(
  productId: string,
  data: Record<string, any>,
): PluginRecordCard {
  const [minPrice] = productPriceRange(data as Parameters<typeof productPriceRange>[0])
  return {
    title: String(data['name'] ?? productId),
    ...(minPrice ? { caption: `$${minPrice}` } : {}),
    ...(data['imageUrl'] ?? data['mediaUrls']?.[0]
      ? { imageUrl: data['imageUrl'] ?? data['mediaUrls']?.[0] }
      : {}),
    ...(data['slug'] ? { path: `/products/${data['slug']}` } : {}),
  }
}

/** Registered from both server registrars, so either app's handlers can ask. */
export function registerProductCardReader(): void {
  registerPluginRecordCardReader(
    'product',
    {
      async read({ hostId, id }) {
        const snapshot = await firebaseAdmin
          .app()
          .firestore()
          .collection('hosts')
          .doc(hostId)
          .collection('products')
          .doc(id)
          .get()
        return snapshot.exists
          ? productCard(id, snapshot.data() as Record<string, any>)
          : null
      },
    },
    { pluginId: BUNDLE_ID },
  )
}
