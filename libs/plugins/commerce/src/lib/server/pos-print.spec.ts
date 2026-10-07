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

import { memoryFirestore, type MemoryFirestore } from '../testing/pos-ops-memory-firestore'
import {
  kickPosDrawer,
  posSalePrintPlan,
  printPosSale,
  printPosSaleReceipt,
  registerPosSalePrinting,
  type PosPrintDeps,
} from './pos-print'
import { onPosSaleCompleted } from './pos-sale'

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))
jest.mock('./pos-sale', () => ({ onPosSaleCompleted: jest.fn() }))
jest.mock('./printers', () => ({ orderReceipt: jest.fn(), queueRegisterPrint: jest.fn() }))

/**
 * The register's paper and drawer (AGL-3609) through the cloud printer queue
 * (AGL-3619): what a completed sale prints, what opens the drawer, and that
 * every job is keyed on its cause.
 */

let memory: MemoryFirestore
let queued: Array<Record<string, any>>
let deps: PosPrintDeps
let receiptDefault: 'ask' | 'print' | 'none'

const cashSale = {
  channel: 'pos',
  status: 'paid',
  registerId: 'front',
  cashierId: 'cashier',
  number: 12,
  totals: { totalCents: 1000 },
  payments: [{ id: 'p1', method: 'cash', amountCents: 1000, status: 'succeeded', cashTenderedCents: 2000 }],
}
const cardSale = {
  ...cashSale,
  payments: [{ id: 'p1', method: 'card_present', amountCents: 1000, status: 'succeeded', last4: '4242' }],
}

beforeEach(() => {
  memory = memoryFirestore(() => 1_800_000_000_000)
  queued = []
  receiptDefault = 'print'
  deps = {
    firestore: () => memory.firestore,
    queue: (async (input: Record<string, any>) => {
      queued.push(input)
      return { jobIds: ['job-1'] }
    }) as any,
    receipt: (async (_hostId: string, orderId: string) => ({ orderNumber: '12', orderId })) as any,
    registerSettings: async () => ({
      tippingEnabled: false,
      tipPercentages: [],
      receiptDefault,
      displayMessage: '',
      displayMarketingOptIn: false,
    }),
    memberName: async (uid) => (uid === 'cashier' ? 'Cal Cashier' : ''),
  }
})

const withoutFirestore = (input: Record<string, any>) => {
  const { firestore: _firestore, ...rest } = input
  return rest
}

describe('what a completed sale puts on paper', () => {
  it('prints when the site always prints, and opens the drawer for cash', () => {
    expect(posSalePrintPlan(cashSale as any, 'print')).toEqual({ receipt: true, drawer: true })
    expect(posSalePrintPlan(cardSale as any, 'print')).toEqual({ receipt: true, drawer: false })
  })

  it("follows the customer's own choice over the site's default", () => {
    expect(posSalePrintPlan({ ...cardSale, receiptRequest: { channel: 'print' } } as any, 'none')).toEqual({
      receipt: true,
      drawer: false,
    })
    expect(posSalePrintPlan({ ...cashSale, receiptRequest: { channel: 'email' } } as any, 'print')).toEqual({
      receipt: false,
      drawer: true,
    })
    expect(posSalePrintPlan({ ...cardSale, receiptRequest: { channel: 'none' } } as any, 'print')).toEqual({
      receipt: false,
      drawer: false,
    })
  })

  it('prints nothing on "ask" until the customer asks', () => {
    expect(posSalePrintPlan(cardSale as any, 'ask')).toEqual({ receipt: false, drawer: false })
  })

  it('opens the drawer only for cash that was actually taken', () => {
    const failedCash = {
      ...cardSale,
      payments: [...cardSale.payments, { id: 'p2', method: 'cash', amountCents: 500, status: 'failed' }],
    }
    expect(posSalePrintPlan(failedCash as any, 'none').drawer).toBe(false)
  })
})

describe('printing a completed sale', () => {
  it('queues the receipt with the cashier named, and the drawer, keyed on the order', async () => {
    memory.seed('hosts/shop/orders/o1', cashSale)
    expect(await printPosSale({ hostId: 'shop', orderId: 'o1' }, deps)).toEqual({ jobIds: ['job-1'] })
    expect(queued.map(withoutFirestore)).toEqual([
      {
        hostId: 'shop',
        registerId: 'front',
        receipt: { orderNumber: '12', orderId: 'o1', cashierName: 'Cal Cashier' },
        openDrawer: true,
        orderId: 'o1',
        reason: 'sale',
        idempotencyKey: 'o1',
      },
    ])
  })

  it('opens the drawer without a receipt when the site prints none', async () => {
    receiptDefault = 'none'
    memory.seed('hosts/shop/orders/o1', cashSale)
    await printPosSale({ hostId: 'shop', orderId: 'o1' }, deps)
    expect(queued).toHaveLength(1)
    expect(queued[0]).not.toHaveProperty('receipt')
    expect(queued[0]!['openDrawer']).toBe(true)
  })

  it('queues nothing for a card sale on "ask", an online order, or a missing one', async () => {
    receiptDefault = 'ask'
    memory.seed('hosts/shop/orders/o1', cardSale)
    memory.seed('hosts/shop/orders/web', { ...cashSale, channel: 'online' })
    await printPosSale({ hostId: 'shop', orderId: 'o1' }, deps)
    await printPosSale({ hostId: 'shop', orderId: 'web' }, deps)
    await printPosSale({ hostId: 'shop', orderId: 'gone' }, deps)
    expect(queued).toEqual([])
  })

  it('never throws at the sale that caused it', async () => {
    memory.seed('hosts/shop/orders/o1', cashSale)
    deps.queue = (async () => {
      throw new Error('queue down')
    }) as any
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(printPosSale({ hostId: 'shop', orderId: 'o1' }, deps)).resolves.toEqual({ jobIds: [] })
    spy.mockRestore()
  })

  it("prints a receipt the customer asked for later under the sale's own key, so it prints once", async () => {
    memory.seed('hosts/shop/orders/o1', cardSale)
    await printPosSaleReceipt('shop', 'o1', deps)
    expect(withoutFirestore(queued[0]!)).toEqual({
      hostId: 'shop',
      registerId: 'front',
      receipt: { orderNumber: '12', orderId: 'o1', cashierName: 'Cal Cashier' },
      orderId: 'o1',
      reason: 'sale',
      idempotencyKey: 'o1',
    })
  })
})

describe('the drawer for cash that moved without a sale', () => {
  it('kicks it keyed on the cause', async () => {
    await kickPosDrawer(
      { hostId: 'shop', registerId: 'front', reason: 'paid_out', causeId: 'e1', createdBy: 'cashier' },
      deps,
    )
    expect(withoutFirestore(queued[0]!)).toEqual({
      hostId: 'shop',
      registerId: 'front',
      openDrawer: true,
      reason: 'paid_out',
      idempotencyKey: 'e1',
      createdBy: 'cashier',
    })
  })
})

describe('the subscription', () => {
  it('subscribes to completed sales once, however often the routes register', () => {
    registerPosSalePrinting()
    registerPosSalePrinting()
    expect(onPosSaleCompleted).toHaveBeenCalledTimes(1)
  })
})
