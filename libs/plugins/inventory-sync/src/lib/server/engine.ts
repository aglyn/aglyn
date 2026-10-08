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

import type { PluginProductCatalog } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import type { PluginProductWriter } from '@aglyn/aglyn/plugin-manager/plugin-product-writer'
import type { PluginStockLevels } from '@aglyn/aglyn/plugin-manager/plugin-stock-levels'
import { createHash } from 'node:crypto'
import {
  LEASE_MS,
  PRODUCTS_INTERVAL_MS,
  PRODUCTS_PER_RUN,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  SEND_MAX_ATTEMPTS,
  STOCK_FULL_INTERVAL_MS,
  STOCK_INTERVAL_MS,
  STOCK_MAX_SKUS,
} from '../constants'
import {
  INVENTORY_PROVIDERS,
  isBrightpearlContactId,
  type InventoryProductSummary,
  type InventoryProviderId,
  type InventoryStockSummary,
} from '../model/inventory-sync'
import { isProviderError, ProviderError } from '../providers/http'
import type { InventoryCredential, InventorySystemProvider, SystemOrder, SystemStockChange } from '../providers/provider'
import {
  EMPTY_PRODUCTS,
  productLinkId,
  type InventoryStore,
  type StoredConnection,
  type StoredOrder,
  type StoredProductLink,
} from './store'

/**
 * THE SYNC ENGINE (AGL-3642): sends paid orders to the site's connected
 * system, keeps stock counts in step in the direction the connection names,
 * and makes products on the side the connection names.
 *
 * Every write to the store goes through core's seams, never through
 * commerce: counts through `core.stock-levels`, the store's catalog read
 * through `core.product-catalog`, and imported products through
 * `core.product-writer` (AGL-3641) when the deployment has one.
 *
 * IDEMPOTENT BY CONSTRUCTION
 *
 * - An order is sent under its own reference, derived from the site and the
 *   order; the system is asked for that reference before every create, so an
 *   attempt that timed out after the system took it is adopted, never
 *   repeated. Each hand-off runs under a lease, so two ticks, or a tick and a
 *   "Send now", never send it twice.
 * - A count is SET, never added to: a run that repeats sets the same number.
 *   Pushing counts the other way works out each adjustment from the system's
 *   count read in the same run, so a repeated run adjusts by nothing.
 * - A product is linked by the system's id (import) or the SKU (export) with
 *   the version last written; an unchanged version is not written again.
 *
 * PARTIAL FAILURE, RATE LIMITS, RETRIES
 *
 * - A refused credential turns the connection to "connect again"; queued
 *   orders wait and are sent once it is.
 * - A rate limit holds the whole connection until the system said to come
 *   back: every kind of work shares one account's budget.
 * - A failed order is retried with backoff, then stops and asks the merchant;
 *   one the system refused (an unknown SKU, a missing customer) stops at
 *   once, with the system's reason.
 * - A product or count batch that fails is counted and named in the
 *   activity; the rest of the run goes on.
 */

/** Core's `core.product-writer` (AGL-3641): the products' keeper the import writes through. */
export type SourcedProductWriterLike = PluginProductWriter

export interface EngineDeps {
  now(): number
  store: InventoryStore
  provider(id: InventoryProviderId): InventorySystemProvider
  credential(connectionId: string, connection: StoredConnection): Promise<InventoryCredential>
  /** The seller's stock counts; `null` when nothing on the deployment sells. */
  stockLevels(): PluginStockLevels | null
  /** The seller's catalog; `undefined` when nothing on the deployment sells. */
  catalog(): PluginProductCatalog | undefined
  /** The products' keeper; `undefined` until a deployment has one. */
  productWriter(): SourcedProductWriterLike | undefined
  /** Whether the site may still sync: entitled, commerce and this plugin on, not locked. */
  siteOpen(hostId: string): Promise<boolean>
}

export type OrderRunOutcome = 'leased_elsewhere' | 'idle' | 'sent' | 'canceled' | 'waiting' | 'retry' | 'failed'
export type ConnectionRunOutcome = 'leased_elsewhere' | 'skipped' | 'synced' | 'failed'

const label = (provider: InventoryProviderId) => INVENTORY_PROVIDERS[provider].label

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** The wait before attempt `attempts + 1`, doubling from the base. */
export const retryDelayMs = (attempts: number): number =>
  Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1))

const sha = (value: string) => createHash('sha256').update(value).digest('hex')

/** What a message about a thrown value says. */
const reason = (error: unknown) => (isProviderError(error) ? error.message : 'something went wrong')

/** The store's catalog, by SKU: what the store says it holds of each tracked SKU. */
async function storeCounts(
  catalog: PluginProductCatalog,
  hostId: string,
): Promise<{ counts: Map<string, number>; offers: number }> {
  const counts = new Map<string, number>()
  const duplicate = new Set<string>()
  let cursor: string | null = null
  let offers = 0
  do {
    const page = await catalog.page({ hostId, cursor, limit: 200 })
    for (const offer of page.offers) {
      offers += 1
      const sku = String(offer.sku ?? '').trim()
      if (!sku || offer.quantity === null) continue
      // Two configurations under one SKU is ambiguous; neither is pushed.
      if (counts.has(sku)) duplicate.add(sku)
      counts.set(sku, Math.max(0, Math.floor(offer.quantity)))
    }
    cursor = page.nextCursor
  } while (cursor && offers < STOCK_MAX_SKUS)
  for (const sku of duplicate) counts.delete(sku)
  return { counts, offers }
}

export function createEngine(deps: EngineDeps) {
  const log = (id: string, kind: 'order' | 'stock' | 'products' | 'canceled' | 'error', message: string, recordId?: string) =>
    deps.store.appendLog(id, { atMs: deps.now(), kind, message, ...(recordId ? { recordId } : {}) }).catch((error) => {
      console.error('[inventory-sync] log not written', id, error)
    })

  /**
   * What a failure means for the whole connection: a refused credential
   * turns it to "connect again"; a rate limit holds every kind of work until
   * the system said to come back. Answers when the work may run again.
   */
  async function connectionFailure(id: string, connection: StoredConnection, error: unknown): Promise<number> {
    const nowMs = deps.now()
    if (isProviderError(error) && error.kind === 'auth') {
      await deps.store.patchConnection(id, {
        status: 'reconnect',
        lastError: `${label(connection.provider)} refused the connection: ${error.message} Connect again to keep syncing.`,
        updatedAtMs: nowMs,
      })
      await log(id, 'error', `${label(connection.provider)} refused the connection. Connect again.`)
      return nowMs + STOCK_INTERVAL_MS
    }
    if (isProviderError(error) && error.kind === 'rate-limit') {
      const until = nowMs + Math.max(1_000, error.retryAfterMs ?? 60_000)
      await deps.store.patchConnection(id, { holdUntilMs: until, updatedAtMs: nowMs })
      return until
    }
    return 0
  }

  /** Bumps one of a connection's totals. */
  async function bump(id: string, key: 'ordersSent' | 'ordersFailed') {
    const fresh = await deps.store.getConnection(id)
    if (!fresh) return
    const totals = { ordersSent: fresh.totals?.ordersSent ?? 0, ordersFailed: fresh.totals?.ordersFailed ?? 0 }
    totals[key] += 1
    await deps.store.patchConnection(id, { totals })
  }

  /** Cancels what the system holds of a hand-off, or says why it could not. */
  async function cancelAtSystem(
    id: string,
    order: StoredOrder,
    connection: StoredConnection,
    credential: InventoryCredential,
  ): Promise<OrderRunOutcome> {
    const nowMs = deps.now()
    const system = deps.provider(order.provider)
    const name = label(order.provider)
    const held: SystemOrder | null = order.externalId
      ? { id: order.externalId, number: order.externalNumber }
      : await system.findOrder(credential, order.reference)
    if (!held) {
      await deps.store.patchOrder(id, {
        status: 'canceled',
        active: false,
        note: `${order.note ?? 'The order was canceled.'} It was never sent to ${name}.`,
        leaseUntilMs: 0,
        updatedAtMs: nowMs,
      })
      return 'canceled'
    }
    const outcome = await system.cancelOrder(credential, { ...held, reference: order.reference })
    const patch: Partial<StoredOrder> = {
      externalId: held.id,
      externalNumber: held.number,
      active: false,
      leaseUntilMs: 0,
      updatedAtMs: nowMs,
    }
    if (outcome === 'canceled') {
      await deps.store.patchOrder(id, { ...patch, status: 'canceled', note: `Canceled in ${name} too.` })
      await log(connection.hostId, 'canceled', `${order.displayRef} canceled in ${name}.`, order.recordId)
      return 'canceled'
    }
    await deps.store.patchOrder(id, {
      ...patch,
      status: 'sent',
      note:
        outcome === 'too_late'
          ? `${name} would not cancel it, most likely because it has shipped. Check the order there.`
          : `The order was canceled in the store. Cancel it in ${name} too: ${held.number ?? order.reference}.`,
    })
    await log(
      connection.hostId,
      'error',
      `${order.displayRef} was canceled in the store; cancel it in ${name} (${held.number ?? order.reference}).`,
      order.recordId,
    )
    return 'failed'
  }

  /** Sends (or cancels) one order's hand-off. */
  async function runOrder(id: string, options: { force?: boolean } = {}): Promise<OrderRunOutcome> {
    const nowMs = deps.now()
    const order = await deps.store.leaseOrder(id, nowMs, LEASE_MS, options)
    if (!order) return 'leased_elsewhere'
    const release = (patch: Partial<StoredOrder>) =>
      deps.store.patchOrder(id, { leaseUntilMs: 0, updatedAtMs: deps.now(), ...patch })
    const connection = await deps.store.getConnection(order.connectionId)
    const name = label(order.provider)
    if (!connection || connection.provider !== order.provider || !connection.connectedAtMs) {
      await release({
        status: order.status === 'sent' ? 'sent' : 'failed',
        active: false,
        note: `${name} is no longer connected. ${order.status === 'sent' ? 'Check the order there.' : 'Nothing was sent.'}`,
      })
      return 'failed'
    }
    if (!order.cancelRequested && order.status !== 'queued' && !(options.force && order.status === 'failed')) {
      await release({ active: false })
      return 'idle'
    }
    if (connection.status !== 'active' || (connection.holdUntilMs ?? 0) > nowMs || !(await deps.siteOpen(order.hostId))) {
      // Waits, unchanged, for the connection or the site to come back.
      await release({ nextRunAtMs: Math.max(nowMs + STOCK_INTERVAL_MS, connection.holdUntilMs ?? 0) })
      return 'waiting'
    }
    let credential: InventoryCredential
    try {
      credential = await deps.credential(order.connectionId, connection)
      if (order.cancelRequested) return await cancelAtSystem(id, order, connection, credential)
      const customer = connection.orderCustomer.trim()
      if (!customer || (order.provider === 'brightpearl' && !isBrightpearlContactId(customer))) {
        await release({
          status: 'failed',
          active: false,
          note: `Choose the ${INVENTORY_PROVIDERS[order.provider].customerLabel.toLowerCase()} in the ${name} settings, then send the order again.`,
        })
        await bump(order.connectionId, 'ordersFailed')
        return 'failed'
      }
      const system = deps.provider(order.provider)
      // Adopt what an attempt that timed out may already have made.
      let made = await system.findOrder(credential, order.reference)
      if (!made) {
        const skus = [...new Set(order.lines.map((line) => line.sku))]
        const ids = await system.productIdsBySku(credential, skus)
        const missing = skus.filter((sku) => !ids.has(sku))
        if (missing.length) {
          throw new ProviderError(
            'invalid',
            `${name} has no product with the SKU ${missing.join(', ')}. Add ${missing.length === 1 ? 'it' : 'them'} there, then send the order again.`,
          )
        }
        made = await system.createOrder(credential, {
          reference: order.reference,
          displayRef: order.displayRef,
          orderedAtMs: order.snapshot.orderedAtMs,
          currency: order.snapshot.currency,
          customer,
          locationId: connection.locationId,
          taxRule: connection.taxRule ?? '',
          buyerName: order.snapshot.buyerName,
          buyerEmail: order.snapshot.buyerEmail,
          shippingAddress: order.snapshot.shippingAddress,
          lines: order.lines.map((line) => ({
            sku: line.sku,
            productId: ids.get(line.sku) as string,
            name: line.name,
            quantity: line.quantity,
            unitAmountCents: line.unitAmountCents,
          })),
          shippingCents: order.snapshot.shippingCents,
          discountCents: order.snapshot.discountCents,
          taxCents: order.snapshot.taxCents,
          totalCents: order.snapshot.totalCents,
        })
      }
      await release({
        status: 'sent',
        active: false,
        externalId: made.id,
        externalNumber: made.number,
        attempts: order.attempts + 1,
        note: order.skippedLines?.length
          ? `Sent without the items that have no SKU: ${order.skippedLines.join(', ')}.`
          : null,
      })
      await bump(order.connectionId, 'ordersSent')
      await log(order.connectionId, 'order', `${order.displayRef} sent to ${name}${made.number ? ` as ${made.number}` : ''}.`, order.recordId)
      return 'sent'
    } catch (error) {
      const until = await connectionFailure(order.connectionId, connection, error)
      if (until) {
        // The connection's trouble, not the order's: it waits, without an attempt counted.
        await release({ nextRunAtMs: until })
        return 'waiting'
      }
      const attempts = order.attempts + 1
      const refused = isProviderError(error) && error.kind === 'invalid'
      if (!isProviderError(error)) console.error('[inventory-sync] order run failed', id, error)
      if (refused || attempts >= SEND_MAX_ATTEMPTS) {
        await release({
          status: order.cancelRequested ? order.status : 'failed',
          active: false,
          attempts,
          note: refused
            ? `${name} refused the order: ${reason(error)}`
            : `${name} could not be reached after ${plural(attempts, 'attempt')}: ${reason(error)}. Send it again from the order.`,
        })
        if (!order.cancelRequested) await bump(order.connectionId, 'ordersFailed')
        await log(order.connectionId, 'error', `${order.displayRef} was not sent: ${reason(error)}`, order.recordId)
        return 'failed'
      }
      await release({ attempts, nextRunAtMs: deps.now() + retryDelayMs(attempts), note: `Retrying: ${reason(error)}` })
      return 'retry'
    }
  }

  /** Leases a connection's stock or product run, or says why it does not run now. */
  async function leaseRun(
    id: string,
    work: 'stock' | 'products',
    options: { force?: boolean },
  ): Promise<{ connection: StoredConnection } | ConnectionRunOutcome> {
    const nowMs = deps.now()
    const connection = await deps.store.leaseConnection(id, work, nowMs, LEASE_MS, options)
    if (!connection) return 'leased_elsewhere'
    const dueField = work === 'stock' ? 'stockDueAtMs' : 'productsDueAtMs'
    const leaseField = work === 'stock' ? 'stockLeaseUntilMs' : 'productsLeaseUntilMs'
    const interval = work === 'stock' ? STOCK_INTERVAL_MS : PRODUCTS_INTERVAL_MS
    const off = work === 'stock' ? connection.stockSource === 'off' : connection.productSync === 'off'
    if (off || !(await deps.siteOpen(connection.hostId))) {
      await deps.store.patchConnection(id, { [dueField]: nowMs + interval, [leaseField]: 0 })
      return 'skipped'
    }
    if ((connection.holdUntilMs ?? 0) > nowMs) {
      await deps.store.patchConnection(id, { [dueField]: connection.holdUntilMs, [leaseField]: 0 })
      return 'skipped'
    }
    return { connection }
  }

  /** One stock run: counts follow the side the connection names. */
  async function runStock(id: string, options: { force?: boolean } = {}): Promise<ConnectionRunOutcome> {
    const leased = await leaseRun(id, 'stock', options)
    if (typeof leased === 'string') return leased
    const { connection } = leased
    const nowMs = deps.now()
    const name = label(connection.provider)
    const summary: InventoryStockSummary = {
      syncedAtMs: nowMs,
      direction: connection.stockSource,
      skus: 0,
      updated: 0,
      unchanged: 0,
      unknown: 0,
      untracked: 0,
      perLocation: 0,
      failed: 0,
    }
    const finish = async (patch: Partial<StoredConnection>) =>
      deps.store.patchConnection(id, {
        stockLeaseUntilMs: 0,
        stockDueAtMs: deps.now() + STOCK_INTERVAL_MS,
        updatedAtMs: deps.now(),
        ...patch,
      })
    try {
      // Orders paid and not yet sent are off the store's count already and still on the system's.
      const pending = new Map<string, number>()
      for (const { order } of await deps.store.activeOrdersForHost(connection.hostId, 500)) {
        if (order.status !== 'queued' || order.cancelRequested) continue
        for (const line of order.lines ?? []) pending.set(line.sku, (pending.get(line.sku) ?? 0) + line.quantity)
      }
      if (connection.stockSource === 'store' && !connection.locationId) {
        await finish({ lastError: `Choose the ${INVENTORY_PROVIDERS[connection.provider].locationLabel.toLowerCase()} whose counts follow the store’s.` })
        return 'failed'
      }
      const credential = await deps.credential(id, connection)
      const counted = await deps.provider(connection.provider).stock(credential, {
        locationId: connection.locationId,
        max: STOCK_MAX_SKUS,
      })
      summary.skus = counted.length
      const lastCounts: Record<string, number> = { ...(connection.lastCounts ?? {}) }
      const full = options.force === true || (connection.stockFullDueAtMs ?? 0) <= nowMs

      if (connection.stockSource === 'system') {
        const levels = deps.stockLevels()
        if (!levels) throw new ProviderError('invalid', 'Nothing on this deployment keeps stock counts.')
        const wanted = counted.map((entry) => ({
          sku: entry.sku,
          quantity: Math.max(0, entry.available - (pending.get(entry.sku) ?? 0)),
        }))
        const changed = full ? wanted : wanted.filter((entry) => lastCounts[entry.sku] !== entry.quantity)
        summary.unchanged += wanted.length - changed.length
        for (let index = 0; index < changed.length; index += 500) {
          const batch = changed.slice(index, index + 500)
          const results = await levels.setAvailable({ hostId: connection.hostId, source: name, levels: batch })
          results.forEach((result, position) => {
            const sku = batch[position]?.sku ?? result.sku
            if (result.outcome === 'updated') summary.updated += 1
            else if (result.outcome === 'unchanged') summary.unchanged += 1
            else if (result.outcome === 'untracked') summary.untracked += 1
            else if (result.outcome === 'per_location') summary.perLocation += 1
            else if (result.outcome === 'unknown_sku') summary.unknown += 1
            else summary.failed += 1
            // A count that did not land is tried again next run; every other answer stands.
            if (result.outcome === 'failed' || result.outcome === 'invalid') delete lastCounts[sku]
            else lastCounts[sku] = batch[position]?.quantity ?? 0
          })
        }
      } else {
        const catalog = deps.catalog()
        if (!catalog) throw new ProviderError('invalid', 'Nothing on this deployment keeps a catalog.')
        const { counts } = await storeCounts(catalog, connection.hostId)
        const changes: SystemStockChange[] = []
        const seen = new Set<string>()
        for (const entry of counted) {
          seen.add(entry.sku)
          const storeCount = counts.get(entry.sku)
          if (storeCount === undefined) continue
          const target = storeCount + (pending.get(entry.sku) ?? 0)
          if (!full && lastCounts[entry.sku] === target && entry.available === target) {
            summary.unchanged += 1
            continue
          }
          const delta = target - entry.available
          if (delta === 0) {
            summary.unchanged += 1
            lastCounts[entry.sku] = target
            continue
          }
          changes.push({ sku: entry.sku, productId: entry.productId, delta, onHand: entry.onHand })
        }
        for (const sku of counts.keys()) if (!seen.has(sku)) summary.unknown += 1
        const currency = (await catalog.store(connection.hostId))?.currency ?? 'USD'
        const reference = `AGS-${sha(connection.hostId).slice(0, 6)}-${nowMs}`
        for (let index = 0; index < changes.length; index += 100) {
          const batch = changes.slice(index, index + 100)
          try {
            await deps.provider(connection.provider).adjustStock(credential, {
              locationId: connection.locationId as string,
              reference: `${reference}-${index / 100 + 1}`,
              changes: batch,
              currency,
            })
            summary.updated += batch.length
            for (const change of batch) lastCounts[change.sku] = change.onHand + change.delta
          } catch (error) {
            // A refused credential or a rate limit ends the run; a refused batch is counted and the rest go on.
            if (isProviderError(error) && (error.kind === 'auth' || error.kind === 'rate-limit')) throw error
            summary.failed += batch.length
            for (const change of batch) delete lastCounts[change.sku]
            await log(id, 'error', `${plural(batch.length, 'count')} could not be adjusted in ${name}: ${reason(error)}`)
          }
        }
      }
      await finish({
        stock: summary,
        lastCounts,
        ...(full ? { stockFullDueAtMs: nowMs + STOCK_FULL_INTERVAL_MS } : {}),
        lastError: null,
      })
      if (summary.updated) {
        await log(
          id,
          'stock',
          connection.stockSource === 'system'
            ? `${plural(summary.updated, 'store count')} set from ${name}.`
            : `${plural(summary.updated, 'count')} in ${name} adjusted to the store’s.`,
        )
      }
      return summary.failed ? 'failed' : 'synced'
    } catch (error) {
      const until = await connectionFailure(id, connection, error)
      if (!isProviderError(error)) console.error('[inventory-sync] stock run failed', id, error)
      await finish({
        ...(until ? { stockDueAtMs: until } : { stockDueAtMs: deps.now() + RETRY_BASE_MS * 6 }),
        ...(isProviderError(error) && error.kind === 'auth'
          ? {}
          : { lastError: `The stock sync failed: ${reason(error)}. It runs again shortly.` }),
      })
      if (!(isProviderError(error) && error.kind === 'auth')) await log(id, 'error', `Stock sync failed: ${reason(error)}`)
      return 'failed'
    }
  }

  /** One product run: make products on the side the connection names. */
  async function runProducts(id: string, options: { force?: boolean } = {}): Promise<ConnectionRunOutcome> {
    const leased = await leaseRun(id, 'products', options)
    if (typeof leased === 'string') return leased
    const { connection } = leased
    const nowMs = deps.now()
    const name = label(connection.provider)
    const summary: InventoryProductSummary = { ...EMPTY_PRODUCTS, syncedAtMs: nowMs }
    let cursor: string | null = connection.productsCursor ?? null
    const runStartedAtMs = cursor ? (connection.productsRunStartedAtMs ?? nowMs) : nowMs
    const finish = (patch: Partial<StoredConnection>) =>
      deps.store.patchConnection(id, {
        productsLeaseUntilMs: 0,
        updatedAtMs: deps.now(),
        products: summary,
        ...patch,
      })
    const link = (key: string): string => productLinkId(connection.hostId, connection.provider, key)
    const baseLink = (input: Partial<StoredProductLink> & Pick<StoredProductLink, 'externalId' | 'sku' | 'version'>): StoredProductLink => ({
      orgId: connection.orgId,
      hostId: connection.hostId,
      provider: connection.provider,
      direction: connection.productSync === 'import' ? 'import' : 'export',
      productId: null,
      variantId: null,
      error: null,
      updatedAtMs: deps.now(),
      ...input,
    })
    try {
      const catalog = deps.catalog()
      const store = catalog ? await catalog.store(connection.hostId) : null
      if (!catalog || !store) throw new ProviderError('invalid', 'This site does not sell.')
      const credential = await deps.credential(id, connection)
      const system = deps.provider(connection.provider)
      let written = 0
      let stop: string | null = null

      if (connection.productSync === 'export') {
        if (!INVENTORY_PROVIDERS[connection.provider].exportsProducts) {
          throw new ProviderError('invalid', `${name} products are made in ${name}. Choose Import or Off.`)
        }
        do {
          const page = await catalog.page({ hostId: connection.hostId, cursor, limit: 100 })
          const offers = page.offers.filter((offer) => String(offer.sku ?? '').trim())
          const unlinked = []
          for (const offer of offers) {
            const sku = String(offer.sku).trim()
            const existing = await deps.store.getLink(link(`sku_${sha(sku).slice(0, 24)}`))
            if (existing?.externalId) summary.unchanged += 1
            else unlinked.push({ offer, sku })
          }
          const known = unlinked.length ? await system.productIdsBySku(credential, unlinked.map((entry) => entry.sku)) : new Map()
          for (const { offer, sku } of unlinked) {
            const key = link(`sku_${sha(sku).slice(0, 24)}`)
            const found = known.get(sku)
            if (found) {
              await deps.store.putLink(key, baseLink({ externalId: found, sku, version: 'matched', productId: offer.productId, variantId: offer.variantId }))
              summary.unchanged += 1
              continue
            }
            if (written >= PRODUCTS_PER_RUN) {
              stop = 'limit'
              break
            }
            try {
              const made = await system.createProduct(credential, {
                sku,
                name: offer.title || offer.productName,
                description: offer.description ?? '',
                priceMinor: offer.salePriceMinor ?? offer.priceMinor,
                currency: store.currency,
                weightGrams: offer.weightGrams ?? null,
                barcode: offer.gtin ?? null,
              })
              written += 1
              summary.created += 1
              await deps.store.putLink(key, baseLink({ externalId: made.id, sku, version: String(offer.updatedAtMs ?? ''), productId: offer.productId, variantId: offer.variantId }))
            } catch (error) {
              if (isProviderError(error) && (error.kind === 'auth' || error.kind === 'rate-limit')) throw error
              summary.failed += 1
              await log(id, 'error', `${sku} could not be made in ${name}: ${reason(error)}`)
            }
          }
          if (stop) break
          cursor = page.nextCursor
        } while (cursor)
      } else {
        const writer = deps.productWriter()
        if (!writer) throw new ProviderError('invalid', 'Importing products is not available on this deployment.')
        do {
          const page = await system.products(credential, {
            sinceMs: connection.productsSinceMs ?? null,
            cursor,
            limit: 100,
            currency: store.currency,
          })
          for (const product of page.products) {
            if (written >= PRODUCTS_PER_RUN) {
              stop = 'limit'
              break
            }
            const key = link(product.id)
            const existing = await deps.store.getLink(key)
            if (existing && existing.version === product.version && (existing.productId || existing.error === 'deleted')) {
              summary.unchanged += 1
              continue
            }
            if (!existing?.productId && product.priceMinor === null) {
              summary.failed += 1
              await deps.store.putLink(key, baseLink({ externalId: product.id, sku: product.sku, version: product.version, error: `no price in ${store.currency}` }))
              await log(id, 'error', `${product.sku} was not imported: ${name} has no price for it in ${store.currency.toUpperCase()}.`)
              continue
            }
            if (!existing?.productId && !product.active) {
              summary.unchanged += 1
              continue
            }
            const answer = await writer.upsertSourced({
              hostId: connection.hostId,
              product: {
                sourceKey: `${connection.provider}:${product.id}`,
                name: product.name,
                ...(product.description ? { description: product.description } : {}),
                mediaUrls: [],
                options: [],
                variants: [
                  {
                    key: product.id,
                    ...(existing?.variantId ? { variantId: existing.variantId } : {}),
                    options: {},
                    sku: product.sku,
                    priceMinor: product.priceMinor ?? 0,
                    ...(product.weightGrams ? { weightGrams: product.weightGrams } : {}),
                    available: product.active,
                  },
                ],
              },
              ...(existing?.productId ? { productId: existing.productId, recreate: false } : { status: 'draft' as const }),
              prices: product.priceMinor !== null,
              content: false,
            })
            if (answer.outcome === 'plan_limit') {
              stop = `Your plan allows ${answer.limit} products. Importing stopped there.`
              break
            }
            if (answer.outcome === 'no_store') throw new ProviderError('invalid', 'This site does not sell.')
            if (answer.outcome === 'invalid') {
              summary.failed += 1
              await deps.store.putLink(key, baseLink({ externalId: product.id, sku: product.sku, version: product.version, error: answer.message }))
              await log(id, 'error', `${product.sku} was not imported: ${answer.message}`)
              continue
            }
            if (answer.outcome === 'missing') {
              // The merchant deleted it in the store: it stays deleted.
              await deps.store.putLink(key, baseLink({ externalId: product.id, sku: product.sku, version: product.version, error: 'deleted' }))
              summary.unchanged += 1
              continue
            }
            written += answer.outcome === 'unchanged' ? 0 : 1
            if (answer.outcome === 'created') summary.created += 1
            else if (answer.outcome === 'updated') summary.updated += 1
            else summary.unchanged += 1
            await deps.store.putLink(
              key,
              baseLink({
                externalId: product.id,
                sku: product.sku,
                version: product.version,
                productId: answer.productId,
                variantId: answer.variants.find((variant) => variant.key === product.id)?.variantId ?? null,
              }),
            )
          }
          if (stop) break
          cursor = page.nextCursor
        } while (cursor)
      }

      summary.more = stop === 'limit'
      const finished = !stop
      await finish({
        productsCursor: finished ? null : stop === 'limit' ? cursor : null,
        productsRunStartedAtMs: finished ? null : runStartedAtMs,
        ...(finished && connection.productSync === 'import' ? { productsSinceMs: runStartedAtMs } : {}),
        // An unfinished run continues on the next tick; a finished one waits its interval.
        productsDueAtMs: deps.now() + (stop === 'limit' ? 60_000 : PRODUCTS_INTERVAL_MS),
        lastError: stop && stop !== 'limit' ? stop : null,
      })
      if (summary.created || summary.updated) {
        await log(
          id,
          'products',
          connection.productSync === 'import'
            ? `${plural(summary.created, 'product')} imported from ${name}, ${summary.updated} updated.`
            : `${plural(summary.created, 'product')} made in ${name}.`,
        )
      }
      return summary.failed ? 'failed' : 'synced'
    } catch (error) {
      const until = await connectionFailure(id, connection, error)
      if (!isProviderError(error)) console.error('[inventory-sync] product run failed', id, error)
      const refused = isProviderError(error) && error.kind === 'invalid'
      await finish({
        // Keeps its place: a run cut short by a rate limit continues where it stopped.
        productsCursor: cursor,
        productsRunStartedAtMs: cursor ? runStartedAtMs : null,
        productsDueAtMs: until || deps.now() + (refused ? PRODUCTS_INTERVAL_MS : RETRY_BASE_MS * 6),
        ...(isProviderError(error) && (error.kind === 'auth' || error.kind === 'rate-limit')
          ? {}
          : { lastError: `The product sync failed: ${reason(error)}` }),
      })
      if (!(isProviderError(error) && error.kind === 'auth')) await log(id, 'error', `Product sync failed: ${reason(error)}`)
      return 'failed'
    }
  }

  return { runOrder, runStock, runProducts }
}

export type Engine = ReturnType<typeof createEngine>
