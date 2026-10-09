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
import { handlePosShift, posShiftForSale } from './pos-shift'
import { authorizePosOps, mintPosAssertion } from './pos-ops-gate'

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({ resolveOrgPermissions: jest.fn() }))

/**
 * Shifts and the cash drawer (AGL-3609): one open shift per register, the
 * cash events, the X and Z reports and the variance, each against an
 * in-memory site through the route itself.
 */

let h: PosOpsHarness
const shift = (body: Record<string, unknown>, uid = 'cashier') =>
  handlePosShift(h.deps, h.request(uid, { hostId: 'shop', registerId: 'front', ...body }))

beforeEach(() => {
  h = posOpsHarness()
})

describe('who may run a shift', () => {
  it('refuses the signed-out, a viewer, a member without managePos and a plan without POS', async () => {
    expect((await handlePosShift(h.deps, h.request(null, { hostId: 'shop', registerId: 'front', action: 'current' }))).status).toBe(401)
    expect((await shift({ action: 'current' }, 'viewer')).status).toBe(403)
    h.memberships['cashier'] = { ...h.memberships['cashier']!, permissions: { managePos: false } }
    expect((await shift({ action: 'current' })).status).toBe(403)
    h.memberships['cashier'] = { ...h.memberships['cashier']!, permissions: { managePos: true } }
    h.entitled.pos = false
    expect((await shift({ action: 'current' })).status).toBe(403)
  })

  it("refuses another site's register as unknown", async () => {
    const outcome = await shift({ action: 'open', registerId: 'theirs', openingFloatCents: 100 })
    expect(outcome.status).toBe(404)
    expect(h.memory.read('hosts/other/registers/theirs')?.['openShiftId']).toBeUndefined()
  })
})

describe('one open shift per register', () => {
  it('opens with a float and names it on the register', async () => {
    const outcome = await shift({ action: 'open', openingFloatCents: 15000 })
    expect(outcome.status).toBe(200)
    const opened = outcome.body['shift'] as { id: string; openingFloatCents: number; openedBy: string }
    expect(opened.openingFloatCents).toBe(15000)
    expect(opened.openedBy).toBe('cashier')
    expect(h.memory.read('hosts/shop/registers/front')?.['openShiftId']).toBe(opened.id)
    // Every field the history sorts by is on the shift from the start (AGL-3680).
    expect(h.memory.read(`hosts/shop/registers/front/shifts/${opened.id}`)).toMatchObject({
      closedAtMs: null,
      netSalesCents: null,
      expectedCashCents: null,
      countedCashCents: null,
      varianceCents: null,
    })
  })

  it('refuses a second open while one stands', async () => {
    await shift({ action: 'open', openingFloatCents: 10000 })
    const second = await shift({ action: 'open', openingFloatCents: 5000 })
    expect(second.status).toBe(409)
  })

  it('lets exactly one of two racing opens win', async () => {
    const [a, b] = await Promise.all([
      shift({ action: 'open', openingFloatCents: 100 }),
      shift({ action: 'open', openingFloatCents: 200 }, 'cashier2'),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const shifts = [...h.memory.docs.keys()].filter((path) => path.startsWith('hosts/shop/registers/front/shifts/'))
    expect(shifts).toHaveLength(1)
  })

  it('keeps each register to itself', async () => {
    expect((await shift({ action: 'open', openingFloatCents: 100 })).status).toBe(200)
    expect((await shift({ action: 'open', registerId: 'back', openingFloatCents: 100 })).status).toBe(200)
  })

  it('refuses a float that is not an amount', async () => {
    expect((await shift({ action: 'open', openingFloatCents: -5 })).status).toBe(400)
    expect((await shift({ action: 'open', openingFloatCents: 'lots' })).status).toBe(400)
  })
})

describe('cash in and out of the drawer', () => {
  beforeEach(async () => {
    await shift({ action: 'open', openingFloatCents: 10000 })
  })

  it('records paid in, paid out and a drop, once each however often a tap is retried', async () => {
    await shift({ action: 'cash-event', type: 'paid_in', amountCents: 2000, reason: 'Change from bank', eventId: 'e1' })
    await shift({ action: 'cash-event', type: 'paid_out', amountCents: 500, reason: 'Milk', eventId: 'e2' })
    const retried = await shift({ action: 'cash-event', type: 'paid_out', amountCents: 500, reason: 'Milk', eventId: 'e2' })
    expect(retried.body['replayed']).toBe(true)
    await shift({ action: 'cash-event', type: 'drop', amountCents: 5000, reason: '', eventId: 'e3' })
    const openShiftId = h.memory.read('hosts/shop/registers/front')?.['openShiftId']
    const events = h.memory.read(`hosts/shop/registers/front/shifts/${openShiftId}`)?.['cashEvents'] as unknown[]
    expect(events).toHaveLength(3)
  })

  it('needs a reason for paid in and out, and an amount', async () => {
    expect((await shift({ action: 'cash-event', type: 'paid_out', amountCents: 500 })).status).toBe(400)
    expect((await shift({ action: 'cash-event', type: 'paid_in', amountCents: 0, reason: 'x' })).status).toBe(400)
    expect((await shift({ action: 'cash-event', type: 'refund', amountCents: 100, reason: 'x' })).status).toBe(400)
  })

  it('refuses cash events with no shift open', async () => {
    const back = await shift({ action: 'cash-event', registerId: 'back', type: 'paid_in', amountCents: 100, reason: 'x' })
    expect(back.status).toBe(409)
  })
})

describe('the X and Z reports', () => {
  async function sale(id: string, data: Record<string, unknown>) {
    const shiftId = h.memory.read('hosts/shop/registers/front')?.['openShiftId']
    h.memory.seed(`hosts/shop/orders/${id}`, { channel: 'pos', status: 'paid', shiftId, ...data })
  }

  beforeEach(async () => {
    await shift({ action: 'open', openingFloatCents: 10000 })
    await sale('o-cash', { totals: { totalCents: 2160, discountCents: 200, taxCents: 160 } })
    await sale('o-split', {
      totals: { totalCents: 5000, taxCents: 400, tipCents: 500 },
      payments: [
        { id: 'p1', method: 'cash', amountCents: 2000, status: 'succeeded', cashTenderedCents: 2000 },
        { id: 'p2', method: 'card_present', amountCents: 3000, tipCents: 500, status: 'succeeded', last4: '4242' },
        { id: 'p3', method: 'card_present', amountCents: 3000, status: 'failed' },
      ],
    })
    await sale('o-pending', { status: 'pending', totals: { totalCents: 999 } })
    await sale('o-cancelled', { status: 'cancelled', totals: { totalCents: 999 } })
    h.memory.seed('hosts/shop/orders/o-elsewhere', { channel: 'pos', status: 'paid', shiftId: 'another', totals: { totalCents: 777 } })
    await shift({ action: 'cash-event', type: 'paid_out', amountCents: 300, reason: 'Stamps', eventId: 'x1' })
  })

  it('the X report counts the shift so far and closes nothing', async () => {
    const outcome = await shift({ action: 'x-report' })
    expect(outcome.status).toBe(200)
    const report = outcome.body['report'] as Record<string, any>
    expect(report['orderCount']).toBe(2)
    expect(report['grossSalesCents']).toBe(7160)
    expect(report['discountsCents']).toBe(200)
    expect(report['taxCents']).toBe(560)
    expect(report['tipsCents']).toBe(500)
    expect(report['salesByTender']).toEqual({ cash: 4160, card_present: 3000 })
    // float 100.00 + cash sales 41.60 − paid out 3.00
    expect(report['expectedCashCents']).toBe(10000 + 4160 - 300)
    expect(h.memory.read('hosts/shop/registers/front')?.['openShiftId']).toBeTruthy()
  })

  it('the Z report freezes the figures, the count and the variance, and frees the register', async () => {
    const shiftId = String(h.memory.read('hosts/shop/registers/front')?.['openShiftId'])
    const outcome = await shift({ action: 'close', countedCashCents: 13800, shiftId, note: 'Short a bit' })
    expect(outcome.status).toBe(200)
    const stored = h.memory.read(`hosts/shop/registers/front/shifts/${shiftId}`)!
    expect(stored['status']).toBe('closed')
    expect(stored['expectedCashCents']).toBe(13860)
    expect(stored['countedCashCents']).toBe(13800)
    expect(stored['varianceCents']).toBe(-60)
    expect(stored['report']['orderCount']).toBe(2)
    // Flattened so the history can order by it (AGL-3680).
    expect(stored['netSalesCents']).toBe(stored['report']['netSalesCents'])
    expect(typeof stored['closedAtMs']).toBe('number')
    expect(stored['closedBy']).toBe('cashier')
    expect(h.memory.read('hosts/shop/registers/front')?.['openShiftId']).toBeNull()
    // A new shift may open now.
    expect((await shift({ action: 'open', openingFloatCents: 100 })).status).toBe(200)
  })

  it('a stale tablet cannot close the next shift with the last one’s count', async () => {
    const first = String(h.memory.read('hosts/shop/registers/front')?.['openShiftId'])
    await shift({ action: 'close', countedCashCents: 1, shiftId: first })
    await shift({ action: 'open', openingFloatCents: 100 })
    const stale = await shift({ action: 'close', countedCashCents: 1, shiftId: first })
    expect(stale.status).toBe(409)
  })

  it('counts a cash return paid out of the drawer against the expected cash', async () => {
    const shiftId = String(h.memory.read('hosts/shop/registers/front')?.['openShiftId'])
    const path = `hosts/shop/registers/front/shifts/${shiftId}`
    const events = h.memory.read(path)!['cashEvents'] as unknown[]
    h.memory.seed(path, {
      ...h.memory.read(path),
      cashEvents: [...events, { id: 'r1', type: 'refund', amountCents: 1000, reason: 'Return #1', by: 'cashier', atMs: 1 }],
    })
    h.memory.seed('hosts/shop/registers/front/returns/r1', {
      shiftId,
      refundedCents: 1000,
      tenders: [{ method: 'cash', amountCents: 1000, status: 'refunded' }],
    })
    const report = (await shift({ action: 'x-report' })).body['report'] as Record<string, any>
    expect(report['cashRefundsCents']).toBe(1000)
    expect(report['refundsByTender']).toEqual({ cash: 1000 })
    expect(report['netSalesCents']).toBe(7160 - 1000)
    expect(report['expectedCashCents']).toBe(10000 + 4160 - 300 - 1000)
  })
})

describe('the cashier a PIN put at the register', () => {
  it('stamps the shift with the PIN member, not the device', async () => {
    const { token } = mintPosAssertion(h.deps, { hostId: 'shop', registerId: 'front', memberUid: 'cashier2', purpose: 'cashier' })
    const outcome = await shift({ action: 'open', openingFloatCents: 0, cashierAssertion: token }, 'owner')
    expect((outcome.body['shift'] as { openedBy: string }).openedBy).toBe('cashier2')
  })

  it('falls back to the signed-in member when the assertion is for another register', async () => {
    const { token } = mintPosAssertion(h.deps, { hostId: 'shop', registerId: 'back', memberUid: 'cashier2', purpose: 'cashier' })
    const outcome = await shift({ action: 'open', openingFloatCents: 0, cashierAssertion: token }, 'owner')
    expect((outcome.body['shift'] as { openedBy: string }).openedBy).toBe('owner')
  })
})

describe('the open-shift rule for a sale', () => {
  it('lets a sale through without a shift unless the site requires one', async () => {
    const gate = await authorizePosOps(h.deps, h.request('cashier', {}), 'shop')
    if ('error' in gate) throw new Error(gate.error)
    const register = h.memory.firestore.collection('hosts').doc('shop').collection('registers').doc('front')
    expect(await posShiftForSale(gate.staff, register)).toEqual({ ok: true, shiftId: null })
    expect(await posShiftForSale({ settings: { ...gate.staff.settings, requireOpenShift: true } }, register)).toMatchObject({ ok: false })
    await shift({ action: 'open', openingFloatCents: 0 })
    const open = await posShiftForSale({ settings: { ...gate.staff.settings, requireOpenShift: true } }, register)
    expect(open).toMatchObject({ ok: true })
    expect((open as { shiftId: string }).shiftId).toBeTruthy()
  })
})

describe('the drawer and the receipt printer (AGL-3619 queue)', () => {
  beforeEach(async () => {
    await shift({ action: 'open', openingFloatCents: 10000 })
  })

  it('opens the drawer once per cash event, keyed on the event, never on a replay', async () => {
    await shift({ action: 'cash-event', type: 'paid_out', amountCents: 500, reason: 'Milk', eventId: 'e1' })
    await shift({ action: 'cash-event', type: 'paid_out', amountCents: 500, reason: 'Milk', eventId: 'e1' })
    await shift({ action: 'cash-event', type: 'drop', amountCents: 5000, reason: '', eventId: 'e2' })
    expect(h.printed).toEqual([
      {
        kind: 'drawer',
        input: { hostId: 'shop', registerId: 'front', reason: 'paid_out', causeId: 'e1', createdBy: 'cashier' },
      },
      {
        kind: 'drawer',
        input: { hostId: 'shop', registerId: 'front', reason: 'drop', causeId: 'e2', createdBy: 'cashier' },
      },
    ])
  })

  it('does not open the drawer for a refused cash event', async () => {
    await shift({ action: 'cash-event', type: 'paid_out', amountCents: 500 })
    await shift({ action: 'cash-event', registerId: 'back', type: 'paid_in', amountCents: 100, reason: 'x' })
    expect(h.printed).toEqual([])
  })

  it('prints the open shift as an X report, with the figures the screen shows', async () => {
    h.memory.seed('hosts/shop', { ...h.memory.read('hosts/shop'), displayName: 'Corner Shop' })
    await shift({ action: 'cash-event', type: 'paid_in', amountCents: 2000, reason: 'Bank', eventId: 'e1' })
    const outcome = await shift({ action: 'print-report', attemptKey: 'a1' })
    expect(outcome.status).toBe(200)
    expect(outcome.body).toEqual({ printed: true, jobIds: ['job-2'] })
    const printed = h.printed[1]!
    expect(printed.kind).toBe('report')
    expect(printed.input['attemptKey']).toBe('a1')
    expect(printed.input['report']['title']).toBe('X REPORT')
    expect(printed.input['report']['storeName']).toBe('Corner Shop')
    expect(printed.input['report']['subtitle']).toBe('Front - Opened by Cal Cashier')
    const drawer = printed.input['report']['sections'].find((section: any) => section.section === 'Cash drawer')
    expect(drawer.rows).toContainEqual({ label: 'Expected in drawer', value: '$120.00', strong: true })
  })

  it('prints a closed shift as its frozen Z report, with the count and the variance', async () => {
    const shiftId = String(h.memory.read('hosts/shop/registers/front')?.['openShiftId'])
    await shift({ action: 'close', countedCashCents: 9950, shiftId })
    const outcome = await shift({ action: 'print-report', shiftId, attemptKey: 'z1' })
    expect(outcome.status).toBe(200)
    const report = h.printed.at(-1)!.input['report']
    expect(report['title']).toBe('Z REPORT')
    const drawer = report['sections'].find((section: any) => section.section === 'Cash drawer')
    expect(drawer.rows).toContainEqual({ label: 'Counted', value: '$99.50' })
    expect(drawer.rows).toContainEqual({ label: 'Short', value: '-$0.50', strong: true })
  })

  it('says when there is no cloud printer, so the register prints through the browser', async () => {
    h.deps.printer.printReport = async () => ({ jobIds: [] })
    const outcome = await shift({ action: 'print-report' })
    expect(outcome.body).toEqual({ printed: false, jobIds: [] })
  })

  it('refuses a report with no shift, and a shift that does not exist', async () => {
    expect((await shift({ action: 'print-report', registerId: 'back' })).status).toBe(409)
    expect((await shift({ action: 'print-report', shiftId: 'nope' })).status).toBe(404)
  })
})
