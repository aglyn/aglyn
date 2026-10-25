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
  PosHardwareLine,
  PosHardwareOffer,
  PosHardwareOrderStatus,
  PosHardwareShippingMethod,
  PosHardwareTracking,
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
  ) {
    super(message)
  }
}

async function send<T>(
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
    throw new PosHardwareRequestError(String(payload?.error ?? 'Something went wrong'), response.status)
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
}

const SHOP = '/api/commerce/pos-hardware'

/** Leaves the console for Stripe Checkout, which returns to the card. */
export function openPosHardwareCheckout(url: string): void {
  window.location.assign(url)
}

export function posHardwareCatalog(user: User, hostId: string) {
  return send<PosHardwareCatalog>(user, SHOP, { method: 'POST', body: { action: 'catalog', hostId } })
}

export function posHardwareOrders(user: User, hostId: string) {
  return send<{ orders: PosHardwareOrderRow[] }>(user, SHOP, {
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
  return send<{ url: string; orderId: string }>(user, SHOP, {
    method: 'POST',
    body: { ...body, action: 'checkout' },
    attemptKey,
  })
}

/** An order as the staff page lists it. */
export interface StaffHardwareOrderRow extends Omit<PosHardwareOrderRow, 'shippingCents' | 'shippingLabel'> {
  orgId: string
  hostId: string
  contactEmail: string | null
  shipping: {
    method: PosHardwareShippingMethod
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
}

const STAFF = '/api/commerce/admin/hardware-orders'

export function staffHardwareOrders(user: User, status: PosHardwareOrderStatus | '', after: string | null = null) {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (after) params.set('after', after)
  const search = params.toString()
  return send<{ orders: StaffHardwareOrderRow[]; next: string | null; pageSize: number; canWrite: boolean }>(
    user,
    search ? `${STAFF}?${search}` : STAFF,
    { method: 'GET' },
  )
}

export function staffHardwareOrderAction(
  user: User,
  body: {
    action: 'update' | 'cancel' | 'refund'
    orgId: string
    orderId: string
    stripeHardwareOrderId?: string | null
    tracking?: { carrier: string; number: string; url?: string } | null
    status?: PosHardwareOrderStatus
  },
) {
  return send<{ ok: true; order: StaffHardwareOrderRow }>(user, STAFF, { method: 'POST', body })
}
