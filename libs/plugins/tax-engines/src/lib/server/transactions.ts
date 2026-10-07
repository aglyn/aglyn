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

import type { PluginDomainEventEnvelope } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { createHash } from 'node:crypto'
import { taxDocumentDate } from '../model/tax-engines'
import { TaxProviderError } from '../providers/http'
import type { TaxCommitRequest } from '../providers/types'
import { taxProviderFor } from './config'
import { documentLines, shipFromOf, shipToOf, TaxEngineUnavailableError, usableConnection } from './engine'
import {
  exemptionFor,
  normalizeEmail,
  readStoredTransaction,
  taxEnginesDb,
  transactionRef,
  type StoredTaxEngineTransaction,
} from './store'

/**
 * Recording sales with the engine, and reversing them (AGL-3631).
 *
 * The seller announces what happened to an order as domain events — commerce
 * raises `order.paid`, `order.refunded` and `order.cancelled` from every door
 * that changes one, through an outbox that retries a subscriber that throws.
 * This plugin subscribes, so a checkout, a POS sale, a payment link, a refund
 * from the order dialog and a return all reach the engine the same way, and
 * the seller never learns that anything was recorded.
 *
 * An order is recorded when it carries a `taxEngine` stamp: the seller asked
 * the engine for its tax, or meant to and fell back. A store on any other tax
 * path is never sent, and neither is a site whose merchant switched recording
 * off.
 *
 * ## Idempotent, keyed by the order
 *
 * `taxEngineTransactions/{hostId}__{orderId}` is the record. A paid event for
 * an order already `committed` does nothing; one still `pending` is sent
 * again, and the engine's own idempotency (AvaTax `createoradjust` by code,
 * TaxJar create-then-update by id) makes the repeat harmless. A refund is
 * keyed by Stripe's refund id and filed once.
 *
 * ## What a failure does
 *
 * A failure a retry might cure — the network, a timeout, a 429, a 5xx —
 * THROWS, so the outbox delivers again with backoff. A refusal (bad
 * credentials, an address the engine rejects) will not cure itself: it is
 * recorded as `failed` with the engine's sentence, shown on the order, and a
 * person retries from there once they fix it. So does the last of the
 * outbox's attempts.
 */

/** The outbox's attempts per subscriber (`PLUGIN_EVENT_MAX_ATTEMPTS`). */
const LAST_ATTEMPT = 8

/** The order as commerce's events carry it: the public API's shape. */
export interface PaidOrderView {
  id: string
  channel?: string
  currency?: string
  customerEmail?: string | null
  lineItems?: unknown
  totals?: {
    itemsCents?: number
    shippingCents?: number
    taxCents?: number
    discountCents?: number
    totalCents?: number | null
  }
  shippingAddress?: Record<string, unknown> | null
  taxEngine?: { provider?: string; status?: string; reason?: string | null } | null
}

/**
 * The code a sale is filed under at the engine: the order id, or — for an id
 * longer than AvaTax's 50 characters, which a Checkout Session's is — its
 * head with a hash of the whole, so two orders never share a code.
 */
export function saleCode(orderId: string): string {
  if (orderId.length <= 50) return orderId
  const hash = createHash('sha256').update(orderId).digest('base64url').slice(0, 12)
  return `${orderId.slice(0, 37)}-${hash}`
}

/** A refund's code: stable for one refund, distinct from the sale's. */
export function refundCode(orderId: string, refundKey: string): string {
  const hash = createHash('sha256').update(`${orderId}\n${refundKey}`).digest('base64url').slice(0, 12)
  return `${orderId.slice(0, 32)}-R-${hash}`
}

function errorText(error: unknown): string {
  return String((error as Error)?.message ?? error).slice(0, 300)
}

/** Whether a failure is worth the outbox delivering again. */
function isTransient(error: unknown): boolean {
  return error instanceof TaxProviderError ? error.transient : !(error instanceof TaxEngineUnavailableError)
}

/** The document a paid order is recorded as. */
export async function saleFromOrder(
  hostId: string,
  order: PaidOrderView,
  occurredAtMs: number,
): Promise<{ sale: TaxCommitRequest; provider: StoredTaxEngineTransaction['provider'] }> {
  const { connection } = await usableConnection(hostId)
  const shipFrom = shipFromOf(connection)
  const shipTo = shipToOf(shipFrom, String(order.channel ?? 'online'), order.shippingAddress ?? null)
  const items = (Array.isArray(order.lineItems) ? order.lineItems : []) as Array<Record<string, any>>
  const lines = await documentLines(
    hostId,
    connection,
    items.map((item, index) => ({
      id: String(index),
      productId: item.productId ? String(item.productId) : undefined,
      sku: item.sku ? String(item.sku) : undefined,
      description: [item.name, item.variantLabel].filter(Boolean).join(' — ') || undefined,
      quantity: Number(item.quantity) || 1,
      amountCents: Math.round(Number(item.unitAmountCents) || 0) * Math.max(1, Math.round(Number(item.quantity) || 1)),
    })),
    Number(order.totals?.discountCents ?? 0),
  )
  const email = normalizeEmail(order.customerEmail)
  const exemption = await exemptionFor(hostId, email, shipTo.region)
  return {
    provider: connection.provider,
    sale: {
      code: saleCode(order.id),
      date: taxDocumentDate(occurredAtMs),
      currency: String(order.currency || 'usd').toUpperCase(),
      customerCode: email || 'guest',
      shipFrom,
      shipTo,
      lines,
      shippingCents: Math.max(0, Math.round(Number(order.totals?.shippingCents ?? 0))),
      collectedTaxCents: Math.max(0, Math.round(Number(order.totals?.taxCents ?? 0))),
      ...(exemption ? { exemption: { type: exemption.type, certificateNumber: exemption.certificateNumber } } : {}),
    },
  }
}

/** Sends a stored sale to the engine and records the verdict. Throws only a transient failure. */
export async function commitStoredSale(
  hostId: string,
  orderId: string,
  options: { lastAttempt?: boolean } = {},
): Promise<StoredTaxEngineTransaction | null> {
  const ref = transactionRef(hostId, orderId)
  const stored = readStoredTransaction((await ref.get()).data())
  if (!stored || stored.status === 'committed' || stored.status === 'voided') return stored
  try {
    const { connection, credentials } = await usableConnection(hostId)
    await taxProviderFor(connection.provider).commit(credentials, stored.sale)
    const committed = { status: 'committed' as const, lastError: null, updatedAtMs: Date.now() }
    await ref.set(committed, { merge: true })
    return { ...stored, ...committed }
  } catch (error) {
    const retry = isTransient(error) && !options.lastAttempt
    const verdict = {
      status: retry ? ('pending' as const) : ('failed' as const),
      lastError: errorText(error),
      updatedAtMs: Date.now(),
    }
    await ref.set(verdict, { merge: true })
    console.warn(`[tax-engines] order ${orderId} on ${hostId} not recorded: ${verdict.lastError}`)
    if (retry) throw error
    return { ...stored, ...verdict }
  }
}

/** `order.paid`: record the sale. */
export async function onOrderPaid(
  envelope: PluginDomainEventEnvelope<{ order: PaidOrderView }>,
): Promise<void> {
  const order = envelope.payload?.order
  if (!order?.id || !order.taxEngine) return
  const hostId = envelope.hostId
  const ref = transactionRef(hostId, order.id)
  const existing = readStoredTransaction((await ref.get()).data())
  if (!existing) {
    let built: Awaited<ReturnType<typeof saleFromOrder>>
    let connection: Awaited<ReturnType<typeof usableConnection>>['connection']
    try {
      connection = (await usableConnection(hostId)).connection
      if (!connection.recordTransactions) return
      built = await saleFromOrder(hostId, order, envelope.occurredAtMs)
    } catch (error) {
      // No connection, or one with no usable ship-from: nothing to record
      // with, and a redelivery would not change that.
      if (error instanceof TaxEngineUnavailableError) {
        console.warn(`[tax-engines] order ${order.id} on ${hostId} not recorded: ${errorText(error)}`)
        return
      }
      throw error
    }
    const now = Date.now()
    await taxEnginesDb().runTransaction(async (transaction) => {
      const current = await transaction.get(ref)
      if (current.exists) return
      transaction.set(ref, {
        orgId: envelope.orgId ?? connection.orgId,
        hostId,
        orderId: order.id,
        provider: built.provider,
        status: 'pending',
        sale: built.sale,
        refunds: {},
        attempts: 0,
        // Whether checkout charged the service's tax or fell back to the
        // store's own rates; the record shows the merchant which.
        fallbackReason:
          order.taxEngine?.status === 'fallback' ? String(order.taxEngine.reason || 'error') : null,
        lastError: null,
        createdAtMs: now,
        updatedAtMs: now,
      })
    })
  }
  await ref.set({ attempts: envelope.attempt, updatedAtMs: Date.now() }, { merge: true })
  await commitStoredSale(hostId, order.id, { lastAttempt: envelope.attempt >= LAST_ATTEMPT })
}

/** `order.refunded`: reverse what this refund moved. */
export async function onOrderRefunded(
  envelope: PluginDomainEventEnvelope<{
    order: PaidOrderView
    refund?: { id?: string | null; amountCents?: number; full?: boolean }
  }>,
): Promise<void> {
  const order = envelope.payload?.order
  const refund = envelope.payload?.refund
  if (!order?.id || !refund) return
  const hostId = envelope.hostId
  const ref = transactionRef(hostId, order.id)
  const stored = readStoredTransaction((await ref.get()).data())
  if (!stored || stored.status === 'voided' || stored.status === 'failed') return
  if (stored.status === 'pending') {
    // The sale is still on its way to the engine. A refund filed before it
    // lands would be refused, so wait for the next delivery.
    if (envelope.attempt >= LAST_ATTEMPT) return
    throw new Error(`order ${order.id} is not yet recorded with the tax service`)
  }
  const key = String(refund.id || envelope.id)
  if (stored.refunds[key]) return
  const sale = stored.sale
  const saleTotalCents =
    sale.lines.reduce((sum, line) => sum + Math.max(0, line.amountCents - line.discountCents), 0) +
    sale.shippingCents +
    sale.collectedTaxCents
  const amountCents = Math.max(0, Math.round(Number(refund.amountCents) || 0))
  const alreadyCents = Object.values(stored.refunds).reduce((sum, entry) => sum + entry.amountCents, 0)
  const full = refund.full === true || (saleTotalCents > 0 && alreadyCents + amountCents >= saleTotalCents)
  const fraction = full ? 1 : saleTotalCents > 0 ? amountCents / saleTotalCents : 0
  if (!(fraction > 0)) return
  try {
    const { connection, credentials } = await usableConnection(hostId)
    await taxProviderFor(connection.provider).refund(credentials, {
      orderCode: sale.code,
      refundCode: refundCode(order.id, key),
      date: taxDocumentDate(envelope.occurredAtMs),
      // A full refund after partial ones reverses only what is left.
      full: full && alreadyCents === 0,
      fraction: full && alreadyCents > 0 ? Math.max(0, 1 - alreadyCents / saleTotalCents) : fraction,
      sale,
    })
  } catch (error) {
    if (isTransient(error) && envelope.attempt < LAST_ATTEMPT) throw error
    await ref.set({ lastError: errorText(error), updatedAtMs: Date.now() }, { merge: true })
    console.warn(`[tax-engines] refund ${key} of ${order.id} on ${hostId} not recorded: ${errorText(error)}`)
    return
  }
  await ref.set(
    {
      refunds: { [key]: { amountCents, full, atMs: envelope.occurredAtMs } },
      lastError: null,
      updatedAtMs: Date.now(),
    },
    { merge: true },
  )
}

/** `order.cancelled`: void a recorded sale nothing was refunded on. */
export async function onOrderCancelled(
  envelope: PluginDomainEventEnvelope<{ order: PaidOrderView }>,
): Promise<void> {
  const order = envelope.payload?.order
  if (!order?.id) return
  const hostId = envelope.hostId
  const ref = transactionRef(hostId, order.id)
  const stored = readStoredTransaction((await ref.get()).data())
  if (!stored || stored.status !== 'committed') return
  // A cancellation that refunded the money raises `order.refunded` too, and
  // that refund already reversed the sale; voiding it as well would reverse
  // it twice.
  if (Object.keys(stored.refunds).length > 0) return
  try {
    const { connection, credentials } = await usableConnection(hostId)
    await taxProviderFor(connection.provider).void(credentials, stored.sale)
  } catch (error) {
    if (isTransient(error) && envelope.attempt < LAST_ATTEMPT) throw error
    await ref.set({ lastError: errorText(error), updatedAtMs: Date.now() }, { merge: true })
    return
  }
  await ref.set({ status: 'voided', lastError: null, updatedAtMs: Date.now() }, { merge: true })
}

