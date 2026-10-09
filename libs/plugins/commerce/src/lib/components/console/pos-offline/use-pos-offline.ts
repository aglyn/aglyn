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
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as CommerceModel from '../../../model'
import {
  posOfflineChangeCents,
  posOfflineSaleTotals,
  POS_OFFLINE_SYNC_BATCH_MAX,
  type PosOfflineFlag,
  type PosOfflineKit,
  type PosOfflineSale,
  type PosOfflineSaleLine,
  type PosOfflineStockConflict,
} from '../../../model/commerce-pos-offline'
import type { RegisterLine } from '../pos/pos-cart-panel.component'
import { fetchPosOfflineKit, newPosOfflineSaleKey, syncPosOfflineSales } from './pos-offline-api'
import {
  openPosOfflineStore,
  posOfflineProduct,
  type PosOfflineProduct,
  type PosOfflineQueuedSale,
  type PosOfflineStore,
} from './pos-offline-store'

/*==========================================
 * THE REGISTER, OFFLINE (AGL-3625).
 *
 * WHEN IS IT OFFLINE: when the browser says so, or when a register call
 * failed at the network — a Wi-Fi that is "connected" to a router with no
 * uplink looks online to `navigator.onLine`. While offline it probes the sync
 * route every few seconds; the first answer brings it back.
 *
 * WHAT IT KEEPS: the kit and the catalog, refreshed while online, and the
 * queue (see `pos-offline-store.ts`).
 *
 * HOW IT SYNCS: on reconnect, on mount, and after every offline sale while
 * online again, in batches, one sync at a time. A sale leaves the device only
 * when the server has answered for it — recorded, or a replay of a recording —
 * so a connection that drops mid-request leaves it queued, and sending it
 * again is safe: the server lands a sale key once.
 *=========================================*/

/** How often the kit is refreshed while online. */
const KIT_REFRESH_MS = 10 * 60 * 1000
/** How often the whole catalog is re-read for the device. */
const CATALOG_REFRESH_MS = 30 * 60 * 1000
/** How often an offline register asks whether the server answers again. */
const PROBE_MS = 15 * 1000

type User = Parameters<typeof fetchPosOfflineKit>[0]

/** A sale the server answered for with something to check. */
export interface PosOfflineSyncNotice {
  saleKey: string
  orderId: string
  number: number | null
  flags: PosOfflineFlag[]
  stockConflicts: PosOfflineStockConflict[]
}

/** A cash sale the register just rang offline, for its receipt step. */
export interface PosOfflineRungSale {
  saleKey: string
  sale: PosOfflineSale
  /** The order the receipt prints, shaped as the stored order will be. */
  order: CommerceModel.HostOrder & { createdAtMs: number; customerName?: string | null }
}

export interface PosOfflineState {
  /** The register is offline right now. */
  offline: boolean
  /** This device can sell offline: storage opened and the kit says yes. */
  ready: boolean
  /** Why it cannot, in the cashier's words, when it cannot. */
  unavailableReason: string | null
  kit: PosOfflineKit | null
  /** Sales on this device that have not synced, oldest first. */
  queue: PosOfflineQueuedSale[]
  syncing: boolean
  /** Why the last sync could not run, when the server refused it outright. */
  syncError: string | null
  /** Synced sales the server flagged, until the cashier dismisses them. */
  notices: PosOfflineSyncNotice[]
  /** The products the offline grid shows for a search and a chip. */
  gridProducts(search: string, categoryId: string, quickKeysId: string): PosOfflineProduct[]
  /** A product and variant by barcode or SKU from the cached catalog. */
  findByCode(code: string): { product: PosOfflineProduct; variant: any } | null
  /** The totals the basket rings offline, or `null` when it cannot. */
  totalsFor(lines: RegisterLine[], discountPct: number): CommerceModel.OrderTotals | null
  /** Queues one cash sale; `null` (and nothing taken) when it cannot be kept. */
  ringCashSale(input: {
    lines: RegisterLine[]
    discountPct: number
    cashTenderedCents: number
    customer?: { email?: string | null; name?: string | null; kind?: string; id?: string } | null
  }): Promise<PosOfflineRungSale | null>
  /** A register call failed at the network. */
  reportNetworkFailure(): void
  syncNow(): Promise<void>
  dismissNotices(): void
  /** Removes a refused sale the server will never take, after the cashier confirms. */
  discard(saleKey: string): Promise<void>
}

export interface UsePosOfflineInput {
  hostId: string
  user: User | null | undefined
  registerId: string
  /** The open shift on the register as last seen, if any. */
  openShiftId?: string | null
  locationId?: string
  cashierAssertion?: string
  /** Products the live grid holds; kept for the device as they arrive. */
  liveProducts: ReadonlyArray<Record<string, any>>
  /** Reads the whole sellable catalog for the device (the grid's own query). */
  loadCatalog?: () => Promise<Array<Record<string, any>>>
  /** Opens the device store; injected by specs. */
  openStore?: typeof openPosOfflineStore
  now?: () => number
}

/**
 * The shift open on the register as last seen: the live register document's
 * answer when the page has one (including "none"), the kit's otherwise.
 */
function lastKnownShift(live: string | null | undefined, kit: PosOfflineKit, registerId: string): string | null {
  if (live !== undefined) return live || null
  return kit.registers.find((register) => register.id === registerId)?.openShiftId ?? null
}

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

export function usePosOffline(input: UsePosOfflineInput): PosOfflineState {
  const { hostId, user, registerId } = input
  const uid = (user as { uid?: string } | null | undefined)?.uid ?? ''
  const now = input.now ?? Date.now
  const openStore = input.openStore ?? openPosOfflineStore

  const [store, setStore] = useState<PosOfflineStore | null>(null)
  const [storeFailed, setStoreFailed] = useState(false)
  const [kit, setKit] = useState<PosOfflineKit | null>(null)
  const [catalog, setCatalog] = useState<PosOfflineProduct[]>([])
  const [queue, setQueue] = useState<PosOfflineQueuedSale[]>([])
  const [navigatorOnline, setNavigatorOnline] = useState(browserOnline)
  const [networkFailed, setNetworkFailed] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [notices, setNotices] = useState<PosOfflineSyncNotice[]>([])
  const offline = !navigatorOnline || networkFailed

  const latest = useRef(input)
  latest.current = input
  const userRef = useRef(user)
  userRef.current = user

  // The device store, for this member at this site.
  useEffect(() => {
    let active = true
    setStore(null)
    setStoreFailed(false)
    setKit(null)
    setCatalog([])
    setQueue([])
    if (!uid || !hostId) return undefined
    void openStore({ uid, hostId }).then(async (opened) => {
      if (!active) return
      if (!opened) {
        setStoreFailed(true)
        return
      }
      try {
        const [saved, sales] = await Promise.all([opened.loadKit(), opened.listSales()])
        if (!active) return
        if (saved?.kit) setKit(saved.kit)
        if (saved?.products?.length) setCatalog(saved.products)
        setQueue(sales)
        setStore(opened)
      } catch {
        if (active) setStoreFailed(true)
      }
    })
    return () => {
      active = false
    }
  }, [uid, hostId, openStore])

  useEffect(() => {
    const goOnline = () => {
      setNavigatorOnline(true)
      setNetworkFailed(false)
    }
    const goOffline = () => setNavigatorOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // The kit and the catalog, while online.
  const kitSavedAt = useRef(0)
  const catalogSavedAt = useRef(0)
  const refreshKit = useCallback(async () => {
    const signedIn = userRef.current
    if (!store || !signedIn) return
    const answer = await fetchPosOfflineKit(signedIn, hostId)
    if ('error' in answer) {
      if (answer.status === 0) setNetworkFailed(true)
      return
    }
    const fresh = answer.body.kit
    let products: PosOfflineProduct[] | null = null
    const load = latest.current.loadCatalog
    if (load && now() - catalogSavedAt.current > CATALOG_REFRESH_MS) {
      try {
        products = (await load()).map(posOfflineProduct).filter(Boolean) as PosOfflineProduct[]
        catalogSavedAt.current = now()
      } catch {
        products = null
      }
    }
    kitSavedAt.current = now()
    setKit(fresh)
    if (products) setCatalog(products)
    const saved = await store.loadKit().catch(() => null)
    await store
      .saveKit({
        kit: fresh,
        kitSavedAtMs: kitSavedAt.current,
        products: products ?? saved?.products ?? [],
        catalogSavedAtMs: products ? catalogSavedAt.current : (saved?.catalogSavedAtMs ?? 0),
      })
      .catch(() => undefined)
  }, [store, hostId, now])

  useEffect(() => {
    if (!store || offline || !uid) return undefined
    void refreshKit()
    const timer = window.setInterval(() => void refreshKit(), KIT_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [store, offline, uid, refreshKit])

  // Products the live grid shows are merged into the device's catalog, so a
  // product rung up online is sellable offline even past the snapshot.
  const liveKey = input.liveProducts.map((product) => String(product['$id'] ?? '')).join(',')
  useEffect(() => {
    if (!store || offline || !input.liveProducts.length) return
    setCatalog((current) => {
      const byId = new Map(current.map((product) => [product.$id, product]))
      let changed = false
      for (const product of latest.current.liveProducts) {
        const trimmed = posOfflineProduct(product)
        if (!trimmed) continue
        if (JSON.stringify(byId.get(trimmed.$id)) !== JSON.stringify(trimmed)) changed = true
        byId.set(trimmed.$id, trimmed)
      }
      if (!changed) return current
      const next = [...byId.values()]
      void store.loadKit().then((saved) =>
        store.saveKit({
          kit: saved?.kit ?? null,
          kitSavedAtMs: saved?.kitSavedAtMs ?? 0,
          products: next,
          catalogSavedAtMs: saved?.catalogSavedAtMs ?? 0,
        }),
      ).catch(() => undefined)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the ids the grid holds
  }, [store, offline, liveKey])

  // The sync.
  const syncInFlight = useRef(false)
  const syncNow = useCallback(async () => {
    const signedIn = userRef.current
    if (!store || !signedIn || syncInFlight.current) return
    syncInFlight.current = true
    setSyncing(true)
    try {
      const all = await store.listSales()
      const waiting = all.filter((entry) => entry.state === 'queued' && entry.sale.signedInUid === uid)
      if (!waiting.length) {
        // Nothing to send: one empty call says whether the route answers.
        if (networkFailed) {
          const probe = await syncPosOfflineSales(signedIn, hostId, [])
          if (probe.ok || probe.status !== 0) setNetworkFailed(false)
        }
        return
      }
      const flagged: PosOfflineSyncNotice[] = []
      for (let at = 0; at < waiting.length; at += POS_OFFLINE_SYNC_BATCH_MAX) {
        const batch = waiting.slice(at, at + POS_OFFLINE_SYNC_BATCH_MAX)
        const answer = await syncPosOfflineSales(
          signedIn,
          hostId,
          batch.map((entry) => entry.sale),
        )
        if ('error' in answer) {
          if (answer.status === 0) setNetworkFailed(true)
          else setSyncError(answer.error)
          break
        }
        setSyncError(null)
        setNetworkFailed(false)
        const byKey = new Map(batch.map((entry) => [entry.saleKey, entry]))
        for (const result of answer.body.results ?? []) {
          const entry = byKey.get(result.saleKey)
          if (!entry) continue
          if (result.status === 'recorded' || result.status === 'replayed') {
            await store.removeSale(entry.saleKey)
            if (result.flags?.length) {
              flagged.push({
                saleKey: result.saleKey,
                orderId: result.orderId ?? result.saleKey,
                number: result.number ?? null,
                flags: result.flags,
                stockConflicts: result.stockConflicts ?? [],
              })
            }
            continue
          }
          // A transient failure stays queued; every other refusal waits for
          // the cashier, still on the device, with the server's sentence.
          await store.putSale({
            ...entry,
            attempts: entry.attempts + 1,
            state: result.reason === 'failed' || result.reason === 'wrong-staff' ? 'queued' : 'refused',
            ...(result.error ? { error: result.error } : {}),
            ...(result.reason ? { reason: result.reason } : {}),
          })
        }
      }
      if (flagged.length) setNotices((current) => [...current, ...flagged])
    } catch {
      // Storage or the network went away mid-sync; the queue is as it was.
    } finally {
      setQueue(await store.listSales().catch(() => []))
      syncInFlight.current = false
      setSyncing(false)
    }
  }, [store, uid, hostId, networkFailed])

  // Sync on reconnect, on mount, and while offline-by-failure keep probing.
  useEffect(() => {
    if (!store || offline) return
    void syncNow()
  }, [store, offline, syncNow])
  useEffect(() => {
    if (!store || !networkFailed || !navigatorOnline) return undefined
    const timer = window.setInterval(() => void syncNow(), PROBE_MS)
    return () => window.clearInterval(timer)
  }, [store, networkFailed, navigatorOnline, syncNow])

  const unavailableReason = storeFailed
    ? 'This browser is not keeping data for the register (a private window, or storage is blocked), so offline selling is unavailable.'
    : !store
      ? 'Getting the register ready to sell offline…'
      : !kit
        ? 'Connect once so the register can get ready to sell offline.'
        : !kit.available
          ? (kit.unavailableReason ?? 'Offline selling is unavailable for this site.')
          : !catalog.length
            ? 'The register has no catalog saved for offline selling yet.'
            : kit.requireOpenShift && !lastKnownShift(input.openShiftId, kit, registerId)
              ? 'Open a shift before going offline: this site requires one for every sale.'
              : null
  const ready = unavailableReason === null

  const gridProducts = useCallback(
    (search: string, categoryId: string, quickKeysId: string) => {
      const typed = search.trim().toLowerCase()
      return catalog
        .filter((product) => product['status'] === undefined || product['status'] === 'active')
        .filter((product) => !product['deletedAt'])
        .filter((product) => {
          // A degraded grid over the device's own copy: there is no query to
          // ask while offline, so the copy is narrowed in memory.
          if (typed) return String(product.name ?? '').toLowerCase().includes(typed)
          if (categoryId === quickKeysId && quickKeysId) return product['posQuickKey'] === true
          if (categoryId) return Array.isArray(product['categoryIds']) && product['categoryIds'].includes(categoryId)
          return true
        })
        .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
        .map((product) => ({ ...CommerceModel.liftLegacyProduct(product as any), $id: product.$id }))
    },
    [catalog],
  )

  const findByCode = useCallback(
    (code: string) => {
      const needle = code.trim().toLowerCase()
      if (!needle) return null
      for (const raw of catalog) {
        const product = { ...CommerceModel.liftLegacyProduct(raw as any), $id: raw.$id } as PosOfflineProduct
        const variant = (product['variants'] ?? []).find(
          (item: any) =>
            String(item?.barcode ?? '').trim().toLowerCase() === needle ||
            String(item?.sku ?? '').trim().toLowerCase() === needle,
        )
        if (variant) return { product, variant }
      }
      return null
    },
    [catalog],
  )

  const totalsFor = useCallback(
    (lines: RegisterLine[], discountPct: number) => {
      if (!kit?.available || !lines.length) return null
      return posOfflineSaleTotals({ lines, discountPct, tax: kit.tax })
    },
    [kit],
  )

  const ringInFlight = useRef(false)
  const ringCashSale = useCallback<PosOfflineState['ringCashSale']>(
    async (sale) => {
      const context = latest.current
      if (!store || !kit?.available || !uid || ringInFlight.current) return null
      if (sale.discountPct > kit.maxDiscountPct) return null
      const totals = posOfflineSaleTotals({ lines: sale.lines, discountPct: sale.discountPct, tax: kit.tax })
      if (sale.cashTenderedCents < totals.totalCents) return null
      ringInFlight.current = true
      try {
        const saleKey = newPosOfflineSaleKey()
        const soldAtMs = now()
        const byId = new Map(catalog.map((product) => [product.$id, product]))
        const lines: PosOfflineSaleLine[] = sale.lines.map((line) => {
          const product = byId.get(line.productId)
          const variant = (product?.['variants'] ?? []).find((item: any) => item?.id === line.variantId)
          return {
            productId: line.productId,
            ...(line.variantId ? { variantId: line.variantId } : {}),
            name: line.name,
            ...(line.variantLabel ? { variantLabel: line.variantLabel } : {}),
            ...(variant?.sku ? { sku: String(variant.sku) } : {}),
            ...(product?.['type'] ? { productType: product['type'] } : {}),
            quantity: line.quantity,
            unitAmountCents: line.unitAmountCents,
            ...(line.modifiers?.length ? { modifiers: line.modifiers } : {}),
          }
        })
        const shiftId = lastKnownShift(context.openShiftId, kit, registerId)
        const customer = sale.customer
          ? {
              ...(sale.customer.email ? { email: sale.customer.email } : {}),
              ...(sale.customer.name ? { name: sale.customer.name } : {}),
              ...(sale.customer.kind && sale.customer.kind !== 'none' && sale.customer.id
                ? { kind: sale.customer.kind, id: sale.customer.id }
                : {}),
            }
          : undefined
        const queued: PosOfflineSale = {
          v: 1,
          saleKey,
          hostId,
          orgId: kit.orgId,
          signedInUid: uid,
          registerId,
          shiftId,
          ...(context.locationId ? { locationId: context.locationId } : {}),
          ...(context.cashierAssertion ? { cashierAssertion: context.cashierAssertion } : {}),
          soldAtMs,
          lines,
          discountPct: sale.discountPct,
          totals,
          cashTenderedCents: sale.cashTenderedCents,
          changeCents: posOfflineChangeCents(totals.totalCents, sale.cashTenderedCents),
          ...(customer && Object.keys(customer).length ? { customer } : {}),
        }
        // The sale is real only once the device holds it: a write that fails
        // answers null, and the cashier is told before taking any cash.
        await store.putSale({ saleKey, sale: queued, state: 'queued', queuedAtMs: soldAtMs, attempts: 0 })
        setQueue(await store.listSales())
        return {
          saleKey,
          sale: queued,
          order: {
            status: 'paid',
            channel: 'pos',
            registerId,
            lineItems: lines.map((line) => ({ ...line, modifiers: undefined })) as CommerceModel.OrderLineItem[],
            totals,
            payments: [
              {
                id: 'pay_cash',
                method: 'cash',
                amountCents: totals.totalCents,
                status: 'succeeded',
                atMs: soldAtMs,
                cashTenderedCents: sale.cashTenderedCents,
                changeCents: queued.changeCents,
              },
            ],
            createdAtMs: soldAtMs,
            customerName: customer?.name ?? null,
          } as PosOfflineRungSale['order'],
        }
      } catch {
        return null
      } finally {
        ringInFlight.current = false
      }
    },
    [store, kit, uid, catalog, hostId, registerId, now],
  )

  const reportNetworkFailure = useCallback(() => setNetworkFailed(true), [])
  const dismissNotices = useCallback(() => setNotices([]), [])
  const discard = useCallback(
    async (saleKey: string) => {
      if (!store) return
      await store.removeSale(saleKey).catch(() => undefined)
      setQueue(await store.listSales().catch(() => []))
    },
    [store],
  )

  return useMemo(
    () => ({
      offline,
      ready,
      unavailableReason,
      kit,
      queue,
      syncing,
      syncError,
      notices,
      gridProducts,
      findByCode,
      totalsFor,
      ringCashSale,
      reportNetworkFailure,
      syncNow,
      dismissNotices,
      discard,
    }),
    [
      offline,
      ready,
      unavailableReason,
      kit,
      queue,
      syncing,
      syncError,
      notices,
      gridProducts,
      findByCode,
      totalsFor,
      ringCashSale,
      reportNetworkFailure,
      syncNow,
      dismissNotices,
      discard,
    ],
  )
}
