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

import { openPosOfflineStore, posOfflineProduct, type PosOfflineQueuedSale } from './pos-offline-store'

/**
 * The register's device store (AGL-3625): a queued sale survives a reload,
 * another member or site on the same device never reads it, and a browser
 * that refuses storage leaves the register "offline selling unavailable"
 * rather than crashing.
 *
 * IndexedDB is a small in-memory double of the parts the store uses; the
 * databases it holds outlive one `open`, as a browser's do across reloads.
 */

type Rows = Map<string, Record<string, unknown>>

const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)))

function fakeIndexedDb(): IDBFactory {
  const databases = new Map<string, Map<string, { keyPath: string; rows: Rows }>>()
  const later = (fn: () => void) => setTimeout(fn, 0)
  const answer = <T>(value: () => T) => {
    const req: any = {}
    later(() => {
      try {
        req.result = value()
        req.onsuccess?.()
      } catch (error) {
        req.error = error
        req.onerror?.()
      }
    })
    return req
  }
  return {
    open: (name: string) => {
      const req: any = {}
      later(() => {
        const fresh = !databases.has(name)
        const stores = databases.get(name) ?? new Map()
        databases.set(name, stores)
        const db = {
          objectStoreNames: { contains: (store: string) => stores.has(store) },
          createObjectStore: (store: string, options: { keyPath: string }) =>
            stores.set(store, { keyPath: options.keyPath, rows: new Map() }),
          transaction: (store: string) => ({
            objectStore: () => {
              const target = stores.get(store)!
              return {
                get: (key: string) => answer(() => clone(target.rows.get(key))),
                getAll: () => answer(() => [...target.rows.values()].map((row) => clone(row))),
                put: (row: Record<string, unknown>) =>
                  answer(() => void target.rows.set(String(row[target.keyPath]), clone(row))),
                delete: (key: string) => answer(() => void target.rows.delete(key)),
              }
            },
          }),
        }
        req.result = db
        if (fresh) req.onupgradeneeded?.()
        req.onsuccess?.()
      })
      return req
    },
  } as unknown as IDBFactory
}

const queued = (saleKey: string, soldAtMs: number, uid = 'u1'): Omit<PosOfflineQueuedSale, 'scope'> => ({
  saleKey,
  state: 'queued',
  queuedAtMs: soldAtMs,
  attempts: 0,
  sale: {
    v: 1,
    saleKey,
    hostId: 'shop',
    orgId: 'org-1',
    signedInUid: uid,
    registerId: 'front',
    soldAtMs,
    lines: [{ productId: 'p1', name: 'Mug', quantity: 1, unitAmountCents: 1200 }],
    discountPct: 0,
    totals: { itemsCents: 1200, shippingCents: 0, taxCents: 0, discountCents: 0, totalCents: 1200, feeCents: 0 },
    cashTenderedCents: 2000,
    changeCents: 800,
  },
})

describe('the register device store', () => {
  it('keeps a queued sale and the kit across a reopen, oldest sale first', async () => {
    const idb = fakeIndexedDb()
    const first = (await openPosOfflineStore({ uid: 'u1', hostId: 'shop' }, idb))!
    await first.putSale(queued('saleaaaaaaaaaaaaaaaa2', 2000))
    await first.putSale(queued('saleaaaaaaaaaaaaaaaa1', 1000))
    await first.saveKit({ kit: null, kitSavedAtMs: 5, products: [{ $id: 'p1', name: 'Mug' }], catalogSavedAtMs: 5 })

    const reopened = (await openPosOfflineStore({ uid: 'u1', hostId: 'shop' }, idb))!
    expect((await reopened.listSales()).map((entry) => entry.saleKey)).toEqual([
      'saleaaaaaaaaaaaaaaaa1',
      'saleaaaaaaaaaaaaaaaa2',
    ])
    expect((await reopened.loadKit())?.products).toEqual([{ $id: 'p1', name: 'Mug' }])
    await reopened.removeSale('saleaaaaaaaaaaaaaaaa1')
    expect((await reopened.listSales()).map((entry) => entry.saleKey)).toEqual(['saleaaaaaaaaaaaaaaaa2'])
  })

  it('never shows one member’s or site’s queue to another on the same device', async () => {
    const idb = fakeIndexedDb()
    const mine = (await openPosOfflineStore({ uid: 'u1', hostId: 'shop' }, idb))!
    await mine.putSale(queued('saleaaaaaaaaaaaaaaaa1', 1000))
    await mine.saveKit({ kit: null, kitSavedAtMs: 1, products: [{ $id: 'p1' }], catalogSavedAtMs: 1 })
    const colleague = (await openPosOfflineStore({ uid: 'u2', hostId: 'shop' }, idb))!
    const otherSite = (await openPosOfflineStore({ uid: 'u1', hostId: 'other' }, idb))!
    expect(await colleague.listSales()).toEqual([])
    expect(await colleague.loadKit()).toBeNull()
    expect(await otherSite.listSales()).toEqual([])
  })

  it('answers null, never a throw, when the browser keeps nothing', async () => {
    expect(await openPosOfflineStore({ uid: 'u1', hostId: 'shop' }, undefined)).toBeNull()
    const throwing = {
      open: () => {
        throw new Error('InvalidStateError: private window')
      },
    } as unknown as IDBFactory
    expect(await openPosOfflineStore({ uid: 'u1', hostId: 'shop' }, throwing)).toBeNull()
    const failing = {
      open: () => {
        const req: any = {}
        setTimeout(() => {
          req.error = new Error('QuotaExceededError')
          req.onerror?.()
        }, 0)
        return req
      },
    } as unknown as IDBFactory
    expect(await openPosOfflineStore({ uid: 'u1', hostId: 'shop' }, failing)).toBeNull()
    expect(await openPosOfflineStore({ uid: '', hostId: 'shop' }, fakeIndexedDb())).toBeNull()
  })

  it('keeps a product’s selling fields and drops its long copy', () => {
    expect(
      posOfflineProduct({ $id: 'p1', name: 'Mug', description: 'long', seo: { title: 'x' }, variants: [{ id: 'v1' }] }),
    ).toEqual({ $id: 'p1', name: 'Mug', variants: [{ id: 'v1' }] })
    expect(posOfflineProduct({ name: 'no id' })).toBeNull()
  })
})
