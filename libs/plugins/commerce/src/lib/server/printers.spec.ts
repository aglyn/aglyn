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

import { MemoryFirestore } from '../testing/memory-firestore'

const store = { current: new MemoryFirestore() }
const gate = { managePos: true, entitled: true }

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => store.current,
      auth: () => ({
        verifyIdToken: async (token: string) => {
          if (!token.startsWith('uid:')) throw new Error('bad token')
          return { uid: token.slice(4) }
        },
      }),
    }),
  },
  getOrgForHost: jest.fn(async () => ({ orgId: 'org1', org: { id: 'org1', timeZone: 'America/Chicago' } })),
}))
jest.mock('@aglyn/aglyn/server', () => ({
  checkEntitlement: jest.fn(() => gate.entitled),
}))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: jest.fn(async () => ({ permissions: { managePos: gate.managePos } })),
}))
jest.mock('./download', () => ({ tokenSigningSecret: () => 'test-signing-secret' }))

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { printersHandler, queueRegisterPrint } from './printers'

const HOST = 'host1'

function call(body: Record<string, unknown>, uid: string | null = 'manager') {
  let status = 0
  let payload: any
  const res = {
    status(code: number) {
      status = code
      return res
    },
    json(value: unknown) {
      payload = value
    },
  } as unknown as PluginApiResponse
  const req = {
    method: 'POST',
    body: { hostId: HOST, ...body },
    query: {},
    headers: uid ? { authorization: `Bearer uid:${uid}` } : {},
    cookies: {},
    socket: {},
  } as PluginApiRequest
  return Promise.resolve(printersHandler(req, res)).then(() => ({ status, body: payload }))
}

const jobs = () =>
  [...store.current.docs.entries()]
    .filter(([path]) => path.startsWith(`hosts/${HOST}/printJobs/`))
    .map(([path, stored]) => ({ id: path.split('/').pop(), ...stored.data }))

beforeEach(() => {
  store.current = new MemoryFirestore()
  gate.managePos = true
  gate.entitled = true
  store.current.write(`hosts/${HOST}`, {
    displayName: 'Corner Cafe',
    memberRoles: { manager: 'admin', clerk: 'editor', reader: 'viewer', author: 'author' },
  })
  store.current.write(`hosts/${HOST}/registers/reg1`, { name: 'Front counter' })
})

const STAR = {
  action: 'create',
  registerId: 'reg1',
  brand: 'star',
  name: 'Counter Star',
  model: 'mC-Print3',
  deviceId: '00-11-62-AB-CD-EF',
  kickDrawer: true,
}

describe('POST /api/commerce/printers — the gate (AGL-3619)', () => {
  it('needs a signed-in admin or editor with managePos on a plan with POS', async () => {
    expect((await call(STAR, null)).status).toBe(401)
    expect((await call(STAR, 'reader')).status).toBe(403)
    expect((await call(STAR, 'author')).status).toBe(403)
    expect((await call(STAR, 'stranger')).status).toBe(403)
    gate.managePos = false
    expect((await call(STAR, 'clerk')).status).toBe(403)
    gate.managePos = true
    gate.entitled = false
    expect((await call(STAR)).status).toBe(403)
    gate.entitled = true
    expect((await call(STAR, 'clerk')).status).toBe(200)
  })
})

describe('POST /api/commerce/printers — managing printers', () => {
  it('adds a printer to a register and answers the URL to paste into it', async () => {
    const { status, body } = await call(STAR)
    expect(status).toBe(200)
    expect(body).toMatchObject({ brand: 'star', deviceId: '00:11:62:ab:cd:ef' })
    expect(body.pollUrl).toMatch(
      new RegExp(`/api/commerce/cloudprnt/${HOST}/${body.printerId}/[0-9a-f]{40}$`),
    )
    expect(store.current.read(`hosts/${HOST}/printers/${body.printerId}`)).toMatchObject({
      name: 'Counter Star',
      registerId: 'reg1',
      autoPrintReceipts: true,
      kickDrawer: true,
      paperWidthMm: 80,
      secretVersion: 1,
      createdBy: 'manager',
    })
  })

  it('refuses a bad MAC, an unknown register, a duplicate device and a bad logo key', async () => {
    expect((await call({ ...STAR, deviceId: '00:11' })).status).toBe(400)
    expect((await call({ ...STAR, registerId: 'nope' })).status).toBe(404)
    expect((await call({ ...STAR, brand: 'zebra' })).status).toBe(400)
    expect((await call({ ...STAR, logoKey: '999' })).status).toBe(400)
    expect((await call(STAR)).status).toBe(200)
    expect((await call({ ...STAR, deviceId: '001162abcdef' })).status).toBe(409)
  })

  it('caps the printers on one register', async () => {
    for (let index = 0; index < 4; index += 1) {
      expect((await call({ ...STAR, deviceId: `00:11:62:00:00:0${index}` })).status).toBe(200)
    }
    expect((await call({ ...STAR, deviceId: '00:11:62:00:00:09' })).status).toBe(409)
  })

  it('shows the same URL again, and Regenerate replaces it', async () => {
    const created = (await call(STAR)).body
    const shown = (await call({ action: 'credentials', printerId: created.printerId })).body
    expect(shown.pollUrl).toBe(created.pollUrl)
    const regenerated = (await call({ action: 'regenerate', printerId: created.printerId })).body
    expect(regenerated.pollUrl).not.toBe(created.pollUrl)
    expect(store.current.read(`hosts/${HOST}/printers/${created.printerId}`)?.['secretVersion']).toBe(2)
  })

  it('updates settings, validating them for the printer’s brand', async () => {
    const created = (await call({ ...STAR, brand: 'epson', deviceId: 'counter-1' })).body
    expect((await call({ action: 'update', printerId: created.printerId, logoKey: '48,48', paperWidthMm: 58 })).status).toBe(200)
    expect(store.current.read(`hosts/${HOST}/printers/${created.printerId}`)).toMatchObject({
      logoKey: '48,48',
      paperWidthMm: 58,
    })
    expect((await call({ action: 'update', printerId: created.printerId, logoKey: '7' })).status).toBe(400)
  })

  it('queues a test page and a drawer kick, and cancels a job the printer has not taken', async () => {
    const created = (await call(STAR)).body
    const test = await call({ action: 'test', printerId: created.printerId })
    const drawer = await call({ action: 'drawer', printerId: created.printerId })
    expect(jobs().map((job: any) => [job.kind, job.reason, job.storeName])).toEqual(
      expect.arrayContaining([
        ['test', 'test', 'Corner Cafe'],
        ['drawer', 'open_drawer', undefined],
      ]),
    )
    expect((await call({ action: 'cancel', jobId: test.body.jobId })).status).toBe(200)
    store.current.write(`hosts/${HOST}/printJobs/${drawer.body.jobId}`, {
      ...store.current.read(`hosts/${HOST}/printJobs/${drawer.body.jobId}`),
      status: 'printing',
    })
    expect((await call({ action: 'cancel', jobId: drawer.body.jobId })).status).toBe(409)
  })

  it('reprints an order on its register’s receipt printer, marked REPRINT', async () => {
    const created = (await call(STAR)).body
    store.current.write(`hosts/${HOST}/orders/o1`, {
      number: 7,
      status: 'paid',
      channel: 'pos',
      registerId: 'reg1',
      createdAtMs: 1,
      lineItems: [{ productId: 'p', name: 'Tea', quantity: 1, unitAmountCents: 300 }],
      totals: { itemsCents: 300, shippingCents: 0, taxCents: 0, discountCents: 0, totalCents: 300, feeCents: 0 },
    })
    const { status } = await call({ action: 'reprint', orderId: 'o1' })
    expect(status).toBe(200)
    const [job] = jobs() as any[]
    expect(job).toMatchObject({ printerId: created.printerId, kind: 'receipt', reason: 'reprint', orderId: 'o1' })
    expect(job.receipt).toMatchObject({
      storeName: 'Corner Cafe',
      orderNumber: '7',
      banner: 'REPRINT',
      registerName: 'Front counter',
      timeZone: 'America/Chicago',
    })
  })

  it('removing a printer cancels what it had not printed', async () => {
    const created = (await call(STAR)).body
    const test = (await call({ action: 'test', printerId: created.printerId })).body
    expect((await call({ action: 'remove', printerId: created.printerId })).status).toBe(200)
    expect(store.current.read(`hosts/${HOST}/printers/${created.printerId}`)).toBeUndefined()
    expect(store.current.read(`hosts/${HOST}/printJobs/${test.jobId}`)?.['status']).toBe('canceled')
  })
})

describe('queueRegisterPrint — what a sale, a refund or a paid-out queues', () => {
  const receipt = {
    storeName: 'Corner Cafe',
    orderNumber: '1',
    createdAtMs: 1,
    currency: 'usd',
    lines: [],
    subtotalCents: 0,
    totalCents: 0,
  }

  async function addTwo() {
    const receiptPrinter = (await call({ ...STAR, kickDrawer: false, deviceId: '00:11:62:00:00:01' })).body
    const drawerPrinter = (await call({ ...STAR, autoPrintReceipts: false, deviceId: '00:11:62:00:00:02' })).body
    return { receiptPrinter: receiptPrinter.printerId, drawerPrinter: drawerPrinter.printerId }
  }

  it('prints on auto-print printers and kicks the drawer printer once', async () => {
    const { receiptPrinter, drawerPrinter } = await addTwo()
    const { jobIds } = await queueRegisterPrint({
      hostId: HOST,
      registerId: 'reg1',
      receipt,
      openDrawer: true,
      orderId: 'o1',
      reason: 'sale',
      idempotencyKey: 'o1',
      firestore: store.current,
    })
    expect(jobIds).toHaveLength(2)
    const byPrinter = Object.fromEntries(jobs().map((job: any) => [job.printerId, job]))
    expect(byPrinter[receiptPrinter]).toMatchObject({ kind: 'receipt' })
    expect(byPrinter[receiptPrinter].openDrawer).toBeUndefined()
    expect(byPrinter[drawerPrinter]).toMatchObject({ kind: 'drawer', reason: 'sale' })
  })

  it('rides the kick on the receipt when one printer does both', async () => {
    await call(STAR)
    await queueRegisterPrint({
      hostId: HOST,
      registerId: 'reg1',
      receipt,
      openDrawer: true,
      reason: 'sale',
      firestore: store.current,
    })
    expect(jobs()).toEqual([expect.objectContaining({ kind: 'receipt', openDrawer: true })])
  })

  it('a cause delivered twice queues once', async () => {
    await addTwo()
    const input = {
      hostId: HOST,
      registerId: 'reg1',
      receipt,
      openDrawer: true,
      reason: 'sale',
      idempotencyKey: 'o1',
      firestore: store.current,
    }
    await queueRegisterPrint(input)
    await queueRegisterPrint(input)
    expect(jobs()).toHaveLength(2)
  })

  it('a paid-out with no receipt only kicks the drawer', async () => {
    await addTwo()
    await queueRegisterPrint({
      hostId: HOST,
      registerId: 'reg1',
      openDrawer: true,
      reason: 'paid_out',
      firestore: store.current,
    })
    expect(jobs()).toEqual([expect.objectContaining({ kind: 'drawer', reason: 'paid_out' })])
  })

  it('a register with no printers queues nothing', async () => {
    expect(
      await queueRegisterPrint({ hostId: HOST, registerId: 'reg9', receipt, reason: 'sale', firestore: store.current }),
    ).toEqual({ jobIds: [] })
  })

  it('prints a shift report once, on the receipt printer, keyed on its cause (AGL-3609)', async () => {
    const { receiptPrinter } = await addTwo()
    const report = {
      title: 'Z REPORT',
      storeName: 'Corner Cafe',
      sections: [{ section: 'Sales', rows: [{ label: 'Orders', value: '3' }] }],
    }
    const input = {
      hostId: HOST,
      registerId: 'reg1',
      report,
      reason: 'z_report',
      idempotencyKey: 'shift1-a',
      firestore: store.current,
    }
    await queueRegisterPrint(input)
    await queueRegisterPrint(input)
    expect(jobs()).toEqual([
      expect.objectContaining({ kind: 'report', printerId: receiptPrinter, reason: 'z_report', report }),
    ])
  })
})
