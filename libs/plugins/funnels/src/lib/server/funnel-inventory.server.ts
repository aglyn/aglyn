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

import { pluginEntityPicker } from '@aglyn/aglyn/plugin-manager/plugin-entity-pickers'
import { pluginHostCollection } from '@aglyn/aglyn/plugin-manager/plugin-host-collections'
import type { FunnelInventory, FunnelInventoryItem } from '../model/funnel-inventory'

/**
 * A site's funnel inventory, read on the server (AGL-3605).
 *
 * Pages come from the host document's routing map, one read. The records
 * belong to other plugins, so they are read by the names those plugins
 * DECLARE — a collection is listed only when some plugin declares it as a
 * site collection, and a record's name field is the one its entity picker
 * declares — and never by importing them. A site whose workspace runs no
 * bookings simply has no services to pick.
 *
 * Each list is bounded: the pickers and the prompt need a site's records, not
 * an unbounded scan of them.
 */

const LIMITS = { forms: 100, services: 100, products: 200, overlays: 100 } as const
const PAGE_LIMIT = 500

async function readRecords(
  firestore: any,
  hostId: string,
  collection: string,
  pickerKind: string | null,
  limit: number,
): Promise<FunnelInventoryItem[]> {
  if (!pluginHostCollection(collection)) return []
  const nameField = (pickerKind && pluginEntityPicker(pickerKind)?.nameField) || 'name'
  const snapshot = await firestore
    .collection('hosts')
    .doc(hostId)
    .collection(collection)
    .limit(limit)
    .get()
    .catch(() => null)
  if (!snapshot) return []
  const items: FunnelInventoryItem[] = []
  for (const doc of snapshot.docs) {
    const data = (doc.data() ?? {}) as Record<string, unknown>
    if (data['deletedAt']) continue
    const name = String(data[nameField] ?? data['name'] ?? data['displayName'] ?? '').trim()
    items.push({ id: doc.id, name: name || doc.id })
  }
  return items.sort((a, b) => a.name.localeCompare(b.name))
}

export async function readFunnelInventory(
  firestore: any,
  hostId: string,
  hostData?: Record<string, unknown> | null,
): Promise<FunnelInventory> {
  const host =
    hostData ??
    ((await firestore.collection('hosts').doc(hostId).get()).data() as Record<string, unknown> | undefined) ??
    {}
  const routes = (host['screens'] ?? {}) as Record<string, unknown>
  const pages = [
    ...new Set(
      Object.values(routes)
        .filter((path): path is string => typeof path === 'string' && path.startsWith('/'))
        .map((path) => (path.length > 1 ? path.replace(/\/+$/, '') : path)),
    ),
  ]
    .sort()
    .slice(0, PAGE_LIMIT)
  const [forms, services, products, overlays] = await Promise.all([
    readRecords(firestore, hostId, 'forms', 'forms', LIMITS.forms),
    readRecords(firestore, hostId, 'services', null, LIMITS.services),
    readRecords(firestore, hostId, 'products', 'products', LIMITS.products),
    readRecords(firestore, hostId, 'overlays', null, LIMITS.overlays),
  ])
  return { pages, forms, services, products, overlays }
}
