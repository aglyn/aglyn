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

import type { PosOfflineKit, PosOfflineRefusal, PosOfflineSale } from '../../../model/commerce-pos-offline'

/*==========================================
 * WHAT THE REGISTER KEEPS ON THE DEVICE (AGL-3625), in IndexedDB.
 *
 * Two things, both scoped to ONE signed-in member at ONE site — the scope is
 * part of every key, so another member on the same tablet, or the same
 * member in another workspace, never reads a sale or a catalog that is not
 * theirs:
 *
 *  - the KIT: the server's offline rules for the site plus the catalog the
 *    grid sells from, refreshed while online. Products only; nothing about
 *    any customer.
 *  - the QUEUE: each cash sale rung offline, until the server has recorded
 *    it. A sale carries its customer's email and name only when the cashier
 *    attached one, because the receipt email is sent on sync; it leaves the
 *    device the moment the server answers for it.
 *
 * IndexedDB, not `localStorage`: a queue must survive a reload, and a sale is
 * a structured record written atomically. When the browser refuses storage
 * (a private window, storage blocked, a quota) the store does not open and the
 * register says "offline selling unavailable" — it never crashes the till.
 *=========================================*/

const DB_NAME = 'aglyn-pos-offline'
const DB_VERSION = 1
const KITS = 'kits'
const SALES = 'sales'

/** One product as the offline grid sells it. */
export type PosOfflineProduct = Record<string, any> & { $id: string; name?: string }

/** The kit as the device keeps it: the server's rules and the catalog. */
export interface PosOfflineDeviceKit {
  scope: string
  kit: PosOfflineKit | null
  kitSavedAtMs: number
  products: PosOfflineProduct[]
  catalogSavedAtMs: number
}

/** A sale on the device, with where it stands. */
export interface PosOfflineQueuedSale {
  scope: string
  saleKey: string
  sale: PosOfflineSale
  /** `queued` waits for the connection; `refused` waits for the cashier. */
  state: 'queued' | 'refused'
  queuedAtMs: number
  attempts: number
  error?: string
  reason?: PosOfflineRefusal
}

export interface PosOfflineStore {
  readonly scope: string
  loadKit(): Promise<PosOfflineDeviceKit | null>
  saveKit(kit: Omit<PosOfflineDeviceKit, 'scope'>): Promise<void>
  /** Every sale this member queued at this site, oldest first. */
  listSales(): Promise<PosOfflineQueuedSale[]>
  putSale(sale: Omit<PosOfflineQueuedSale, 'scope'>): Promise<void>
  removeSale(saleKey: string): Promise<void>
}

/** The scope every key carries: one member at one site. */
export function posOfflineScope(uid: string, hostId: string): string {
  return `${uid}:${hostId}`
}

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let opening: IDBOpenDBRequest
    try {
      opening = factory.open(DB_NAME, DB_VERSION)
    } catch (error) {
      reject(error)
      return
    }
    opening.onupgradeneeded = () => {
      const db = opening.result
      if (!db.objectStoreNames.contains(KITS)) db.createObjectStore(KITS, { keyPath: 'scope' })
      if (!db.objectStoreNames.contains(SALES)) db.createObjectStore(SALES, { keyPath: 'key' })
    }
    opening.onsuccess = () => resolve(opening.result)
    opening.onerror = () => reject(opening.error ?? new Error('IndexedDB did not open'))
    opening.onblocked = () => reject(new Error('IndexedDB is blocked'))
  })
}

/**
 * The device store for one member at one site, or `null` when this browser
 * will not keep one. Never throws.
 */
export async function openPosOfflineStore(
  scope: { uid: string; hostId: string },
  factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
): Promise<PosOfflineStore | null> {
  if (!factory || !scope.uid || !scope.hostId) return null
  let db: IDBDatabase
  try {
    db = await openDatabase(factory)
  } catch {
    return null
  }
  const key = posOfflineScope(scope.uid, scope.hostId)
  const store = (name: string, mode: IDBTransactionMode) => db.transaction(name, mode).objectStore(name)
  const saleId = (saleKey: string) => `${key}|${saleKey}`
  return {
    scope: key,
    loadKit: async () => {
      const found = (await request(store(KITS, 'readonly').get(key))) as PosOfflineDeviceKit | undefined
      return found ?? null
    },
    saveKit: async (kit) => {
      await request(store(KITS, 'readwrite').put({ ...kit, scope: key }))
    },
    listSales: async () => {
      // This member's keys only, where the browser can range over them; the
      // filter below holds either way.
      const range =
        typeof IDBKeyRange === 'undefined' ? undefined : IDBKeyRange.bound(`${key}|`, `${key}|\uffff`)
      const all = (await request(store(SALES, 'readonly').getAll(range))) as Array<
        PosOfflineQueuedSale & { key: string }
      >
      return all
        .filter((entry) => entry.scope === key)
        .map(({ key: _key, ...entry }) => entry)
        .sort((a, b) => a.sale.soldAtMs - b.sale.soldAtMs || a.queuedAtMs - b.queuedAtMs)
    },
    putSale: async (sale) => {
      await request(store(SALES, 'readwrite').put({ ...sale, scope: key, key: saleId(sale.saleKey) }))
    },
    removeSale: async (saleKey) => {
      await request(store(SALES, 'readwrite').delete(saleId(saleKey)))
    },
  }
}

/** The fields a product sells by; its long copy stays on the server. */
const HEAVY_PRODUCT_FIELDS = ['description', 'descriptionHtml', 'body', 'seo', 'longDescription', 'reviews']

/** A product trimmed and made plain for the device. */
export function posOfflineProduct(product: Record<string, any>): PosOfflineProduct | null {
  const id = String(product?.['$id'] ?? '')
  if (!id) return null
  const plain = JSON.parse(JSON.stringify(product)) as Record<string, any>
  for (const field of HEAVY_PRODUCT_FIELDS) delete plain[field]
  return { ...plain, $id: id }
}
