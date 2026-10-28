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
 * 4G FOR CARD READERS, AS A SYSTEM EMAIL (AGL-4038).
 *
 * A workspace's monthly charge for 4G on its Stripe Reader S710s that is
 * still unpaid after the grace period turns 4G off at Stripe for every one
 * of its stores, and the people who manage the workspace's billing get this:
 * which month went unpaid and for how much, which stores lost 4G, and the way
 * back (pay it on the Billing page, then turn 4G on again on the store's POS
 * devices card). The platform bills the charge, so it is a SYSTEM email in
 * the platform's brand (or the workspace's white label), not a store's mail.
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
  turnedOffUnpaid: 'pos-cellular-turned-off-unpaid',
} as const

const SOURCE = 'libs/plugins/commerce/src/lib/server/pos-cellular-notify.ts'

function tokens(origin: string): Record<string, SystemEmailMergeToken> {
  return {
    org: { name: 'org.name', description: 'The workspace whose 4G was turned off', sample: 'Test Org' },
    month: { name: 'cellular.month', description: 'The month whose 4G charge went unpaid', sample: 'October 2026' },
    amount: { name: 'cellular.amount', description: 'What that month’s 4G charge came to', sample: '$21.65' },
    readers: {
      name: 'cellular.readers',
      description: 'How many Stripe Reader S710s that month’s charge was for',
      sample: '2 Stripe Reader S710s',
    },
    openedOn: { name: 'cellular.openedOn', description: 'The day the charge did not go through', sample: 'November 2, 2026' },
    turnedOffOn: { name: 'cellular.turnedOffOn', description: 'The day 4G was turned off', sample: 'November 16, 2026' },
    stores: {
      name: 'cellular.stores',
      description: 'The stores 4G was turned off for, one per line',
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
          text: 'Unpaid: {{cellular.amount}} for {{cellular.month}}\nReaders: {{cellular.readers}}\nStores with 4G turned off:\n{{cellular.stores}}',
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
