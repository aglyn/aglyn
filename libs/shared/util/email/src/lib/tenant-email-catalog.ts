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
    control: 'fixed',
  },
  {
    key: 'sale-notification',
    name: 'New sale',
    description: 'Notifies the seller when an order is placed.',
    pluginId: 'commerce',
    plugin: 'Commerce',
    control: 'fixed',
  },
  {
    key: 'reservation-confirmed',
    name: 'Reservation confirmed',
    description: 'Confirms a paid reservation to the customer.',
    pluginId: 'commerce',
    plugin: 'Commerce',
    control: 'fixed',
  },
  {
    key: 'gift-card',
    name: 'Gift card delivery',
    description: 'Delivers a purchased gift card to its recipient.',
    pluginId: 'commerce',
    plugin: 'Commerce',
    control: 'fixed',
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
