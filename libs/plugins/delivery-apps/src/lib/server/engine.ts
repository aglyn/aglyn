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
import type { PluginProductCatalog } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import {
  AUTO_COMPLETE_MS,
  CATALOG_MAX_OFFERS,
  LEASE_MS,
  MAX_ATTEMPTS,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  UNMATCHED_KEPT,
} from '../constants'
import type {
  DeliveryCatalogOption,
  DeliveryOrderAction,
  DeliveryPendingCall,
  DeliveryServiceId,
} from '../model/delivery-apps'
import { isProviderError } from '../providers/http'
import {
  incomingOrderProblem,
  menuItemId,
  readMenuItemId,
  type DeliveryEvent,
  type DeliveryProvider,
  type IncomingOrder,
  type Menu,
  type MenuItem,
  type OrderRef,
} from '../providers/provider'
import {
  itemKey,
  orderDocId,
  serviceLabel,
  storeDocId,
  type DeliveryStore,
  type StoredOrder,
  type StoredStore,
} from './store'

/**
 * The delivery-apps engine (AGL-3644): what happens to a service's order
 * between its webhook and the courier's pickup.
 *
 * ## The order and the store order are two records
 *
 * A service order is kept as it arrived (`deliveryAppOrders`), and becomes a
 * STORE order only when the counter accepts it: then it is recorded through
 * core's `core.channel-orders`, whose seller numbers it, takes its units off
 * the shelf in the same transaction as every other sale, and announces it. A
 * rejected order never touches stock. The store order is recorded BEFORE the
 * service is told yes, so the service never waits on food the store has no
 * record of; if the service then refuses the acceptance (the order expired
 * there), the store order is cancelled and its units go back.
 *
 * ## Once per service order
 *
 * The order's document id is the service and its order id, and creating it
 * refuses an existing one, so a retried webhook changes nothing. Each change
 * and refund the service sends is applied once, by its id. Every state change
 * is one transaction that reads the order first, and a worker holds a short
 * lease while it talks to the service, so two cashiers tapping Accept
 * together send one acceptance.
 *
 * ## No money moves here
 *
 * The buyer paid the service, and the service pays the merchant. A refund or
 * an item the service took off the order is RECORDED on the store order —
 * the units that never left go back on the shelf — and nothing is charged
 * or refunded by Aglyn.
 */

export interface EngineDeps {
  now(): number
  store: DeliveryStore
  /** The adapter for a service the deployment offers; `null` for one it does not. */
  provider(service: DeliveryServiceId): DeliveryProvider | null
  /** Whether the service's orders are test orders (its sandbox). */
  sandbox(service: DeliveryServiceId): boolean
  channelOrders(): PluginChannelOrders | null
  catalog(): PluginProductCatalog | undefined
  /** Whether the site may take orders now: entitled, the plugin and the seller on, not locked. */
  siteOpen(hostId: string): Promise<boolean>
}

export type WebhookOutcome =
  /** Every event was for a store connected here, and each was applied or already had been. */
  | { outcome: 'handled'; applied: number }
  /** An order's store is connected to no site here (or that site no longer takes orders). */
  | { outcome: 'unknown_store' }

export type ActionOutcome =
  | { outcome: 'done'; message: string | null }
  /** Refused for the merchant; `message` says why. */
  | { outcome: 'refused'; message: string }
  | { outcome: 'busy' }
  | { outcome: 'no_such_order' }

const OPEN = new Set(['new', 'accepted', 'ready'])

const backoff = (attempts: number) => Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1))

const providerMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 300) || 'The service did not answer'

/** Whether a failed call can succeed on a later attempt. */
const retryable = (error: unknown) =>
  !isProviderError(error) || error.kind === 'transient' || error.kind === 'rate-limit' || error.kind === 'auth'

/** A line's name as the store order keeps it: the item and its options. */
const lineName = (line: { name: string; options: string[] }) =>
  line.options.length ? `${line.name} (${line.options.join(', ')})`.slice(0, 200) : line.name

export function createEngine(deps: EngineDeps) {
  const ref = (order: StoredOrder): OrderRef => ({
    externalOrderId: order.externalOrderId,
    externalStoreId: order.externalStoreId,
    recordId: order.recordId,
  })

  async function findStore(service: DeliveryServiceId, storeIds: string[]) {
    for (const externalStoreId of storeIds) {
      const id = storeDocId(service, externalStoreId)
      const store = await deps.store.getStore(id)
      if (store) return { id, store }
    }
    return null
  }

  function storedOrder(service: DeliveryServiceId, storeId: string, store: StoredStore, order: IncomingOrder): StoredOrder {
    const nowMs = deps.now()
    return {
      orgId: store.orgId,
      hostId: store.hostId,
      service,
      storeId,
      externalOrderId: order.externalOrderId,
      externalStoreId: store.externalStoreId,
      externalRef: order.externalRef,
      status: 'new',
      active: true,
      handoff: order.handoff,
      placedAtMs: Math.min(order.placedAtMs, nowMs),
      pickupAtMs: order.pickupAtMs,
      customerName: order.customerName,
      instructions: order.instructions,
      currency: order.currency,
      lines: order.lines,
      subtotalCents: order.subtotalCents,
      taxCents: order.taxCents,
      discountCents: order.discountCents,
      totalCents: order.totalCents,
      refundedCents: 0,
      eventIds: [],
      recordId: null,
      displayRef: null,
      recordLines: [],
      oversold: 0,
      testMode: deps.sandbox(service),
      pending: null,
      error: null,
      nextRunAtMs: null,
      leaseUntilMs: null,
      readyAtMs: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    }
  }

  /** The product each line takes stock from: our menu's id, the merchant's match, or the id as a SKU. */
  function resolveLines(order: StoredOrder, store: StoredStore | null) {
    return order.lines.map((line) => {
      const ours = readMenuItemId(line.externalItemId)
      const matched = line.externalItemId ? store?.itemMatches?.[itemKey(line.externalItemId)] : undefined
      const place = ours ?? (matched ? { productId: matched.productId, variantId: matched.variantId } : null)
      return {
        externalLineId: line.externalLineId,
        sku: place ? null : line.externalItemId,
        ...(place ? { productId: place.productId, variantId: place.variantId } : {}),
        name: lineName(line),
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
      }
    })
  }

  /** Keeps the items no product matched, for the merchant to match in the store's settings. */
  async function noteUnmatched(storeId: string, order: StoredOrder, unmatched: number[]) {
    const items = unmatched.map((index) => order.lines[index]).filter((line) => line?.externalItemId)
    if (!items.length) return
    const nowMs = deps.now()
    await deps.store.updateStore(storeId, (store) => {
      const next = { ...(store.unmatched ?? {}) }
      for (const line of items) {
        const key = itemKey(String(line.externalItemId))
        if (store.itemMatches?.[key]) continue
        next[key] = { externalItemId: String(line.externalItemId), name: line.name, lastSeenAtMs: nowMs }
      }
      const kept = Object.entries(next)
        .sort(([, a], [, b]) => b.lastSeenAtMs - a.lastSeenAtMs)
        .slice(0, UNMATCHED_KEPT)
      return { unmatched: Object.fromEntries(kept), updatedAtMs: nowMs }
    })
  }

  /** Takes the order for one call to the service, or answers why not. */
  async function claim(
    id: string,
    allowed: (order: StoredOrder) => string | null,
    pending: DeliveryPendingCall | null,
    reason: string | null = null,
  ): Promise<{ order: StoredOrder } | ActionOutcome> {
    const nowMs = deps.now()
    let refusal: ActionOutcome | null = null
    const order = await deps.store.transitionOrder(id, (current) => {
      if ((current.leaseUntilMs ?? 0) > nowMs) {
        refusal = { outcome: 'busy' }
        return null
      }
      const problem = allowed(current)
      if (problem) {
        refusal = { outcome: 'refused', message: problem }
        return null
      }
      return {
        leaseUntilMs: nowMs + LEASE_MS,
        ...(pending
          ? {
              pending: {
                call: pending,
                attempts: current.pending?.call === pending ? current.pending.attempts : 0,
                reason: reason ?? (current.pending?.call === pending ? current.pending.reason : null),
              },
            }
          : {}),
        updatedAtMs: nowMs,
      }
    })
    if (order) return { order }
    return refusal ?? { outcome: 'no_such_order' }
  }

  /** A failed call: retried by the job while it can succeed, else left for staff with the service's words. */
  function failedCall(order: StoredOrder, call: DeliveryPendingCall, error: unknown): Partial<StoredOrder> {
    const nowMs = deps.now()
    const attempts = (order.pending?.call === call ? order.pending.attempts : 0) + 1
    const again = retryable(error) && attempts < MAX_ATTEMPTS
    return {
      pending: { call, attempts, reason: order.pending?.reason ?? null },
      error: providerMessage(error),
      nextRunAtMs: again ? nowMs + backoff(attempts) : null,
      leaseUntilMs: null,
      updatedAtMs: nowMs,
    }
  }

  /** Puts the store order's units back: the service will not have it after all. */
  async function cancelRecord(order: StoredOrder, reason: string) {
    if (!order.recordId) return
    const seller = deps.channelOrders()
    const outcome = await seller?.cancelOrder({ hostId: order.hostId, recordId: order.recordId, reason })
    if (outcome?.outcome === 'not_cancellable' && seller?.recordRefund) {
      // Already handed over: the service refunds its buyer, and the store records it.
      const owed = order.totalCents - order.refundedCents
      if (owed > 0) {
        await seller.recordRefund({
          hostId: order.hostId,
          recordId: order.recordId,
          refundId: `cancel:${order.externalOrderId}`,
          amountCents: owed,
          reason,
          restock: [],
        })
      }
    }
  }

  // ── Accept ──────────────────────────────────────────────────────────────

  async function accept(id: string): Promise<ActionOutcome> {
    const claimed = await claim(
      id,
      (order) =>
        order.status === 'new' || (order.status === 'accepted' && order.pending?.call === 'accept')
          ? null
          : `This order is ${order.status.replace('_', ' ')}.`,
      'accept',
    )
    if (!('order' in claimed)) return claimed
    let order = claimed.order
    const provider = deps.provider(order.service)
    const label = serviceLabel(order.service)
    const release = (patch: Partial<StoredOrder>) =>
      deps.store.transitionOrder(id, () => ({ ...patch, leaseUntilMs: null, updatedAtMs: deps.now() }))
    if (!provider) {
      await release({ error: `${label} is not available on this deployment.` })
      return { outcome: 'refused', message: `${label} is not available on this deployment.` }
    }

    // 1. The store order, once: its units come off the shelf here. Not for an
    // order the service cancelled since it was claimed.
    if (!order.recordId && (await deps.store.getOrder(id))?.status === 'cancelled') {
      await release({ pending: null })
      return { outcome: 'refused', message: `${label} canceled this order.` }
    }
    if (!order.recordId) {
      const seller = deps.channelOrders()
      if (!seller) {
        await release({ pending: null, error: 'The store cannot record orders right now.' })
        return { outcome: 'refused', message: 'The store cannot record orders right now.' }
      }
      const store = await deps.store.getStore(order.storeId)
      const imported = await seller.importOrder({
        hostId: order.hostId,
        channel: { id: order.service, label },
        externalOrderId: order.externalOrderId,
        externalRef: order.externalRef,
        placedAtMs: order.placedAtMs,
        currency: order.currency,
        lines: resolveLines(order, store),
        shippingCents: 0,
        taxCents: order.taxCents,
        discountCents: order.discountCents,
        totalCents: order.totalCents,
        fees: null,
        customerName: order.customerName,
        shippingAddress: null,
        testMode: order.testMode,
        handoff: 'courier',
      })
      if (imported.outcome === 'refused') {
        await release({ pending: null, error: imported.reason })
        return { outcome: 'refused', message: imported.reason }
      }
      const unmatched = imported.outcome === 'created' ? imported.unmatched : []
      const oversold = imported.outcome === 'created' ? imported.shortfalls.reduce((sum, entry) => sum + entry.short, 0) : 0
      const recorded = await deps.store.transitionOrder(id, (current) => ({
        recordId: imported.recordId,
        displayRef: imported.displayRef,
        recordLines: imported.lines,
        oversold,
        lines: current.lines.map((line, index) => ({ ...line, matched: !unmatched.includes(index) })),
        updatedAtMs: deps.now(),
      }))
      if (recorded) order = recorded
      if (unmatched.length) await noteUnmatched(order.storeId, order, unmatched)
    }

    // 2. Yes to the service.
    const prepMinutes = (await deps.store.getStore(order.storeId))?.settings.prepMinutes ?? 15
    try {
      await provider.accept(ref(order), prepMinutes, deps.now())
    } catch (error) {
      if (retryable(error)) {
        const failed = await deps.store.transitionOrder(id, (current) =>
          current.status === 'cancelled' ? { leaseUntilMs: null } : { status: 'accepted', ...failedCall(current, 'accept', error) },
        )
        if (failed?.status === 'cancelled') await cancelRecord(failed, `Canceled on ${label}`)
        return {
          outcome: 'done',
          message: `Accepted here. ${label} has not confirmed it yet; it is sent again automatically.`,
        }
      }
      // The service will not take it (it expired or was cancelled there): the units go back.
      const message = `${label} would not take the acceptance: ${providerMessage(error)}`
      const closed = await deps.store.transitionOrder(id, () => ({
        status: 'cancelled',
        active: false,
        pending: null,
        error: message,
        nextRunAtMs: null,
        leaseUntilMs: null,
        updatedAtMs: deps.now(),
      }))
      if (closed) await cancelRecord(closed, message)
      return { outcome: 'refused', message }
    }
    const done = await deps.store.transitionOrder(id, (current) =>
      current.status === 'cancelled'
        ? { pending: null, leaseUntilMs: null, updatedAtMs: deps.now() }
        : { status: 'accepted', pending: null, error: null, nextRunAtMs: null, leaseUntilMs: null, updatedAtMs: deps.now() },
    )
    // The service cancelled while the acceptance was on its way: the units go back.
    if (done?.status === 'cancelled') {
      await cancelRecord(done, `Canceled on ${label}`)
      return { outcome: 'refused', message: `${label} canceled this order.` }
    }
    return { outcome: 'done', message: null }
  }

  // ── Reject ──────────────────────────────────────────────────────────────

  async function reject(id: string, reason: string): Promise<ActionOutcome> {
    const why = reason.trim().slice(0, 200) || 'The store cannot make this order right now.'
    const claimed = await claim(
      id,
      (order) =>
        order.status === 'new' || (order.status === 'rejected' && order.pending?.call === 'reject')
          ? null
          : order.recordId
            ? 'This order is already accepted. Cancel it with the service instead.'
            : `This order is ${order.status.replace('_', ' ')}.`,
      'reject',
      why,
    )
    if (!('order' in claimed)) return claimed
    const order = claimed.order
    const provider = deps.provider(order.service)
    const label = serviceLabel(order.service)
    try {
      if (!provider) throw new Error(`${label} is not available on this deployment.`)
      await provider.reject(ref(order), order.pending?.reason ?? why)
    } catch (error) {
      if (retryable(error)) {
        await deps.store.transitionOrder(id, (current) =>
          current.status === 'cancelled'
            ? { leaseUntilMs: null }
            : { status: 'rejected', active: false, ...failedCall(current, 'reject', error) },
        )
        return { outcome: 'done', message: `Rejected here. ${label} has not confirmed it yet; it is sent again automatically.` }
      }
      // Gone on the service already: rejected is where it stands either way.
    }
    await deps.store.transitionOrder(id, (current) =>
      current.status === 'cancelled'
        ? { pending: null, leaseUntilMs: null }
        : {
            status: 'rejected',
            active: false,
            pending: null,
            error: null,
            nextRunAtMs: null,
            leaseUntilMs: null,
            updatedAtMs: deps.now(),
          },
    )
    return { outcome: 'done', message: null }
  }

  // ── Ready ───────────────────────────────────────────────────────────────

  async function ready(id: string): Promise<ActionOutcome> {
    const claimed = await claim(
      id,
      (order) =>
        (order.status === 'accepted' && order.pending?.call !== 'accept') ||
        (order.status === 'ready' && order.pending?.call === 'ready')
          ? null
          : order.status === 'accepted'
            ? 'The service has not confirmed the acceptance yet.'
            : `This order is ${order.status.replace('_', ' ')}.`,
      'ready',
    )
    if (!('order' in claimed)) return claimed
    const order = claimed.order
    const provider = deps.provider(order.service)
    const label = serviceLabel(order.service)
    const nowMs = deps.now()
    const readyFields = (current: StoredOrder): Partial<StoredOrder> => ({
      status: 'ready',
      readyAtMs: current.readyAtMs ?? nowMs,
    })
    try {
      if (provider?.ready) await provider.ready(ref(order))
    } catch (error) {
      if (retryable(error)) {
        await deps.store.transitionOrder(id, (current) =>
          current.status === 'cancelled' ? { leaseUntilMs: null } : { ...readyFields(current), ...failedCall(current, 'ready', error) },
        )
        return { outcome: 'done', message: `Marked ready here. ${label} has not confirmed it yet; it is sent again automatically.` }
      }
      await deps.store.transitionOrder(id, (current) =>
        current.status === 'cancelled'
          ? { leaseUntilMs: null }
          : {
              ...readyFields(current),
              pending: null,
              error: `${label} did not take "ready": ${providerMessage(error)}`,
              nextRunAtMs: (current.readyAtMs ?? nowMs) + AUTO_COMPLETE_MS,
              leaseUntilMs: null,
              updatedAtMs: deps.now(),
            },
      )
      return { outcome: 'done', message: `Marked ready here. ${label} did not take it: ${providerMessage(error)}` }
    }
    await deps.store.transitionOrder(id, (current) =>
      current.status === 'cancelled'
        ? { leaseUntilMs: null }
        : {
            ...readyFields(current),
            pending: null,
            error: null,
            // Closed as picked up if nobody says so first: the courier has long since taken it.
            nextRunAtMs: (current.readyAtMs ?? nowMs) + AUTO_COMPLETE_MS,
            leaseUntilMs: null,
            updatedAtMs: deps.now(),
          },
    )
    return { outcome: 'done', message: null }
  }

  // ── Picked up ───────────────────────────────────────────────────────────

  async function pickedUp(id: string): Promise<ActionOutcome> {
    const claimed = await claim(
      id,
      (order) =>
        order.status === 'ready' || (order.status === 'accepted' && order.pending?.call !== 'accept')
          ? null
          : `This order is ${order.status.replace('_', ' ')}.`,
      null,
    )
    if (!('order' in claimed)) return claimed
    const order = claimed.order
    const label = serviceLabel(order.service)
    const seller = deps.channelOrders()
    if (order.recordId && seller?.completeOrder) {
      const outcome = await seller.completeOrder({
        hostId: order.hostId,
        recordId: order.recordId,
        note: order.handoff === 'customer' ? `Collected by the ${label} customer` : `Picked up by the ${label} courier`,
      })
      if (outcome.outcome === 'not_completable') {
        const message = `The store order is ${outcome.status}, so it cannot be marked picked up.`
        await deps.store.transitionOrder(id, () => ({ error: message, nextRunAtMs: null, leaseUntilMs: null, updatedAtMs: deps.now() }))
        return { outcome: 'refused', message }
      }
    }
    await deps.store.transitionOrder(id, (current) =>
      current.status === 'cancelled'
        ? { leaseUntilMs: null }
        : {
            status: 'picked_up',
            active: false,
            pending: null,
            error: null,
            nextRunAtMs: null,
            leaseUntilMs: null,
            updatedAtMs: deps.now(),
          },
    )
    return { outcome: 'done', message: null }
  }

  /** Runs whatever call the order still owes the service. */
  async function retry(id: string): Promise<ActionOutcome> {
    const order = await deps.store.getOrder(id)
    if (!order) return { outcome: 'no_such_order' }
    switch (order.pending?.call) {
      case 'accept':
        return accept(id)
      case 'reject':
        return reject(id, order.pending.reason ?? '')
      case 'ready':
        return ready(id)
      default:
        return { outcome: 'refused', message: 'Nothing is waiting to be sent for this order.' }
    }
  }

  // ── The service's events ────────────────────────────────────────────────

  async function created(service: DeliveryServiceId, incoming: IncomingOrder): Promise<WebhookOutcome> {
    const problem = incomingOrderProblem(incoming)
    if (problem) {
      console.warn(`[delivery-apps] ${service} order not read: ${problem}`)
      return { outcome: 'handled', applied: 0 }
    }
    const found = await findStore(service, incoming.storeIds)
    if (!found || !(await deps.siteOpen(found.store.hostId))) return { outcome: 'unknown_store' }
    const id = orderDocId(service, incoming.externalOrderId)
    const fresh = await deps.store.createOrder(id, storedOrder(service, found.id, found.store, incoming))
    if (fresh && found.store.settings.autoAccept) {
      // A failed auto-accept leaves the order new on the register, its reason shown.
      await accept(id).catch((error) => console.error('[delivery-apps] auto-accept failed', id, error))
    }
    return { outcome: 'handled', applied: fresh ? 1 : 0 }
  }

  async function updated(service: DeliveryServiceId, eventId: string, incoming: IncomingOrder): Promise<WebhookOutcome> {
    const id = orderDocId(service, incoming.externalOrderId)
    const order = await deps.store.getOrder(id)
    if (!order) return created(service, incoming)
    if (order.eventIds.includes(eventId) || incomingOrderProblem(incoming)) return { outcome: 'handled', applied: 0 }
    const label = serviceLabel(service)
    // What the change took off: units no longer on the order, and the money.
    const now = new Map(incoming.lines.map((line) => [line.externalLineId, line.quantity]))
    const removed = order.lines
      .map((line) => ({ line, gone: line.quantity - Math.min(line.quantity, now.get(line.externalLineId) ?? 0) }))
      .filter((entry) => entry.gone > 0)
    const amount = Math.max(0, order.totalCents - incoming.totalCents)
    let refundedCents: number | null = null
    if (order.recordId && (amount > 0 || removed.length)) {
      const seller = deps.channelOrders()
      const handedOver = order.status === 'picked_up'
      const restock = handedOver
        ? []
        : removed.flatMap(({ line, gone }) => {
            const recorded = order.recordLines.find((entry) => entry.externalLineId === line.externalLineId)
            return recorded ? [{ lineIndex: recorded.lineIndex, quantity: gone }] : []
          })
      const names = removed.map(({ line, gone }) => `${gone} × ${line.name}`).join(', ')
      const outcome = await seller?.recordRefund?.({
        hostId: order.hostId,
        recordId: order.recordId,
        refundId: eventId,
        amountCents: amount,
        reason: names ? `${label} took ${names} off the order` : `${label} changed the order`,
        restock,
      })
      if (outcome?.outcome === 'recorded') refundedCents = outcome.refundedCents
    }
    await deps.store.transitionOrder(id, (current) =>
      current.eventIds.includes(eventId)
        ? null
        : {
            lines: incoming.lines.map((line) => ({
              ...line,
              matched: current.lines.find((entry) => entry.externalLineId === line.externalLineId)?.matched ?? true,
            })),
            subtotalCents: incoming.subtotalCents,
            taxCents: incoming.taxCents,
            discountCents: incoming.discountCents,
            totalCents: incoming.totalCents,
            refundedCents: refundedCents ?? current.refundedCents,
            eventIds: [...current.eventIds, eventId].slice(-50),
            updatedAtMs: deps.now(),
          },
    )
    return { outcome: 'handled', applied: 1 }
  }

  async function cancelled(service: DeliveryServiceId, externalOrderId: string, reason: string): Promise<WebhookOutcome> {
    const id = orderDocId(service, externalOrderId)
    // Closed first, so an acceptance on its way sees it and puts the units back.
    let wasOpen = false
    const order = await deps.store.transitionOrder(id, (current) => {
      if (!OPEN.has(current.status)) return null
      wasOpen = true
      return {
        status: 'cancelled',
        active: false,
        pending: null,
        error: reason,
        nextRunAtMs: null,
        updatedAtMs: deps.now(),
      }
    })
    if (!order || !wasOpen) return { outcome: 'handled', applied: 0 }
    // An acceptance mid-flight that records its store order after this sees
    // the order cancelled and cancels that one itself; a second cancel of
    // the same store order answers `already`.
    if (order.recordId) await cancelRecord(order, reason)
    return { outcome: 'handled', applied: 1 }
  }

  async function refunded(
    service: DeliveryServiceId,
    event: Extract<DeliveryEvent, { kind: 'refunded' }>,
  ): Promise<WebhookOutcome> {
    const id = orderDocId(service, event.externalOrderId)
    const order = await deps.store.getOrder(id)
    if (!order || order.eventIds.includes(event.refundId)) return { outcome: 'handled', applied: 0 }
    let refundedCents: number | null = null
    if (order.recordId) {
      const outcome = await deps.channelOrders()?.recordRefund?.({
        hostId: order.hostId,
        recordId: order.recordId,
        refundId: event.refundId,
        amountCents: event.amountCents,
        reason: event.reason,
        restock: [],
      })
      if (outcome?.outcome === 'recorded') refundedCents = outcome.refundedCents
    }
    await deps.store.transitionOrder(id, (current) =>
      current.eventIds.includes(event.refundId)
        ? null
        : {
            // The store order's own figure once it has one; before, what the service said, bounded by the order.
            refundedCents:
              refundedCents ?? (current.recordId ? current.refundedCents : Math.min(current.totalCents, current.refundedCents + event.amountCents)),
            eventIds: [...current.eventIds, event.refundId].slice(-50),
            updatedAtMs: deps.now(),
          },
    )
    return { outcome: 'handled', applied: 1 }
  }

  return {
    /** Applies a verified webhook's events, in order. */
    async handleEvents(service: DeliveryServiceId, events: DeliveryEvent[]): Promise<WebhookOutcome> {
      let applied = 0
      for (const event of events) {
        let outcome: WebhookOutcome
        switch (event.kind) {
          case 'created':
            outcome = await created(service, event.order)
            break
          case 'updated':
            outcome = await updated(service, event.eventId, event.order)
            break
          case 'cancelled':
            outcome = await cancelled(service, event.externalOrderId, event.reason)
            break
          case 'refunded':
            outcome = await refunded(service, event)
            break
          default:
            outcome = { outcome: 'handled', applied: 0 }
        }
        if (outcome.outcome === 'unknown_store') return outcome
        applied += outcome.applied
      }
      return { outcome: 'handled', applied }
    },

    /** A cashier's action on one order, the route having checked who asks and for which site. */
    async act(id: string, action: DeliveryOrderAction, options: { reason?: string } = {}): Promise<ActionOutcome> {
      switch (action) {
        case 'accept':
          return accept(id)
        case 'reject':
          return reject(id, options.reason ?? '')
        case 'ready':
          return ready(id)
        case 'picked_up':
          return pickedUp(id)
        case 'retry':
          return retry(id)
      }
    },

    /** The job's look at one order: a call still owed, or a ready order to close. */
    async runDue(id: string): Promise<'retried' | 'completed' | 'skipped'> {
      const order = await deps.store.getOrder(id)
      if (!order || order.nextRunAtMs === null || order.nextRunAtMs > deps.now()) return 'skipped'
      if (!(await deps.siteOpen(order.hostId))) {
        // A site that stopped taking orders keeps them as they are; nothing is sent for it.
        await deps.store.transitionOrder(id, () => ({ nextRunAtMs: null }))
        return 'skipped'
      }
      if (order.pending) {
        await retry(id)
        return 'retried'
      }
      if (order.status === 'ready') {
        await pickedUp(id)
        return 'completed'
      }
      await deps.store.transitionOrder(id, () => ({ nextRunAtMs: null }))
      return 'skipped'
    },

    /** Sends the store's menu, built from the catalog, to the service. */
    async publishMenu(storeId: string): Promise<{ ok: true; items: number } | { ok: false; message: string }> {
      const store = await deps.store.getStore(storeId)
      if (!store) return { ok: false, message: 'That store is not connected.' }
      const provider = deps.provider(store.service)
      const label = serviceLabel(store.service)
      if (!provider) return { ok: false, message: `${label} is not available on this deployment.` }
      const catalog = deps.catalog()
      const shop = await catalog?.store(store.hostId)
      if (!catalog || !shop) return { ok: false, message: 'This site has no store to build a menu from.' }
      const categories = new Map<string, MenuItem[]>()
      let cursor: string | null = null
      let read = 0
      do {
        const page = await catalog.page({ hostId: store.hostId, cursor, limit: 250 })
        for (const offer of page.offers) {
          read += 1
          if (offer.kind !== 'physical' || offer.subscriptionOnly) continue
          const category = (offer.productType ?? '').split('>').pop()?.trim() || 'Menu'
          const items = categories.get(category) ?? []
          items.push({
            externalItemId: menuItemId(offer.productId, offer.variantId),
            name: offer.title.slice(0, 120),
            description: offer.description.slice(0, 500),
            priceCents: offer.salePriceMinor ?? offer.priceMinor,
            imageUrl: offer.imageUrl ?? null,
            available: offer.availability !== 'out_of_stock',
          })
          categories.set(category, items)
        }
        cursor = page.nextCursor
      } while (cursor && read < CATALOG_MAX_OFFERS)
      const items = [...categories.values()].reduce((sum, list) => sum + list.length, 0)
      if (!items) return { ok: false, message: 'The store has no products to put on a menu.' }
      const menu: Menu = {
        name: shop.name.slice(0, 80) || 'Menu',
        currency: shop.currency,
        categories: [...categories.entries()].map(([name, list], index) => ({ id: `aglyn-category-${index + 1}`, name, items: list })),
      }
      const nowMs = deps.now()
      try {
        await provider.publishMenu(store.externalStoreId, menu)
      } catch (error) {
        const message = `${label} did not take the menu: ${providerMessage(error)}`
        await deps.store.updateStore(storeId, (current) => ({ menu: { ...current.menu, error: message }, updatedAtMs: nowMs }))
        return { ok: false, message }
      }
      await deps.store.updateStore(storeId, () => ({ menu: { publishedAtMs: nowMs, items, error: null }, updatedAtMs: nowMs }))
      return { ok: true, items }
    },

    /** Offers whose name or SKU holds `query`, read through the whole catalog, for matching an item. */
    async searchCatalog(hostId: string, query: string): Promise<DeliveryCatalogOption[]> {
      const catalog = deps.catalog()
      if (!catalog) return []
      const wanted = query.trim().toLowerCase()
      const found: DeliveryCatalogOption[] = []
      let cursor: string | null = null
      let read = 0
      do {
        const page = await catalog.page({ hostId, cursor, limit: 250 })
        for (const offer of page.offers) {
          read += 1
          if (offer.kind !== 'physical') continue
          if (wanted && !offer.title.toLowerCase().includes(wanted) && !(offer.sku ?? '').toLowerCase().includes(wanted)) continue
          found.push({ productId: offer.productId, variantId: offer.variantId, title: offer.title, sku: offer.sku ?? null })
          if (found.length >= 20) return found
        }
        cursor = page.nextCursor
      } while (cursor && read < CATALOG_MAX_OFFERS)
      return found
    },
  }
}

export type Engine = ReturnType<typeof createEngine>
