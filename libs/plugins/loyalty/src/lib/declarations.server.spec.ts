/**
 * @jest-environment node
 */
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

import {
  checkoutCreditProvider,
  checkoutCreditProviderForCode,
} from '@aglyn/aglyn/plugin-manager/plugin-checkout-credits'
import { listPluginDomainEventSubscribers } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { loyaltyTenantEmails } from './tenant-emails'
import { LOYALTY_EMAIL_KEYS } from './constants/bundle-common'

jest.mock('./server/credit-provider', () => ({}))
jest.mock('./server/order-events', () => ({}))

/**
 * What loyalty registers at boot (AGL-3640): its checkout credit, found by
 * the codes it mints and by nothing else, and its order-event subscribers —
 * with no server module loaded until one is called.
 */
describe('loyalty server declarations', () => {
  beforeAll(async () => {
    await import('./declarations.server')
  })

  it('registers the rewards credit under loyalty.rewards, for its own codes only', () => {
    expect(checkoutCreditProvider('loyalty.rewards')?.provider.label).toBe('Rewards')
    expect(checkoutCreditProviderForCode('rw-7k3p-q9xz-2m4d')?.providerId).toBe('loyalty.rewards')
    expect(checkoutCreditProviderForCode('RF-7K3P9X')?.providerId).toBe('loyalty.rewards')
    expect(checkoutCreditProviderForCode('GC-ABCDEFGH')).toBeNull()
    expect(typeof checkoutCreditProvider('loyalty.rewards')?.provider.lookup).toBe('function')
  })

  it('subscribes to the order events it earns and gives back on', () => {
    const subscribed = (event: string) => listPluginDomainEventSubscribers(event)
    expect(subscribed('order.paid')).toEqual(expect.arrayContaining(['loyalty:earn']))
    expect(subscribed('order.refunded')).toEqual(expect.arrayContaining(['loyalty:refund']))
    expect(subscribed('order.cancelled')).toEqual(expect.arrayContaining(['loyalty:cancel']))
  })

  it('declares every email it sends as a designable catalog entry', () => {
    const keys = loyaltyTenantEmails().map((entry) => entry.key)
    expect(keys.sort()).toEqual(Object.values(LOYALTY_EMAIL_KEYS).sort())
    for (const entry of loyaltyTenantEmails()) {
      expect(entry).toMatchObject({ pluginId: 'loyalty', control: 'besigner' })
      expect(entry.footerReason).toContain('{{host.businessName}}')
    }
  })
})
