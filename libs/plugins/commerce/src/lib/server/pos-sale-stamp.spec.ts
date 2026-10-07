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

import { posOpsHarness, type PosOpsHarness } from '../testing/pos-ops-harness'
import { mintPosAssertion } from './pos-ops-gate'
import { posPaymentCashierId, posSaleCustomerFields, posSaleStamp } from './pos-sale-stamp'

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({ resolveOrgPermissions: jest.fn() }))

/**
 * What every register sale carries (AGL-3609): the cashier a PIN put at the
 * register, re-checked now; the open shift the X and Z reports count it
 * under; and the customer the lookup attached.
 */

let h: PosOpsHarness
const hostRef = () => h.memory.firestore.collection('hosts').doc('shop')
const cashierPin = (registerId = 'front', memberUid = 'cashier2') =>
  mintPosAssertion(h.deps, { hostId: 'shop', registerId, memberUid, purpose: 'cashier' }).token
const stamp = (overrides: Partial<Parameters<typeof posSaleStamp>[0]> = {}) =>
  posSaleStamp({
    hostId: 'shop',
    hostRef: hostRef() as any,
    registerId: 'front',
    openShiftId: 'shift-1',
    signedInUid: 'owner',
    body: {},
    config: {},
    deps: h.deps,
    ...overrides,
  })

beforeEach(() => {
  h = posOpsHarness()
})

describe('who rang the sale', () => {
  it('is the member signed in on the device when no PIN switched anyone in', async () => {
    const outcome = await stamp()
    expect(outcome).toEqual({ ok: true, stamp: { cashierId: 'owner', fields: { shiftId: 'shift-1' } } })
  })

  it('is the member a valid cashier PIN names', async () => {
    const outcome = await stamp({ body: { cashierAssertion: cashierPin() } })
    expect(outcome.ok && outcome.stamp.cashierId).toBe('cashier2')
  })

  it("falls back to the device's member for a PIN minted at another register", async () => {
    const outcome = await stamp({ body: { cashierAssertion: cashierPin('back') } })
    expect(outcome.ok && outcome.stamp.cashierId).toBe('owner')
  })

  it('never carries a member whose register access was revoked after the PIN was entered', async () => {
    const token = cashierPin()
    h.memberships['cashier2'] = { ...h.memberships['cashier2']!, permissions: { managePos: false } }
    const outcome = await stamp({ body: { cashierAssertion: token } })
    expect(outcome.ok && outcome.stamp.cashierId).toBe('owner')
  })

  it('refuses a forged assertion the same way as none', async () => {
    const outcome = await stamp({ body: { cashierAssertion: `${cashierPin().split('.')[0]}.forged` } })
    expect(outcome.ok && outcome.stamp.cashierId).toBe('owner')
  })
})

describe('the shift a sale is counted in', () => {
  it('takes no shift when none is open and the site does not require one', async () => {
    const outcome = await stamp({ openShiftId: null })
    expect(outcome).toEqual({ ok: true, stamp: { cashierId: 'owner', fields: {} } })
  })

  it('refuses the sale when the site requires an open shift and none is', async () => {
    const outcome = await stamp({ openShiftId: '', config: { posRequireOpenShift: true } })
    expect(outcome).toEqual({
      ok: false,
      status: 409,
      error: 'Open a shift on this register before ringing a sale.',
    })
    expect((await stamp({ config: { posRequireOpenShift: true } })).ok).toBe(true)
  })

  it('never stamps a shift id the dispatcher could not have written', async () => {
    const outcome = await stamp({ openShiftId: '../other' })
    expect(outcome.ok && outcome.stamp.fields).toEqual({})
  })
})

describe('the customer the lookup attached', () => {
  it('records the name and the record it came from', () => {
    expect(
      posSaleCustomerFields({ kind: 'crm', id: 'rec_1', name: ' Dana Diaz ', email: 'd@x.co', phone: '555' }),
    ).toEqual({ customerName: 'Dana Diaz', customerRecord: { kind: 'crm', id: 'rec_1' } })
  })

  it("never writes the phone: that field is a buyer's number for order texts", () => {
    expect(posSaleCustomerFields({ kind: 'crm', id: 'rec_1', phone: '555-0100' })).not.toHaveProperty(
      'customerPhone',
    )
  })

  it('keeps a typed receipt email as no record at all', () => {
    expect(posSaleCustomerFields({ kind: 'none', id: '', name: '', email: 'd@x.co' })).toEqual({})
  })

  it('drops an unusable id, and bounds the name', () => {
    expect(posSaleCustomerFields({ kind: 'crm', id: 'a/b', name: 'x'.repeat(500) })).toEqual({
      customerName: 'x'.repeat(200),
    })
    expect(posSaleCustomerFields('dana')).toEqual({})
    expect(posSaleCustomerFields(null)).toEqual({})
  })

  it('rides on the stamp', async () => {
    const outcome = await stamp({ body: { customer: { kind: 'crm', id: 'rec_1', name: 'Dana' } } })
    expect(outcome.ok && outcome.stamp.fields).toEqual({
      shiftId: 'shift-1',
      customerName: 'Dana',
      customerRecord: { kind: 'crm', id: 'rec_1' },
    })
  })
})

describe('who takes a payment toward an open sale', () => {
  beforeEach(() => {
    h.memory.seed('hosts/shop/orders/o1', { channel: 'pos', registerId: 'front', status: 'pending' })
  })

  const pay = (assertion: unknown, orderId = 'o1') =>
    posPaymentCashierId({ hostId: 'shop', orderId, signedInUid: 'owner', assertion, deps: h.deps })

  it("is the PIN member, checked against the sale's own register", async () => {
    expect(await pay(cashierPin('front'))).toBe('cashier2')
    expect(await pay(cashierPin('back'))).toBe('owner')
  })

  it("is the device's member with no assertion, or for a sale that does not exist", async () => {
    expect(await pay(undefined)).toBe('owner')
    expect(await pay(cashierPin('front'), 'missing')).toBe('owner')
  })
})
