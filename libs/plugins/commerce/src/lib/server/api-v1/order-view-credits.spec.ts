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

import { orderCreditsView, orderViewFromData } from './order-view'

/**
 * The plugin credits an order carries (AGL-3640), in the public order view
 * every order event and webhook carries: an online redemption as a discount,
 * a register payment as a tender — and only payments that went through.
 */
describe('order credits in the public order view', () => {
  it('lists an online redemption and the register’s succeeded credit payments', () => {
    const view = orderViewFromData('o-1', {
      credits: [
        { providerId: 'loyalty.rewards', pluginId: 'loyalty', reference: 'm:a', label: 'Rewards', last4: 'AAAA', amountCents: 500, appliedAs: 'discount' },
      ],
      payments: [
        { id: 'p1', method: 'credit', status: 'succeeded', amountCents: 300, creditProviderId: 'loyalty.rewards', creditReference: 'm:b', creditLabel: 'Rewards', last4: 'BBBB' },
        { id: 'p2', method: 'credit', status: 'reversed', amountCents: 900, creditProviderId: 'loyalty.rewards', creditReference: 'm:c' },
        { id: 'p3', method: 'cash', status: 'succeeded', amountCents: 100 },
      ],
    })
    expect(view.credits).toEqual([
      { providerId: 'loyalty.rewards', pluginId: 'loyalty', reference: 'm:a', label: 'Rewards', last4: 'AAAA', amountCents: 500, appliedAs: 'discount' },
      { providerId: 'loyalty.rewards', pluginId: 'loyalty', reference: 'm:b', label: 'Rewards', last4: 'BBBB', amountCents: 300, appliedAs: 'tender' },
    ])
  })

  it('is empty for an order no plugin credit touched, and drops what cannot be traced', () => {
    expect(orderViewFromData('o-2', {}).credits).toEqual([])
    expect(orderCreditsView({ credits: [{ providerId: 'x.y', amountCents: 5 }, { amountCents: 5 }] })).toEqual([])
  })
})
