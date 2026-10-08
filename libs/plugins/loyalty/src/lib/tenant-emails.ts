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

/**
 * The emails a store sends its members through Rewards (AGL-3640): what an
 * order earned, store credit the store gave, and a referral reward. Declared
 * here, by the plugin that sends them, and compiled into the platform's
 * tenant email catalog by `tools/scripts/generate-plugin-manifests.mjs`, so
 * the send path finds the store's designed version without loading this
 * plugin. Each is designed in the Besigner in the site's own theme.
 */

const BALANCE_TOKENS = [
  { name: 'name', description: "The member's name, when the store knows it", sample: 'Alex' },
  { name: 'loyalty.balance', description: 'Points the member holds now', sample: '1,250' },
  { name: 'loyalty.value', description: 'What those points are worth', sample: '$12.50' },
  { name: 'loyalty.credit', description: 'Store credit the member holds', sample: '$10.00' },
  { name: 'loyalty.code', description: 'The member’s rewards code, to spend their balance', sample: 'RW-7K3P-Q9XZ-2M4D' },
  {
    name: 'loyalty.referral',
    description: 'A sentence with the member’s referral code and what it gives; empty when referrals are off',
    sample: 'Share your referral code RF-7K3P9X: a friend gets $10.00 off their first order, and you get $10.00 in store credit.',
  },
] as const

const SPEND_LINE = {
  block: 'text',
  text: 'Your rewards code is {{loyalty.code}}. Enter it at checkout on {{host.url}}, or give it at the register, to spend your balance.',
  variant: 'body',
} as const

const BALANCE_LINE = {
  block: 'text',
  text: 'You have {{loyalty.balance}} points (worth {{loyalty.value}}) and {{loyalty.credit}} in store credit.',
  variant: 'body',
} as const

export function loyaltyTenantEmails(): readonly TenantEmailEntry[] {
  return [
    {
      key: 'loyalty-points-earned',
      name: 'Rewards points earned',
      description: 'Tells a customer the points an order earned them, their balance and their rewards code.',
      pluginId: 'loyalty',
      plugin: 'Rewards',
      control: 'besigner',
      defaultSubject: 'You earned {{loyalty.points}} points',
      mergeTokens: [
        ...BALANCE_TOKENS,
        { name: 'loyalty.points', description: 'Points this order earned', sample: '45' },
      ],
      defaultBody: [
        { block: 'text', text: 'You earned {{loyalty.points}} points', variant: 'heading' },
        { block: 'text', text: 'Thanks for your order with {{host.businessName}}.', variant: 'body' },
        BALANCE_LINE,
        SPEND_LINE,
        { block: 'text', text: '{{loyalty.referral}}', variant: 'body' },
        { block: 'button', label: 'Shop {{host.businessName}}', href: '{{host.url}}' },
      ],
      footerReason: 'You’re receiving this because you earned rewards with an order from {{host.businessName}}.',
    },
    {
      key: 'loyalty-store-credit',
      name: 'Store credit given',
      description: 'Tells a customer the store gave them store credit, with their rewards code to spend it.',
      pluginId: 'loyalty',
      plugin: 'Rewards',
      control: 'besigner',
      defaultSubject: 'You have {{loyalty.amount}} in store credit',
      mergeTokens: [
        ...BALANCE_TOKENS,
        { name: 'loyalty.amount', description: 'The credit given', sample: '$10.00' },
        { name: 'loyalty.note', description: 'The note the store wrote; empty when none', sample: 'Sorry about the delay!' },
      ],
      defaultBody: [
        { block: 'text', text: 'You have {{loyalty.amount}} in store credit', variant: 'heading' },
        { block: 'text', text: '{{loyalty.note}}', variant: 'body' },
        BALANCE_LINE,
        SPEND_LINE,
        { block: 'button', label: 'Shop {{host.businessName}}', href: '{{host.url}}' },
      ],
      footerReason: 'You’re receiving this because {{host.businessName}} gave you store credit.',
    },
    {
      key: 'loyalty-referral-reward',
      name: 'Referral reward',
      description: 'Tells a customer a friend’s first order earned them store credit.',
      pluginId: 'loyalty',
      plugin: 'Rewards',
      control: 'besigner',
      defaultSubject: 'A friend’s first order earned you {{loyalty.amount}}',
      mergeTokens: [...BALANCE_TOKENS, { name: 'loyalty.amount', description: 'The reward', sample: '$10.00' }],
      defaultBody: [
        { block: 'text', text: 'Your referral paid off', variant: 'heading' },
        {
          block: 'text',
          text: 'A friend used your referral code at {{host.businessName}}, so you have {{loyalty.amount}} more in store credit.',
          variant: 'body',
        },
        BALANCE_LINE,
        SPEND_LINE,
        { block: 'button', label: 'Shop {{host.businessName}}', href: '{{host.url}}' },
      ],
      footerReason: 'You’re receiving this because a friend used your referral code at {{host.businessName}}.',
    },
  ]
}
