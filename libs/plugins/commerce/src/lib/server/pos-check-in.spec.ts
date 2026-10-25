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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CheckInCustomer, CheckInRow } from '../model/commerce-check-in'
import { posOpsHarness, type PosOpsHarness } from '../testing/pos-ops-harness'
import {
  CHECK_IN_RECONCILE_MS,
  createPosCheckInHandler,
  handlePosCheckIn,
  recordSaleCheckIns,
} from './pos-check-in'

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({ resolveOrgPermissions: jest.fn() }))

/**
 * Check-in at the window (AGL-4043), through the route itself against an
 * in-memory site in Chicago. The clock reads 2027-01-15 08:00Z, 02:00 on the
 * 15th there, so the site's day runs 06:00Z on the 15th to 06:00Z on the 16th.
 */

const DAY_START = Date.UTC(2027, 0, 15, 6)
const HOUR = 3_600_000
const DAY_MS = Date.UTC(2027, 0, 15)

let h: PosOpsHarness

/** A POST always answers JSON; only the day list's GET answers a spreadsheet. */
const post = async (body: Record<string, unknown>, uid: string | null = 'cashier', headers: Record<string, string> = {}) =>
  (await handlePosCheckIn(h.deps, h.request(uid, { hostId: 'shop', ...body }, headers))) as {
    status: number
    body: Record<string, unknown>
  }

function get(query: Record<string, string>, uid: string | null = 'cashier'): PluginApiRequest {
  return {
    method: 'GET',
    headers: uid ? { authorization: `Bearer token-${uid}` } : {},
    body: {},
    query: { hostId: 'shop', ...query },
    cookies: {},
    socket: {},
  }
}

async function dayList(query: Record<string, string> = {}) {
  const outcome = await handlePosCheckIn(h.deps, get(query))
  if ('csv' in outcome) throw new Error('expected JSON')
  return outcome.body as { dayKey: string; totals: { expected: number; checkedIn: number }; checkIns: CheckInRow[] }
}

const search = async (text: string) =>
  ((await post({ action: 'search', text })).body['customers'] ?? []) as CheckInCustomer[]

function order(id: string, data: Record<string, unknown>) {
  h.memory.seed(`hosts/shop/orders/${id}`, {
    status: 'paid',
    channel: 'online',
    createdAtMs: DAY_START + 2 * HOUR,
    ...data,
  })
}

/** Lets the throttle run the next reconcile. */
const later = () => {
  h.clock.now += CHECK_IN_RECONCILE_MS + 1
}

beforeEach(() => {
  h = posOpsHarness()
  h.clock.now = Date.UTC(2027, 0, 15, 8)
  h.memory.seed('hosts/shop', {
    memberRoles: { owner: 'admin', cashier: 'editor', cashier2: 'editor', viewer: 'viewer' },
    timeZone: 'America/Chicago',
  })
  h.memory.seed('hosts/shop/products/pass', {
    name: 'Day pass',
    checkIn: { enabled: true, headcount: 1 },
    variants: [
      { id: 'adult', priceUsd: 40 },
      // A spectator ticket on the same product needs no wristband.
      { id: 'spectator', priceUsd: 5, checkIn: { enabled: false } },
    ],
  })
  h.memory.seed('hosts/shop/products/family', {
    name: 'Family camping',
    checkIn: { enabled: true, headcount: 4 },
    variants: [{ id: 'default', priceUsd: 60 }],
  })
  h.memory.seed('hosts/shop/products/shirt', { name: 'T-shirt', variants: [{ id: 'default', priceUsd: 20 }] })
  order('o1', {
    number: 1042,
    customerName: 'Jordan Lee',
    customerEmail: 'Jordan@Example.com',
    customerPhone: '(555) 201-7788',
    lineItems: [
      { productId: 'pass', variantId: 'adult', name: 'Day pass', variantLabel: 'Adult', quantity: 2, unitAmountCents: 4000 },
      { productId: 'pass', variantId: 'spectator', name: 'Day pass', variantLabel: 'Spectator', quantity: 1, unitAmountCents: 500 },
      { productId: 'shirt', name: 'T-shirt', quantity: 1, unitAmountCents: 2000 },
    ],
  })
})

describe('who may check people in', () => {
  it('refuses the signed-out, a viewer, a member without managePos and a plan without POS', async () => {
    expect((await post({ action: 'search', text: 'jordan' }, null)).status).toBe(401)
    expect((await post({ action: 'search', text: 'jordan' }, 'viewer')).status).toBe(403)
    h.memberships['cashier'] = { ...h.memberships['cashier']!, permissions: { managePos: false } }
    expect((await post({ action: 'search', text: 'jordan' })).status).toBe(403)
    h.memberships['cashier'] = { ...h.memberships['cashier']!, permissions: { managePos: true } }
    h.entitled.pos = false
    expect((await post({ action: 'search', text: 'jordan' })).status).toBe(403)
    expect((await handlePosCheckIn(h.deps, get({}))).status).toBe(403)
  })

  it('answers GET and POST only, and an action it knows', async () => {
    const put = { ...h.request('cashier', { hostId: 'shop' }), method: 'PUT' } as PluginApiRequest
    expect((await handlePosCheckIn(h.deps, put)).status).toBe(405)
    expect((await post({ action: 'nope' })).status).toBe(400)
    expect((await post({ action: 'search', text: 'jordan', day: '2027-02-30' })).status).toBe(400)
  })
})

describe('what is due today', () => {
  it('makes one check-in per person a paid check-in line admits, on the day it was bought', async () => {
    order('o2', {
      customerName: 'Pat Lee',
      customerEmail: 'pat@example.com',
      lineItems: [{ productId: 'family', name: 'Family camping', quantity: 1, unitAmountCents: 6000 }],
    })
    const list = await dayList()
    expect(list.dayKey).toBe('2027-01-15')
    // Two adult passes, no spectator, no T-shirt; a family spot admits four.
    expect(list.totals).toEqual({ expected: 6, checkedIn: 0 })
    const jordan = list.checkIns.filter((row) => row.orderId === 'o1')
    expect(jordan.map((row) => `${row.variantLabel} ${row.unitIndex + 1}/${row.unitCount}`)).toEqual([
      'Adult 1/2',
      'Adult 2/2',
    ])
    expect(jordan[0]).toMatchObject({
      status: 'expected',
      customerKey: 'email:jordan@example.com',
      orderLabel: '#1042',
      channel: 'online',
    })
  })

  it('leaves out orders not paid, lines refunded by name, other days and other sites', async () => {
    order('pending', { status: 'pending', lineItems: [{ productId: 'family', name: 'F', quantity: 1, unitAmountCents: 1 }] })
    order('refunded', { status: 'refunded', lineItems: [{ productId: 'family', name: 'F', quantity: 1, unitAmountCents: 1 }] })
    order('line-back', {
      refundedLineItemIds: [0],
      lineItems: [{ productId: 'family', name: 'F', quantity: 1, unitAmountCents: 1 }],
    })
    // 05:00Z on the 15th is still the 14th in Chicago.
    order('yesterday', {
      createdAtMs: DAY_START - HOUR,
      lineItems: [{ productId: 'family', name: 'F', quantity: 1, unitAmountCents: 1 }],
    })
    h.memory.seed('hosts/other/orders/theirs', {
      status: 'paid',
      createdAtMs: DAY_START + HOUR,
      lineItems: [{ productId: 'family', name: 'F', quantity: 1, unitAmountCents: 1 }],
    })
    expect((await dayList()).totals.expected).toBe(2)
    expect((await dayList({ day: '2027-01-14' })).totals.expected).toBe(4)
  })

  it('turning check-in on covers passes already sold today', async () => {
    h.memory.seed('hosts/shop/products/shirt', {
      name: 'T-shirt',
      checkIn: { enabled: true },
      variants: [{ id: 'default', priceUsd: 20 }],
    })
    expect((await dayList()).totals.expected).toBe(3)
  })

  it('adds a stay on each day it covers, confirmed or already checked in', async () => {
    h.memory.seed('hosts/shop/resources/cabin', { name: 'Cabin 3', nightlyRateUsd: 90 })
    h.memory.seed('hosts/shop/reservations/stay', {
      resourceId: 'cabin',
      status: 'confirmed',
      checkInDayMs: DAY_MS - 86_400_000,
      checkOutDayMs: DAY_MS + 86_400_000,
      guestName: 'Sam Rivera',
      guestEmail: 'sam@example.com',
    })
    h.memory.seed('hosts/shop/reservations/hold', {
      resourceId: 'cabin',
      status: 'pending',
      checkInDayMs: DAY_MS,
      checkOutDayMs: DAY_MS + 86_400_000,
      guestName: 'Held Guest',
    })
    h.memory.seed('hosts/shop/reservations/gone', {
      resourceId: 'cabin',
      status: 'confirmed',
      checkInDayMs: DAY_MS - 3 * 86_400_000,
      checkOutDayMs: DAY_MS,
      guestName: 'Left Yesterday',
    })
    const stays = (await dayList()).checkIns.filter((row) => row.source === 'reservation')
    expect(stays.map((row) => `${row.customerName} ${row.itemName}`)).toEqual(['Sam Rivera Cabin 3'])
    // The last night is the 15th, so the 16th, the day they leave, is not due.
    expect((await dayList({ day: '2027-01-16' })).checkIns.filter((row) => row.source === 'reservation')).toEqual([])
  })

  it('writes a register sale’s check-ins the moment it completes', async () => {
    const written = await recordSaleCheckIns(h.deps, {
      hostId: 'shop',
      orderId: 'pos1',
      order: {
        status: 'paid',
        channel: 'pos',
        createdAtMs: DAY_START + 3 * HOUR,
        customerRecord: { kind: 'contact', id: 'contact-7' },
        lineItems: [{ productId: 'pass', variantId: 'adult', name: 'Day pass', quantity: 1, unitAmountCents: 4000 }],
      } as never,
    })
    expect(written).toBe(1)
    expect(h.memory.read('hosts/shop/checkIns/o_pos1_0_0')).toMatchObject({
      dayKey: '2027-01-15',
      channel: 'pos',
      contactId: 'contact-7',
      customerKey: 'contact:contact-7',
      status: 'expected',
    })
  })
})

describe('finding a customer', () => {
  it('by name, address, phone or order number, as one customer with what they have due', async () => {
    for (const typed of ['jor', 'Lee', 'jordan@exa', '555 201', '7788', '#1042']) {
      later()
      const customers = await search(typed)
      expect(`${typed}: ${customers.map((c) => `${c.name} ${c.unitsCheckedIn}/${c.unitsDue}`).join()}`).toBe(
        `${typed}: Jordan Lee 0/2`,
      )
    }
    expect(await search('zz')).toEqual([])
    // One character asks nothing.
    expect(await search('j')).toEqual([])
  })

  it('finds an online order on the first search after the throttle, never from a stale window', async () => {
    await search('jordan')
    order('o3', {
      customerName: 'Riley Park',
      lineItems: [{ productId: 'family', name: 'Family camping', quantity: 1, unitAmountCents: 6000 }],
    })
    expect(await search('riley')).toEqual([])
    later()
    expect((await search('riley')).map((c) => c.unitsDue)).toEqual([4])
  })

  it('lists one customer’s check-ins by key or by the address the register attached', async () => {
    const byKey = await post({ action: 'customer', customerKey: 'email:jordan@example.com' })
    expect((byKey.body['checkIns'] as CheckInRow[]).map((row) => row.id)).toEqual(['o_o1_0_0', 'o_o1_0_1'])
    const byEmail = await post({ action: 'customer', email: 'JORDAN@example.com' })
    expect((byEmail.body['customer'] as CheckInCustomer).unitsDue).toBe(2)
    expect((await post({ action: 'customer' })).status).toBe(400)
  })

  it('reads the day in passing only once the window has used check-in that day', async () => {
    const panel = () => post({ action: 'customer', email: 'jordan@example.com', reconcile: 'if-used' })
    // A store that never checks anybody in: nothing is read or written.
    expect(((await panel()).body['checkIns'] as CheckInRow[]).length).toBe(0)
    expect(h.memory.read('hosts/shop/checkInDays/2027-01-15')).toBeUndefined()
    await search('jordan')
    expect(((await panel()).body['checkIns'] as CheckInRow[]).length).toBe(2)
  })
})

describe('checking in', () => {
  beforeEach(async () => {
    await dayList()
  })

  it('records who, when and the wristband, and says so when it is tapped again', async () => {
    const first = await post(
      { action: 'check_in', checkIns: [{ id: 'o_o1_0_0', wristband: { number: '214', color: 'Blue' } }] },
      'cashier',
      { 'idempotency-key': 'tap-1' },
    )
    expect(first.status).toBe(200)
    expect(h.memory.read('hosts/shop/checkIns/o_o1_0_0')).toMatchObject({
      status: 'checked_in',
      checkedInAtMs: h.clock.now,
      checkedInBy: 'cashier',
      checkedInByName: 'Cal Cashier',
      wristband: { number: '214', color: 'Blue' },
    })
    // The same tap retried is the same check-in, not "already".
    const retried = await post({ action: 'check_in', checkIns: [{ id: 'o_o1_0_0' }] }, 'cashier', {
      'idempotency-key': 'tap-1',
    })
    expect((retried.body['checkedIn'] as CheckInRow[]).length).toBe(1)
    expect(retried.body['alreadyCheckedIn']).toEqual([])
    // A second person's tap is told who did it and when.
    const again = await post({ action: 'check_in', checkIns: [{ id: 'o_o1_0_0' }] }, 'owner', {
      'idempotency-key': 'tap-2',
    })
    expect(again.body['checkedIn']).toEqual([])
    expect((again.body['alreadyCheckedIn'] as CheckInRow[])[0]).toMatchObject({ checkedInByName: 'Cal Cashier' })
    expect((await dayList()).totals).toEqual({ expected: 2, checkedIn: 1 })
  })

  it('checks several in at once, and refuses junk', async () => {
    const both = await post({ action: 'check_in', checkIns: [{ id: 'o_o1_0_0' }, { id: 'o_o1_0_1' }] })
    expect((both.body['checkedIn'] as CheckInRow[]).map((row) => row.wristband)).toEqual([null, null])
    expect((await post({ action: 'check_in', checkIns: [] })).status).toBe(400)
    expect((await post({ action: 'check_in', checkIns: [{ id: '../x' }] })).status).toBe(400)
    expect(
      (await post({ action: 'check_in', checkIns: [{ id: 'o_o1_0_0', wristband: { number: '<b>' } }] })).status,
    ).toBe(400)
    expect(
      (await post({ action: 'check_in', checkIns: Array.from({ length: 51 }, (_v, at) => ({ id: `o_o1_0_${at}` })) }))
        .status,
    ).toBe(400)
    expect((await post({ action: 'check_in', checkIns: [{ id: 'o_nobody_0_0' }] })).status).toBe(404)
  })

  it('undoes a check-in, changes a wristband, and refuses either before a check-in', async () => {
    expect((await post({ action: 'undo', id: 'o_o1_0_0' })).status).toBe(409)
    expect((await post({ action: 'wristband', id: 'o_o1_0_0', wristband: { color: 'Red' } })).status).toBe(409)
    await post({ action: 'check_in', checkIns: [{ id: 'o_o1_0_0', wristband: { color: 'Red' } }] })
    const changed = await post({ action: 'wristband', id: 'o_o1_0_0', wristband: { color: 'Green', number: '9' } })
    expect((changed.body['checkIn'] as CheckInRow).wristband).toEqual({ number: '9', color: 'Green' })
    h.clock.now += 1000
    const undone = await post({ action: 'undo', id: 'o_o1_0_0' }, 'owner')
    expect(undone.status).toBe(200)
    expect(h.memory.read('hosts/shop/checkIns/o_o1_0_0')).toMatchObject({
      status: 'expected',
      checkedInBy: null,
      wristband: null,
      undoneBy: 'owner',
      undoneAtMs: h.clock.now,
    })
  })

  it('takes a waiting person off when the order is refunded, and keeps one already checked in', async () => {
    await post({ action: 'check_in', checkIns: [{ id: 'o_o1_0_0' }] })
    h.memory.seed('hosts/shop/orders/o1', { ...h.memory.read('hosts/shop/orders/o1'), status: 'refunded' })
    later()
    const list = await dayList()
    expect(list.checkIns.map((row) => `${row.id} ${row.status}`)).toEqual(['o_o1_0_0 checked_in'])
  })

  it('refreshes a waiting person’s name when the order learns it', async () => {
    h.memory.seed('hosts/shop/orders/o1', { ...h.memory.read('hosts/shop/orders/o1'), customerName: 'Jordan Q. Lee' })
    later()
    expect((await dayList()).checkIns.map((row) => row.customerName)).toEqual(['Jordan Q. Lee', 'Jordan Q. Lee'])
  })
})

describe('the day’s list as a spreadsheet', () => {
  it('downloads one row per person', async () => {
    const res = {
      headers: {} as Record<string, string>,
      statusCode: 0,
      sent: '',
      setHeader(name: string, value: string) {
        this.headers[name] = value
      },
      status(code: number) {
        this.statusCode = code
        return this
      },
      send(value: string) {
        this.sent = value
        return this
      },
      json() {
        return this
      },
    }
    await createPosCheckInHandler(() => h.deps)(get({ format: 'csv' }), res as never)
    expect(res.statusCode).toBe(200)
    expect(res.headers['Content-Disposition']).toBe('attachment; filename="check-ins-2027-01-15.csv"')
    const lines = res.sent.trim().split('\n')
    expect(lines[0]).toBe(
      'Day,Name,Email,Phone,Item,Order,Status,Checked in at,Checked in by,Wristband number,Wristband color',
    )
    expect(lines[1]).toBe(
      '2027-01-15,Jordan Lee,Jordan@Example.com,(555) 201-7788,Day pass · Adult (1 of 2),#1042,Expected,,,,',
    )
    expect(lines).toHaveLength(3)
  })
})

describe('the indexes its queries need', () => {
  const config: { indexes: Array<{ collectionGroup: string; queryScope: string; fields: Array<Record<string, string>> }> } =
    JSON.parse(readFileSync(join(__dirname, '../../../../../../cloud/firebase-firestore.indexes.json'), 'utf8'))
  const declared = (second: Record<string, string>) =>
    config.indexes.some(
      (index) =>
        index.collectionGroup === 'checkIns' &&
        index.queryScope === 'COLLECTION' &&
        index.fields.length === 2 &&
        index.fields[0]?.['fieldPath'] === 'dayKey' &&
        index.fields[0]?.['order'] === 'ASCENDING' &&
        JSON.stringify(index.fields[1]) === JSON.stringify(second),
    )

  it('declares checkIns (dayKey, searchTokens CONTAINS) for the search', () => {
    expect(declared({ fieldPath: 'searchTokens', arrayConfig: 'CONTAINS' })).toBe(true)
  })

  it('declares checkIns (dayKey, customerKey) for one customer’s day', () => {
    expect(declared({ fieldPath: 'customerKey', order: 'ASCENDING' })).toBe(true)
  })
})
