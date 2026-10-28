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
 *
 * @jest-environment node
 */

/**
 * Before a closure, the hardware shop says which orders it will cancel and
 * refund (AGL-4038): the same unshipped orders the closure reads, each with
 * its number, items and amount, through core's closure notices.
 */

jest.mock('@aglyn/tenant-data-admin', () => {
  const fake = jest.requireActual('../testing/fake-firestore')
  return {
    __esModule: true,
    firebaseAdmin: {
      app: () => ({ firestore: () => fake.fakeFirestore }),
      firestore: { FieldValue: fake.fakeFieldValue },
    },
  }
})

import { readClosureNotices } from '@aglyn/aglyn/plugin-manager/plugin-closure-notices'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerCommerceConsoleServerDeclarations } from '../declarations.console-server'
import { fakeDocs, resetFakeFirestore } from '../testing/fake-firestore'
import { posHardwareClosureNotice, posHardwareClosureNoticeSource } from './pos-hardware-closure-notices'

const order = (status: string, createdBy = 'buyer-1') => ({
  status,
  createdBy,
  lines: [{ sku: 'stripe-reader-s710', name: 'Stripe Reader S710', quantity: 1, unitCents: 30_000, lineCents: 30_000 }],
  totalCents: 32_475,
})

beforeEach(() => {
  resetFakeFirestore()
  fakeDocs.set('orgs/org-1/hardwareOrders/hw_aaa111', order('paid'))
  fakeDocs.set('orgs/org-1/hardwareOrders/hw_bbb222', order('ordered'))
  fakeDocs.set('orgs/org-1/hardwareOrders/hw_ccc333', order('shipped'))
  fakeDocs.set('orgs/org-2/hardwareOrders/hw_ddd444', order('paid'))
  fakeDocs.set('orgs/org-2/hardwareOrders/hw_eee555', order('paid', 'someone-else'))
})

describe('posHardwareClosureNotice', () => {
  it('warns about each unshipped order with its number, items and amount', () => {
    const [notice] = posHardwareClosureNotice('workspace', [
      { orderId: 'hw_aaa111', order: order('paid') as never },
      { orderId: 'hw_ccc333', order: order('shipped') as never },
    ])
    expect(notice).toEqual({
      id: 'pos-hardware-unshipped-orders',
      severity: 'warning',
      title: 'A card reader order will be canceled and refunded',
      body: expect.stringContaining('When the workspace is deleted, it is canceled and refunded in full'),
      items: [{ id: 'hw_aaa111', primary: 'Order HW-AAA111', secondary: 'Stripe Reader S710 × 1', amount: '$324.75' }],
    })
  })

  it('says nothing when nothing is unshipped', () => {
    expect(posHardwareClosureNotice('account', [{ orderId: 'hw_ccc333', order: order('delivered') as never }])).toEqual([])
  })
})

describe('the hardware shop’s closure notices', () => {
  it('lists a workspace’s paid and ordered orders, never a shipped one', async () => {
    const [notice] = await posHardwareClosureNoticeSource.notices({ kind: 'workspace', orgId: 'org-1' })
    expect(notice.title).toBe('2 card reader orders will be canceled and refunded')
    expect(notice.items.map((item) => item.id).sort()).toEqual(['hw_aaa111', 'hw_bbb222'])
  })

  it('lists every unshipped order the person placed, in any workspace, and nobody else’s', async () => {
    const [notice] = await posHardwareClosureNoticeSource.notices({ kind: 'account', uid: 'buyer-1' })
    expect(notice.items.map((item) => item.id).sort()).toEqual(['hw_aaa111', 'hw_bbb222', 'hw_ddd444'])
    expect(notice.body).toContain('When your account is closed')
  })

  it('answers the console’s closure screens once registered, as commerce', async () => {
    resetPluginServicesForTests()
    registerCommerceConsoleServerDeclarations()
    const read = await readClosureNotices({ kind: 'workspace', orgId: 'org-1' })
    expect(read.unavailable).toEqual([])
    expect(read.notices).toEqual([expect.objectContaining({ pluginId: 'commerce', id: 'pos-hardware-unshipped-orders' })])
  })
})
