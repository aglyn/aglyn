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

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { PosOfflineKit, PosOfflineSale } from '../../../model/commerce-pos-offline'
import type { PosOfflineDeviceKit, PosOfflineQueuedSale, PosOfflineStore } from './pos-offline-store'
import { usePosOffline, type PosOfflineState, type UsePosOfflineInput } from './use-pos-offline'
import { PosOfflineBanner } from './pos-offline-banner.component'
import { PosOfflineCheckout } from './pos-offline-checkout.component'

/**
 * The register, offline (AGL-3625): it knows when it is offline (the browser
 * says so, or a call failed at the network), sells cash from the catalog and
 * the store rate it kept, queues each sale on the device, and on reconnect
 * sends the queue — removing a sale only once the server has answered for it.
 *
 * The device store is an in-memory double; the network is a counted fetch at
 * the one route the register syncs through.
 */

const mockFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))
const mockConfirm = jest.fn()
jest.mock('@aglyn/shared-ui-jsx', () => ({ useConfirmationContext: () => ({ confirm: mockConfirm }) }))
const mockPrint = jest.fn()
jest.mock('../pos-ops/pos-receipt', () => ({
  posReceiptLogoUrl: () => undefined,
  printPosReceipt: (...args: unknown[]) => mockPrint(...args),
}))

const KIT: PosOfflineKit = {
  v: 1,
  hostId: 'shop',
  orgId: 'org-1',
  issuedAtMs: 1,
  available: true,
  tax: { pct: 8, pricesIncludeTax: false },
  maxDiscountPct: 20,
  requireOpenShift: false,
  registers: [{ id: 'front', name: 'Front', openShiftId: 'shift-1' }],
  receipt: { name: 'Corner Shop', footer: 'Thanks!' },
}

const PRODUCTS = [
  { $id: 'p-mug', name: 'Mug', status: 'active', variants: [{ id: 'v1', priceUsd: 12, barcode: '0123', sku: 'MUG' }] },
  { $id: 'p-tee', name: 'Tee', status: 'active', categoryIds: ['c-apparel'], variants: [{ id: 'default', priceUsd: 25 }] },
  { $id: 'p-old', name: 'Old', status: 'archived', variants: [{ id: 'default', priceUsd: 5 }] },
]

const LINES = [{ productId: 'p-mug', variantId: 'v1', name: 'Mug', unitAmountCents: 1200, quantity: 2 }]

function memoryStore() {
  const sales = new Map<string, PosOfflineQueuedSale>()
  let kit: PosOfflineDeviceKit | null = null
  const store: PosOfflineStore = {
    scope: 'cashier:shop',
    loadKit: async () => kit,
    saveKit: async (next) => void (kit = { ...next, scope: 'cashier:shop' }),
    listSales: async () => [...sales.values()].sort((a, b) => a.sale.soldAtMs - b.sale.soldAtMs),
    putSale: async (sale) => void sales.set(sale.saleKey, { ...sale, scope: 'cashier:shop' }),
    removeSale: async (saleKey) => void sales.delete(saleKey),
  }
  return { store, sales, kit: () => kit }
}

type Reply = { status: number; body: unknown } | 'network'
let replies: { kit: Reply[]; sync: Reply[] }
let syncBodies: Array<{ hostId: string; sales: PosOfflineSale[] }>

function respond(reply: Reply | undefined, fallback: unknown) {
  if (reply === 'network') return Promise.reject(new TypeError('Failed to fetch'))
  const answer = reply ?? { status: 200, body: fallback }
  return Promise.resolve({
    ok: answer.status >= 200 && answer.status < 300,
    status: answer.status,
    json: async () => answer.body,
  })
}

function setNavigatorOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online })
  window.dispatchEvent(new Event(online ? 'online' : 'offline'))
}

let device: ReturnType<typeof memoryStore>
const user = { uid: 'cashier' }

function setup(overrides: Partial<UsePosOfflineInput> = {}) {
  const props: UsePosOfflineInput = {
    hostId: 'shop',
    user: user as never,
    registerId: 'front',
    openShiftId: 'shift-1',
    liveProducts: [],
    loadCatalog: async () => PRODUCTS,
    openStore: async () => device.store,
    now: () => 1_800_000_000_000,
    ...overrides,
  }
  return renderHook((input: UsePosOfflineInput) => usePosOffline(input), { initialProps: props })
}

beforeEach(() => {
  device = memoryStore()
  replies = { kit: [], sync: [] }
  syncBodies = []
  mockFetch.mockReset()
  mockPrint.mockReset()
  mockConfirm.mockReset()
  mockFetch.mockImplementation((_user: unknown, url: string, init: RequestInit) => {
    if (init.method === 'GET') return respond(replies.kit.shift(), { kit: KIT })
    const body = JSON.parse(String(init.body))
    syncBodies.push(body)
    return respond(replies.sync.shift(), {
      results: body.sales.map((sale: PosOfflineSale, index: number) => ({
        saleKey: sale.saleKey,
        status: 'recorded',
        orderId: sale.saleKey,
        number: 1001 + index,
        flags: [],
        stockConflicts: [],
      })),
    })
  })
  setNavigatorOnline(true)
})

async function ready() {
  const hook = setup()
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  return hook
}

describe('getting ready', () => {
  it('keeps the kit and the whole sellable catalog on the device while online', async () => {
    const hook = await ready()
    expect(hook.result.current.kit).toEqual(KIT)
    expect(device.kit()?.products.map((product) => product.$id)).toEqual(['p-mug', 'p-tee', 'p-old'])
    expect(hook.result.current.gridProducts('', '', '__quick__').map((product) => product.$id)).toEqual(['p-mug', 'p-tee'])
    expect(hook.result.current.gridProducts('te', '', '__quick__').map((product) => product.$id)).toEqual(['p-tee'])
    expect(hook.result.current.gridProducts('', 'c-apparel', '__quick__').map((product) => product.$id)).toEqual(['p-tee'])
    expect(hook.result.current.findByCode('0123')?.product.$id).toBe('p-mug')
    expect(hook.result.current.findByCode('mug')?.variant.id).toBe('v1')
  })

  it('says offline selling is unavailable when the browser keeps nothing', async () => {
    const hook = setup({ openStore: async () => null })
    await waitFor(() => expect(hook.result.current.unavailableReason).toMatch(/private window/))
    expect(hook.result.current.ready).toBe(false)
  })

  it('says so when the site cannot sell offline, or needs a shift that is not open', async () => {
    replies.kit.push({ status: 200, body: { kit: { ...KIT, available: false, unavailableReason: 'Choose how this store charges tax.' } } })
    const hook = setup()
    await waitFor(() => expect(hook.result.current.unavailableReason).toBe('Choose how this store charges tax.'))
    device = memoryStore()
    replies.kit.push({ status: 200, body: { kit: { ...KIT, requireOpenShift: true } } })
    const shiftless = setup({ openShiftId: null })
    await waitFor(() => expect(shiftless.result.current.unavailableReason).toMatch(/Open a shift/))
  })
})

describe('selling offline', () => {
  it('goes offline with the browser, rings cash at the store rate and queues the sale', async () => {
    const hook = await ready()
    act(() => setNavigatorOnline(false))
    expect(hook.result.current.offline).toBe(true)
    // 2 × 12.00 = 24.00, 10% off = 21.60, 8% tax = 1.73 → 23.33.
    expect(hook.result.current.totalsFor(LINES, 10)?.totalCents).toBe(2333)
    let rung: Awaited<ReturnType<PosOfflineState['ringCashSale']>> = null
    await act(async () => {
      rung = await hook.result.current.ringCashSale({
        lines: LINES,
        discountPct: 10,
        cashTenderedCents: 3000,
        customer: { email: 'dana@acme.com', name: 'Dana', kind: 'none', id: '' },
      })
    })
    expect(rung).not.toBeNull()
    const sale = rung!.sale
    expect(sale).toMatchObject({
      hostId: 'shop',
      orgId: 'org-1',
      signedInUid: 'cashier',
      registerId: 'front',
      shiftId: 'shift-1',
      discountPct: 10,
      cashTenderedCents: 3000,
      changeCents: 667,
      customer: { email: 'dana@acme.com', name: 'Dana' },
      lines: [{ productId: 'p-mug', variantId: 'v1', sku: 'MUG', quantity: 2, unitAmountCents: 1200 }],
    })
    expect(sale.saleKey).toMatch(/^off[A-Za-z0-9]{16,}$/)
    expect(hook.result.current.queue).toHaveLength(1)
    expect(syncBodies).toHaveLength(0)
  })

  it('refuses short cash and a discount over the ceiling, taking nothing', async () => {
    const hook = await ready()
    act(() => setNavigatorOnline(false))
    await act(async () => {
      expect(await hook.result.current.ringCashSale({ lines: LINES, discountPct: 0, cashTenderedCents: 100 })).toBeNull()
      expect(await hook.result.current.ringCashSale({ lines: LINES, discountPct: 50, cashTenderedCents: 9999 })).toBeNull()
    })
    expect(hook.result.current.queue).toHaveLength(0)
  })

  it('treats a call that failed at the network as offline, and probes until it answers', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    try {
      const hook = setup()
      await waitFor(() => expect(hook.result.current.ready).toBe(true))
      act(() => hook.result.current.reportNetworkFailure())
      expect(hook.result.current.offline).toBe(true)
      replies.sync.push('network')
      await act(async () => {
        jest.advanceTimersByTime(15_000)
      })
      expect(hook.result.current.offline).toBe(true)
      await act(async () => {
        jest.advanceTimersByTime(15_000)
      })
      await waitFor(() => expect(hook.result.current.offline).toBe(false))
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('syncing', () => {
  async function ringTwo(hook: Awaited<ReturnType<typeof ready>>) {
    act(() => setNavigatorOnline(false))
    for (const tendered of [3000, 2600]) {
      await act(async () => {
        await hook.result.current.ringCashSale({ lines: LINES, discountPct: 0, cashTenderedCents: tendered })
      })
    }
    expect(hook.result.current.queue).toHaveLength(2)
  }

  it('sends the queue on reconnect and removes each sale the server answered for', async () => {
    const hook = await ready()
    await ringTwo(hook)
    act(() => setNavigatorOnline(true))
    await waitFor(() => expect(hook.result.current.queue).toHaveLength(0))
    expect(syncBodies.filter((body) => body.sales.length)).toHaveLength(1)
    expect(syncBodies.find((body) => body.sales.length)!.sales).toHaveLength(2)
  })

  it('keeps every sale when the sync never got an answer, and sends the same keys again', async () => {
    const hook = await ready()
    await ringTwo(hook)
    const keys = hook.result.current.queue.map((entry) => entry.saleKey)
    replies.sync.push('network')
    act(() => setNavigatorOnline(true))
    await waitFor(() => expect(hook.result.current.offline).toBe(true))
    expect(hook.result.current.queue.map((entry) => entry.saleKey)).toEqual(keys)
    await act(async () => {
      setNavigatorOnline(true)
    })
    await waitFor(() => expect(hook.result.current.queue).toHaveLength(0))
    const sent = syncBodies.filter((body) => body.sales.length)
    expect(sent).toHaveLength(2)
    expect(sent[1].sales.map((sale) => sale.saleKey)).toEqual(keys)
  })

  it('shows what the server flagged, and keeps a refused sale with its reason', async () => {
    const hook = await ready()
    await ringTwo(hook)
    const [first, second] = hook.result.current.queue
    replies.sync.push({
      status: 200,
      body: {
        results: [
          {
            saleKey: first.saleKey,
            status: 'recorded',
            orderId: first.saleKey,
            number: 1042,
            flags: ['stock-short'],
            stockConflicts: [{ productId: 'p-mug', name: 'Mug', requested: 2, applied: 1, shortUnits: 1 }],
          },
          {
            saleKey: second.saleKey,
            status: 'refused',
            reason: 'wrong-workspace',
            error: 'This sale was rung in another workspace.',
            retry: false,
          },
        ],
      },
    })
    act(() => setNavigatorOnline(true))
    await waitFor(() => expect(hook.result.current.notices).toHaveLength(1))
    expect(hook.result.current.queue).toEqual([
      expect.objectContaining({ saleKey: second.saleKey, state: 'refused', error: 'This sale was rung in another workspace.' }),
    ])

    render(<PosOfflineBanner offline={hook.result.current} />)
    expect(screen.getByText(/Order #1042: 1 of 2× Mug not in stock/)).toBeTruthy()
    expect(screen.getByText(/did not sync: This sale was rung in another workspace/)).toBeTruthy()
    mockConfirm.mockResolvedValueOnce(undefined)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    })
    await waitFor(() => expect(hook.result.current.queue).toHaveLength(0))
  })

  it('keeps the queue and says why when the server refuses the sync itself', async () => {
    const hook = await ready()
    await ringTwo(hook)
    replies.sync.push({ status: 403, body: { error: 'POS requires the Pro plan or above' } })
    act(() => setNavigatorOnline(true))
    await waitFor(() => expect(hook.result.current.syncError).toBe('POS requires the Pro plan or above'))
    expect(hook.result.current.queue).toHaveLength(2)
  })
})

describe('the banner and the cash sale', () => {
  it('says offline, what still sells and what is waiting', async () => {
    const hook = await ready()
    act(() => setNavigatorOnline(false))
    await act(async () => {
      await hook.result.current.ringCashSale({ lines: LINES, discountPct: 0, cashTenderedCents: 3000 })
    })
    render(<PosOfflineBanner offline={hook.result.current} />)
    expect(screen.getByText('Offline')).toBeTruthy()
    expect(screen.getByText(/gift cards, store credit and room charges are off/)).toBeTruthy()
    expect(screen.getByText(/1 sale \(\$25\.92\) waiting to sync/)).toBeTruthy()
  })

  it('renders nothing online with nothing waiting', async () => {
    const hook = await ready()
    const { container } = render(<PosOfflineBanner offline={hook.result.current} />)
    expect(container.innerHTML).toBe('')
  })

  it('takes the cash, gives the change and prints the receipt from the device', async () => {
    const hook = await ready()
    act(() => setNavigatorOnline(false))
    const onRung = jest.fn()
    const onDone = jest.fn()
    render(
      <PosOfflineCheckout
        open
        offline={hook.result.current}
        hostId="shop"
        lines={LINES}
        discountPct={0}
        registerName="Front"
        onClose={() => undefined}
        onRung={onRung}
        onDone={onDone}
      />,
    )
    expect(screen.getByText('Cash — $25.92')).toBeTruthy()
    const take = screen.getByRole('button', { name: 'Take cash' }) as HTMLButtonElement
    expect(take.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Cash received ($)'), { target: { value: '30' } })
    expect(screen.getByText('Change: $4.08')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Take cash' }))
    })
    await waitFor(() => expect(onRung).toHaveBeenCalled())
    expect(screen.getByText('Change due: $4.08')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Print receipt' }))
    expect(mockPrint).toHaveBeenCalledWith(
      expect.objectContaining({ storeName: 'Corner Shop', totalCents: 2592, changeCents: 408, registerName: 'Front' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'New sale' }))
    expect(onDone).toHaveBeenCalled()
  })
})
