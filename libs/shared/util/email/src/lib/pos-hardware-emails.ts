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

/*==========================================
 * A CARD READER BOUGHT FROM THE PLATFORM, AS SYSTEM EMAILS (AGL-4038).
 *
 * The commerce plugin's POS hardware shop sends these to the person who
 * placed the order: the order received, the parcel shipped with its
 * tracking, and the parcel delivered with the way to set the reader up. The
 * platform is the seller, so they are SYSTEM emails in the platform's brand
 * (or the workspace's white label), not a store's own emails to its buyers.
 *
 * They live here, beside the catalog, for the reason `domain-emails.ts`
 * gives: system emails have no plugin seam, and the staff System emails page
 * reads this registry before any plugin loads.
 *
 * Amounts and dates arrive formatted; a template never does arithmetic.
 *=========================================*/

import type {
  SystemEmailMergeToken,
  SystemEmailTemplateDefinition,
} from './system-email-catalog'

export const POS_HARDWARE_EMAIL_KEYS = {
  received: 'pos-hardware-order-received',
  shipped: 'pos-hardware-order-shipped',
  delivered: 'pos-hardware-order-delivered',
} as const

const SOURCE = 'libs/plugins/commerce/src/lib/server/pos-hardware-notify.ts'

/**
 * The sample site's Point of sale page in the console, for the designer's
 * preview of the two links. It is a page a merchant opens, not a storage path,
 * so it is written as one value rather than spelled out beside each link.
 */
const SAMPLE_POS_PAGE = ['/test-org', 'hosts', 'test-bakery', 'products', 'pos'].join('/')

function tokens(origin: string): Record<string, SystemEmailMergeToken> {
  return {
    org: { name: 'org.name', description: 'The workspace that placed the order', sample: 'Test Org' },
    site: { name: 'site.name', description: 'The site the order was placed from', sample: 'Test Bakery' },
    number: { name: 'order.number', description: 'The hardware order number', sample: 'HW-3F9A21' },
    items: {
      name: 'order.items',
      description: 'What was ordered, one line per item',
      sample: 'Stripe Reader S710 × 1\nCharging dock for the S700 and S710 × 1',
    },
    total: { name: 'order.total', description: 'What was charged, shipping and tax included', sample: '$123.45' },
    shipTo: {
      name: 'order.shipTo',
      description: 'The name and address it ships to',
      sample: 'Alex Test\n12 Main St\nSpringfield, IL 62701',
    },
    shipping: { name: 'order.shippingMethod', description: 'The shipping speed chosen', sample: 'Standard shipping' },
    carrier: { name: 'order.carrier', description: 'The carrier delivering the parcel', sample: 'UPS' },
    trackingNumber: { name: 'order.trackingNumber', description: 'The parcel’s tracking number', sample: '1Z999AA10123456784' },
    trackingUrl: {
      name: 'order.trackingUrl',
      description: 'The carrier’s tracking page for the parcel',
      sample: 'https://www.ups.com/track?tracknum=1Z999AA10123456784',
    },
    ordersUrl: {
      name: 'order.ordersUrl',
      description: 'The Hardware card, where the order and its status are',
      sample: `${origin}${SAMPLE_POS_PAGE}#pos-hardware`,
    },
    setupUrl: {
      name: 'order.setupUrl',
      description: 'The POS devices card, where a reader is added to a register',
      sample: `${origin}${SAMPLE_POS_PAGE}#pos-devices`,
    },
  }
}

export function posHardwareSystemEmailTemplates(
  origin: string,
): SystemEmailTemplateDefinition[] {
  const t = tokens(origin)
  const footer =
    'You’re receiving this because you ordered card reader hardware for ' +
    '{{site.name}} from {{brand.productName}}.'
  return [
    {
      key: POS_HARDWARE_EMAIL_KEYS.received,
      name: 'Card reader order received',
      description:
        'Sent to the person who ordered card readers or accessories from the ' +
        'POS hardware shop, once the payment goes through.',
      deliveredBy: 'resend',
      defaultSubject: 'We have your card reader order {{order.number}}',
      mergeTokens: [t.org, t.site, t.number, t.items, t.total, t.shipTo, t.shipping, t.ordersUrl],
      defaultBody: [
        { block: 'text', text: '{{site.name}} · Order {{order.number}}', variant: 'eyebrow' },
        { block: 'text', text: 'Your hardware order is in', variant: 'heading' },
        { block: 'text', text: 'Thanks for your order. We place it with Stripe, which makes the readers and ships them straight to you. We will email you again with tracking as soon as it ships.', variant: 'body' },
        { block: 'text', text: '{{order.items}}\nShipping: {{order.shippingMethod}}\nTotal charged: {{order.total}}', variant: 'details' },
        { block: 'text', text: 'Shipping to', variant: 'subheading' },
        { block: 'text', text: '{{order.shipTo}}', variant: 'details' },
        { block: 'text', text: 'What happens next', variant: 'subheading' },
        { block: 'text', text: 'While the order is being prepared you can follow it on the Hardware card in your point of sale settings. If something is wrong with the address, contact support before it ships: {{brand.supportUrl}}', variant: 'body' },
        { block: 'button', label: 'See your order', href: '{{order.ordersUrl}}' },
        { block: 'text', text: 'Order {{order.number}} for {{org.name}}.', variant: 'caption' },
      ],
      footerReason: footer,
      source: SOURCE,
    },
    {
      key: POS_HARDWARE_EMAIL_KEYS.shipped,
      name: 'Card reader order shipped',
      description:
        'Sent when a card reader order from the POS hardware shop ships, with ' +
        'the carrier and a tracking link.',
      deliveredBy: 'resend',
      defaultSubject: 'Your card reader order {{order.number}} has shipped',
      mergeTokens: [
        t.org, t.site, t.number, t.items, t.shipTo, t.carrier, t.trackingNumber, t.trackingUrl, t.ordersUrl,
      ],
      defaultBody: [
        { block: 'text', text: '{{site.name}} · Order {{order.number}}', variant: 'eyebrow' },
        { block: 'text', text: 'Your hardware is on its way', variant: 'heading' },
        { block: 'text', text: 'Your order left Stripe’s warehouse and is with {{order.carrier}}. Someone may need to sign for it, so keep an eye on the tracking page for the delivery day.', variant: 'body' },
        { block: 'text', text: '{{order.items}}\nCarrier: {{order.carrier}}\nTracking number: {{order.trackingNumber}}', variant: 'details' },
        { block: 'button', label: 'Track your parcel', href: '{{order.trackingUrl}}' },
        { block: 'text', text: 'Before it arrives', variant: 'subheading' },
        { block: 'text', text: 'Pick the spot where the reader will live: it needs power and Wi-Fi, or a cellular signal for the S710. Once it is delivered, you add it to a register on the POS devices card in a minute.', variant: 'body' },
        { block: 'text', text: 'Shipping to: {{order.shipTo}}', variant: 'caption' },
      ],
      footerReason: footer,
      source: SOURCE,
    },
    {
      key: POS_HARDWARE_EMAIL_KEYS.delivered,
      name: 'Card reader order delivered',
      description:
        'Sent when a card reader order from the POS hardware shop is delivered, ' +
        'with the way to set the reader up at a register.',
      deliveredBy: 'resend',
      defaultSubject: 'Your card reader order {{order.number}} was delivered',
      mergeTokens: [t.org, t.site, t.number, t.items, t.setupUrl, t.ordersUrl],
      defaultBody: [
        { block: 'text', text: '{{site.name}} · Order {{order.number}}', variant: 'eyebrow' },
        { block: 'text', text: 'Your hardware has arrived', variant: 'heading' },
        { block: 'text', text: 'Your order was delivered. Here is how to start taking payments with it.', variant: 'body' },
        { block: 'text', text: '{{order.items}}', variant: 'details' },
        { block: 'text', text: 'Set up your reader', variant: 'subheading' },
        { block: 'text', text: '1. Charge it and switch it on.\n2. Connect it to Wi-Fi from the reader’s Settings.\n3. On the reader, generate a pairing code.\n4. On the POS devices card, choose Add card reader and enter the code.', variant: 'details' },
        { block: 'button', label: 'Set up your reader', href: '{{order.setupUrl}}' },
        { block: 'text', text: 'The M2 pairs by Bluetooth from the {{brand.productName}} POS app instead. If anything arrived damaged, contact support: {{brand.supportUrl}}', variant: 'caption' },
      ],
      footerReason: footer,
      source: SOURCE,
    },
  ]
}
