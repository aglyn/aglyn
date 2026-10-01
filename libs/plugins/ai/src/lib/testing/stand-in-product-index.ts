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
  registerPluginRecordIndex,
  type PluginIndexedRecord,
} from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'

/**
 * The product and category indexes a plugin that keeps products publishes
 * (AGL-3080), stood in over a spec's own Firestore double — this plugin may
 * not load the commerce plugin that registers the real ones. It answers in
 * the shape the commerce plugin's `product-record-index.ts` documents: live,
 * named records only, with the product facts its docblock lists. What the
 * commerce plugin itself answers is held in its own spec.
 */

const OWNER = 'commerce'

const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).map(str).filter(Boolean)

function product(id: string, data: Record<string, unknown> | undefined): PluginIndexedRecord | null {
  if (!data || data['deletedAt'] != null || !str(data['name'])) return null
  const seo = (data['seo'] ?? {}) as Record<string, unknown>
  const mediaUrls = Array.isArray(data['mediaUrls']) ? data['mediaUrls'] : []
  return {
    id,
    name: str(data['name']),
    facts: {
      type: data['type'],
      description: str(data['description']),
      tags: strings(data['tags']),
      categoryIds: strings(data['categoryIds']),
      options: (Array.isArray(data['options']) ? data['options'] : []).map((option) => {
        const record = (option ?? {}) as Record<string, unknown>
        return { name: str(record['name']), values: strings(record['values']) }
      }),
      imageUrl: str(mediaUrls[0]) || str(data['imageUrl']) || null,
      seoTitle: str(seo['title']),
      seoDescription: str(seo['description']),
    },
  }
}

/** Registers both indexes, reading through `firestore`. */
export function standInProductIndexes(firestore: FirebaseFirestore.Firestore): void {
  const site = (hostId: string, name: string) =>
    firestore.collection('hosts').doc(hostId).collection(name)
  registerPluginRecordIndex(
    'product',
    {
      async list({ hostId, limit }) {
        if (!hostId) return { records: [], truncated: false }
        const snapshot = await site(hostId, 'products').limit(limit + 1).get()
        const records = snapshot.docs
          .map((doc) => product(doc.id, doc.data()))
          .filter((record): record is PluginIndexedRecord => record !== null)
        return { records: records.slice(0, limit), truncated: snapshot.docs.length > limit }
      },
      async get({ hostId, id }) {
        if (!hostId) return null
        const snapshot = await site(hostId, 'products').doc(id).get()
        return snapshot.exists ? product(snapshot.id, snapshot.data()) : null
      },
    },
    { pluginId: OWNER },
  )
  registerPluginRecordIndex(
    'productCategory',
    {
      async list({ hostId, limit }) {
        if (!hostId) return { records: [], truncated: false }
        const snapshot = await site(hostId, 'productCategories').limit(limit + 1).get()
        const records = snapshot.docs
          .map((doc) => ({ id: doc.id, name: str(doc.get('name')), facts: {} }))
          .filter((record) => record.name)
        return { records: records.slice(0, limit), truncated: snapshot.docs.length > limit }
      },
      async get() {
        return null
      },
    },
    { pluginId: OWNER },
  )
}

/** Forgets both, so the next spec starts with no plugin keeping products. */
export function removeStandInProductIndexes(): void {
  unregisterPluginServices(OWNER)
}
