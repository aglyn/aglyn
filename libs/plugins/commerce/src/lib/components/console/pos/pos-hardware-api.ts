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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import type {
  PosHardwareAttachment,
  PosHardwareLine,
  PosHardwareOffer,
  PosHardwareOrderShippingMethod,
  PosHardwareOrderSource,
  PosHardwareOrderStatus,
  PosHardwarePaidTo,
  PosHardwareRefund,
  PosHardwareRegisterSale,
  PosHardwareReturnRequest,
  PosHardwareShippingMethod,
  PosHardwareTracking,
  PosHardwareUnit,
} from '../../../model/pos-hardware'

/*
 * The POS hardware shop's client half (AGL-4038): the Hardware card's calls
 * and the staff page's, so neither component builds a request by hand.
 */

type User = Parameters<typeof authorizedFetch>[0]

export class PosHardwareRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The route's `reason`, when it names a step the caller takes next. */
    readonly reason?: string,
  ) {
    super(message)
  }
}

/** One request to a hardware route, refused with the route's own words. */
export async function sendPosHardwareRequest<T>(
  user: User,
  url: string,
  init: { method: 'GET' | 'POST'; body?: unknown; attemptKey?: string },
): Promise<T> {
  const response = await authorizedFetch(user, url, {
    method: init.method,
    headers: {
      ...(init.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      ...(init.attemptKey ? { 'Idempotency-Key': init.attemptKey } : {}),
    },
    ...(init.method === 'POST' ? { body: JSON.stringify(init.body ?? {}) } : {}),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new PosHardwareRequestError(
      String(payload?.error ?? 'Something went wrong'),
      response.status,
      typeof payload?.reason === 'string' ? payload.reason : undefined,
    )
  }
  return payload as T
}

export type PosHardwareCatalog =
  | { available: false }
  | {
      available: true
      offers: PosHardwareOffer[]
      shipping: Array<{ method: PosHardwareShippingMethod; label: string; cents: number }>
      automaticTax: boolean
      shipCountries: string[]
    }

/** An order as the Hardware card lists it. */
export interface PosHardwareOrderRow {
  id: string
  number: string
  status: PosHardwareOrderStatus
  lines: PosHardwareLine[]
  subtotalCents: number
  shippingCents: number
  shippingLabel: string
  taxCents: number
  totalCents: number
  tracking: PosHardwareTracking | null
  createdAtMs: number
  updatedAtMs: number
  /** Bought in person at the platform's own store (AGL-4038), and its readers still to set up. */
  source?: PosHardwareOrderSource
  discountCents?: number
  readersToSetUp?: number
  refundedCents?: number
  returnRequest?: { state: PosHardwareReturnRequest['state']; requestedAtMs: number; note: string | null } | null
}

const SHOP = '/api/commerce/pos-hardware'

/** Leaves the console for Stripe Checkout, which returns to the card. */
export function openPosHardwareCheckout(url: string): void {
  window.location.assign(url)
}

export function posHardwareCatalog(user: User, hostId: string) {
  return sendPosHardwareRequest<PosHardwareCatalog>(user, SHOP, { method: 'POST', body: { action: 'catalog', hostId } })
}

export function posHardwareOrders(user: User, hostId: string) {
  return sendPosHardwareRequest<{ orders: PosHardwareOrderRow[] }>(user, SHOP, {
    method: 'POST',
    body: { action: 'orders', hostId },
  })
}

export function posHardwareCheckout(
  user: User,
  attemptKey: string,
  body: {
    hostId: string
    lines: Array<{ sku: string; quantity: number }>
    shippingMethod: PosHardwareShippingMethod
  },
) {
  return sendPosHardwareRequest<{ url: string; orderId: string }>(user, SHOP, {
    method: 'POST',
    body: { ...body, action: 'checkout' },
    attemptKey,
  })
}

/** A reader the workspace bought in person, waiting to be set up (AGL-4038). */
export interface WaitingReaderOrder extends PosHardwareOrderRow {
  /** The store it is for; empty while the buyer has still to choose. */
  hostId: string
  /** Readers whose serial was taken at the sale: they set themselves up. */
  serialsTaken: number
}

export interface WaitingReaders {
  posPlan: boolean
  stores: Array<{ hostId: string; name: string; hasLocation: boolean; setupUrl: string }>
  orders: WaitingReaderOrder[]
}

export function posHardwareWaiting(user: User, hostId: string) {
  return sendPosHardwareRequest<WaitingReaders>(user, SHOP, { method: 'POST', body: { action: 'waiting', hostId } })
}

/** Chooses the store (`hostId`) a reader bought in person is for. */
export function posHardwareChooseStore(user: User, hostId: string, orderId: string) {
  return sendPosHardwareRequest<{ ok: true; order: PosHardwareOrderRow }>(user, SHOP, {
    method: 'POST',
    body: { action: 'choose-store', hostId, orderId },
  })
}

export function posHardwareMarkSetUp(user: User, hostId: string, orderId: string) {
  return sendPosHardwareRequest<{ ok: true; order: PosHardwareOrderRow }>(user, SHOP, {
    method: 'POST',
    body: { action: 'mark-set-up', hostId, orderId },
  })
}

/** An order as the staff page lists it. */
export interface StaffHardwareOrderRow extends Omit<PosHardwareOrderRow, 'shippingCents' | 'shippingLabel'> {
  orgId: string
  hostId: string
  contactEmail: string | null
  shipping: {
    method: PosHardwareOrderShippingMethod
    label: string
    cents: number
    name: string | null
    phone: string | null
    address: {
      line1: string
      line2?: string
      city: string
      state?: string
      postalCode: string
      country: string
    } | null
    /** What an account erasure left of the address: where tax is sourced. */
    taxRegion?: { country: string; state: string | null; postalCode: string | null } | null
  } | null
  stripeCheckoutSessionId: string | null
  stripePaymentIntentId: string | null
  stripeHardwareOrderId: string | null
  livemode: boolean
  refundPending: boolean
  /** Sold in person at the platform's own store (AGL-4038), and what that sale says. */
  source: PosHardwareOrderSource
  discountCents: number
  posSale: PosHardwareRegisterSale | null
  paidTo: PosHardwarePaidTo | null
  attachment: PosHardwareAttachment | null
  units: PosHardwareUnit[]
  refundedCents: number
  refunds: PosHardwareRefund[]
  returnRequest: PosHardwareReturnRequest | null
}

const STAFF = '/api/commerce/admin/hardware-orders'

/** The staff list's filter: one status, every order, or the in-person sales still to attach. */
export type StaffHardwareFilter = PosHardwareOrderStatus | '' | 'to-attach' | 'returns'

export function staffHardwareOrders(user: User, filter: StaffHardwareFilter, after: string | null = null) {
  const params = new URLSearchParams()
  if (filter === 'to-attach') params.set('attach', 'pending')
  else if (filter === 'returns') params.set('returns', 'requested')
  else if (filter) params.set('status', filter)
  if (after) params.set('after', after)
  const search = params.toString()
  return sendPosHardwareRequest<{ orders: StaffHardwareOrderRow[]; next: string | null; pageSize: number; canWrite: boolean }>(
    user,
    search ? `${STAFF}?${search}` : STAFF,
    { method: 'GET' },
  )
}

export function staffHardwareOrderAction(
  user: User,
  body: {
    action: 'update' | 'cancel' | 'refund' | 'forget-buyer' | 'decline-return'
    note?: string
    orgId: string
    orderId: string
    stripeHardwareOrderId?: string | null
    tracking?: { carrier: string; number: string; url?: string } | null
    status?: PosHardwareOrderStatus
    /** A cancel or a refund: email the buyer about it (AGL-4038). */
    notifyBuyer?: boolean
  },
) {
  return sendPosHardwareRequest<{
    ok: true
    order: StaffHardwareOrderRow
    /** A cancel or a refund: what became of the buyer's email, `off` when staff chose none. */
    buyerEmail?: 'sent' | 'already' | 'skipped' | 'failed' | 'off'
  }>(user, STAFF, { method: 'POST', body })
}

/** Asks to return a card reader bought in person, with the reason (AGL-4038). */
export function posHardwareRequestReturn(user: User, hostId: string, orderId: string, reason: string) {
  return sendPosHardwareRequest<{ ok: true; order: PosHardwareOrderRow }>(user, SHOP, {
    method: 'POST',
    body: { action: 'request-return', hostId, orderId, reason },
  })
}
