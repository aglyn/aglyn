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

import type { PluginChannelOrders } from '@aglyn/aglyn/plugin-manager/plugin-channel-orders'
import type { CatalogOffer, PluginProductCatalog } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import {
  FEES_FOLLOW_MS,
  FEES_POLL_MS,
  LEASE_MS,
  LISTING_RETRY_MS,
  LISTINGS_BATCH,
  LISTINGS_MAX_OFFERS,
  LISTINGS_POLL_MS,
  ORDER_PAGES_PER_RUN,
  ORDERS_FIRST_LOOKBACK_MS,
  ORDERS_OVERLAP_MS,
  ORDERS_POLL_MS,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  SHIPMENT_MAX_ATTEMPTS,
} from '../constants'
import {
  DEFAULT_SETTINGS,
  EMPTY_LISTING_SUMMARY,
  MARKETPLACES,
  type ListingSyncSummary,
  type MarketplaceSettings,
} from '../model/marketplaces'
import { isProviderError, ProviderError } from '../providers/http'
import type {
  ListingPush,
  ListingResult,
  MarketplaceApp,
  MarketplaceCredential,
  MarketplaceOrder,
  MarketplaceProvider,
} from '../providers/provider'
import type { MarketplacesConfig } from './config'
import {
  LISTING_CHUNK_IDS,
  listingChunkOf,
  marketplaceOrderDocId,
  type ListingStateChunk,
  type ListingStateEntry,
  type MarketplaceStore,
  type StoredConnection,
  type StoredMarketplaceOrder,
} from './store'

/**
 * THE MARKETPLACE ENGINE (AGL-3638): one run of one connection, and one run
 * of one imported order. The console job calls both; "Sync now" calls the
 * first. Everything outside — the marketplaces, the store's catalog, the
 * store's orders, Firestore — arrives in {@link EngineDeps}, so a spec drives
 * it whole.
 *
 * ## A connection's run
 *
 * 1. **Orders**: every order the marketplace changed since the last read
 *    (with an overlap, for one it dated late). A paid order not yet shipped
 *    becomes an Aglyn order through core's `core.channel-orders`, whose seller
 *    takes its units off the shelf in the same write; one the marketplace
 *    canceled is cancelled here and its units put back. Each order is
 *    recorded here once, by the marketplace's id, so a page read twice
 *    imports nothing twice.
 * 2. **Listings**: the store's catalog, read through `core.product-catalog`,
 *    against what each listing was last sent. Only what changed is sent:
 *    the quantity (less the merchant's buffer), and the price when the
 *    merchant asked. Any sale on any channel marks every connection of the
 *    site due at once, so the last unit sold here is gone everywhere else
 *    within one tick.
 *
 * ## An imported order's run
 *
 * Tells the marketplace the seller took it (where it must hear that),
 * confirms each shipment the merchant recorded with its tracking, and reads
 * the marketplace's fees once it states them — recorded on the order, never
 * charged by Aglyn.
 *
 * ## Failures
 *
 * A refused grant turns the connection to "connect again". A rate limit
 * waits as long as the marketplace asked. Anything else backs off,
 * doubling, and says what went wrong on the card. A run never throws.
 */

export interface EngineDeps {
  now(): number
  store: MarketplaceStore
  config(): MarketplacesConfig
  provider(id: StoredConnection['marketplace']): MarketplaceProvider
  /** Opens a connection's grant, refreshing it when it is about to expire. */
  credential(connectionId: string, connection: StoredConnection): Promise<MarketplaceCredential>
  /** The store's catalog (`core.product-catalog`), or `undefined` when no plugin sells. */
  catalog(): PluginProductCatalog | undefined
  /** The seller's order intake (`core.channel-orders`), or `null` when no plugin sells. */
  channelOrders(): PluginChannelOrders | null
  /** Whether the site may run this plugin now: entitled, commerce and this plugin on, not locked. */
  siteOpen(hostId: string): Promise<boolean>
}

export type ConnectionOutcome = 'synced' | 'not_due' | 'leased_elsewhere' | 'closed' | 'reconnect' | 'failed'
export type OrderOutcome = 'done' | 'waiting' | 'not_due' | 'leased_elsewhere' | 'failed'

const backoff = (failures: number) => Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1))

const message = (error: unknown): string =>
  (isProviderError(error) ? error.message : error instanceof Error ? error.message : String(error)).slice(0, 300)

/** The settings a stored connection runs with, every field present. */
export const settingsOf = (connection: Pick<StoredConnection, 'settings'>): MarketplaceSettings => ({
  ...DEFAULT_SETTINGS,
  ...(connection.settings ?? {}),
})

/** The price a listing shows: the store's selling price, adjusted by the merchant's percent, whole minor units. */
export function listingPrice(offer: Pick<CatalogOffer, 'priceMinor' | 'salePriceMinor'>, adjustPercent: number): number {
  const base = offer.salePriceMinor ?? offer.priceMinor
  return Math.max(0, Math.round((base * (100 + adjustPercent)) / 100))
}

/**
 * The units a listing offers: the store's count less the merchant's buffer,
 * never below zero; for a product that counts no stock, the merchant's
 * stand-in. A backorder product at zero offers zero here: a marketplace
 * buyer is promised what is on the shelf.
 */
export function listingQuantity(offer: Pick<CatalogOffer, 'quantity'>, settings: MarketplaceSettings): number {
  if (offer.quantity === null || offer.quantity === undefined) return settings.untrackedQuantity
  return Math.max(0, Math.trunc(offer.quantity) - settings.stockBuffer)
}

/** Whether a catalog offer can be listed on a marketplace at all: goods that ship, sold once. */
export const listable = (offer: CatalogOffer): boolean => offer.kind === 'physical' && !offer.subscriptionOnly

/** The seller SKU an offer is listed under: the merchant's own, else the store's offer id. */
export const listingSku = (offer: Pick<CatalogOffer, 'sku' | 'id'>): string => (offer.sku?.trim() || offer.id).slice(0, 120)

export function createEngine(deps: EngineDeps) {
  const label = (connection: Pick<StoredConnection, 'marketplace'>) => MARKETPLACES[connection.marketplace].label

  const log = async (connectionId: string, kind: Parameters<MarketplaceStore['appendLog']>[1]['kind'], text: string) => {
    try {
      await deps.store.appendLog(connectionId, { atMs: deps.now(), kind, message: text.slice(0, 500) })
    } catch (error) {
      console.error('[marketplaces] log not written', connectionId, error)
    }
  }

  /** The credential a run uses: the merchant's chosen marketplace site wins over the account's first. */
  const runCredential = async (id: string, connection: StoredConnection): Promise<MarketplaceCredential> => {
    const credential = await deps.credential(id, connection)
    const chosen = settingsOf(connection).marketplaceId
    return chosen ? { ...credential, account: { ...credential.account, marketplaceId: chosen } } : credential
  }

  // ---------------------------------------------------------------- orders

  async function handleOrder(
    id: string,
    connection: StoredConnection,
    app: MarketplaceApp,
    credential: MarketplaceCredential,
    provider: MarketplaceProvider,
    order: MarketplaceOrder,
    tally: { imported: number; skipped: number; canceled: number; lastImportedAtMs: number | null },
  ): Promise<void> {
    const orderId = marketplaceOrderDocId(connection.hostId, connection.marketplace, order.externalId)
    const existing = await deps.store.getOrder(orderId)
    const name = label(connection)
    const nowMs = deps.now()
    const base = (): StoredMarketplaceOrder => ({
      orgId: connection.orgId,
      hostId: connection.hostId,
      marketplace: connection.marketplace,
      connectionId: id,
      externalOrderId: order.externalId,
      displayRef: order.displayRef || order.externalId,
      recordId: '',
      status: 'refused',
      note: null,
      lines: [],
      acknowledged: true,
      currency: order.currency,
      fees: order.fees ? order.fees.map((fee) => ({ label: fee.label, amountMinor: fee.amountMinor })) : null,
      feesFollowUntilMs: 0,
      shipments: {},
      sandbox: connection.sandbox === true || order.testMode === true,
      active: false,
      nextRunAtMs: nowMs,
      leaseUntilMs: 0,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    })
    // Remembered once, so a page read again neither re-logs nor re-counts it.
    const skip = async (note: string) => {
      if (existing) return
      if (await deps.store.createOrder(orderId, { ...base(), status: 'refused', note })) {
        tally.skipped += 1
        await log(id, 'order_skipped', `${name} order ${order.displayRef}: ${note}`)
      }
    }

    if (order.state === 'canceled') {
      if (!existing || existing.status !== 'imported') return
      const seller = deps.channelOrders()
      if (!seller) throw new ProviderError('transient', 'The store cannot record orders right now')
      const outcome = await seller.cancelOrder({
        hostId: connection.hostId,
        recordId: existing.recordId,
        reason: `Canceled on ${name}`,
      })
      if (outcome.outcome === 'cancelled' || outcome.outcome === 'already') {
        await deps.store.patchOrder(orderId, { status: 'canceled', active: false, updatedAtMs: nowMs })
        if (outcome.outcome === 'cancelled') {
          tally.canceled += 1
          await log(
            id,
            'order_canceled',
            `${name} canceled order ${order.displayRef}; ${outcome.restockedUnits} unit${outcome.restockedUnits === 1 ? '' : 's'} back in stock`,
          )
          await deps.store.markListingsDue(connection.hostId, nowMs)
        }
      } else if (outcome.outcome === 'not_cancellable') {
        await deps.store.patchOrder(orderId, {
          status: 'canceled',
          note: `${name} canceled it after it was ${outcome.status}. Check the order.`,
          updatedAtMs: nowMs,
        })
        await log(id, 'error', `${name} canceled order ${order.displayRef}, which is already ${outcome.status} here. Check it.`)
      }
      return
    }
    if (existing) return
    if (order.fulfilledByMarketplace) return skip(`Shipped by ${name} from its own warehouse; not imported.`)
    if (order.state === 'pending') return
    if (order.state === 'shipped') return skip(`Already shipped on ${name} when first read; not imported.`)
    if (!order.lines.length) return skip('It has no items.')
    const seller = deps.channelOrders()
    if (!seller) throw new ProviderError('transient', 'The store cannot record orders right now')
    const outcome = await seller.importOrder({
      hostId: connection.hostId,
      channel: { id: connection.marketplace, label: name },
      externalOrderId: order.externalId,
      externalRef: order.displayRef || order.externalId,
      placedAtMs: order.placedAtMs,
      currency: order.currency,
      lines: order.lines.map((line) => ({
        externalLineId: line.externalLineId,
        sku: line.sku,
        name: line.title,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceMinor,
      })),
      shippingCents: order.shippingMinor,
      taxCents: order.taxMinor,
      discountCents: order.discountMinor,
      totalCents: order.totalMinor,
      fees: order.fees ? order.fees.map((fee) => ({ label: fee.label, amountCents: fee.amountMinor })) : null,
      customerName: order.buyerName,
      shippingAddress: order.shipTo,
      testMode: connection.sandbox === true || order.testMode === true,
    })
    if (outcome.outcome === 'refused') return skip(outcome.reason)
    const needsAck = Boolean(provider.acknowledgeOrder)
    const followFees = order.fees === null && Boolean(provider.orderFees)
    const record: StoredMarketplaceOrder = {
      ...base(),
      recordId: outcome.recordId,
      status: 'imported',
      lines: outcome.lines,
      acknowledged: !needsAck,
      feesFollowUntilMs: followFees ? nowMs + FEES_FOLLOW_MS : 0,
      active: needsAck || followFees,
      nextRunAtMs: followFees && !needsAck ? nowMs + FEES_POLL_MS : nowMs,
      note:
        outcome.outcome === 'created' && outcome.shortfalls.length
          ? `Sold ${outcome.shortfalls.reduce((sum, entry) => sum + entry.short, 0)} more than was in stock.`
          : null,
    }
    if (!(await deps.store.createOrder(orderId, record))) return
    if (needsAck && provider.acknowledgeOrder) {
      try {
        await provider.acknowledgeOrder(app, credential, order)
        await deps.store.patchOrder(orderId, {
          acknowledged: true,
          active: followFees,
          nextRunAtMs: followFees ? nowMs + FEES_POLL_MS : nowMs,
        })
      } catch (error) {
        if (isProviderError(error) && error.kind === 'auth') throw error
        // The order's own run asks again.
        console.error('[marketplaces] acknowledge failed', orderId, message(error))
      }
    }
    if (outcome.outcome === 'created') {
      tally.imported += 1
      tally.lastImportedAtMs = nowMs
      await log(id, 'order_imported', `${name} order ${order.displayRef} is order ${outcome.displayRef}`)
      if (outcome.unmatched.length) {
        await log(
          id,
          'error',
          `${outcome.unmatched.length} item${outcome.unmatched.length === 1 ? '' : 's'} of ${name} order ${order.displayRef} match no product's SKU, so no stock was taken for ${outcome.unmatched.length === 1 ? 'it' : 'them'}.`,
        )
      }
    }
  }

  async function importOrders(
    id: string,
    connection: StoredConnection,
    app: MarketplaceApp,
    credential: MarketplaceCredential,
    provider: MarketplaceProvider,
  ): Promise<Partial<StoredConnection>> {
    const nowMs = deps.now()
    const resume = connection.ordersPage
    const sinceMs = resume ? resume.sinceMs : Math.max(0, (connection.ordersSinceMs ?? nowMs) - ORDERS_OVERLAP_MS)
    const startedAtMs = resume ? resume.startedAtMs : nowMs
    let cursor: string | null = resume ? resume.cursor : null
    const tally = { imported: 0, skipped: 0, canceled: 0, lastImportedAtMs: null as number | null }
    let pages = 0
    let finished = false
    try {
      while (pages < ORDER_PAGES_PER_RUN) {
        const page = await provider.listOrders(app, credential, { sinceMs, cursor })
        pages += 1
        for (const order of page.orders) {
          await handleOrder(id, connection, app, credential, provider, order, tally)
        }
        cursor = page.nextCursor
        if (!cursor) {
          finished = true
          break
        }
      }
    } finally {
      // What was read is kept whatever ends the loop, so a retry resumes rather than repeats.
      const totals = connection.orders ?? { imported: 0, skipped: 0, lastImportedAtMs: null }
      const counted = {
        imported: (totals.imported ?? 0) + tally.imported,
        skipped: (totals.skipped ?? 0) + tally.skipped,
        lastImportedAtMs: tally.lastImportedAtMs ?? totals.lastImportedAtMs ?? null,
      }
      connection.orders = counted
      if (tally.imported || tally.canceled) await deps.store.markListingsDue(connection.hostId, deps.now())
      if (finished) {
        connection.ordersSinceMs = startedAtMs
        connection.ordersPage = null
      } else if (cursor) {
        connection.ordersPage = { cursor, sinceMs, startedAtMs }
      }
    }
    return {
      orders: connection.orders,
      ordersSinceMs: connection.ordersSinceMs,
      ordersPage: connection.ordersPage ?? null,
      // More pages wait: come back on the next tick rather than in ten minutes.
      ordersDueAtMs: finished ? nowMs + ORDERS_POLL_MS : nowMs,
    }
  }

  // -------------------------------------------------------------- listings

  async function readCatalog(hostId: string) {
    const catalog = deps.catalog()
    if (!catalog) return null
    const store = await catalog.store(hostId)
    if (!store) return null
    const offers: CatalogOffer[] = []
    let cursor: string | null = null
    do {
      const page = await catalog.page({ hostId, cursor, limit: 250 })
      offers.push(...page.offers.filter(listable))
      cursor = page.nextCursor
    } while (cursor && offers.length < LISTINGS_MAX_OFFERS)
    return { store, offers: offers.slice(0, LISTINGS_MAX_OFFERS), truncated: Boolean(cursor) }
  }

  async function syncListings(
    id: string,
    connection: StoredConnection,
    app: MarketplaceApp,
    credential: MarketplaceCredential,
    provider: MarketplaceProvider,
  ): Promise<Partial<StoredConnection>> {
    const nowMs = deps.now()
    const settings = settingsOf(connection)
    const info = MARKETPLACES[connection.marketplace]
    const catalog = await readCatalog(connection.hostId)
    if (!catalog) {
      return { listings: { ...EMPTY_LISTING_SUMMARY, syncedAtMs: nowMs }, listingsDueAtMs: nowMs + LISTINGS_POLL_MS }
    }
    const site = connection.sites?.find((entry) => entry.id === (settings.marketplaceId ?? credential.account.marketplaceId))
    // A price is only sent in the currency the marketplace sells in.
    const pricesOk =
      settings.syncPrices && info.canSyncPrices && (!site?.currency || site.currency.toUpperCase() === catalog.store.currency)
    const options = { publish: settings.listingMode === 'publish' && info.canPublish, prices: pricesOk }
    const state = await deps.store.readListingState(id)
    const entryOf = (offerId: string): ListingStateEntry | undefined => state[listingChunkOf(offerId)]?.[offerId]
    const changed = new Set<string>()
    const setEntry = (offerId: string, entry: ListingStateEntry | null) => {
      const chunk = listingChunkOf(offerId)
      const entries: ListingStateChunk = { ...(state[chunk] ?? {}) }
      if (entry) entries[offerId] = entry
      else delete entries[offerId]
      state[chunk] = entries
      changed.add(chunk)
    }

    const summary: ListingSyncSummary = { ...EMPTY_LISTING_SUMMARY, syncedAtMs: nowMs, offers: catalog.offers.length }
    const pushes: Array<{ push: ListingPush; title: string }> = []
    const seen = new Set<string>()
    const skus = new Set<string>()
    for (const offer of catalog.offers) {
      const sku = listingSku(offer)
      // Two products under one SKU would fight over one listing; the first keeps it.
      if (skus.has(sku.toLowerCase())) continue
      skus.add(sku.toLowerCase())
      seen.add(offer.id)
      const quantity = listingQuantity(offer, settings)
      const price = listingPrice(offer, settings.priceAdjustPercent)
      const entry = entryOf(offer.id)
      const stale = !entry || nowMs - entry.at >= LISTING_RETRY_MS
      const due =
        !entry ||
        entry.s !== sku ||
        ((entry.o === 'updated' || entry.o === 'created') && (entry.q !== quantity || (options.prices && entry.p !== price))) ||
        ((entry.o === 'failed' || entry.o === 'not_listed') && (stale || entry.q !== quantity))
      if (!due) {
        if (entry.o === 'not_listed') summary.notListed += 1
        else if (entry.o === 'failed') summary.failed += 1
        else summary.unchanged += 1
        continue
      }
      pushes.push({
        title: offer.title,
        push: {
          offerId: offer.id,
          sku,
          groupId: offer.groupId,
          title: offer.title,
          description: offer.description,
          priceMinor: price,
          currency: catalog.store.currency,
          quantity,
          imageUrls: [offer.imageUrl, ...offer.additionalImageUrls].filter((url): url is string => Boolean(url)),
          productUrl: catalog.store.origin ? `${catalog.store.origin}${offer.path}` : null,
          ...(offer.gtin ? { gtin: offer.gtin } : {}),
          ...(offer.brand ? { brand: offer.brand } : {}),
          ...(offer.mpn ? { mpn: offer.mpn } : {}),
          ...(offer.condition ? { condition: offer.condition } : {}),
          ...(offer.weightGrams ? { weightGrams: offer.weightGrams } : {}),
          ...(offer.dimensionsCm ? { dimensionsCm: offer.dimensionsCm } : {}),
          options: offer.options,
          externalId: entry?.x ?? null,
        },
      })
    }
    // A product gone from the catalog (archived, deleted, no longer shipped)
    // stops selling there: its listing is set to none left, once.
    if (!catalog.truncated) {
      for (const chunk of LISTING_CHUNK_IDS) {
        for (const [offerId, entry] of Object.entries(state[chunk] ?? {})) {
          if (seen.has(offerId)) continue
          if (entry.o === 'not_listed' || entry.o === 'failed' || entry.q === 0) {
            if (entry.o !== 'updated' || entry.q === 0) setEntry(offerId, entry.o === 'updated' ? entry : null)
            continue
          }
          pushes.push({
            title: entry.t,
            push: {
              offerId,
              sku: entry.s,
              groupId: offerId,
              title: entry.t,
              description: '',
              priceMinor: entry.p ?? 0,
              currency: catalog.store.currency,
              quantity: 0,
              imageUrls: [],
              productUrl: null,
              options: {},
              externalId: entry.x,
            },
          })
        }
      }
    }

    let stopped: unknown = null
    for (let start = 0; start < pushes.length && !stopped; start += LISTINGS_BATCH) {
      const batch = pushes.slice(start, start + LISTINGS_BATCH)
      let results: ListingResult[]
      try {
        results = await provider.syncListings(
          app,
          credential,
          batch.map((entry) => entry.push),
          // An offer leaving the catalog is only ever zeroed, never published.
          { ...options, publish: options.publish },
        )
      } catch (error) {
        if (isProviderError(error) && error.kind === 'invalid') {
          results = batch.map((entry) => ({ sku: entry.push.sku, outcome: 'failed', message: message(error) }))
        } else {
          stopped = error
          break
        }
      }
      batch.forEach((entry, index) => {
        const result = results[index] ?? { sku: entry.push.sku, outcome: 'failed' as const, message: 'The marketplace gave no answer for it.' }
        const leaving = !seen.has(entry.push.offerId)
        // A leaving offer with no listing there needs no record.
        if (leaving && result.outcome === 'not_listed') return setEntry(entry.push.offerId, null)
        setEntry(entry.push.offerId, {
          s: entry.push.sku,
          t: entry.title.slice(0, 120),
          q: entry.push.quantity,
          p: options.prices ? entry.push.priceMinor : null,
          o: result.outcome,
          x: result.externalId ?? entry.push.externalId ?? null,
          m: result.message ? String(result.message).slice(0, 300) : null,
          at: nowMs,
        })
        if (leaving) return
        if (result.outcome === 'updated') summary.updated += 1
        else if (result.outcome === 'created') summary.created += 1
        else if (result.outcome === 'not_listed') summary.notListed += 1
        else summary.failed += 1
      })
    }
    if (changed.size) {
      const write: Record<string, ListingStateChunk> = {}
      for (const chunk of changed) write[chunk] = state[chunk] ?? {}
      await deps.store.writeListingState(id, write)
    }
    if (stopped) throw stopped
    if (summary.updated || summary.created) {
      await log(
        id,
        'listings',
        `${label(connection)} listings: ${summary.updated} updated${summary.created ? `, ${summary.created} published` : ''}${summary.failed ? `, ${summary.failed} refused` : ''}`,
      )
    }
    return { listings: summary, listingsDueAtMs: nowMs + LISTINGS_POLL_MS }
  }

  // ------------------------------------------------------------ connection

  async function runConnection(id: string, options: { force?: boolean } = {}): Promise<ConnectionOutcome> {
    const startedAtMs = deps.now()
    const connection = await deps.store.leaseConnection(id, startedAtMs, LEASE_MS, options)
    if (!connection) {
      const current = await deps.store.getConnection(id)
      return current && (current.leaseUntilMs ?? 0) > startedAtMs ? 'leased_elsewhere' : 'not_due'
    }
    const settle = (patch: Partial<StoredConnection>) =>
      deps.store.settleConnection(id, { ...patch, updatedAtMs: deps.now() }, startedAtMs, deps.now())
    if (!(await deps.siteOpen(connection.hostId))) {
      await settle({ ordersDueAtMs: startedAtMs + ORDERS_POLL_MS, listingsDueAtMs: startedAtMs + LISTINGS_POLL_MS })
      return 'closed'
    }
    const app = deps.config().apps[connection.marketplace]
    const provider = deps.provider(connection.marketplace)
    if (!app) {
      await settle({ status: 'reconnect', lastError: 'This deployment no longer offers this marketplace.' })
      return 'reconnect'
    }
    const settings = settingsOf(connection)
    const patch: Partial<StoredConnection> = {}
    const errors: unknown[] = []
    let credential: MarketplaceCredential
    try {
      credential = await runCredential(id, connection)
    } catch (error) {
      return fail(error)
    }
    const nowMs = deps.now()
    if (settings.importOrders && (options.force || (connection.ordersDueAtMs ?? 0) <= nowMs)) {
      try {
        Object.assign(patch, await importOrders(id, connection, app, credential, provider))
      } catch (error) {
        errors.push(error)
        patch.orders = connection.orders
        patch.ordersSinceMs = connection.ordersSinceMs
        patch.ordersPage = connection.ordersPage ?? null
      }
    } else if (!settings.importOrders) {
      patch.ordersDueAtMs = nowMs + ORDERS_POLL_MS
    }
    if (settings.listingMode !== 'off' && (options.force || (connection.listingsDueAtMs ?? 0) <= nowMs)) {
      try {
        Object.assign(patch, await syncListings(id, connection, app, credential, provider))
      } catch (error) {
        errors.push(error)
      }
    } else if (settings.listingMode === 'off') {
      patch.listingsDueAtMs = nowMs + LISTINGS_POLL_MS
    }
    if (errors.length) return fail(errors[0], patch)
    await settle({ ...patch, failures: 0, lastError: null })
    return 'synced'

    async function fail(error: unknown, kept: Partial<StoredConnection> = {}): Promise<ConnectionOutcome> {
      const atMs = deps.now()
      const text = message(error)
      if (isProviderError(error) && error.kind === 'auth') {
        await settle({ ...kept, status: 'reconnect', lastError: text })
        await log(id, 'error', `${label(connection)}: ${text}`)
        return 'reconnect'
      }
      const failures = (connection.failures ?? 0) + 1
      const wait =
        isProviderError(error) && error.kind === 'rate-limit' ? Math.max(error.retryAfterMs ?? 0, 60_000) : backoff(failures)
      await settle({
        ...kept,
        failures,
        lastError: text,
        ordersDueAtMs: Math.max(kept.ordersDueAtMs ?? 0, atMs + wait),
        listingsDueAtMs: Math.max(kept.listingsDueAtMs ?? 0, atMs + wait),
      })
      if (failures === 1 || failures % 5 === 0) await log(id, 'error', `${label(connection)}: ${text}`)
      return 'failed'
    }
  }

  // ----------------------------------------------------------------- order

  async function runOrder(id: string, options: { force?: boolean } = {}): Promise<OrderOutcome> {
    const nowMs = deps.now()
    const order = await deps.store.leaseOrder(id, nowMs, LEASE_MS, options)
    if (!order) {
      const current = await deps.store.getOrder(id)
      return current && (current.leaseUntilMs ?? 0) > nowMs ? 'leased_elsewhere' : 'not_due'
    }
    const finish = async (patch: Partial<StoredMarketplaceOrder>, outcome: OrderOutcome) => {
      await deps.store.settleOrder(id, { ...patch, updatedAtMs: deps.now() }, deps.now(), Object.keys(order.shipments ?? {}))
      return outcome
    }
    const connection = await deps.store.getConnection(order.connectionId)
    if (!connection || order.status !== 'imported') {
      return finish({ active: false, note: connection ? order.note : 'The marketplace was disconnected.' }, 'done')
    }
    if (connection.status !== 'active' || !(await deps.siteOpen(order.hostId))) {
      return finish({ nextRunAtMs: nowMs + ORDERS_POLL_MS }, 'waiting')
    }
    const app = deps.config().apps[connection.marketplace]
    if (!app) return finish({ nextRunAtMs: nowMs + RETRY_MAX_MS }, 'waiting')
    const provider = deps.provider(connection.marketplace)
    const name = label(connection)
    const settings = settingsOf(connection)
    const patch: Partial<StoredMarketplaceOrder> = {}
    let credential: MarketplaceCredential
    try {
      credential = await runCredential(order.connectionId, connection)
    } catch (error) {
      if (isProviderError(error) && error.kind === 'auth') {
        await deps.store.patchConnection(order.connectionId, { status: 'reconnect', lastError: message(error), updatedAtMs: nowMs })
      }
      return finish({ nextRunAtMs: nowMs + backoff(1) }, 'failed')
    }
    let retryAtMs: number | null = null
    const wait = (error: unknown, attempts: number) =>
      nowMs + (isProviderError(error) && error.kind === 'rate-limit' ? Math.max(error.retryAfterMs ?? 0, 60_000) : backoff(attempts))
    let authRefused: unknown = null

    if (!order.acknowledged && provider.acknowledgeOrder) {
      try {
        await provider.acknowledgeOrder(app, credential, {
          externalId: order.externalOrderId,
          displayRef: order.displayRef,
          state: 'unshipped',
          fulfilledByMarketplace: false,
          placedAtMs: order.createdAtMs,
          updatedAtMs: order.createdAtMs,
          currency: order.currency,
          lines: [],
          shippingMinor: 0,
          taxMinor: 0,
          discountMinor: 0,
          totalMinor: 0,
          fees: order.fees,
          buyerName: null,
          shipTo: null,
        })
        patch.acknowledged = true
      } catch (error) {
        if (isProviderError(error) && error.kind === 'auth') authRefused = error
        retryAtMs = wait(error, 1)
      }
    }

    const shipments = { ...(order.shipments ?? {}) }
    let confirmed = 0
    let failed = 0
    if (!authRefused) {
      for (const [fulfillmentId, shipment] of Object.entries(shipments)) {
        if (shipment.state !== 'pending') continue
        if (!settings.confirmShipments) continue
        if (!shipment.trackingNumber) {
          shipments[fulfillmentId] = {
            ...shipment,
            state: 'failed',
            message: `No tracking number. Confirm this shipment on ${name} by hand, or add one and send it again.`,
          }
          failed += 1
          continue
        }
        const byLine = new Map(order.lines.map((line) => [line.lineIndex, line.externalLineId]))
        const lines = shipment.lines
          .map((line) => ({ externalLineId: byLine.get(line.lineIndex) ?? '', quantity: line.quantity }))
          .filter((line) => line.externalLineId && line.quantity > 0)
        if (!lines.length) {
          shipments[fulfillmentId] = { ...shipment, state: 'failed', message: `None of its items came from ${name}.` }
          failed += 1
          continue
        }
        try {
          await provider.confirmShipment(app, credential, {
            externalOrderId: order.externalOrderId,
            lines,
            carrier: shipment.carrier,
            trackingNumber: shipment.trackingNumber,
            trackingUrl: shipment.trackingUrl,
            shippingCostMinor: shipment.shippingCostCents ?? null,
            shippedAtMs: shipment.atMs,
            reference: `${order.recordId}:${fulfillmentId}`.slice(0, 120),
          })
          shipments[fulfillmentId] = { ...shipment, state: 'confirmed', message: null, attempts: shipment.attempts + 1 }
          confirmed += 1
        } catch (error) {
          const attempts = shipment.attempts + 1
          if (isProviderError(error) && error.kind === 'auth') {
            authRefused = error
            break
          }
          const refused = isProviderError(error) && (error.kind === 'invalid' || error.kind === 'not-found')
          if (refused || attempts >= SHIPMENT_MAX_ATTEMPTS) {
            shipments[fulfillmentId] = { ...shipment, state: 'failed', message: message(error), attempts }
            failed += 1
          } else {
            shipments[fulfillmentId] = { ...shipment, message: message(error), attempts }
            retryAtMs = Math.min(retryAtMs ?? Infinity, wait(error, attempts))
          }
        }
      }
      patch.shipments = shipments
    }

    let fees = order.fees
    if (!authRefused && fees === null && provider.orderFees && nowMs < (order.feesFollowUntilMs ?? 0)) {
      try {
        const found = await provider.orderFees(app, credential, order.externalOrderId)
        if (found) {
          fees = found.map((fee) => ({ label: fee.label, amountMinor: fee.amountMinor }))
          patch.fees = fees
          await deps.channelOrders()?.recordFees({
            hostId: order.hostId,
            recordId: order.recordId,
            fees: fees.map((fee) => ({ label: fee.label, amountCents: fee.amountMinor })),
          })
        }
      } catch (error) {
        if (isProviderError(error) && error.kind === 'auth') authRefused = error
      }
    }

    if (confirmed || failed) {
      const fresh = await deps.store.getConnection(order.connectionId)
      if (fresh) {
        await deps.store.patchConnection(order.connectionId, {
          shipments: {
            confirmed: (fresh.shipments?.confirmed ?? 0) + confirmed,
            failed: (fresh.shipments?.failed ?? 0) + failed,
          },
        })
      }
      if (confirmed) await log(order.connectionId, 'shipment_confirmed', `Tracking sent to ${name} for order ${order.displayRef}`)
      if (failed) await log(order.connectionId, 'error', `A shipment of ${name} order ${order.displayRef} could not be confirmed there.`)
    }
    if (authRefused) {
      await deps.store.patchConnection(order.connectionId, { status: 'reconnect', lastError: message(authRefused), updatedAtMs: nowMs })
      return finish({ ...patch, nextRunAtMs: nowMs + ORDERS_POLL_MS }, 'failed')
    }

    const acknowledged = patch.acknowledged ?? order.acknowledged
    const pending = Object.values(shipments).some((shipment) => shipment.state === 'pending' && settings.confirmShipments)
    const followFees = fees === null && Boolean(provider.orderFees) && nowMs < (order.feesFollowUntilMs ?? 0)
    const active = !acknowledged || pending || followFees
    const next = Math.min(
      retryAtMs ?? Infinity,
      !acknowledged || pending ? (retryAtMs ?? nowMs + RETRY_BASE_MS) : Infinity,
      followFees ? nowMs + FEES_POLL_MS : Infinity,
    )
    return finish({ ...patch, active, nextRunAtMs: Number.isFinite(next) ? next : nowMs + FEES_POLL_MS }, active ? 'waiting' : 'done')
  }

  return { runConnection, runOrder }
}

export type Engine = ReturnType<typeof createEngine>
