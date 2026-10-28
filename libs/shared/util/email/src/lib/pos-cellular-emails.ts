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
 * 4G FOR CARD READERS, AS SYSTEM EMAILS (AGL-4038).
 *
 * Two emails to the people who manage a workspace's billing, about its
 * monthly charge for 4G on its Stripe Reader S710s:
 *
 * - PAYMENT DUE, the day the charge doesn't go through: how much, for which
 *   month, and the day 4G turns off for its stores unless the open invoice
 *   is paid (pay it on the Billing page, and nothing else changes).
 * - TURNED OFF, once that day comes and it is still unpaid: which month went
 *   unpaid and for how much, which stores lost 4G, and the way back (pay it
 *   on the Billing page, then turn 4G on again on the store's POS devices
 *   card).
 *
 * The platform bills the charge, so they are SYSTEM emails in the platform's
 * brand (or the workspace's white label), not a store's mail.
 *
 * It lives here, beside the catalog, for the reason `domain-emails.ts`
 * gives: system emails have no plugin seam, and the staff System emails page
 * reads this registry before any plugin loads.
 *
 * Amounts and dates arrive formatted; a template never does arithmetic.
 *=========================================*/

import type {
  SystemEmailMergeToken,
  SystemEmailTemplateDefinition,
} from './system-email-catalog'

export const POS_CELLULAR_EMAIL_KEYS = {
  paymentDue: 'pos-cellular-payment-due',
  turnedOffUnpaid: 'pos-cellular-turned-off-unpaid',
} as const

const SOURCE = 'libs/plugins/commerce/src/lib/server/pos-cellular-notify.ts'

function tokens(origin: string): Record<string, SystemEmailMergeToken> {
  return {
    org: { name: 'org.name', description: 'The workspace whose 4G was turned off', sample: 'Test Org' },
    orgDue: { name: 'org.name', description: 'The workspace whose 4G charge is due', sample: 'Test Org' },
    month: { name: 'cellular.month', description: 'The month whose 4G charge went unpaid', sample: 'October 2026' },
    amount: { name: 'cellular.amount', description: 'What that month’s 4G charge came to', sample: '$21.65' },
    readers: {
      name: 'cellular.readers',
      description: 'How many Stripe Reader S710s that month’s charge was for',
      sample: '2 Stripe Reader S710s',
    },
    openedOn: { name: 'cellular.openedOn', description: 'The day the charge did not go through', sample: 'November 2, 2026' },
    turnedOffOn: { name: 'cellular.turnedOffOn', description: 'The day 4G was turned off', sample: 'November 16, 2026' },
    turnsOffOn: {
      name: 'cellular.turnsOffOn',
      description: 'The day 4G turns off for the workspace’s stores unless the charge is paid, in its time zone',
      sample: 'November 16, 2026',
    },
    stores: {
      name: 'cellular.stores',
      description: 'The stores 4G was turned off for, one per line',
      sample: 'Test Bakery',
    },
    storesWithCellular: {
      name: 'cellular.stores',
      description: 'The stores that have 4G now and would lose it, one per line (blank, and the row left out, when none has)',
      sample: 'Test Bakery',
    },
    billingUrl: {
      name: 'cellular.billingUrl',
      description: 'The workspace’s Billing page, where the open invoice is paid',
      sample: `${origin}/test-org/billing`,
    },
  }
}

export function posCellularSystemEmailTemplates(origin: string): SystemEmailTemplateDefinition[] {
  const t = tokens(origin)
  return [
    {
      key: POS_CELLULAR_EMAIL_KEYS.paymentDue,
      name: '4G charge unpaid: the day 4G turns off',
      description:
        'Sent to the people who manage a workspace’s billing the day its ' +
        'monthly charge for 4G on Stripe Reader S710s doesn’t go through, ' +
        'once: the amount, and the day 4G turns off for its stores unless ' +
        'the open invoice is paid.',
      deliveredBy: 'resend',
      defaultSubject: '4G turns off on {{cellular.turnsOffOn}} unless the {{cellular.month}} charge is paid',
      mergeTokens: [t.orgDue, t.month, t.amount, t.readers, t.openedOn, t.turnsOffOn, t.storesWithCellular, t.billingUrl],
      defaultBody: [
        { block: 'text', text: '{{org.name}} · 4G for card readers', variant: 'eyebrow' },
        { block: 'text', text: 'Your 4G charge didn’t go through', variant: 'heading' },
        {
          block: 'text',
          text: 'On {{cellular.openedOn}} we tried to charge {{cellular.amount}} for your card readers’ 4G in {{cellular.month}}, and the payment didn’t go through. The invoice is open on your Billing page. Unless it’s paid before {{cellular.turnsOffOn}}, 4G turns off for your stores that day.',
          variant: 'body',
        },
        {
          block: 'text',
          text: 'Amount due: {{cellular.amount}} for {{cellular.month}}\n4G turns off on: {{cellular.turnsOffOn}}\nReaders: {{cellular.readers}}\nStores with 4G: {{cellular.stores}}',
          variant: 'details',
        },
        { block: 'text', text: 'How to keep 4G on', variant: 'subheading' },
        {
          block: 'text',
          text: 'Pay the open invoice on your Billing page. If your card has changed, update your payment method there first. Once it’s paid, 4G stays on and there’s nothing else to do. Either way, your readers keep working on Wi-Fi or Ethernet.',
          variant: 'body',
        },
        { block: 'button', label: 'Pay on the Billing page', href: '{{cellular.billingUrl}}' },
        { block: 'text', text: 'Questions about the charge? Contact support: {{brand.supportUrl}}', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because you manage billing for {{org.name}} on {{brand.productName}}.',
      source: SOURCE,
    },
    {
      key: POS_CELLULAR_EMAIL_KEYS.turnedOffUnpaid,
      name: '4G turned off: charge unpaid',
      description:
        'Sent to the people who manage a workspace’s billing when its monthly ' +
        'charge for 4G on Stripe Reader S710s is still unpaid after the grace ' +
        'period, and 4G has been turned off for its stores.',
      deliveredBy: 'resend',
      defaultSubject: '4G is off for your card readers: the {{cellular.month}} charge is unpaid',
      mergeTokens: [t.org, t.month, t.amount, t.readers, t.openedOn, t.turnedOffOn, t.stores, t.billingUrl],
      defaultBody: [
        { block: 'text', text: '{{org.name}} · 4G for card readers', variant: 'eyebrow' },
        { block: 'text', text: 'We turned off 4G for your card readers', variant: 'heading' },
        {
          block: 'text',
          text: 'The 4G charge for {{cellular.month}} didn’t go through on {{cellular.openedOn}}, and it is still unpaid. So on {{cellular.turnedOffOn}} we turned 4G off for your stores. Your readers keep working on Wi-Fi or Ethernet.',
          variant: 'body',
        },
        {
          block: 'text',
          text: 'Unpaid: {{cellular.amount}} for {{cellular.month}}\nReaders: {{cellular.readers}}\nStores with 4G turned off: {{cellular.stores}}',
          variant: 'details',
        },
        { block: 'text', text: 'How to turn it back on', variant: 'subheading' },
        {
          block: 'text',
          text: 'Pay the open invoice on your Billing page. 4G doesn’t come back on by itself once it’s paid: turn it on again from each store’s POS devices card, in its point of sale settings.',
          variant: 'body',
        },
        { block: 'button', label: 'Pay on the Billing page', href: '{{cellular.billingUrl}}' },
        { block: 'text', text: 'Questions about the charge? Contact support: {{brand.supportUrl}}', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because you manage billing for {{org.name}} on {{brand.productName}}.',
      source: SOURCE,
    },
  ]
}
