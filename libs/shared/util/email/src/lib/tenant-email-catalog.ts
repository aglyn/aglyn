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

import type {
  SystemEmailDefaultBlock,
  SystemEmailMergeToken,
} from './system-email-catalog'

/**
 * How a site owner controls a tenant email's copy (AGL-769/770):
 *
 * `besigner` — designable here, per site, in the email besigner. The send
 *   site resolves the designed template and falls back to built-in copy.
 * `external` — already authored in another part of the console (a marketing
 *   campaign, a workflow), so the reference links there instead of offering a
 *   second editor.
 * `fixed` — fixed copy inside the plugin, not customizable yet. Listed for
 *   visibility; becomes `besigner` once its send site is wired.
 */
export type TenantEmailControl = 'besigner' | 'external' | 'fixed'

export interface TenantEmailEntry {
  /** Stable key — the `hosts/{hostId}/emailTemplates` document id. */
  key: string
  name: string
  description: string
  /** Plugin that owns the send (matches org.enabledPlugins). */
  pluginId: string
  plugin: string
  control: TenantEmailControl
  /** `external`: where the copy is authored, shown as the link/label. */
  authoredIn?: string
  /** `besigner`: subject used when no template is published. */
  defaultSubject?: string
  /** `besigner`: tokens the send site supplies. */
  mergeTokens?: readonly SystemEmailMergeToken[]
  /** `besigner`: starting content the editor seeds and the default renders. */
  defaultBody?: readonly SystemEmailDefaultBlock[]
  /**
   * Entitlement flag the SEND is gated on, when one is (AGL-2081).
   *
   * `enabledPlugins` decides whether a template appears at all; this is the
   * narrower question of whether the send behind an appearing template can
   * actually happen. `abandoned-cart` is the case that named it: the template
   * has always been listed and designable on every plan, while
   * `process-abandoned.ts` refuses to send it without `abandonedCart` — so
   * the Emails page showed a template that could never send, and read
   * exactly like one that could.
   *
   * A plain string rather than `keyof OrgFeatureFlags` to keep this lib off
   * the billing lib's dependency edge; the console resolves it through
   * `checkEntitlement`, and a spec asserts every value here is a real flag.
   */
  requiresFeature?: string
}

/**
 * The transactional emails a SITE sends to its own end-users (AGL-769/770).
 *
 * Distinct from the platform system emails (mail Aglyn sends about the
 * account). These are tenant-owned: a site sends them to its customers. Flat
 * list keyed for the host-scoped template store and the `renderHostEmail`
 * resolver; the console UI groups by `pluginId`. Code-defined and fixed — the
 * set is whatever the plugins actually send.
 */
export const TENANT_EMAILS: readonly TenantEmailEntry[] = [
  // ── Bookings ──────────────────────────────────────────────────────────
  {
    key: 'booking-confirmed',
    name: 'Booking confirmed',
    description: 'Confirms a booking to the customer, for paid and free services.',
    pluginId: 'bookings',
    plugin: 'Bookings',
    control: 'besigner',
    defaultSubject: 'Booking confirmed: {{service.name}}',
    mergeTokens: [
      { name: 'name', description: "The customer's name", sample: 'Alex' },
      {
        name: 'service.name',
        description: 'The booked service',
        sample: 'Consultation',
      },
      {
        name: 'when',
        description: 'Formatted date and time of the booking',
        sample: 'Monday, June 1, 2026 at 9:00 AM',
      },
      {
        name: 'timezone',
        description: 'Timezone the time is shown in',
        sample: 'UTC',
      },
      {
        name: 'booking.ref',
        description: 'Booking reference id',
        sample: 'bk_123',
      },
    ],
    defaultBody: [
      { block: 'text', text: 'Booking confirmed', variant: 'heading' },
      {
        block: 'text',
        text:
          'Hi {{name}}, your booking for "{{service.name}}" is confirmed for ' +
          '{{when}} ({{timezone}}).',
        variant: 'body',
      },
      { block: 'text', text: 'Reference: {{booking.ref}}', variant: 'caption' },
    ],
  },
  {
    key: 'booking-reminder',
    name: 'Booking reminder',
    description: 'Reminds the customer of an upcoming booking.',
    pluginId: 'bookings',
    plugin: 'Bookings',
    control: 'besigner',
    defaultSubject: 'Reminder: {{service.name}} is coming up',
    mergeTokens: [
      { name: 'name', description: "The customer's name", sample: 'Alex' },
      {
        name: 'service.name',
        description: 'The booked service',
        sample: 'Consultation',
      },
      {
        name: 'when',
        description: 'Formatted date and time of the booking',
        sample: 'Tomorrow at 9:00 AM',
      },
    ],
    defaultBody: [
      {
        block: 'text',
        text:
          'Hi {{name}}, this is a reminder that "{{service.name}}" is ' +
          'coming up on {{when}}.',
        variant: 'body',
      },
    ],
  },
  // ── Commerce (fixed for now; flips to `besigner` when the send site is
  //    wired to renderHostEmail — AGL-770) ────────────────────────────────
  {
    key: 'order-receipt',
    name: 'Order receipt',
    description: 'Sent to the buyer after a successful order or checkout.',
    pluginId: 'commerce',
    plugin: 'Commerce',
    control: 'besigner',
    defaultSubject: 'Receipt for your order',
    mergeTokens: [
      {
        name: 'order.summary',
        description: 'The ordered items, one per line (with any license/download links)',
        sample: 'House Blend × 2 — $24.00',
      },
      {
        name: 'order.total',
        description: 'Order total',
        sample: '$24.00',
      },
      {
        name: 'order.ref',
        description: 'Order reference id',
        sample: 'cs_test_123',
      },
    ],
    defaultBody: [
      { block: 'text', text: 'Thanks for your purchase!', variant: 'heading' },
      { block: 'text', text: '{{order.summary}}', variant: 'body' },
      { block: 'text', text: 'Total: {{order.total}}', variant: 'body' },
      {
        block: 'text',
        text: 'Order reference: {{order.ref}}',
        variant: 'caption',
      },
    ],
  },
  {
    key: 'sale-notification',
    name: 'New sale',
    description: 'Notifies the seller when an order is placed.',
    pluginId: 'commerce',
    plugin: 'Commerce',
    control: 'besigner',
    defaultSubject: 'New order on {{site.name}}',
    mergeTokens: [
      {
        name: 'site.name',
        description: 'The site the sale happened on',
        sample: 'Northwind Coffee',
      },
      {
        name: 'order.summary',
        description: 'The ordered items',
        sample: 'House Blend — $12.00',
      },
      { name: 'order.total', description: 'Order total', sample: '$12.00' },
      {
        name: 'buyer.email',
        description: "The buyer's email",
        sample: 'buyer@example.com',
      },
      {
        name: 'order.ref',
        description: 'Order reference id',
        sample: 'cs_test_123',
      },
    ],
    defaultBody: [
      { block: 'text', text: 'You made a sale', variant: 'heading' },
      {
        block: 'text',
        text: 'A new order came in on {{site.name}}.',
        variant: 'body',
      },
      { block: 'text', text: '{{order.summary}}', variant: 'body' },
      { block: 'text', text: 'Total: {{order.total}}', variant: 'body' },
      {
        block: 'text',
        text: 'Buyer: {{buyer.email}} · Order {{order.ref}}',
        variant: 'caption',
      },
    ],
  },
  {
    key: 'reservation-confirmed',
    name: 'Reservation confirmed',
    description: 'Confirms a paid reservation to the customer.',
    pluginId: 'commerce',
    plugin: 'Commerce',
    control: 'besigner',
    defaultSubject: 'Reservation confirmed',
    mergeTokens: [
      {
        name: 'reservation.checkIn',
        description: 'Check-in date',
        sample: 'Mon, 01 Jun 2026',
      },
      {
        name: 'reservation.nights',
        description: 'Number of nights',
        sample: '2',
      },
      {
        name: 'reservation.paid',
        description: 'Amount paid today',
        sample: '$240.00',
      },
      {
        name: 'reservation.ref',
        description: 'Reservation reference id',
        sample: 'resv_123',
      },
    ],
    defaultBody: [
      { block: 'text', text: 'Reservation confirmed', variant: 'heading' },
      { block: 'text', text: 'Your stay is confirmed!', variant: 'body' },
      {
        block: 'text',
        text: 'Check-in: {{reservation.checkIn}}',
        variant: 'body',
      },
      { block: 'text', text: 'Nights: {{reservation.nights}}', variant: 'body' },
      {
        block: 'text',
        text: 'Paid today: {{reservation.paid}}',
        variant: 'body',
      },
      {
        block: 'text',
        text: 'Reference: {{reservation.ref}}',
        variant: 'caption',
      },
    ],
  },
  {
    key: 'gift-card',
    name: 'Gift card delivery',
    description: 'Delivers a purchased gift card to its recipient.',
    pluginId: 'commerce',
    plugin: 'Commerce',
    control: 'besigner',
    defaultSubject: 'Your gift card',
    mergeTokens: [
      {
        name: 'giftcard.code',
        description: 'The gift card code',
        sample: 'GC-ABC123DEF456',
      },
      {
        name: 'giftcard.value',
        description: 'The gift card value',
        sample: '$25.00',
      },
    ],
    defaultBody: [
      { block: 'text', text: 'Your gift card', variant: 'heading' },
      {
        block: 'text',
        text: 'Gift card code: {{giftcard.code}}',
        variant: 'body',
      },
      { block: 'text', text: 'Value: {{giftcard.value}}', variant: 'body' },
      {
        block: 'text',
        text: 'Enter it at checkout to apply the balance.',
        variant: 'body',
      },
    ],
  },
  {
    key: 'supplier-fulfillment',
    name: 'Supplier fulfillment',
    description: 'Tells a dropship supplier there is a new order to fulfill.',
    pluginId: 'commerce',
    plugin: 'Commerce',
    control: 'fixed',
  },
  {
    key: 'back-in-stock',
    name: 'Back in stock',
    description: 'Tells a customer a product they watched is available again.',
    pluginId: 'commerce',
    plugin: 'Commerce',
    control: 'besigner',
    defaultSubject: 'Back in stock: {{product.name}}',
    mergeTokens: [
      {
        name: 'product.name',
        description: 'The product that restocked',
        sample: 'House Blend',
      },
      {
        name: 'product.url',
        description: 'Link to the product page',
        sample: '/products/house-blend',
      },
    ],
    defaultBody: [
      {
        block: 'text',
        text:
          '{{product.name}} is available again — grab it before it sells out.',
        variant: 'body',
      },
      { block: 'button', label: 'View product', href: '{{product.url}}' },
    ],
  },
  {
    key: 'abandoned-cart',
    name: 'Abandoned cart',
    description: 'Reminds a shopper of items left in their cart.',
    // The cron refuses to send this without the entitlement
    // (`process-abandoned.ts:92`), so the console has to say so (AGL-2081).
    requiresFeature: 'abandonedCart',
    pluginId: 'commerce',
    plugin: 'Commerce',
    control: 'besigner',
    defaultSubject: 'You left something in your cart',
    mergeTokens: [
      {
        name: 'cart.url',
        description: 'Link back to the shopper cart',
        sample: 'https://shop.example.com/cart',
      },
    ],
    defaultBody: [
      {
        block: 'text',
        text: 'Your cart is still waiting — pick up where you left off.',
        variant: 'body',
      },
      { block: 'button', label: 'Return to cart', href: '{{cart.url}}' },
      {
        block: 'text',
        text:
          'Your items are held but not reserved, so they may sell out.',
        variant: 'caption',
      },
    ],
  },
  {
    key: 'member-post',
    name: 'New member post',
    description: 'Notifies members when new members-only content is posted.',
    pluginId: 'commerce',
    plugin: 'Commerce',
    control: 'fixed',
  },
  {
    key: 'member-password-reset',
    name: 'Member password reset',
    description:
      "Resets a site member's password — a store-member account, separate " +
      'from an Aglyn login.',
    pluginId: 'commerce',
    plugin: 'Commerce',
    control: 'fixed',
  },
  // ── Marketing / Workflows (authored in their own UIs) ──────────────────
  {
    key: 'campaign',
    name: 'Campaign broadcast',
    description: "A campaign sent to the site's subscriber list.",
    pluginId: 'marketing',
    plugin: 'Marketing',
    control: 'external',
    authoredIn: 'Marketing → Campaigns',
  },
  {
    key: 'workflow-email',
    name: 'Workflow email step',
    description:
      "An email sent by a workflow's send-email action when its trigger " +
      'fires.',
    pluginId: 'workflows',
    plugin: 'Workflows',
    control: 'external',
    authoredIn: 'the workflow that sends it',
  },
]

/** Firestore subcollection under a host holding its designed templates. */
export const TENANT_EMAIL_COLLECTION = 'emailTemplates'

export function getTenantEmail(key: string): TenantEmailEntry | undefined {
  return TENANT_EMAILS.find((entry) => entry.key === key)
}

/** True when a site owner can design this email in the besigner. */
export function isTenantEmailEditable(entry: TenantEmailEntry): boolean {
  return entry.control === 'besigner'
}
