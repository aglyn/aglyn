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

import { MemoryFirestore } from '../testing/memory-firestore'

const store = { current: new MemoryFirestore() }

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => store.current }) },
  getOrgForHost: jest.fn(async () => ({ orgId: 'org1', org: { id: 'org1', timeZone: 'America/Chicago' } })),
}))
jest.mock('@aglyn/aglyn/server', () => ({ checkEntitlement: jest.fn(() => true) }))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: jest.fn(async () => ({ permissions: { managePos: true } })),
}))
jest.mock('./download', () => ({ tokenSigningSecret: () => 'test-signing-secret' }))
// The sale-completed seam's own module pulls in Stripe and email; the
// listener needs only its event type.
jest.mock('./pos-sale', () => ({}))

import { printCompletedSale, receiptChoiceForPrinting, saleTookCash } from './sale-printing'

const HOST = 'host1'

const jobs = () =>
  [...store.current.docs.entries()]
    .filter(([path]) => path.startsWith(`hosts/${HOST}/printJobs/`))
    .map(([path, stored]) => ({ id: path.split('/').pop(), ...stored.data }))

function printer(id: string, settings: Record<string, unknown>) {
  store.current.write(`hosts/${HOST}/printers/${id}`, {
    name: id,
    brand: 'star',
    deviceId: `00:11:62:00:00:0${id.length}`,
    registerId: 'reg1',
    paperWidthMm: 80,
    autoPrintReceipts: false,
    kickDrawer: false,
    secretVersion: 1,
    createdAtMs: id === 'counter' ? 1 : 2,
    ...settings,
  })
}

function sale(overrides: Record<string, unknown> = {}) {
  store.current.write(`hosts/${HOST}/orders/o1`, {
    channel: 'pos',
    status: 'paid',
    registerId: 'reg1',
    number: 1042,
    currency: 'usd',
    cashierId: 'clerk',
    lineItems: [{ productId: 'p1', name: 'Latte', quantity: 2, unitAmountCents: 450 }],
    totals: { itemsCents: 900, totalCents: 900 },
    payments: [
      { id: 'pay_cash', method: 'cash', amountCents: 900, status: 'succeeded', cashTenderedCents: 1000, changeCents: 100 },
    ],
    ...overrides,
  })
}

const EVENT = { hostId: HOST, orderId: 'o1', order: { status: 'paid', channel: 'pos', registerId: 'reg1' } as any }

beforeEach(() => {
  store.current = new MemoryFirestore()
  store.current.write(`hosts/${HOST}`, { displayName: 'Corner Cafe' })
  store.current.write(`hosts/${HOST}/registers/reg1`, { name: 'Front counter' })
})

describe('printCompletedSale (AGL-3619)', () => {
  it('prints the receipt with the drawer kick on a cash sale, and a kitchen ticket', async () => {
    printer('counter', { autoPrintReceipts: true, kickDrawer: true })
    printer('kitchen', { kitchenTickets: true })
    sale()
    await printCompletedSale(EVENT, store.current)
    const byKind = Object.fromEntries(jobs().map((job: any) => [job.kind, job]))
    expect(byKind['receipt']).toMatchObject({
      printerId: 'counter',
      openDrawer: true,
      orderId: 'o1',
      reason: 'sale',
      createdBy: 'clerk',
      receipt: expect.objectContaining({ orderNumber: '1042', changeCents: 100, registerName: 'Front counter' }),
    })
    expect(byKind['kitchen']).toMatchObject({ printerId: 'kitchen' })
    expect(jobs()).toHaveLength(2)
  })

  it('never opens the drawer on a card sale', async () => {
    printer('counter', { autoPrintReceipts: true, kickDrawer: true })
    sale({ payments: [{ id: 'pay_card', method: 'card_present', amountCents: 900, status: 'succeeded' }] })
    await printCompletedSale(EVENT, store.current)
    expect(jobs()).toEqual([expect.objectContaining({ kind: 'receipt' })])
    expect((jobs()[0] as any).openDrawer).toBeUndefined()
  })

  it('opens the drawer for the cash half of a split sale, and not for a failed cash attempt', async () => {
    printer('counter', { kickDrawer: true })
    sale({
      payments: [
        { id: 'a', method: 'cash', amountCents: 400, status: 'failed' },
        { id: 'b', method: 'card_present', amountCents: 900, status: 'succeeded' },
      ],
    })
    await printCompletedSale(EVENT, store.current)
    expect(jobs()).toEqual([])
    sale({
      payments: [
        { id: 'a', method: 'cash', amountCents: 400, status: 'succeeded' },
        { id: 'b', method: 'card_present', amountCents: 500, status: 'succeeded' },
      ],
    })
    await printCompletedSale({ ...EVENT }, store.current)
    expect(jobs()).toEqual([expect.objectContaining({ kind: 'drawer' })])
  })

  it('prints once however often the sale is announced', async () => {
    printer('counter', { autoPrintReceipts: true, kickDrawer: true })
    sale()
    await printCompletedSale(EVENT, store.current)
    await printCompletedSale(EVENT, store.current)
    expect(jobs()).toHaveLength(1)
  })

  it('prints nothing for an unpaid, a web or a missing order', async () => {
    printer('counter', { autoPrintReceipts: true, kickDrawer: true })
    sale({ status: 'open' })
    await printCompletedSale(EVENT, store.current)
    sale({ channel: 'web' })
    await printCompletedSale(EVENT, store.current)
    await printCompletedSale({ ...EVENT, orderId: 'nope' }, store.current)
    expect(jobs()).toEqual([])
  })

  it('reads the customer’s receipt choice', () => {
    expect(receiptChoiceForPrinting({ receiptRequest: { channel: 'email' } } as any)).toBe('none')
    expect(receiptChoiceForPrinting({ receiptRequest: { channel: 'print' } } as any)).toBe('print')
    expect(receiptChoiceForPrinting({} as any)).toBeUndefined()
    expect(saleTookCash({ payments: [{ method: 'cash', status: 'succeeded' }] } as any)).toBe(true)
    expect(saleTookCash({} as any)).toBe(false)
  })
})
