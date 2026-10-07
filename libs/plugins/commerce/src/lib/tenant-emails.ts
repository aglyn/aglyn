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

import type { TenantEmailEntry } from '@aglyn/shared-util-email'

/** The human order number every buyer order email names (AGL-3610). */
const ORDER_NUMBER_TOKEN = {
  name: 'order.number',
  description: 'The order number, as the store shows it',
  sample: '#1042',
} as const

/**
 * The buyer's private order-status page (AGL-3610): a signed link, so it
 * opens without an account and only for this order.
 */
const ORDER_STATUS_URL_TOKEN = {
  name: 'order.statusUrl',
  description:
    'Link to the order status page: status, shipments and tracking. Private ' +
    'to the buyer; it needs no account',
  sample: 'https://shop.example.com/order-status?o=ord_123&t=…',
} as const

const ORDER_FOOTER_REASON =
  'You’re receiving this because you placed an order with {{host.businessName}}.'

/**
 * The emails a site sends its own customers through Commerce (AGL-769/770).
 *
 * Declared here, by the plugin that sends them, and compiled into the
 * platform's tenant email catalog (`TENANT_EMAILS` in
 * `@aglyn/shared-util-email`) by `tools/scripts/generate-plugin-manifests.mjs`
 * (AGL-3080): the catalog's readers include the send path, which loads no
 * plugin code, so a runtime registry it had not filled would quietly send
 * the text card in place of the site's designed email. Regenerate after
 * changing an entry; `--check` refuses a stale catalog.
 *
 * Most commerce sends are designable in the email besigner; a `fixed` entry
 * flips to `besigner` when its send site is wired to `renderHostEmail`
 * (AGL-770).
 */
export function commerceTenantEmails(): readonly TenantEmailEntry[] {
  return [
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
        {
          name: 'store.receiptFooter',
          description:
            'The Receipt footer from the store settings; empty when none is set',
          sample: 'Returns are accepted within 30 days.',
        },
        ORDER_NUMBER_TOKEN,
        ORDER_STATUS_URL_TOKEN,
      ],
      defaultBody: [
        { block: 'text', text: 'Thanks for your purchase!', variant: 'heading' },
        {
          block: 'text',
          text: 'Here is the receipt for your order from {{host.businessName}}.',
          variant: 'body',
        },
        { block: 'text', text: '{{order.summary}}', variant: 'body' },
        { block: 'text', text: 'Total charged: {{order.total}}', variant: 'body' },
        { block: 'text', text: '{{store.receiptFooter}}', variant: 'body' },
        { block: 'button', label: 'View your order', href: '{{order.statusUrl}}' },
        {
          block: 'text',
          text: 'Order reference: {{order.ref}}',
          variant: 'caption',
        },
      ],
      footerReason: ORDER_FOOTER_REASON,
    },
    {
      key: 'order-shipped',
      name: 'Order shipped',
      description:
        'Tells the buyer part or all of their order is on its way, with the ' +
        'carrier and a tracking link when the shipment has one. Sent once per ' +
        'shipment.',
      pluginId: 'commerce',
      plugin: 'Commerce',
      control: 'besigner',
      defaultSubject: 'Your order {{order.number}} has shipped',
      mergeTokens: [
        ORDER_NUMBER_TOKEN,
        {
          name: 'shipment.summary',
          description: 'The items in this shipment, one per line',
          sample: '2× House Blend',
        },
        {
          name: 'shipment.carrier',
          description: 'The carrier; empty when none was recorded',
          sample: 'UPS',
        },
        {
          name: 'shipment.trackingNumber',
          description: 'The tracking number; empty when none was recorded',
          sample: '1Z999AA10123456784',
        },
        {
          name: 'shipment.tracking',
          description:
            'A sentence with the carrier, tracking number and tracking link; ' +
            'empty when the shipment has no tracking number',
          sample:
            'Tracking: UPS 1Z999AA10123456784 — https://www.ups.com/track?tracknum=1Z999AA10123456784',
        },
        {
          name: 'shipment.remaining',
          description:
            'A sentence saying how many items are still to ship; empty when ' +
            'this shipment completes the order',
          sample: '1 more item will ship separately.',
        },
        ORDER_STATUS_URL_TOKEN,
      ],
      defaultBody: [
        { block: 'text', text: 'Your order is on its way', variant: 'heading' },
        {
          block: 'text',
          text: '{{host.businessName}} shipped items from order {{order.number}}.',
          variant: 'body',
        },
        { block: 'text', text: '{{shipment.summary}}', variant: 'body' },
        { block: 'text', text: '{{shipment.tracking}}', variant: 'body' },
        { block: 'text', text: '{{shipment.remaining}}', variant: 'body' },
        { block: 'button', label: 'Track your order', href: '{{order.statusUrl}}' },
      ],
      footerReason: ORDER_FOOTER_REASON,
    },
    {
      key: 'order-delivered',
      name: 'Order delivered',
      description: 'Tells the buyer their order was marked delivered.',
      pluginId: 'commerce',
      plugin: 'Commerce',
      control: 'besigner',
      defaultSubject: 'Your order {{order.number}} was delivered',
      mergeTokens: [
        ORDER_NUMBER_TOKEN,
        {
          name: 'order.summary',
          description: 'The ordered items, one per line',
          sample: '2× House Blend',
        },
        ORDER_STATUS_URL_TOKEN,
      ],
      defaultBody: [
        { block: 'text', text: 'Your order was delivered', variant: 'heading' },
        {
          block: 'text',
          text:
            '{{host.businessName}} marked order {{order.number}} as delivered.',
          variant: 'body',
        },
        { block: 'text', text: '{{order.summary}}', variant: 'body' },
        { block: 'button', label: 'View your order', href: '{{order.statusUrl}}' },
        {
          block: 'text',
          text:
            'If something is missing or not right, reply to this email or ' +
            'contact {{host.businessName}}.',
          variant: 'caption',
        },
      ],
      footerReason: ORDER_FOOTER_REASON,
    },
    {
      key: 'order-refunded',
      name: 'Order refunded',
      description:
        'Tells the buyer a refund was issued, for how much and, when the ' +
        'store refunded named items, which ones. Sent once per refund.',
      pluginId: 'commerce',
      plugin: 'Commerce',
      control: 'besigner',
      defaultSubject: 'Refund for your order {{order.number}}',
      mergeTokens: [
        ORDER_NUMBER_TOKEN,
        {
          name: 'refund.amount',
          description: 'The amount of this refund',
          sample: '$12.00',
        },
        {
          name: 'refund.summary',
          description:
            'The refunded items, one per line; empty when the refund was by ' +
            'amount only',
          sample: '1× House Blend',
        },
        {
          name: 'refund.note',
          description:
            'Whether the order is now fully refunded, as a sentence',
          sample: 'Your order has been refunded in full.',
        },
        ORDER_STATUS_URL_TOKEN,
      ],
      defaultBody: [
        { block: 'text', text: 'Your refund is on its way', variant: 'heading' },
        {
          block: 'text',
          text:
            '{{host.businessName}} refunded {{refund.amount}} on order ' +
            '{{order.number}}.',
          variant: 'body',
        },
        { block: 'text', text: '{{refund.summary}}', variant: 'body' },
        { block: 'text', text: '{{refund.note}}', variant: 'body' },
        {
          block: 'text',
          text:
            'Refunds go back to the original payment method and usually ' +
            'appear within 5 to 10 business days, depending on your bank.',
          variant: 'caption',
        },
        { block: 'button', label: 'View your order', href: '{{order.statusUrl}}' },
      ],
      footerReason: ORDER_FOOTER_REASON,
    },
    {
      key: 'order-cancelled',
      name: 'Order canceled',
      description: 'Tells the buyer their order was canceled.',
      pluginId: 'commerce',
      plugin: 'Commerce',
      control: 'besigner',
      defaultSubject: 'Your order {{order.number}} was canceled',
      mergeTokens: [
        ORDER_NUMBER_TOKEN,
        {
          name: 'order.summary',
          description: 'The ordered items, one per line',
          sample: '2× House Blend',
        },
        {
          name: 'cancel.note',
          description:
            'What happens to the payment, as a sentence; empty when nothing ' +
            'was paid',
          sample:
            'Any payment you made will be refunded, and you will get a ' +
            'separate email when it is.',
        },
        ORDER_STATUS_URL_TOKEN,
      ],
      defaultBody: [
        { block: 'text', text: 'Your order was canceled', variant: 'heading' },
        {
          block: 'text',
          text: '{{host.businessName}} canceled order {{order.number}}.',
          variant: 'body',
        },
        { block: 'text', text: '{{order.summary}}', variant: 'body' },
        { block: 'text', text: '{{cancel.note}}', variant: 'body' },
        { block: 'button', label: 'View your order', href: '{{order.statusUrl}}' },
      ],
      footerReason: ORDER_FOOTER_REASON,
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
      footerReason:
        'You’re receiving this because you manage {{host.businessName}}.',
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
          description:
            'What the guest was charged today, lodging tax included; a ' +
            'charge that carried lodging tax names it, as in “$254.40, ' +
            'including $14.40 lodging tax”',
          sample: '$240.00',
        },
        {
          name: 'reservation.balance',
          description:
            'What is still owed for the stay and where it is paid, as a ' +
            'sentence; empty when the stay is paid in full',
          sample: 'Still to pay: $360.00, at the property. It has not been charged.',
        },
        {
          name: 'reservation.ref',
          description: 'Reservation reference id',
          sample: 'resv_123',
        },
      ],
      defaultBody: [
        { block: 'text', text: 'Reservation confirmed', variant: 'heading' },
        {
          block: 'text',
          text: 'Your stay at {{host.businessName}} is confirmed.',
          variant: 'body',
        },
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
        { block: 'text', text: '{{reservation.balance}}', variant: 'body' },
        {
          block: 'text',
          text: 'Reference: {{reservation.ref}}',
          variant: 'caption',
        },
      ],
      footerReason:
        'You’re receiving this because you made a reservation with {{host.businessName}}.',
    },
    {
      key: 'gift-card',
      name: 'Gift card delivery',
      description: 'Delivers a purchased gift card to its recipient.',
      pluginId: 'commerce',
      plugin: 'Commerce',
      control: 'besigner',
      defaultSubject: 'Your gift card for {{host.businessName}}',
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
        {
          name: 'giftcard.note',
          description:
            'The note written when the card was issued by hand; empty for a ' +
            'card bought at checkout',
          sample: 'Happy birthday, Sam!',
        },
      ],
      defaultBody: [
        { block: 'text', text: 'Your gift card', variant: 'heading' },
        {
          block: 'text',
          text: 'You have a {{giftcard.value}} gift card for {{host.businessName}}.',
          variant: 'body',
        },
        { block: 'text', text: '{{giftcard.note}}', variant: 'body' },
        {
          block: 'text',
          text: 'Gift card code: {{giftcard.code}}',
          variant: 'body',
        },
        {
          block: 'text',
          text: 'Enter the code at checkout on {{host.url}} to use its balance.',
          variant: 'body',
        },
        {
          block: 'button',
          label: 'Visit {{host.businessName}}',
          href: '{{host.url}}',
        },
      ],
      footerReason:
        'You’re receiving this because a gift card from {{host.businessName}} was sent to this address.',
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
          sample: 'https://shop.example.com/products/house-blend',
        },
      ],
      defaultBody: [
        {
          block: 'text',
          text: '{{product.name}} is back in stock at {{host.businessName}}.',
          variant: 'body',
        },
        { block: 'button', label: 'View product', href: '{{product.url}}' },
      ],
      footerReason:
        'You’re receiving this because you asked {{host.businessName}} to tell you when this was back.',
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
          text:
            'You left items in your cart at {{host.businessName}}. Pick up ' +
            'where you left off.',
          variant: 'body',
        },
        { block: 'button', label: 'Return to cart', href: '{{cart.url}}' },
        {
          block: 'text',
          text: 'Nothing in your cart is held for you.',
          variant: 'caption',
        },
      ],
      footerReason:
        'You’re receiving this because you started a checkout with {{host.businessName}}.',
    },
    {
      key: 'member-post',
      name: 'New member post',
      description: 'Notifies members when new members-only content is posted.',
      pluginId: 'commerce',
      plugin: 'Commerce',
      control: 'besigner',
      defaultSubject: '{{post.title}}',
      mergeTokens: [
        { name: 'post.title', description: 'The post’s title', sample: 'This month in the studio' },
        {
          name: 'post.body',
          description: 'The post, as its author wrote it',
          sample: 'Three new pieces are up for members first.',
        },
      ],
      defaultBody: [
        { block: 'text', text: '{{post.title}}', variant: 'heading' },
        { block: 'text', text: '{{post.body}}', variant: 'body' },
      ],
      footerReason: 'You’re receiving this because you’re a member of {{host.businessName}}.',
    },
    {
      key: 'member-password-reset',
      name: 'Member password reset',
      description:
        "Resets a site member's password — a store-member account, separate " +
        'from a console login. Sent when the member asks, and when a site ' +
        'administrator starts a reset for them.',
      pluginId: 'commerce',
      plugin: 'Commerce',
      control: 'besigner',
      defaultSubject: 'Reset your {{site.name}} password',
      mergeTokens: [
        { name: 'site.name', description: 'The site’s name', sample: 'Northwind Coffee' },
        {
          name: 'reset.intro',
          description: 'Who started the reset',
          sample: 'Someone asked to reset the password for your Northwind Coffee account.',
        },
        {
          name: 'resetUrl',
          description: 'The one-time reset link',
          sample: 'https://shop.example.com/recover?token=…',
        },
        {
          name: 'reset.note',
          description: 'How long the link lasts, and what to do if unexpected',
          sample:
            'The link works once and expires in 1 hour. If you did not ask for ' +
            'this, you can safely ignore this email — your password is unchanged.',
        },
      ],
      defaultBody: [
        { block: 'text', text: 'Reset your password', variant: 'heading' },
        { block: 'text', text: '{{reset.intro}}', variant: 'body' },
        { block: 'button', label: 'Set a new password', href: '{{resetUrl}}' },
        { block: 'text', text: '{{reset.note}}', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because a password reset was started for your ' +
        '{{host.businessName}} account.',
    },
    {
      key: 'member-password-changed',
      name: 'Member password changed',
      description:
        'Tells a site member that a site administrator set a new password on ' +
        'their account.',
      pluginId: 'commerce',
      plugin: 'Commerce',
      control: 'besigner',
      defaultSubject: 'Your {{site.name}} password was changed',
      mergeTokens: [
        { name: 'site.name', description: 'The site’s name', sample: 'Northwind Coffee' },
        {
          name: 'signInUrl',
          description: 'Where the member signs back in',
          sample: 'https://shop.example.com',
        },
      ],
      defaultBody: [
        { block: 'text', text: 'Your password was changed', variant: 'heading' },
        {
          block: 'text',
          text:
            'An administrator of {{site.name}} set a new password on your ' +
            'account and signed you out on every device. To sign back in, ' +
            'get the new password from them, or choose "Forgot password?" on ' +
            'the sign-in page to set your own.',
          variant: 'body',
        },
        { block: 'button', label: 'Sign in', href: '{{signInUrl}}' },
        {
          block: 'text',
          text: 'If you did not expect this, contact the site owner.',
          variant: 'caption',
        },
      ],
      footerReason:
        'You’re receiving this because the password on your ' +
        '{{host.businessName}} account was changed.',
    },
    {
      key: 'newsletter-confirmation',
      name: 'Subscription confirmation',
      description:
        'Asks someone who signed up for a site’s emails to confirm the address ' +
        'before anything is sent to it.',
      pluginId: 'commerce',
      plugin: 'Commerce',
      control: 'besigner',
      defaultSubject: 'Confirm your subscription',
      mergeTokens: [
        {
          name: 'stream.name',
          description: 'What they signed up for',
          sample: 'Newsletter',
        },
        {
          name: 'confirmUrl',
          description: 'The confirmation link',
          sample: 'https://shop.example.com/subscribe/confirm?token=…',
        },
      ],
      defaultBody: [
        { block: 'text', text: 'Confirm your subscription', variant: 'heading' },
        {
          block: 'text',
          text:
            'Please confirm that you want to get {{stream.name}} emails from ' +
            '{{host.businessName}} at this address.',
          variant: 'body',
        },
        { block: 'button', label: 'Confirm my subscription', href: '{{confirmUrl}}' },
        {
          block: 'text',
          text:
            'The link works for three days. If you did not sign up, ignore this ' +
            'message — nothing will be sent.',
          variant: 'caption',
        },
      ],
      footerReason:
        'You’re receiving this because this address was entered on ' +
        '{{host.businessName}}’s signup form.',
    },
    ...returnTenantEmails(),
  ]
}

/** The items a return covers, one per line. */
const RETURN_ITEMS_TOKEN = {
  name: 'return.items',
  description: 'The items being returned, one per line, with the reason',
  sample: '1× House Blend — Arrived damaged',
} as const

/** The merchant's note on a return; empty when they left none. */
const RETURN_NOTE_TOKEN = {
  name: 'return.note',
  description: 'The store’s note to the buyer on this return; empty when none',
  sample: 'Please include the original packaging.',
} as const

/**
 * The return emails (AGL-3611): one to the store when a buyer asks, and one
 * to the buyer at each answer. Their own block, beside the order emails
 * rather than among them, because those belong to the order notifications.
 */
function returnTenantEmails(): readonly TenantEmailEntry[] {
  return [
    {
      key: 'return-requested',
      name: 'Return requested',
      description:
        'Tells the store a buyer asked to return items, with what and why, so ' +
        'someone can approve or decline it.',
      pluginId: 'commerce',
      plugin: 'Commerce',
      control: 'besigner',
      defaultSubject: 'Return requested for order {{order.number}}',
      mergeTokens: [
        ORDER_NUMBER_TOKEN,
        RETURN_ITEMS_TOKEN,
        {
          name: 'buyer.email',
          description: 'The buyer’s email',
          sample: 'buyer@example.com',
        },
        {
          name: 'return.customerNote',
          description: 'What the buyer wrote; empty when they wrote nothing',
          sample: 'The lid was cracked.',
        },
      ],
      defaultBody: [
        { block: 'text', text: 'A buyer asked for a return', variant: 'heading' },
        {
          block: 'text',
          text: '{{buyer.email}} wants to return items from order {{order.number}}.',
          variant: 'body',
        },
        { block: 'text', text: '{{return.items}}', variant: 'body' },
        { block: 'text', text: '{{return.customerNote}}', variant: 'body' },
        {
          block: 'text',
          text: 'Approve or decline it under Products → Returns.',
          variant: 'caption',
        },
      ],
      footerReason: 'You’re receiving this because you manage {{host.businessName}}.',
    },
    {
      key: 'return-approved',
      name: 'Return approved',
      description:
        'Tells the buyer their return was approved and how to send the items ' +
        'back, with the return label when the store attached one.',
      pluginId: 'commerce',
      plugin: 'Commerce',
      control: 'besigner',
      defaultSubject: 'Your return for order {{order.number}} is approved',
      mergeTokens: [
        ORDER_NUMBER_TOKEN,
        RETURN_ITEMS_TOKEN,
        RETURN_NOTE_TOKEN,
        {
          name: 'return.label',
          description:
            'A sentence with the return label link and its tracking; empty ' +
            'when the store attached no label',
          sample: 'Print your return label: https://labels.example.com/r/123',
        },
        ORDER_STATUS_URL_TOKEN,
      ],
      defaultBody: [
        { block: 'text', text: 'Your return is approved', variant: 'heading' },
        {
          block: 'text',
          text: '{{host.businessName}} approved the return of:',
          variant: 'body',
        },
        { block: 'text', text: '{{return.items}}', variant: 'body' },
        { block: 'text', text: '{{return.note}}', variant: 'body' },
        { block: 'text', text: '{{return.label}}', variant: 'body' },
        { block: 'button', label: 'View your order', href: '{{order.statusUrl}}' },
      ],
      footerReason: ORDER_FOOTER_REASON,
    },
    {
      key: 'return-declined',
      name: 'Return declined',
      description: 'Tells the buyer their return was declined, with the store’s note.',
      pluginId: 'commerce',
      plugin: 'Commerce',
      control: 'besigner',
      defaultSubject: 'About your return for order {{order.number}}',
      mergeTokens: [ORDER_NUMBER_TOKEN, RETURN_ITEMS_TOKEN, RETURN_NOTE_TOKEN, ORDER_STATUS_URL_TOKEN],
      defaultBody: [
        { block: 'text', text: 'We could not accept this return', variant: 'heading' },
        {
          block: 'text',
          text: '{{host.businessName}} declined the return of:',
          variant: 'body',
        },
        { block: 'text', text: '{{return.items}}', variant: 'body' },
        { block: 'text', text: '{{return.note}}', variant: 'body' },
        { block: 'button', label: 'View your order', href: '{{order.statusUrl}}' },
      ],
      footerReason: ORDER_FOOTER_REASON,
    },
    {
      key: 'return-refunded',
      name: 'Return refunded',
      description: 'Tells the buyer their return was received and refunded, and how much.',
      pluginId: 'commerce',
      plugin: 'Commerce',
      control: 'besigner',
      defaultSubject: 'Your refund for order {{order.number}}',
      mergeTokens: [
        ORDER_NUMBER_TOKEN,
        RETURN_ITEMS_TOKEN,
        {
          name: 'return.refundTotal',
          description: 'The amount refunded for this return',
          sample: '$24.00',
        },
        ORDER_STATUS_URL_TOKEN,
      ],
      defaultBody: [
        { block: 'text', text: 'Your return is refunded', variant: 'heading' },
        {
          block: 'text',
          text:
            '{{host.businessName}} received your return and refunded ' +
            '{{return.refundTotal}} to your original payment method.',
          variant: 'body',
        },
        { block: 'text', text: '{{return.items}}', variant: 'body' },
        { block: 'button', label: 'View your order', href: '{{order.statusUrl}}' },
      ],
      footerReason: ORDER_FOOTER_REASON,
    },
  ]
}
