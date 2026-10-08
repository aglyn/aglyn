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

/**
 * What a store tells its buyer, and when (AGL-3610).
 *
 * Each moment in an order's life sends the buyer one message: the receipt,
 * each shipment, delivery, each refund and a cancellation — and, for an
 * order collected or brought by the store (AGL-3624), ready for pickup,
 * picked up and out for delivery. A store
 * turns any of them off on `hosts/{hostId}/settings/store.buyerNotifications`
 * — and ONLY off: every moment is ON unless an explicit `false` is stored,
 * because transaction messages are on by default for every store, existing
 * and new (the 2026-10-06 decision AGL-3600 implemented for the owner's own
 * notices). An absent map, an absent key and a malformed value all read as
 * on, so a schema slip can never silence a store's receipts.
 *
 * `texts` is the channel switch rather than a moment: when the platform can
 * send texts and the order carries the buyer's phone number, each moment that
 * is on also goes by text unless the store turned texts off.
 */
export const BUYER_NOTIFICATION_EVENTS = [
  'receipt',
  'shipped',
  'delivered',
  'refunded',
  'cancelled',
  // Pickup and the store's own delivery (AGL-3624).
  'ready_for_pickup',
  'picked_up',
  'out_for_delivery',
] as const

export type BuyerNotificationEvent = (typeof BUYER_NOTIFICATION_EVENTS)[number]

export type BuyerNotificationChannel = 'email' | 'sms'

export type BuyerNotificationSettings = Partial<
  Record<BuyerNotificationEvent | 'texts', boolean>
>

/** The designable email each moment sends: keys in `tenant-emails.ts`. */
export const BUYER_NOTIFICATION_EMAIL_KEYS: Readonly<
  Record<BuyerNotificationEvent, string>
> = {
  receipt: 'order-receipt',
  shipped: 'order-shipped',
  delivered: 'order-delivered',
  refunded: 'order-refunded',
  cancelled: 'order-cancelled',
  ready_for_pickup: 'order-ready-for-pickup',
  picked_up: 'order-picked-up',
  out_for_delivery: 'order-out-for-delivery',
}

/** How the store settings card names each moment. */
export const BUYER_NOTIFICATION_LABELS: Readonly<
  Record<BuyerNotificationEvent, { label: string; description: string }>
> = {
  receipt: {
    label: 'Order receipt',
    description:
      'When an order is paid: online, from a payment link, or at the register when the customer gives an email.',
  },
  shipped: {
    label: 'Order shipped',
    description:
      'Each time you ship part or all of an order, with the carrier and tracking link.',
  },
  delivered: {
    label: 'Order delivered',
    description: 'When you mark an order delivered.',
  },
  refunded: {
    label: 'Refund issued',
    description: 'Each refund, with the amount and any items you named.',
  },
  cancelled: {
    label: 'Order canceled',
    description: 'When you cancel an order.',
  },
  ready_for_pickup: {
    label: 'Ready for pickup',
    description: 'When you mark a pickup order ready, with where to collect it and the pickup hours.',
  },
  picked_up: {
    label: 'Order picked up',
    description: 'When a pickup order is collected.',
  },
  out_for_delivery: {
    label: 'Out for delivery',
    description: 'When your own driver sets out with a local delivery order.',
  },
}

/** Whether a moment (or the `texts` channel) is on. Only `false` is off. */
export function buyerNotificationEnabled(
  settings: unknown,
  key: BuyerNotificationEvent | 'texts',
): boolean {
  if (!settings || typeof settings !== 'object') return true
  return (settings as Record<string, unknown>)[key] !== false
}

/**
 * The idempotency key for one message: which moment, which occurrence of it
 * (a shipment id, a refund id; `order` for the once-per-order moments) and
 * which channel. Stored as a field name under `buyerNotifications` on the
 * order, so it is restricted to characters a Firestore field path takes
 * without quoting.
 */
export function buyerNotificationMarker(
  event: BuyerNotificationEvent,
  occurrence: string,
  channel: BuyerNotificationChannel,
): string {
  const safe = (value: string) =>
    String(value || 'order')
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 120)
  return `${event}__${safe(occurrence)}__${channel}`
}

/**
 * Formats integer cents in the store's currency. Falls back to a plain dollar
 * figure for a currency code `Intl` does not know, rather than throwing on a
 * stored typo.
 */
export function formatOrderMoney(cents: number, currency = 'USD'): string {
  const amount = (Number(cents) || 0) / 100
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: String(currency || 'USD').toUpperCase(),
    }).format(amount)
  } catch {
    return `$${amount.toFixed(2)}`
  }
}
