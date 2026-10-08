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

import * as Aglyn from '@aglyn/aglyn/server'
import type { PluginApiHandler, PluginApiRequest } from '@aglyn/aglyn/server'
import recordCapturedContact from '@aglyn/aglyn/plugin-manager/record-captured-contact'
import { FieldValue } from 'firebase-admin/firestore'
import * as CommerceModel from '../model'
import {
  posOfflineFlagLabels,
  posOfflineSaleTotals,
  posOfflineSoldAt,
  posOfflineTotalsAddUp,
  POS_OFFLINE_LATE_SYNC_MS,
  POS_OFFLINE_SYNC_BATCH_MAX,
  sanitizePosOfflineSale,
  type PosOfflineFlag,
  type PosOfflineKit,
  type PosOfflineOrderStamp,
  type PosOfflineRefusal,
  type PosOfflineSaleOutcome,
  type PosOfflineStockConflict,
} from '../model/commerce-pos-offline'
import { ORDER_PAID_EVENT } from '../model/order-events'
import { posMaxDiscountPct } from '../plugin-config'
import { alertLowStockCrossing } from './low-stock'
import { notifyOrderBuyer } from './order-notifications'
import { raiseOrderEvent } from './order-events'
import { offlineFeeMonthKey } from './pos-fee-month'
import {
  authorizePosOps,
  defaultPosOpsDeps,
  posOpsBody,
  posOpsCleanId,
  resolvePosStaffAssertion,
  type PosOpsDeps,
  type PosOpsStaff,
} from './pos-ops-gate'
import { notifyPosSaleCompleted } from './pos-sale'
import { decrementVariantStock, type StockDecrementOutcome } from './reserve-stock'

/*==========================================
 * THE OFFLINE REGISTER'S SYNC (AGL-3625): `/api/commerce/pos-offline-sync`.
 *
 *   GET   ?hostId=   the offline kit: the store's in-person tax rate, the
 *                    discount ceiling, the shift rule, the registers and their
 *                    open shifts, and the receipt's head and foot
 *   POST  {hostId, sales[]}   records each cash sale rung offline, once
 *
 * The register's gate, unchanged (`authorizePosOps`): admin or editor on the
 * site, `managePos`, and the plan's `pos` entitlement — re-read at sync, so a
 * workspace that lost POS cannot sync into it. The plugin dispatcher has
 * already applied the security lockdown before this runs.
 *
 * ONE SALE, ONE ORDER, ONCE. The register's sale key is the order's id and
 * the id of a server-only record beside it (`posOfflineSales/{key}`), both
 * CREATED in one transaction. A sale sent twice — a connection that flapped
 * mid-request, a retry after an answer that never arrived — finds the record
 * and gets the first answer back, and a key that collides with any existing
 * order cannot overwrite it: `create` refuses.
 *
 * NEVER DROPPED. The customer has paid and left. So nothing the server finds
 * at sync refuses the sale: a changed price, short stock, a closed shift, a
 * register over the cap are each FLAGGED — on the order, its timeline and the
 * answer — and the sale is recorded as it happened. The only refusals are the
 * ones that protect somebody else: a sale signed for another member, another
 * site or another workspace stays on the device that rang it.
 *
 * STEPS AFTER THE COMMIT are recorded on the sync record as they finish, so a
 * request that dies between them is finished by the next sync of the same
 * sale rather than skipped (stock) or repeated (the receipt email).
 *=========================================*/

/** The register's sync record: no customer data, only what dedupe and resume need. */
export interface PosOfflineSyncRecord {
  saleKey: string
  orderId: string
  number: number | null
  signedInUid: string
  registerId: string
  soldAtMs: number
  syncedAtMs: number
  status: 'recorded' | 'settled'
  flags: PosOfflineFlag[]
  stockConflicts: PosOfflineStockConflict[]
  /** Line indexes whose stock has been taken. */
  stockLines: number[]
  stockDone: boolean
  notified: boolean
}

export interface PosOfflineAfterSale {
  hostId: string
  orderId: string
  order: CommerceModel.HostOrder
  email: string
  name: string
}

export interface PosOfflineSyncDeps extends PosOpsDeps {
  /** The plan's take rate for one product type (AGL-2111). */
  feePct(org: Record<string, any> | null, productType: 'physical' | 'digital' | 'service'): number
  /** Whether the register at this creation rank is within the site's cap (AGL-1775). */
  registerWithinCap(org: Record<string, any> | null, hostId: string, rank: number): boolean
  /** Takes one line's units off the shelf, with its ledger row (AGL-2320). */
  decrementStock(input: {
    hostRef: FirebaseFirestore.DocumentReference
    hostId: string
    productId: string
    variantId: string
    quantity: number
    locationId?: string
    orderId: string
  }): Promise<StockDecrementOutcome>
  /** What a completed sale tells the rest of the workspace. Never throws. */
  afterSale(input: PosOfflineAfterSale): Promise<void>
}

export function defaultPosOfflineSyncDeps(): PosOfflineSyncDeps {
  const base = defaultPosOpsDeps()
  return {
    ...base,
    feePct: (org, productType) => Aglyn.resolveTransactionFeePct(org as any, productType),
    registerWithinCap: (org, hostId, rank) =>
      Aglyn.checkHostRegisterQuota(org as any, hostId, rank).allowed,
    decrementStock: async (input) => {
      const moved = await decrementVariantStock({
        firestore: base.firestore(),
        hostRef: input.hostRef,
        hostId: input.hostId,
        productId: input.productId,
        variantId: input.variantId,
        quantity: input.quantity,
        ...(input.locationId ? { locationId: input.locationId } : {}),
        ledger: { reason: 'sale', orderId: input.orderId },
      })
      if (moved.before && moved.after) alertLowStockCrossing(input.hostId, moved.before, moved.after)
      return moved
    },
    afterSale: async (input) => {
      const settle = async (label: string, work: () => Promise<unknown>) => {
        try {
          await work()
        } catch (error) {
          console.error(`[pos-offline-sync] ${label} failed`, input.orderId, error)
        }
      }
      if (input.email) {
        await settle('contact', () =>
          recordCapturedContact({
            orgId: '',
            hostId: input.hostId,
            identity: { email: input.email, ...(input.name ? { name: input.name } : {}) },
            surface: 'relationship',
            lifecycleFloor: 'customer',
            purchaseCents: Number(input.order.totals?.totalCents ?? 0),
            interaction: {
              source: 'order',
              refId: input.orderId,
              summary: `In-store purchase ($${(Number(input.order.totals?.totalCents ?? 0) / 100).toFixed(2)})`,
            },
          }),
        )
      }
      // The sale-completed listeners hear it too, told it was rung offline:
      // the cloud printers must not print a receipt or pop the drawer for a
      // sale the customer walked away with hours ago.
      await settle('sale completed', () =>
        notifyPosSaleCompleted({ hostId: input.hostId, orderId: input.orderId, order: input.order, offline: true }),
      )
      // The emailed receipt sends now, on sync (the printed one went offline).
      await settle('receipt', () =>
        notifyOrderBuyer({ hostId: input.hostId, orderId: input.orderId }, 'receipt', { email: input.email }),
      )
      await settle('paid event', () =>
        raiseOrderEvent(ORDER_PAID_EVENT, { hostId: input.hostId, orderId: input.orderId, key: 'paid' }),
      )
    },
  }
}

type Outcome = { status: number; body: Record<string, unknown> }

const money = (cents: number) => `$${(Math.max(0, cents) / 100).toFixed(2)}`

/** The store's in-person tax, as every register sale computes it. */
export function posInPersonTax(
  settings: CommerceModel.TaxSettings | undefined,
):
  | { ok: true; pct: number | null; pricesIncludeTax: boolean; decision: CommerceModel.StorefrontTaxDecision }
  | { ok: false; reason: string } {
  const taxSettings = (settings ?? {}) as CommerceModel.TaxSettings
  const decision = CommerceModel.storefrontTaxDecision({ settings: taxSettings })
  if (decision.kind === 'undecided') {
    return { ok: false, reason: CommerceModel.STOREFRONT_TAX_UNDECIDED_MESSAGE }
  }
  const misconfigured = CommerceModel.storefrontTaxMisconfiguration(taxSettings, { inPerson: true })
  if (misconfigured) return { ok: false, reason: misconfigured }
  const rate =
    decision.kind === 'manual' ? CommerceModel.resolveTaxRate(taxSettings, taxSettings.origin ?? {}) : null
  return {
    ok: true,
    pct: rate && rate.pct > 0 ? rate.pct : null,
    pricesIncludeTax: taxSettings.pricesIncludeTax === true,
    decision,
  }
}

interface SyncContext {
  deps: PosOfflineSyncDeps
  staff: PosOpsStaff
  config: Record<string, unknown>
  tax: ReturnType<typeof posInPersonTax>
  /** Registers by id, with their creation rank. */
  registers: Map<string, { rank: number; data: Record<string, any> }>
}

async function readRegisters(staff: PosOpsStaff): Promise<SyncContext['registers']> {
  const docs = (await staff.hostRef.collection('registers').get()).docs
    .map((doc) => ({
      id: doc.id,
      data: (doc.data() ?? {}) as Record<string, any>,
      createdAtMs: Number(doc.get('createdAt')?.toMillis?.() ?? doc.get('createdAtMs') ?? 0),
    }))
    .sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id))
  return new Map(docs.map((doc, rank) => [doc.id, { rank, data: doc.data }]))
}

async function readStoreTax(staff: PosOpsStaff): Promise<CommerceModel.TaxSettings | undefined> {
  const store = await staff.hostRef.collection('settings').doc('store').get()
  return (store.get('tax') ?? undefined) as CommerceModel.TaxSettings | undefined
}

/** The kit a register caches to sell offline. */
export async function buildPosOfflineKit(
  deps: PosOfflineSyncDeps,
  staff: PosOpsStaff,
): Promise<PosOfflineKit> {
  const [registers, taxSettings, config, host, store] = await Promise.all([
    readRegisters(staff),
    readStoreTax(staff),
    staff.orgId ? deps.pluginConfig(staff.orgId, staff.hostId).catch(() => ({})) : Promise.resolve({}),
    staff.hostRef.get(),
    staff.hostRef.collection('settings').doc('store').get(),
  ])
  const tax = posInPersonTax(taxSettings)
  return {
    v: 1,
    hostId: staff.hostId,
    orgId: staff.orgId,
    issuedAtMs: deps.now(),
    available: tax.ok,
    ...('reason' in tax ? { unavailableReason: tax.reason } : {}),
    tax: 'decision' in tax ? { pct: tax.pct, pricesIncludeTax: tax.pricesIncludeTax } : { pct: null, pricesIncludeTax: false },
    maxDiscountPct: posMaxDiscountPct(config),
    requireOpenShift: staff.settings.requireOpenShift,
    registers: [...registers.entries()]
      .filter(([, register]) => deps.registerWithinCap(staff.org, staff.hostId, register.rank))
      .map(([id, register]) => ({
        id,
        name: String(register.data['name'] ?? 'Register').slice(0, 120),
        ...(register.data['locationId'] ? { locationId: String(register.data['locationId']) } : {}),
        openShiftId: posOpsCleanId(register.data['openShiftId']) || null,
      })),
    receipt: {
      name: String(host.get('displayName') ?? '') || 'Receipt',
      ...(typeof host.get('logoUrl') === 'string' && host.get('logoUrl') ? { logo: String(host.get('logoUrl')) } : {}),
      ...(staff.settings.receiptAddress ? { address: staff.settings.receiptAddress } : {}),
      ...(store.get('receiptFooter') ? { footer: String(store.get('receiptFooter')).slice(0, 500) } : {}),
      ...(staff.settings.returnPolicy ? { returnPolicy: staff.settings.returnPolicy } : {}),
    },
  }
}

const refused = (
  saleKey: string,
  reason: PosOfflineRefusal,
  error: string,
  retry: boolean,
): PosOfflineSaleOutcome => ({ saleKey, status: 'refused', reason, error, retry })

const replayOf = (record: PosOfflineSyncRecord): PosOfflineSaleOutcome => ({
  saleKey: record.saleKey,
  status: 'replayed',
  orderId: record.orderId,
  number: record.number,
  flags: record.flags,
  stockConflicts: record.stockConflicts,
})

/** The take the plan owes on the goods after the discount (AGL-2111, AGL-2256). */
function takeFeeCents(
  deps: PosOfflineSyncDeps,
  staff: PosOpsStaff,
  lines: CommerceModel.OrderLineItem[],
  totals: CommerceModel.OrderTotals,
): number {
  let applies = false
  const gross = lines.reduce((sum, line) => {
    const pct = deps.feePct(staff.org, (line.productType ?? 'physical') as 'physical' | 'digital' | 'service')
    if (pct > 0) applies = true
    return sum + Math.round((line.unitAmountCents * line.quantity * pct) / 100)
  }, 0)
  const charged = Math.max(0, totals.itemsCents - totals.discountCents)
  const scaled = totals.itemsCents > 0 ? Math.round((gross * charged) / totals.itemsCents) : 0
  return applies && charged > 0 ? Math.max(1, scaled) : scaled
}

/**
 * The steps after the commit, each recorded as it finishes. Run by the sync
 * that recorded the sale, and again by any later sync of it that finds them
 * unfinished.
 */
async function finishSale(
  context: SyncContext,
  recordRef: FirebaseFirestore.DocumentReference,
  orderRef: FirebaseFirestore.DocumentReference,
  record: PosOfflineSyncRecord,
): Promise<PosOfflineSyncRecord> {
  const { deps, staff } = context
  const orderSnapshot = await orderRef.get()
  const order = (orderSnapshot.data() ?? {}) as CommerceModel.HostOrder & Record<string, any>
  let current = record
  if (!current.stockDone) {
    const conflicts = [...current.stockConflicts]
    const done = new Set(current.stockLines)
    const lines = (order.lineItems ?? []) as CommerceModel.OrderLineItem[]
    for (const [index, line] of lines.entries()) {
      if (done.has(index)) continue
      const moved = await deps.decrementStock({
        hostRef: staff.hostRef,
        hostId: staff.hostId,
        productId: line.productId,
        variantId: line.variantId ?? 'default',
        quantity: line.quantity,
        ...(order['locationId'] ? { locationId: String(order['locationId']) } : {}),
        orderId: orderRef.id,
      })
      // A failed commit leaves the line for the next sync to take, rather than
      // marking stock taken that never moved.
      if (moved.failed) continue
      // Untracked stock (or a product gone since) moves nothing and is short of nothing.
      const short = moved.before ? moved.applied - moved.requested : 0
      if (short > 0) {
        conflicts.push({
          productId: line.productId,
          ...(line.variantId ? { variantId: line.variantId } : {}),
          name: [line.name, line.variantLabel].filter(Boolean).join(' — '),
          requested: Math.abs(moved.requested),
          applied: Math.abs(moved.applied),
          shortUnits: short,
        })
      }
      done.add(index)
      await recordRef.update({ stockLines: [...done].sort((a, b) => a - b), stockConflicts: conflicts })
    }
    const stockDone = lines.every((_line, index) => done.has(index))
    const flags: PosOfflineFlag[] =
      conflicts.length && !current.flags.includes('stock-short') ? [...current.flags, 'stock-short'] : current.flags
    current = { ...current, stockLines: [...done], stockConflicts: conflicts, stockDone, flags }
    await recordRef.update({ stockDone, flags, stockConflicts: conflicts })
    if (conflicts.length && conflicts.length !== record.stockConflicts.length) {
      const fresh = (await orderRef.get()).data() as CommerceModel.HostOrder
      const stamp = fresh?.offline
      await orderRef.update({
        ...(stamp ? { offline: { ...stamp, flags, stockConflicts: conflicts } } : {}),
        timeline: CommerceModel.appendOrderEvent(
          fresh ?? {},
          'offline-stock-short',
          conflicts
            .map((conflict) => `${conflict.shortUnits} of ${conflict.requested}× ${conflict.name} not in stock`)
            .join('; ')
            .slice(0, 500),
          deps.now(),
        ),
      })
    }
    if (!stockDone) return current
  }
  if (!current.notified) {
    const email = String(order.customerEmail ?? '')
    await deps.afterSale({
      hostId: staff.hostId,
      orderId: orderRef.id,
      order: order as CommerceModel.HostOrder,
      email,
      name: String(order.customerName ?? ''),
    })
    current = { ...current, notified: true, status: 'settled' }
    await recordRef.update({ notified: true, status: 'settled' })
  }
  return current
}

async function syncOne(context: SyncContext, raw: unknown): Promise<PosOfflineSaleOutcome> {
  const { deps, staff } = context
  const read = sanitizePosOfflineSale(raw)
  const rawKey = String((raw as Record<string, unknown> | null)?.['saleKey'] ?? '').slice(0, 64)
  if ('error' in read) return refused(rawKey, 'invalid', read.error, false)
  const sale = read.sale
  if (sale.hostId !== staff.hostId) {
    return refused(sale.saleKey, 'wrong-site', 'This sale was rung for another site.', false)
  }
  if (sale.signedInUid !== staff.uid) {
    return refused(
      sale.saleKey,
      'wrong-staff',
      'This sale was rung while another member was signed in. It syncs when they sign in on this register.',
      true,
    )
  }
  if (sale.orgId && staff.orgId && sale.orgId !== staff.orgId) {
    return refused(sale.saleKey, 'wrong-workspace', 'This sale was rung in another workspace.', false)
  }

  const firestore = deps.firestore()
  const hostRef = staff.hostRef
  const recordRef = hostRef.collection('posOfflineSales').doc(sale.saleKey)
  const orderRef = hostRef.collection('orders').doc(sale.saleKey)

  const existing = await recordRef.get()
  if (existing.exists) {
    const record = existing.data() as PosOfflineSyncRecord
    if (record.signedInUid !== staff.uid) {
      return refused(sale.saleKey, 'conflict', 'Another sale already used this key.', false)
    }
    return replayOf(record.status === 'settled' ? record : await finishSale(context, recordRef, orderRef, record))
  }

  const now = deps.now()
  const flags = new Set<PosOfflineFlag>()
  const soldAt = posOfflineSoldAt(sale.soldAtMs, now)
  if (soldAt.adjusted) flags.add('clock-adjusted')
  else if (now - soldAt.atMs > POS_OFFLINE_LATE_SYNC_MS) flags.add('late-sync')

  // The lines as sold, checked against the catalog as it stands now. The
  // price on the order is the one rung — that is what the customer paid —
  // and the catalog's is kept beside it where they differ.
  const productIds = [...new Set(sale.lines.map((line) => line.productId))]
  const snapshots = await Promise.all(productIds.map((id) => hostRef.collection('products').doc(id).get()))
  const products = new Map(
    snapshots.map((snapshot) => [
      snapshot.id,
      snapshot.exists ? CommerceModel.liftLegacyProduct(snapshot.data() as any) : null,
    ]),
  )
  const priceDrift: NonNullable<PosOfflineOrderStamp['priceDrift']> = []
  const lineItems: CommerceModel.OrderLineItem[] = sale.lines.map((line, index) => {
    const product = products.get(line.productId)
    if (!product) {
      flags.add('unknown-product')
      return {
        productId: line.productId,
        ...(line.variantId ? { variantId: line.variantId } : {}),
        name: line.name,
        ...(line.variantLabel ? { variantLabel: line.variantLabel } : {}),
        ...(line.sku ? { sku: line.sku } : {}),
        productType: line.productType ?? 'physical',
        quantity: line.quantity,
        unitAmountCents: line.unitAmountCents,
      }
    }
    const variant = product.variants.find((item) => item.id === line.variantId) ?? product.variants[0]
    const chosen = CommerceModel.resolveLineModifiers(product, line.modifiers)
    const currentCents =
      variant && CommerceModel.variantHasPrice(variant) && chosen.ok
        ? Math.round(Number(variant.priceUsd) * 100) + chosen.extraCents
        : null
    if (currentCents !== line.unitAmountCents) {
      flags.add('price-changed')
      priceDrift.push({ index, rungCents: line.unitAmountCents, currentCents: currentCents ?? 0 })
    }
    return {
      productId: line.productId,
      ...(variant && variant.id !== 'default' ? { variantId: variant.id } : {}),
      name: product.name || line.name,
      ...(line.variantLabel ? { variantLabel: line.variantLabel } : {}),
      ...(variant?.sku ? { sku: variant.sku } : line.sku ? { sku: line.sku } : {}),
      productType: product.type ?? line.productType ?? 'physical',
      quantity: line.quantity,
      unitAmountCents: line.unitAmountCents,
      ...(chosen.ok && chosen.modifiers.length ? { modifiers: chosen.modifiers } : {}),
    }
  })

  // The money: what the register rang, when its own arithmetic holds; the
  // arithmetic of its lines, with the tax it rang, when it does not.
  let totals: CommerceModel.OrderTotals
  if (posOfflineTotalsAddUp(sale)) {
    totals = CommerceModel.computeOrderTotals(lineItems, {
      discountCents: sale.totals.discountCents,
      taxCents: sale.totals.taxCents,
    })
  } else {
    flags.add('totals-restated')
    const restated = posOfflineSaleTotals({
      lines: sale.lines,
      discountPct: sale.discountPct,
      tax: { pct: null, pricesIncludeTax: false },
    })
    totals = CommerceModel.computeOrderTotals(lineItems, {
      discountCents: restated.discountCents,
      taxCents: Math.min(sale.totals.taxCents, restated.itemsCents - restated.discountCents),
    })
  }
  if ('decision' in context.tax) {
    const expected = posOfflineSaleTotals({
      lines: sale.lines,
      discountPct: sale.discountPct,
      tax: { pct: context.tax.pct, pricesIncludeTax: context.tax.pricesIncludeTax },
    })
    if (expected.taxCents !== totals.taxCents) flags.add('tax-differs')
  } else if (totals.taxCents > 0) {
    flags.add('tax-differs')
  }
  if (sale.discountPct > posMaxDiscountPct(context.config)) flags.add('discount-over-limit')
  if (sale.cashTenderedCents < totals.totalCents) flags.add('cash-short')

  // Where it was rung.
  const register = context.registers.get(sale.registerId)
  if (!register) flags.add('unknown-register')
  else if (!deps.registerWithinCap(staff.org, staff.hostId, register.rank)) flags.add('register-over-cap')
  let shiftId = ''
  if (sale.shiftId && register) {
    const shift = await hostRef
      .collection('registers')
      .doc(sale.registerId)
      .collection('shifts')
      .doc(sale.shiftId)
      .get()
    if (shift.exists) {
      shiftId = sale.shiftId
      if (shift.get('status') !== 'open') flags.add('shift-closed')
    }
  }
  if (!shiftId && staff.settings.requireOpenShift) flags.add('no-shift')

  // Who rang it: a PIN-switched cashier's assertion is read as of the moment
  // the cash was taken (it was valid then, and expiring since is the normal
  // case for a sale that waited to sync), and the member is re-checked NOW.
  let cashierId = staff.uid
  if (sale.cashierAssertion) {
    const memberUid = await resolvePosStaffAssertion(
      { ...deps, now: () => soldAt.atMs },
      hostRef,
      sale.cashierAssertion,
      { hostId: staff.hostId, registerId: sale.registerId, purpose: 'cashier' },
    )
    if (memberUid) cashierId = memberUid
    else flags.add('cashier-unverified')
  }

  const takeFee = takeFeeCents(deps, staff, lineItems, totals)
  totals = { ...totals, feeCents: takeFee }
  const changeCents = Math.max(0, sale.cashTenderedCents - totals.totalCents)
  const flagList = [...flags]
  const stamp: PosOfflineOrderStamp = {
    saleKey: sale.saleKey,
    soldAtMs: soldAt.atMs,
    syncedAtMs: now,
    syncedBy: staff.uid,
    flags: flagList,
    ...(priceDrift.length ? { priceDrift } : {}),
  }
  const customer = sale.customer ?? {}
  const feeMonth = offlineFeeMonthKey(new Date(now))
  const feeRef = staff.orgId
    ? firestore.collection('orgs').doc(staff.orgId).collection('offlineFees').doc(feeMonth)
    : null
  const counterRef = hostRef.collection('counters').doc('orders')

  const committed = await firestore.runTransaction(async (transaction) => {
    const raced = await transaction.get(recordRef)
    if (raced.exists) return { raced: raced.data() as PosOfflineSyncRecord }
    const taken = await transaction.get(orderRef)
    if (taken.exists) return { collision: true as const }
    const counter = await transaction.get(counterRef)
    const number = Number(counter.get('next') ?? 1)
    transaction.set(counterRef, { next: number + 1 }, { merge: true })
    const paidDetail =
      `Cash — received ${money(sale.cashTenderedCents)}, change ${money(changeCents)}. ` +
      'Rung while the register was offline.'
    const timeline: CommerceModel.OrderTimelineEvent[] = [
      { atMs: soldAt.atMs, event: 'paid', detail: paidDetail },
      {
        atMs: now,
        event: 'offline-synced',
        detail: flagList.length
          ? `Synced. Check: ${posOfflineFlagLabels(flagList).join('; ')}`.slice(0, 1000)
          : 'Synced.',
      },
    ]
    transaction.create(
      orderRef,
      CommerceModel.withOrderListFields(orderRef.id, {
        number,
        status: 'paid',
        channel: 'pos',
        registerId: sale.registerId,
        cashierId,
        ...(shiftId ? { shiftId } : {}),
        ...(customer.name ? { customerName: customer.name } : {}),
        ...(customer.kind && customer.id ? { customerRecord: { kind: customer.kind, id: customer.id } } : {}),
        ...(sale.discountPct > 0 ? { discountPct: sale.discountPct, discountBy: cashierId } : {}),
        ...(sale.locationId ? { locationId: sale.locationId } : {}),
        lineItems,
        totals,
        taxMode: 'decision' in context.tax
          ? CommerceModel.storefrontTaxModeForDecision(context.tax.decision, totals.taxCents)
          : totals.taxCents > 0
            ? 'manual'
            : 'none',
        ...(takeFee > 0 ? { feeCollection: 'invoice' as const } : {}),
        payments: [
          {
            id: 'pay_cash',
            method: 'cash',
            amountCents: totals.totalCents,
            status: 'succeeded',
            atMs: soldAt.atMs,
            settledAtMs: soldAt.atMs,
            takeFeeCents: takeFee,
            feeCents: 0,
            cashierId,
            cashTenderedCents: sale.cashTenderedCents,
            changeCents,
          } satisfies CommerceModel.OrderPayment,
        ],
        customerEmail: customer.email || null,
        timeline,
        offline: stamp,
        createdAtMs: soldAt.atMs,
        createdAt: FieldValue.serverTimestamp(),
      }),
    )
    const record: PosOfflineSyncRecord = {
      saleKey: sale.saleKey,
      orderId: orderRef.id,
      number,
      signedInUid: staff.uid,
      registerId: sale.registerId,
      soldAtMs: soldAt.atMs,
      syncedAtMs: now,
      status: 'recorded',
      flags: flagList,
      stockConflicts: [],
      stockLines: [],
      stockDone: false,
      notified: false,
    }
    transaction.create(recordRef, record)
    // The take accrues with the order, in the same transaction (AGL-2111).
    if (takeFee > 0 && feeRef) {
      transaction.set(
        feeRef,
        { month: feeMonth, feeCents: FieldValue.increment(takeFee), orders: FieldValue.increment(1) },
        { merge: true },
      )
    }
    return { record }
  })
  if ('collision' in committed) {
    return refused(sale.saleKey, 'conflict', 'Another order already has this sale’s key.', false)
  }
  if ('raced' in committed) {
    const record = committed.raced
    if (record.signedInUid !== staff.uid) {
      return refused(sale.saleKey, 'conflict', 'Another sale already used this key.', false)
    }
    return replayOf(record)
  }
  const finished = await finishSale(context, recordRef, orderRef, committed.record)
  return {
    saleKey: sale.saleKey,
    status: 'recorded',
    orderId: orderRef.id,
    number: finished.number,
    flags: finished.flags,
    stockConflicts: finished.stockConflicts,
  }
}

export async function handlePosOfflineSync(
  deps: PosOfflineSyncDeps,
  req: PluginApiRequest,
): Promise<Outcome> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return { status: 405, body: { error: 'Method not allowed' } }
  }
  const body =
    req.method === 'GET'
      ? Object.fromEntries(
          Object.entries(req.query ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
        )
      : posOpsBody(req)
  const gate = await authorizePosOps(deps, req, body['hostId'])
  if ('error' in gate) return { status: gate.status, body: { error: gate.error } }
  const staff = gate.staff
  if (req.method === 'GET') {
    return { status: 200, body: { kit: await buildPosOfflineKit(deps, staff) } }
  }
  const sales = Array.isArray(body['sales']) ? (body['sales'] as unknown[]) : null
  if (!sales) return { status: 400, body: { error: 'Missing sales' } }
  if (sales.length > POS_OFFLINE_SYNC_BATCH_MAX) {
    return { status: 400, body: { error: `Send at most ${POS_OFFLINE_SYNC_BATCH_MAX} sales at a time` } }
  }
  if (sales.length === 0) return { status: 200, body: { results: [] } }
  const [registers, taxSettings, config] = await Promise.all([
    readRegisters(staff),
    readStoreTax(staff),
    staff.orgId ? deps.pluginConfig(staff.orgId, staff.hostId).catch(() => ({})) : Promise.resolve({}),
  ])
  const context: SyncContext = { deps, staff, config, tax: posInPersonTax(taxSettings), registers }
  const results: PosOfflineSaleOutcome[] = []
  // One at a time, in the order they were rung, so order numbers follow the
  // till and one sale's failure cannot take the rest with it.
  for (const sale of sales) {
    try {
      results.push(await syncOne(context, sale))
    } catch (error) {
      console.error('[pos-offline-sync] sale failed', error)
      const key = String((sale as Record<string, unknown> | null)?.['saleKey'] ?? '').slice(0, 64)
      results.push(refused(key, 'failed', 'The sale could not be synced yet. It stays on this register.', true))
    }
  }
  return { status: 200, body: { results } }
}

export function createPosOfflineSyncHandler(
  deps: () => PosOfflineSyncDeps = defaultPosOfflineSyncDeps,
): PluginApiHandler {
  return async (req, res) => {
    try {
      const outcome = await handlePosOfflineSync(deps(), req)
      return res.status(outcome.status).json(outcome.body)
    } catch (error) {
      console.error('[pos-offline-sync] failed', error)
      return res.status(500).json({ error: 'The offline sales could not be synced' })
    }
  }
}

export const posOfflineSyncHandler = createPosOfflineSyncHandler()
