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

import type { PluginApiRequest } from '@aglyn/aglyn/server'
import type { PosDayReport } from '../model/commerce-pos-day-report'
import { posOpsHarness, type PosOpsHarness } from '../testing/pos-ops-harness'
import { createPosDayReportHandler, handlePosDayReport } from './pos-day-report'
import { handlePosShift } from './pos-shift'

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({ resolveOrgPermissions: jest.fn() }))

/**
 * Day and event totals (AGL-4037): every register, shift and cashier on the
 * site over a day in the store's own time zone, through the route itself
 * against an in-memory site.
 *
 * The clock reads 2027-01-15 08:00Z, which is 02:00 on the 15th in Chicago
 * (UTC−6 in January): the store's day runs 06:00Z on the 15th to 06:00Z on
 * the 16th.
 */

const DAY_START = Date.UTC(2027, 0, 15, 6)
const DAY_END = Date.UTC(2027, 0, 16, 6)
const HOUR = 3_600_000

let h: PosOpsHarness

function get(uid: string | null, query: Record<string, string>, method = 'GET'): PluginApiRequest {
  return {
    method,
    headers: uid ? { authorization: `Bearer token-${uid}` } : {},
    body: {},
    query,
    cookies: {},
    socket: {},
  }
}

const report = async (query: Record<string, string> = {}, uid = 'cashier') => {
  const outcome = await handlePosDayReport(h.deps, get(uid, { hostId: 'shop', ...query }))
  if ('csv' in outcome) throw new Error('expected JSON')
  return outcome
}

const shift = (body: Record<string, unknown>, uid = 'cashier') =>
  handlePosShift(h.deps, h.request(uid, { hostId: 'shop', ...body }))

function sale(id: string, data: Record<string, unknown>) {
  h.memory.seed(`hosts/shop/orders/${id}`, { channel: 'pos', status: 'paid', ...data })
}

beforeEach(() => {
  h = posOpsHarness()
  h.memory.seed('hosts/shop', {
    memberRoles: { owner: 'admin', cashier: 'editor', cashier2: 'editor', viewer: 'viewer' },
    timeZone: 'America/Chicago',
  })
})

describe('who may read the day totals', () => {
  it('refuses the signed-out, a viewer, a member without managePos and a plan without POS', async () => {
    expect((await handlePosDayReport(h.deps, get(null, { hostId: 'shop' }))).status).toBe(401)
    expect((await report({}, 'viewer')).status).toBe(403)
    h.memberships['cashier'] = { ...h.memberships['cashier']!, permissions: { managePos: false } }
    expect((await report()).status).toBe(403)
    h.memberships['cashier'] = { ...h.memberships['cashier']!, permissions: { managePos: true } }
    h.entitled.pos = false
    expect((await report()).status).toBe(403)
  })

  it('answers only GET, and needs a site', async () => {
    expect((await handlePosDayReport(h.deps, get('cashier', { hostId: 'shop' }, 'POST'))).status).toBe(405)
    expect((await handlePosDayReport(h.deps, get('cashier', {}))).status).toBe(400)
    expect((await handlePosDayReport(h.deps, get('cashier', { hostId: 'nowhere' }))).status).toBe(404)
  })

  it("never counts another site's sales", async () => {
    h.memory.seed('hosts/other/orders/theirs', {
      channel: 'pos',
      status: 'paid',
      registerId: 'theirs',
      createdAtMs: DAY_START + HOUR,
      totals: { totalCents: 99_900 },
    })
    const outcome = await report()
    expect((outcome.body['report'] as PosDayReport).totals.orderCount).toBe(0)
  })
})

describe('the range', () => {
  it("defaults to today in the store's time zone", async () => {
    const r = (await report()).body['report'] as PosDayReport
    expect(r.timeZone).toBe('America/Chicago')
    expect(r.from).toBe('2027-01-15')
    expect(r.to).toBe('2027-01-15')
    expect(r.startMs).toBe(DAY_START)
    expect(r.endMs).toBe(DAY_END)
    expect(r.days).toBe(1)
  })

  it('takes a first and last day, up to 31 days', async () => {
    const r = (await report({ from: '2027-01-01', to: '2027-01-31' })).body['report'] as PosDayReport
    expect(r.days).toBe(31)
    expect((await report({ from: '2027-01-01', to: '2027-02-01' })).status).toBe(400)
  })

  it('refuses a day that is not a date, and a last day before the first', async () => {
    expect((await report({ from: '2027-02-30' })).status).toBe(400)
    expect((await report({ from: 'yesterday' })).status).toBe(400)
    expect((await report({ from: '2027-01-15', to: '2027-01-14' })).status).toBe(400)
  })

  it('refuses a format it does not speak', async () => {
    expect((await report({ format: 'xml' })).status).toBe(400)
  })
})

describe('the totals across every register, shift and cashier', () => {
  beforeEach(async () => {
    // FRONT: a shift opened at 07:00Z with a $100 float, a cash sale rung on
    // it, a cash return, then closed $1 short.
    h.clock.now = DAY_START + HOUR
    const front = await shift({ registerId: 'front', action: 'open', openingFloatCents: 10_000 })
    const frontShiftId = (front.body['shift'] as { id: string }).id
    sale('o-cash', {
      registerId: 'front',
      shiftId: frontShiftId,
      cashierId: 'cashier',
      createdAtMs: DAY_START + 2 * HOUR,
      totals: { totalCents: 2160, discountCents: 200, taxCents: 160 },
    })
    // A split tender: part cash, part card with a tip, and a declined card.
    sale('o-split', {
      registerId: 'front',
      shiftId: frontShiftId,
      cashierId: 'cashier2',
      createdAtMs: DAY_START + 3 * HOUR,
      totals: { totalCents: 5000, taxCents: 400, tipCents: 500 },
      payments: [
        { id: 'p1', method: 'cash', amountCents: 2000, status: 'succeeded' },
        { id: 'p2', method: 'card_present', amountCents: 3000, tipCents: 500, status: 'succeeded' },
        { id: 'p3', method: 'card_present', amountCents: 3000, status: 'failed' },
      ],
    })
    h.clock.now = DAY_START + 4 * HOUR
    h.memory.seed('hosts/shop/registers/front/returns/r1', {
      registerId: 'front',
      cashierId: 'cashier',
      shiftId: frontShiftId,
      refundedCents: 1000,
      tenders: [{ method: 'cash', amountCents: 1000, status: 'refunded' }],
      atMs: DAY_START + 4 * HOUR,
    })
    const shiftPath = `hosts/shop/registers/front/shifts/${frontShiftId}`
    h.memory.seed(shiftPath, {
      ...h.memory.read(shiftPath),
      cashEvents: [
        { id: 'r1', type: 'refund', amountCents: 1000, reason: 'Return', by: 'cashier', atMs: DAY_START + 4 * HOUR },
      ],
    })
    h.clock.now = DAY_START + 5 * HOUR
    // float 100.00 + cash 41.60 − cash refund 10.00 = 131.60; counted 130.60.
    await shift({ registerId: 'front', action: 'close', countedCashCents: 13_060 })

    // BACK: a shift still open, with $50 float, a paid in and a gift card sale.
    h.clock.now = DAY_START + 6 * HOUR
    const back = await shift({ registerId: 'back', action: 'open', openingFloatCents: 5000 }, 'cashier2')
    const backShiftId = (back.body['shift'] as { id: string }).id
    await shift({ registerId: 'back', action: 'cash-event', type: 'paid_in', amountCents: 2500, reason: 'Change', eventId: 'e1' }, 'cashier2')
    sale('o-gift', {
      registerId: 'back',
      shiftId: backShiftId,
      cashierId: 'cashier2',
      createdAtMs: DAY_START + 7 * HOUR,
      totals: { totalCents: 1500 },
      payments: [{ id: 'g1', method: 'gift_card', amountCents: 1500, status: 'succeeded', giftCardId: 'gc' }],
    })
    // A sale on the very first millisecond of the day counts; the one before it does not.
    sale('o-midnight', {
      registerId: 'back',
      cashierId: 'cashier2',
      createdAtMs: DAY_START,
      totals: { totalCents: 300 },
      payments: [{ id: 'c1', method: 'card_present', amountCents: 300, status: 'succeeded' }],
    })
    sale('o-yesterday', { registerId: 'back', createdAtMs: DAY_START - 1, totals: { totalCents: 99_000 } })
    sale('o-tomorrow', { registerId: 'back', createdAtMs: DAY_END, totals: { totalCents: 99_000 } })
    // Neither an online order, nor a pending or canceled sale, counts.
    sale('o-online', { channel: 'web', createdAtMs: DAY_START + HOUR, totals: { totalCents: 99_000 } })
    sale('o-pending', { status: 'pending', registerId: 'back', createdAtMs: DAY_START + HOUR, totals: { totalCents: 99_000 } })
    sale('o-canceled', { status: 'cancelled', registerId: 'back', createdAtMs: DAY_START + HOUR, totals: { totalCents: 99_000 } })
    h.clock.now = DAY_START + 8 * HOUR
  })

  it('totals the sales of every register', async () => {
    const r = (await report()).body['report'] as PosDayReport
    expect(r.currency).toBe('usd')
    expect(r.totals).toEqual({
      orderCount: 4,
      grossSalesCents: 2160 + 5000 + 1500 + 300,
      discountsCents: 200,
      taxCents: 560,
      tipsCents: 500,
      refundCount: 1,
      refundsCents: 1000,
      netSalesCents: 2160 + 5000 + 1500 + 300 - 1000,
      salesByTender: { cash: 4160, card_present: 3300, gift_card: 1500 },
    })
    expect(r.truncated).toBeUndefined()
  })

  it('breaks the day down by tender, refunds netted against the tender they went back to', async () => {
    const r = (await report()).body['report'] as PosDayReport
    expect(r.byTender).toEqual([
      { method: 'cash', label: 'Cash', salesCents: 4160, refundsCents: 1000, netCents: 3160 },
      { method: 'card_present', label: 'Card', salesCents: 3300, refundsCents: 0, netCents: 3300 },
      { method: 'gift_card', label: 'Gift card', salesCents: 1500, refundsCents: 0, netCents: 1500 },
    ])
  })

  it('breaks the day down by register and by cashier', async () => {
    const r = (await report()).body['report'] as PosDayReport
    expect(r.byRegister.map((row) => [row.name, row.orderCount, row.netSalesCents])).toEqual([
      ['Back', 2, 1800],
      ['Front', 2, 7160 - 1000],
    ])
    expect(r.byCashier.map((row) => [row.memberId, row.name, row.orderCount, row.netSalesCents])).toEqual([
      ['cashier2', 'cashier2', 3, 6800],
      ['cashier', 'Cal Cashier', 1, 2160 - 1000],
    ])
  })

  it('lists the closed shift with its count and the open one with its drawer so far', async () => {
    const r = (await report()).body['report'] as PosDayReport
    expect(r.shifts).toHaveLength(2)
    const [front, back] = r.shifts
    expect(front).toMatchObject({
      registerName: 'Front',
      status: 'closed',
      openingFloatCents: 10_000,
      expectedCashCents: 13_160,
      countedCashCents: 13_060,
      varianceCents: -100,
      openedByName: 'Cal Cashier',
    })
    expect(back).toMatchObject({
      registerName: 'Back',
      status: 'open',
      closedAtMs: null,
      countedCashCents: null,
      varianceCents: null,
      // float 50.00 + paid in 25.00; the gift card took no cash.
      expectedCashCents: 7500,
      netSalesCents: 1500,
    })
  })

  it('sums the drawers: floats, cash moved, expected against counted', async () => {
    const r = (await report()).body['report'] as PosDayReport
    expect(r.cash).toEqual({
      openingFloatCents: 15_000,
      cashSalesCents: 4160,
      cashRefundsCents: 1000,
      paidInCents: 2500,
      paidOutCents: 0,
      dropsCents: 0,
      closedShiftCount: 1,
      openShiftCount: 1,
      expectedCashCents: 13_160,
      countedCashCents: 13_060,
      varianceCents: -100,
      openExpectedCashCents: 7500,
    })
  })

  it('leaves out the day before, but keeps a shift that ran into the next day', async () => {
    const r = (await report({ from: '2027-01-14' })).body['report'] as PosDayReport
    expect(r.totals.orderCount).toBe(1)
    expect(r.totals.grossSalesCents).toBe(99_000)
    // The back register's shift is still open, so it is listed on no day before it opened.
    expect(r.shifts).toHaveLength(0)
    const next = (await report({ from: '2027-01-16' })).body['report'] as PosDayReport
    expect(next.totals.grossSalesCents).toBe(99_000)
    expect(next.shifts.map((row) => row.status)).toEqual(['open'])
    // Its float was counted on the day it opened, not again.
    expect(next.cash.openingFloatCents).toBe(0)
  })

  it('covers a two-day event in one report', async () => {
    const r = (await report({ from: '2027-01-15', to: '2027-01-16' })).body['report'] as PosDayReport
    expect(r.days).toBe(2)
    expect(r.totals.orderCount).toBe(5)
  })

  it('reads the store currency', async () => {
    h.memory.seed('hosts/shop/settings/store', { currency: 'CAD' })
    expect(((await report()).body['report'] as PosDayReport).currency).toBe('cad')
  })
})

describe('every refund of a register sale counts, on the day it was given (AGL-4037)', () => {
  /** A refund given from the order dialog (or in Stripe), as `refund.ts` stores it. */
  function orderRefund(id: string, data: Record<string, unknown>) {
    h.memory.seed(`hosts/shop/registers/front/orderRefunds/${id}`, {
      orderId: 'o-card',
      registerId: 'front',
      refundedCents: 700,
      tenders: [{ method: 'card_present', amountCents: 700 }],
      cashierId: 'owner',
      source: 'order_dialog',
      stripeRefundId: `re_${id}`,
      ...data,
    })
  }

  beforeEach(() => {
    // A card sale rung yesterday, refunded today from the console.
    sale('o-card', {
      registerId: 'front',
      cashierId: 'cashier',
      createdAtMs: DAY_START - 5 * HOUR,
      totals: { totalCents: 3000 },
      payments: [{ id: 'c1', method: 'card_present', amountCents: 3000, status: 'succeeded' }],
    })
  })

  it('counts a refund given from the order dialog today, whenever the sale was', async () => {
    orderRefund('a', { atMs: DAY_START + 3 * HOUR })
    const r = (await report()).body['report'] as PosDayReport
    expect(r.totals).toMatchObject({ orderCount: 0, refundCount: 1, refundsCents: 700, netSalesCents: -700 })
    expect(r.byTender).toEqual([
      { method: 'card_present', label: 'Card', salesCents: 0, refundsCents: 700, netCents: -700 },
    ])
    expect(r.byRegister.map((row) => [row.name, row.refundCount, row.refundsCents])).toEqual([['Front', 1, 700]])
    // Who gave it back, not who rang the sale.
    expect(r.byCashier.map((row) => [row.memberId, row.refundsCents])).toEqual([['owner', 700]])
    // A card went back: no drawer moved.
    expect(r.cash.cashRefundsCents).toBe(0)
  })

  it('counts a refund made in Stripe under no cashier', async () => {
    orderRefund('s', { atMs: DAY_START + HOUR, cashierId: null, source: 'stripe' })
    const r = (await report()).body['report'] as PosDayReport
    expect(r.byCashier.map((row) => [row.memberId, row.name, row.refundsCents])).toEqual([
      ['', 'No cashier recorded', 700],
    ])
  })

  it('counts it on the store’s day: the last millisecond before midnight there, not the first after', async () => {
    // 23:59:59.999 on the 15th in Chicago is 05:59:59.999Z on the 16th.
    orderRefund('late', { atMs: DAY_END - 1 })
    // 00:00 on the 16th in Chicago belongs to the 16th.
    orderRefund('next', { atMs: DAY_END, refundedCents: 300, tenders: [{ method: 'card_present', amountCents: 300 }] })
    // 23:59 on the 14th in Chicago belongs to the 14th.
    orderRefund('before', { atMs: DAY_START - 1, refundedCents: 50, tenders: [{ method: 'card_present', amountCents: 50 }] })
    const today = (await report()).body['report'] as PosDayReport
    expect(today.totals.refundsCents).toBe(700)
    const tomorrow = (await report({ from: '2027-01-16' })).body['report'] as PosDayReport
    expect(tomorrow.totals.refundsCents).toBe(300)
    const yesterday = (await report({ from: '2027-01-14' })).body['report'] as PosDayReport
    expect(yesterday.totals.refundsCents).toBe(50)
    const both = (await report({ from: '2027-01-14', to: '2027-01-16' })).body['report'] as PosDayReport
    expect(both.totals.refundCount).toBe(3)
  })

  it('counts the register’s own returns and the order dialog’s refunds side by side', async () => {
    orderRefund('a', { atMs: DAY_START + 3 * HOUR })
    h.memory.seed('hosts/shop/registers/front/returns/r1', {
      registerId: 'front',
      cashierId: 'cashier',
      refundedCents: 1000,
      tenders: [{ method: 'cash', amountCents: 1000, status: 'refunded' }],
      atMs: DAY_START + 4 * HOUR,
    })
    const r = (await report()).body['report'] as PosDayReport
    expect(r.totals).toMatchObject({ refundCount: 2, refundsCents: 1700 })
    expect(r.byTender.map((row) => [row.method, row.refundsCents])).toEqual([
      ['cash', 1000],
      ['card_present', 700],
    ])
  })

  it('leaves the shift reports alone: a refund away from the register moved no drawer', async () => {
    h.clock.now = DAY_START + HOUR
    const opened = await shift({ registerId: 'front', action: 'open', openingFloatCents: 0 })
    const shiftId = (opened.body['shift'] as { id: string }).id
    orderRefund('a', { atMs: DAY_START + 2 * HOUR, shiftId })
    h.clock.now = DAY_START + 3 * HOUR
    const x = await shift({ registerId: 'front', action: 'x-report' })
    expect(x.status).toBe(200)
    expect(x.body['report']).toMatchObject({ refundCount: 0, refundsCents: 0 })
  })
})

describe('the spreadsheet', () => {
  it('answers format=csv as a download with every block', async () => {
    sale('o-1', {
      registerId: 'front',
      cashierId: 'cashier',
      createdAtMs: DAY_START + HOUR,
      totals: { totalCents: 1234 },
    })
    const headers: Record<string, unknown> = {}
    let status = 0
    let sent = ''
    const res = {
      status(code: number) {
        status = code
        return res
      },
      json: (body: unknown) => {
        sent = JSON.stringify(body)
      },
      send: (body: unknown) => {
        sent = String(body)
      },
      setHeader: (name: string, value: unknown) => {
        headers[name] = value
      },
      redirect: () => undefined,
      end: () => undefined,
    }
    await createPosDayReportHandler(() => h.deps)(get('cashier', { hostId: 'shop', format: 'csv' }), res)
    expect(status).toBe(200)
    expect(headers['Content-Type']).toBe('text/csv; charset=utf-8')
    expect(headers['Content-Disposition']).toBe('attachment; filename="day-totals-2027-01-15.csv"')
    expect(sent).toContain('Total,Every register,1,12.34')
    expect(sent).toContain('Register,Front,1,12.34')
    expect(sent).toContain('Cashier,Cal Cashier,1,12.34')
    expect(sent).toContain('Tender,Sales,Refunds,Net')
    expect(sent).toContain('Cash,12.34,0.00,12.34')
  })

  it('refuses the CSV to a viewer as it does the JSON', async () => {
    const outcome = await handlePosDayReport(h.deps, get('viewer', { hostId: 'shop', format: 'csv' }))
    expect(outcome.status).toBe(403)
    expect('csv' in outcome).toBe(false)
  })
})
