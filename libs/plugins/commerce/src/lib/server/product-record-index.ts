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

import type {
  PluginIndexedRecord,
  PluginRecordIndex,
} from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'

/**
 * The commerce plugin's record indexes (AGL-3080): its products and its
 * product categories, as another plugin reads them — an AI job enriching a
 * catalog, a composer binding the products an email names — without knowing
 * where they are stored or what a deleted one looks like.
 *
 * Both are a SITE's (`hostId` required; an org-only scope answers nothing).
 * A deleted product and an unnamed one are left out of every answer.
 *
 * A product's `facts`:
 *   `type` (`physical` | `digital` | `service` | the stored value),
 *   `description`, `tags: string[]`, `categoryIds: string[]`,
 *   `options: Array<{ name, values: string[] }>`, `imageUrl` (the first
 *   photo's stored media value, or `null`), `seoTitle`, `seoDescription`.
 * A category's `facts` are empty: it is its name.
 */

const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).map(str).filter(Boolean)

function productRecord(id: string, data: Record<string, unknown> | undefined): PluginIndexedRecord | null {
  if (!data || data['deletedAt'] != null) return null
  const name = str(data['name'])
  if (!name) return null
  const seo = (data['seo'] ?? {}) as Record<string, unknown>
  const mediaUrls = Array.isArray(data['mediaUrls']) ? data['mediaUrls'] : []
  return {
    id,
    name,
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

function hostCollection(hostId: string, name: 'products' | 'productCategories') {
  return firebaseAdmin.app().firestore().collection('hosts').doc(hostId).collection(name)
}

export const productRecordIndex: PluginRecordIndex = {
  async list({ hostId, limit }) {
    if (!hostId || limit <= 0) return { records: [], truncated: false }
    // One more than asked, so `truncated` is a fact rather than a guess; the
    // deleted rows are filtered after the read, like every reader did.
    const snapshot = await hostCollection(hostId, 'products').limit(limit + 1).get()
    const records = snapshot.docs
      .map((doc) => productRecord(doc.id, doc.data()))
      .filter((record): record is PluginIndexedRecord => record !== null)
    return { records: records.slice(0, limit), truncated: snapshot.size > limit }
  },
  async get({ hostId, id }) {
    if (!hostId || !id) return null
    const snapshot = await hostCollection(hostId, 'products').doc(id).get()
    return snapshot.exists ? productRecord(snapshot.id, snapshot.data()) : null
  },
}

export const productCategoryRecordIndex: PluginRecordIndex = {
  async list({ hostId, limit }) {
    if (!hostId || limit <= 0) return { records: [], truncated: false }
    const snapshot = await hostCollection(hostId, 'productCategories')
      .select('name')
      .limit(limit + 1)
      .get()
    const records = snapshot.docs
      .map((doc) => ({ id: doc.id, name: str(doc.get('name')), facts: {} }))
      .filter((record) => record.name)
    return { records: records.slice(0, limit), truncated: snapshot.size > limit }
  },
  async get({ hostId, id }) {
    if (!hostId || !id) return null
    const snapshot = await hostCollection(hostId, 'productCategories').doc(id).get()
    const name = snapshot.exists ? str(snapshot.get('name')) : ''
    return name ? { id: snapshot.id, name, facts: {} } : null
  },
}
