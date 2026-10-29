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

/** Where a pickup order is collected (AGL-3624). */
const PICKUP_LOCATION_TOKEN = {
  name: 'pickup.location',
  description: 'The pickup location’s name and address',
  sample: 'Main Street shop, 12 Main St, Springfield',
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
        { block: 'text', text: '{{host.businessName}} · Order {{order.number}}', variant: 'eyebrow' },
        { block: 'text', text: 'Thanks for your order', variant: 'heading' },
        { block: 'text', text: 'Here is the receipt for your order from {{host.businessName}}. We will email you again as your order moves along, and the order page always shows where it is.', variant: 'body' },
        { block: 'text', text: '{{order.summary}}\nTotal charged: {{order.total}}', variant: 'details' },
        { block: 'text', text: '{{store.receiptFooter}}', variant: 'body' },
        { block: 'button', label: 'View your order', href: '{{order.statusUrl}}' },
        { block: 'text', text: 'Order {{order.number}} · payment reference {{order.ref}}. Questions about your order? Reply to this email and {{host.businessName}} will get back to you.', variant: 'caption' },
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
        { block: 'text', text: '{{host.businessName}} · Order {{order.number}}', variant: 'eyebrow' },
        { block: 'text', text: 'Your order is on its way', variant: 'heading' },
        { block: 'text', text: '{{host.businessName}} shipped these items from order {{order.number}}.', variant: 'body' },
        { block: 'text', text: '{{shipment.summary}}', variant: 'details' },
        { block: 'text', text: '{{shipment.tracking}}', variant: 'body' },
        { block: 'text', text: '{{shipment.remaining}}', variant: 'body' },
        { block: 'button', label: 'Track your order', href: '{{order.statusUrl}}' },
        { block: 'text', text: 'The order page shows every shipment and its tracking as it moves. Questions about your order? Reply to this email and {{host.businessName}} will get back to you.', variant: 'caption' },
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
        { block: 'text', text: '{{host.businessName}} · Order {{order.number}}', variant: 'eyebrow' },
        { block: 'text', text: 'Your order was delivered', variant: 'heading' },
        { block: 'text', text: '{{host.businessName}} marked order {{order.number}} as delivered. We hope you enjoy it.', variant: 'body' },
        { block: 'text', text: '{{order.summary}}', variant: 'details' },
        { block: 'button', label: 'View your order', href: '{{order.statusUrl}}' },
        { block: 'text', text: 'Something missing or not right? Reply to this email and {{host.businessName}} will sort it out.', variant: 'caption' },
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
        { block: 'text', text: '{{host.businessName}} · Order {{order.number}}', variant: 'eyebrow' },
        { block: 'text', text: 'Your refund is on its way', variant: 'heading' },
        { block: 'text', text: '{{host.businessName}} refunded {{refund.amount}} on order {{order.number}}.', variant: 'body' },
        { block: 'text', text: '{{refund.summary}}\nTotal refunded: {{refund.amount}}', variant: 'details' },
        { block: 'text', text: '{{refund.note}}', variant: 'body' },
        { block: 'button', label: 'View your order', href: '{{order.statusUrl}}' },
        { block: 'text', text: 'Refunds go back to the original payment method and usually appear within 5 to 10 business days, depending on your bank.', variant: 'caption' },
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
        { block: 'text', text: '{{host.businessName}} · Order {{order.number}}', variant: 'eyebrow' },
        { block: 'text', text: 'Your order was canceled', variant: 'heading' },
        { block: 'text', text: '{{host.businessName}} canceled order {{order.number}}. These items will not be sent.', variant: 'body' },
        { block: 'text', text: '{{order.summary}}', variant: 'details' },
        { block: 'text', text: '{{cancel.note}}', variant: 'body' },
        { block: 'button', label: 'View your order', href: '{{order.statusUrl}}' },
        { block: 'text', text: 'Questions about your order? Reply to this email and {{host.businessName}} will get back to you.', variant: 'caption' },
      ],
      footerReason: ORDER_FOOTER_REASON,
    },
    // Pickup and the store's own delivery (AGL-3624).
    {
      key: 'order-ready-for-pickup',
      name: 'Order ready for pickup',
      description:
        'Tells the buyer their pickup order is ready, where to collect it, ' +
        'the pickup hours and any arrival instructions.',
      pluginId: 'commerce',
      plugin: 'Commerce',
      control: 'besigner',
      defaultSubject: 'Your order {{order.number}} is ready for pickup',
      mergeTokens: [
        ORDER_NUMBER_TOKEN,
        {
          name: 'order.summary',
          description: 'The ordered items, one per line',
          sample: '2× House Blend',
        },
        PICKUP_LOCATION_TOKEN,
        {
          name: 'pickup.hours',
          description: 'The location’s pickup hours; empty when it lists none',
          sample: 'Pickup hours:\nMo-Fr 09:00-17:00',
        },
        {
          name: 'pickup.instructions',
          description: 'What to do on arrival, as the store wrote it; empty when it wrote none',
          sample: 'Ring the bell at the side door.',
        },
        ORDER_STATUS_URL_TOKEN,
      ],
      defaultBody: [
        { block: 'text', text: '{{host.businessName}} · Order {{order.number}}', variant: 'eyebrow' },
        { block: 'text', text: 'Your order is ready for pickup', variant: 'heading' },
        { block: 'text', text: 'Order {{order.number}} is packed and waiting for you at {{pickup.location}}.', variant: 'body' },
        { block: 'text', text: '{{order.summary}}\nPick up at: {{pickup.location}}', variant: 'details' },
        { block: 'text', text: '{{pickup.hours}}', variant: 'body' },
        { block: 'text', text: '{{pickup.instructions}}', variant: 'body' },
        { block: 'button', label: 'View your order', href: '{{order.statusUrl}}' },
        { block: 'text', text: 'Bring your order number, {{order.number}}. Questions about your order? Reply to this email and {{host.businessName}} will get back to you.', variant: 'caption' },
      ],
      footerReason: ORDER_FOOTER_REASON,
    },
    {
      key: 'order-picked-up',
      name: 'Order picked up',
      description: 'Confirms to the buyer that their pickup order was collected.',
      pluginId: 'commerce',
      plugin: 'Commerce',
      control: 'besigner',
      defaultSubject: 'You picked up order {{order.number}}',
      mergeTokens: [
        ORDER_NUMBER_TOKEN,
        {
          name: 'order.summary',
          description: 'The ordered items, one per line',
          sample: '2× House Blend',
        },
        PICKUP_LOCATION_TOKEN,
        ORDER_STATUS_URL_TOKEN,
      ],
      defaultBody: [
        { block: 'text', text: '{{host.businessName}} · Order {{order.number}}', variant: 'eyebrow' },
        { block: 'text', text: 'Thanks for picking up your order', variant: 'heading' },
        { block: 'text', text: 'Order {{order.number}} was picked up from {{pickup.location}}. Enjoy it.', variant: 'body' },
        { block: 'text', text: '{{order.summary}}\nPicked up at: {{pickup.location}}', variant: 'details' },
        { block: 'button', label: 'View your order', href: '{{order.statusUrl}}' },
        { block: 'text', text: 'Something missing or not right? Reply to this email and {{host.businessName}} will sort it out.', variant: 'caption' },
      ],
      footerReason: ORDER_FOOTER_REASON,
    },
    {
      key: 'order-out-for-delivery',
      name: 'Order out for delivery',
      description:
        'Tells the buyer the store’s own driver is on the way with their ' +
        'local delivery, in the window they booked.',
      pluginId: 'commerce',
      plugin: 'Commerce',
      control: 'besigner',
      defaultSubject: 'Your order {{order.number}} is out for delivery',
      mergeTokens: [
        ORDER_NUMBER_TOKEN,
        {
          name: 'order.summary',
          description: 'The ordered items, one per line',
          sample: '2× House Blend',
        },
        {
          name: 'delivery.window',
          description: 'The delivery window the buyer booked',
          sample: 'Tue, Oct 14, 9:00 AM – 12:00 PM',
        },
        ORDER_STATUS_URL_TOKEN,
      ],
      defaultBody: [
        { block: 'text', text: '{{host.businessName}} · Order {{order.number}}', variant: 'eyebrow' },
        { block: 'text', text: 'Your order is out for delivery', variant: 'heading' },
        { block: 'text', text: '{{host.businessName}} is on the way with order {{order.number}}.', variant: 'body' },
        { block: 'text', text: '{{order.summary}}\nDelivery window: {{delivery.window}}', variant: 'details' },
        { block: 'button', label: 'View your order', href: '{{order.statusUrl}}' },
        { block: 'text', text: 'Questions about your order? Reply to this email and {{host.businessName}} will get back to you.', variant: 'caption' },
      ],
      footerReason: ORDER_FOOTER_REASON,
    },
    {
      // AGL-4097. Sent from the console's Send quote, never on its own; the
      // quote's PDF is attached, and each send replies into the customer's
      // conversation with the business (`quote.emailThread`). Every token is
      // composed per send by `utils/quote-email-content.ts`; the prices it
      // carries are the ones named here (`quote.total`, `quote.buttonLabel`),
      // and `quote.proofImages` carries pictures and file names only.
      key: 'quote-sent',
      name: 'Quote',
      description:
        'Sends a quote to the customer when you choose Send quote: your ' +
        'message, the proof, the quote as a PDF and a button to approve or ' +
        'pay it on your site. Later sends, such as a new revision, arrive in ' +
        'the same conversation.',
      pluginId: 'commerce',
      plugin: 'Commerce',
      control: 'besigner',
      defaultSubject: '{{quote.subject}}',
      mergeTokens: [
        {
          name: 'quote.subject',
          description: 'The subject typed when sending; it stays the same for every email about the quote',
          sample: 'Quote #1042 from Northwind Signs',
        },
        { name: 'quote.number', description: 'The quote number', sample: '#1042' },
        { name: 'quote.revision', description: 'Which revision of the quote this is', sample: '2' },
        {
          name: 'quote.total',
          description: 'The quote total; “before tax” when tax is added at payment',
          sample: '$1,250.00',
        },
        {
          name: 'quote.heading',
          description: '“Your quote from …”, or “Your updated quote” from the second revision on',
          sample: 'Your quote from Northwind Signs',
        },
        {
          name: 'quote.intro',
          description: 'One sentence on what this email is: a new quote, or an updated revision',
          sample: 'Here is your quote from Northwind Signs. The quote is attached as a PDF too.',
        },
        {
          name: 'quote.message',
          description: 'The message typed when sending; empty when none was typed',
          sample: 'Thanks for stopping by the shop. Here is the banner we talked about.',
        },
        {
          name: 'quote.proofImages',
          description: 'Up to three proof images, each linked to the quote page; empty when the revision has none',
          sample: '<table role="presentation"><tr><td><img src="https://shop.example.com/api/commerce/quote-proof?file=p1" alt="Proof: banner.png" width="552" /></td></tr></table>',
        },
        {
          name: 'quote.proofFiles',
          description: 'The other proof files by name, to see on the quote page; empty when there are none',
          sample: 'Also with this revision: banner.ai. See it on your quote page.',
        },
        {
          name: 'quote.nextStep',
          description: 'What to do next: approve the proof first, or pay when ready',
          sample: 'Look over the proof, then approve it on your quote page. Once you approve it, you can pay there.',
        },
        {
          name: 'quote.buttonLabel',
          description: '“Review and approve” while an approval is needed first, else “View and pay” with the total',
          sample: 'View and pay $1,250.00',
        },
        {
          name: 'quote.url',
          description: 'The quote’s pay link on your site. Private to the customer; it needs no account',
          sample: 'https://shop.example.com/pay-quote?q=quote_123&t=…',
        },
      ],
      defaultBody: [
        { block: 'text', text: '{{host.businessName}} · Quote {{quote.number}}', variant: 'eyebrow' },
        { block: 'text', text: '{{quote.heading}}', variant: 'heading' },
        { block: 'text', text: '{{quote.intro}}', variant: 'body' },
        { block: 'text', text: '{{quote.message}}', variant: 'body' },
        { block: 'text', text: 'Quote: {{quote.number}}\nRevision: {{quote.revision}}\nTotal: {{quote.total}}', variant: 'details' },
        { block: 'html', html: '{{quote.proofImages}}' },
        { block: 'text', text: '{{quote.proofFiles}}', variant: 'caption' },
        { block: 'text', text: '{{quote.nextStep}}', variant: 'body' },
        { block: 'button', label: '{{quote.buttonLabel}}', href: '{{quote.url}}' },
        { block: 'text', text: 'Reply to this email to reach {{host.businessName}}.', variant: 'caption' },
      ],
      footerReason: 'You’re receiving this because {{host.businessName}} prepared a quote for you.',
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
        { name: 'orders.url', description: 'The site’s Orders page in the console', sample: 'https://app.example.com/northwind/hosts/northwind/products/orders' },
      ],
      defaultBody: [
        { block: 'text', text: '{{site.name}} · New order', variant: 'eyebrow' },
        { block: 'text', text: 'You made a sale', variant: 'heading' },
        { block: 'text', text: 'A new paid order came in on {{site.name}}. Here is what was bought and who bought it.', variant: 'body' },
        { block: 'text', text: '{{order.summary}}\nTotal: {{order.total}}\nBuyer: {{buyer.email}}\nPayment reference: {{order.ref}}', variant: 'details' },
        { block: 'button', label: 'Open orders', href: '{{orders.url}}' },
        { block: 'text', text: 'Fulfill it from Orders: as you mark it shipped, ready for pickup or delivered, the buyer is emailed at each step.', variant: 'caption' },
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
        { block: 'text', text: '{{host.businessName}} · Reservation', variant: 'eyebrow' },
        { block: 'text', text: 'Your stay is confirmed', variant: 'heading' },
        { block: 'text', text: 'Your reservation at {{host.businessName}} is booked. Here are the details to keep.', variant: 'body' },
        { block: 'text', text: 'Check-in: {{reservation.checkIn}}\nNights: {{reservation.nights}}\nPaid today: {{reservation.paid}}\nReference: {{reservation.ref}}', variant: 'details' },
        { block: 'text', text: '{{reservation.balance}}', variant: 'body' },
        { block: 'text', text: 'Questions before you arrive? Reply to this email and {{host.businessName}} will get back to you.', variant: 'caption' },
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
        { block: 'text', text: '{{host.businessName}} · Gift card', variant: 'eyebrow' },
        { block: 'text', text: 'Your {{giftcard.value}} gift card', variant: 'heading' },
        { block: 'text', text: 'You have a {{giftcard.value}} gift card for {{host.businessName}}.', variant: 'body' },
        { block: 'text', text: '{{giftcard.note}}', variant: 'body' },
        { block: 'text', text: 'Value: {{giftcard.value}}\nGift card code: {{giftcard.code}}', variant: 'details' },
        { block: 'text', text: 'Enter the code at checkout on {{host.url}} to use its balance.', variant: 'body' },
        { block: 'button', label: 'Shop {{host.businessName}}', href: '{{host.url}}' },
        { block: 'text', text: 'Keep this email: the code is what you spend the card with.', variant: 'caption' },
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
        { block: 'text', text: '{{host.businessName}}', variant: 'eyebrow' },
        { block: 'text', text: '{{product.name}} is back in stock', variant: 'heading' },
        { block: 'text', text: 'You asked to hear when {{product.name}} was back at {{host.businessName}}. It is, and you can order it now.', variant: 'body' },
        { block: 'button', label: 'Shop {{product.name}}', href: '{{product.url}}' },
        { block: 'text', text: 'You asked {{host.businessName}} to tell you when it was back. Nothing is held for you.', variant: 'caption' },
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
        { block: 'text', text: '{{host.businessName}}', variant: 'eyebrow' },
        { block: 'text', text: 'You left something in your cart', variant: 'heading' },
        { block: 'text', text: 'Your cart at {{host.businessName}} still has your items in it. Pick up where you left off whenever you are ready.', variant: 'body' },
        { block: 'button', label: 'Return to your cart', href: '{{cart.url}}' },
        { block: 'text', text: 'Nothing in your cart is held for you.', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because you started a checkout with {{host.businessName}}.',
    },
    {
      // AGL-3736: days after fulfilment, one per order, with a single-use
      // link per product that opens its review form pre-verified.
      key: 'review-request',
      name: 'Review request',
      description:
        'Asks a buyer to review what they bought, a set number of days after ' +
        'the order is fulfilled. One per order; each product has its own ' +
        'single-use link. Turn it off or change the delay in Settings → Reviews.',
      requiresFeature: 'productReviews',
      pluginId: 'commerce',
      plugin: 'Commerce',
      control: 'besigner',
      defaultSubject: 'How was your order from {{host.businessName}}?',
      mergeTokens: [
        ORDER_NUMBER_TOKEN,
        {
          name: 'review.products',
          description:
            'Each product to review, one per line, with its own review link',
          sample: 'House Blend: https://shop.example.com/products/house-blend?review=…',
        },
        {
          name: 'review.url',
          description: 'The review link for the first product',
          sample: 'https://shop.example.com/products/house-blend?review=…',
        },
        {
          name: 'review.productName',
          description: 'The first product’s name',
          sample: 'House Blend',
        },
      ],
      defaultBody: [
        { block: 'text', text: '{{host.businessName}} · Order {{order.number}}', variant: 'eyebrow' },
        { block: 'text', text: 'How did we do?', variant: 'heading' },
        { block: 'text', text: 'Thanks again for your order {{order.number}} from {{host.businessName}}. Would you tell other shoppers what you think? Each link opens the product with a review form ready.', variant: 'body' },
        { block: 'text', text: '{{review.products}}', variant: 'links' },
        { block: 'button', label: 'Write a review', href: '{{review.url}}' },
        { block: 'text', text: 'Each link works once, for 60 days.', variant: 'caption' },
      ],
      footerReason: ORDER_FOOTER_REASON,
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
        { block: 'text', text: '{{host.businessName}} · Members', variant: 'eyebrow' },
        { block: 'text', text: '{{post.title}}', variant: 'heading' },
        { block: 'text', text: '{{post.body}}', variant: 'body' },
        { block: 'button', label: 'Visit {{host.businessName}}', href: '{{host.url}}' },
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
        { block: 'text', text: '{{site.name}} · Account security', variant: 'eyebrow' },
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
        { block: 'text', text: '{{site.name}} · Account security', variant: 'eyebrow' },
        { block: 'text', text: 'Your password was changed', variant: 'heading' },
        { block: 'text', text: 'An administrator of {{site.name}} set a new password on your account and signed you out on every device. To sign back in, get the new password from them, or choose "Forgot password?" on the sign-in page to set your own.', variant: 'body' },
        { block: 'button', label: 'Sign in', href: '{{signInUrl}}' },
        { block: 'text', text: 'If you did not expect this, contact the site owner straight away.', variant: 'caption' },
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
        { block: 'text', text: '{{host.businessName}}', variant: 'eyebrow' },
        { block: 'text', text: 'Confirm your subscription', variant: 'heading' },
        { block: 'text', text: 'Please confirm that you want {{stream.name}} emails from {{host.businessName}} at this address. Nothing is sent until you do.', variant: 'body' },
        { block: 'text', text: 'List: {{stream.name}}\nFrom: {{host.businessName}}', variant: 'details' },
        { block: 'button', label: 'Confirm my subscription', href: '{{confirmUrl}}' },
        { block: 'text', text: 'The link works for three days. If you did not sign up, ignore this message and nothing will be sent.', variant: 'caption' },
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
        { name: 'return.url', description: 'The return in the console, to approve or decline', sample: 'https://app.example.com/northwind/hosts/northwind/products/returns?return=ret_123' },
      ],
      defaultBody: [
        { block: 'text', text: '{{host.businessName}} · Order {{order.number}}', variant: 'eyebrow' },
        { block: 'text', text: 'A buyer asked for a return', variant: 'heading' },
        { block: 'text', text: '{{buyer.email}} wants to return items from order {{order.number}}. Approve or decline it, and the buyer is emailed your answer.', variant: 'body' },
        { block: 'text', text: '{{return.items}}\nBuyer: {{buyer.email}}', variant: 'details' },
        { block: 'text', text: '{{return.customerNote}}', variant: 'body' },
        { block: 'button', label: 'Review the return', href: '{{return.url}}' },
        { block: 'text', text: 'Returns are under Products → Returns, beside the order they are for.', variant: 'caption' },
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
        { block: 'text', text: '{{host.businessName}} · Order {{order.number}}', variant: 'eyebrow' },
        { block: 'text', text: 'Your return is approved', variant: 'heading' },
        { block: 'text', text: '{{host.businessName}} approved the return of these items from order {{order.number}}.', variant: 'body' },
        { block: 'text', text: '{{return.items}}', variant: 'details' },
        { block: 'text', text: 'What to do next', variant: 'subheading' },
        { block: 'text', text: '{{return.note}}', variant: 'body' },
        { block: 'text', text: '{{return.label}}', variant: 'body' },
        { block: 'button', label: 'View your order', href: '{{order.statusUrl}}' },
        { block: 'text', text: 'Your refund is sent once {{host.businessName}} receives the items, and you will get an email when it is.', variant: 'caption' },
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
        { block: 'text', text: '{{host.businessName}} · Order {{order.number}}', variant: 'eyebrow' },
        { block: 'text', text: 'We could not accept this return', variant: 'heading' },
        { block: 'text', text: '{{host.businessName}} declined the return of these items from order {{order.number}}.', variant: 'body' },
        { block: 'text', text: '{{return.items}}', variant: 'details' },
        { block: 'text', text: '{{return.note}}', variant: 'body' },
        { block: 'button', label: 'View your order', href: '{{order.statusUrl}}' },
        { block: 'text', text: 'Questions about it? Reply to this email and {{host.businessName}} will get back to you.', variant: 'caption' },
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
        { block: 'text', text: '{{host.businessName}} · Order {{order.number}}', variant: 'eyebrow' },
        { block: 'text', text: 'Your return is refunded', variant: 'heading' },
        { block: 'text', text: '{{host.businessName}} received your return and refunded {{return.refundTotal}} to your original payment method.', variant: 'body' },
        { block: 'text', text: '{{return.items}}\nTotal refunded: {{return.refundTotal}}', variant: 'details' },
        { block: 'button', label: 'View your order', href: '{{order.statusUrl}}' },
        { block: 'text', text: 'Refunds usually appear within 5 to 10 business days, depending on your bank.', variant: 'caption' },
      ],
      footerReason: ORDER_FOOTER_REASON,
    },
  ]
}
