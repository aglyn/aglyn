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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PodConnectionView, PodOrderView, PodProductLinkView } from '../model/print-on-demand'
import { OrderPodParts } from './order-pod-parts.component'
import { PrintOnDemandCard } from './print-on-demand-card.component'
import { ProductPodSource } from './product-pod-source.component'

/**
 * The console widgets (AGL-3641), against recorded routes: nothing drawn
 * where the deployment or site cannot hold a connection; connecting with a
 * token and choosing a store; importing a page of products; an order's part
 * with its costs, parcels and actions; a product's costs per variant.
 */

type Answer = { status?: number; body: unknown }
let routes: Record<string, (body: any, url: URL) => Answer>
const sent: Array<{ route: string; body: any }> = []

jest.mock('@aglyn/tenant-feature-instance', () => ({ useUser: () => ({ data: { uid: 'u' } }) }))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (_user: unknown, url: string, init: RequestInit = {}) => {
    const parsed = new URL(url, 'https://console.test')
    const route = parsed.pathname.replace('/api/', '')
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    sent.push({ route, body })
    const handler = routes[route]
    const answer = handler ? handler(body, parsed) : { status: 404, body: { error: 'Not found' } }
    const status = answer.status ?? 200
    // A Response's shape, read the way the widgets read one: jsdom has no fetch.
    return { ok: status < 400, status, json: async () => answer.body }
  },
}))
const mockSnack = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: mockSnack }) }))
const mockConfirm = jest.fn(async () => undefined)
jest.mock('@aglyn/shared-ui-jsx/contexts/confirmation.context', () => ({
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))

const OFFERS = [
  { id: 'printful', label: 'Printful', tokenHelp: { label: 'private token', url: 'https://developers.printful.com/', steps: 'Make a token.' } },
  { id: 'printify', label: 'Printify', tokenHelp: { label: 'personal access token', url: 'https://printify.com/app/account/api', steps: 'Make a token.' } },
]

const connection = (overrides: Partial<PodConnectionView> = {}): PodConnectionView => ({
  provider: 'printful',
  providerLabel: 'Printful',
  storeId: '42',
  storeName: 'Ocean Goods',
  currency: 'USD',
  submitMode: 'automatic',
  syncPrices: false,
  webhooks: 'registered',
  webhookDetail: null,
  lastError: null,
  connectedAtMs: Date.UTC(2026, 9, 7),
  updatedAtMs: 1,
  ...overrides,
})

const LINK: PodProductLinkView = {
  id: 'h__printful__501',
  provider: 'printful',
  providerLabel: 'Printful',
  productId: 'prod-1',
  sourceProductId: '501',
  name: 'Ocean Tee',
  thumbnailUrl: null,
  costCurrency: 'USD',
  variants: [
    { variantId: 'v0', sourceVariantId: '9001', name: 'Black / S', sku: 'S', costMinor: 1150, retailMinor: 2499, available: true },
    { variantId: 'v1', sourceVariantId: '9002', name: 'Black / M', sku: 'M', costMinor: 1250, retailMinor: 2599, available: false },
  ],
  importedAtMs: 1,
  syncedAtMs: Date.UTC(2026, 9, 7),
  lastError: null,
}

const PART: PodOrderView = {
  id: 'h__o__printful',
  orderId: 'o',
  orderRef: '#1042',
  provider: 'printful',
  providerLabel: 'Printful',
  status: 'draft',
  testMode: false,
  sourceOrderId: '701',
  dashboardUrl: 'https://www.printful.com/dashboard?order_id=701',
  lines: [{ lineIndex: 0, name: 'Ocean Tee — Black / S', quantity: 2, costMinor: 1150 }],
  retailMinor: 4998,
  retailCurrency: 'USD',
  costs: { currency: 'USD', itemsMinor: 2300, shippingMinor: 499, taxMinor: 50, totalMinor: 2849 },
  shipments: [],
  attempts: 1,
  lastError: null,
  actions: ['confirm', 'refresh', 'cancel'],
  createdAtMs: 1,
  updatedAtMs: 1,
}

beforeEach(() => {
  sent.length = 0
  mockSnack.mockReset()
  routes = {
    'print-on-demand/connections': () => ({ body: { available: true, storeCurrency: 'USD', providers: OFFERS, connections: [] } }),
    'print-on-demand/imported': () => ({ body: { links: [LINK], next: null } }),
    'print-on-demand/orders': () => ({ body: { parts: [PART], next: null } }),
  }
})

describe('the Print on demand card', () => {
  it('draws nothing where the deployment cannot hold a connection', async () => {
    routes['print-on-demand/connections'] = () => ({ status: 404, body: { error: 'Print on demand is not available on this deployment.' } })
    const { container } = render(<PrintOnDemandCard hostId="h" />)
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(container.innerHTML).toBe('')
  })

  it('connects with the merchant’s token, asking which store when there are several', async () => {
    routes['print-on-demand/connect'] = (body) =>
      body.storeId
        ? { body: { connection: connection({ storeName: 'B' }), notice: null } }
        : { status: 409, body: { error: 'Choose which Printful store to connect.' } }
    routes['print-on-demand/stores'] = () => ({ body: { stores: [{ id: '1', name: 'A' }, { id: '42', name: 'B' }] } })
    render(<PrintOnDemandCard hostId="h" />)
    expect(await screen.findByText('No print-on-demand service is connected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Printful private token'), { target: { value: 'pf-token' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect' }))
    expect(await within(dialog).findByLabelText('Printful store')).toBeTruthy()
    routes['print-on-demand/connections'] = () => ({
      body: { available: true, storeCurrency: 'USD', providers: OFFERS, connections: [connection({ storeName: 'B' })] },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(mockSnack).toHaveBeenCalledWith(expect.stringMatching(/Printful is connected/), expect.anything()))
    expect(sent.filter((entry) => entry.route === 'print-on-demand/connect').map((entry) => entry.body)).toEqual([
      { hostId: 'h', provider: 'printful', token: 'pf-token' },
      { hostId: 'h', provider: 'printful', token: 'pf-token', storeId: '1' },
    ])
    expect(await screen.findByText('Printful — B')).toBeTruthy()
  })

  it('shows a connection with its actions in the header, its settings, its products and its orders', async () => {
    routes['print-on-demand/connections'] = () => ({
      body: {
        available: true,
        storeCurrency: 'USD',
        providers: OFFERS,
        connections: [connection({ webhooks: 'polling', webhookDetail: 'Printful already sends this store’s notices to another app.' })],
      },
    })
    routes['print-on-demand/settings'] = () => ({ body: { connection: connection({ submitMode: 'review' }) } })
    render(<PrintOnDemandCard hostId="h" />)
    expect(await screen.findByText('Printful — Ocean Goods')).toBeTruthy()
    expect(screen.getByText('Checked every 15 min')).toBeTruthy()
    expect(screen.getByText('Printful already sends this store’s notices to another app.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Connect Printify' })).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Send paid orders to Printful for production automatically'))
    await waitFor(() =>
      expect(sent.find((entry) => entry.route === 'print-on-demand/settings')?.body).toEqual({ hostId: 'h', provider: 'printful', submitMode: 'review' }),
    )
    expect(await screen.findByText('Ocean Tee')).toBeTruthy()
    expect(screen.getByText(/2 variants · cost \$11\.50–\$12\.50/)).toBeTruthy()
    expect(screen.getByText('Order #1042 · Printful')).toBeTruthy()
    expect(screen.getByText('Draft at the service')).toBeTruthy()
  })

  it('imports the chosen products from a page of the service’s catalog', async () => {
    routes['print-on-demand/connections'] = () => ({ body: { available: true, storeCurrency: 'USD', providers: OFFERS, connections: [connection()] } })
    routes['print-on-demand/catalog'] = () => ({
      body: {
        products: [
          { id: '501', name: 'Ocean Tee', thumbnailUrl: null, variantCount: 2, importedProductId: null },
          { id: '502', name: 'Ocean Mug', thumbnailUrl: null, variantCount: 1, importedProductId: 'prod-9' },
        ],
        nextCursor: null,
        total: 2,
      },
    })
    routes['print-on-demand/import'] = () => ({
      body: { results: [{ sourceProductId: '501', outcome: 'created', productId: 'prod-1', name: 'Ocean Tee', imagesSkipped: 1 }] },
    })
    render(<PrintOnDemandCard hostId="h" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Import products' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Ocean Mug')).toBeTruthy()
    expect(within(dialog).getByText('Imported')).toBeTruthy()
    fireEvent.click(within(dialog).getByText('Ocean Tee'))
    fireEvent.click(within(dialog).getByLabelText('List new products in the store now'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import 1' }))
    expect(await within(dialog).findByText('1 photo was not copied.')).toBeTruthy()
    expect(sent.find((entry) => entry.route === 'print-on-demand/import')?.body).toEqual({
      hostId: 'h',
      provider: 'printful',
      productIds: ['501'],
      status: 'active',
      content: false,
    })
  })
})

describe('the order’s Print on demand section', () => {
  it('draws nothing for an order no service fills', async () => {
    routes['print-on-demand/order'] = () => ({ body: { parts: [] } })
    const { container } = render(<OrderPodParts hostId="h" order={{ id: 'o' }} />)
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(container.innerHTML).toBe('')
  })

  it('shows the cost against what the buyer paid, and confirms a draft', async () => {
    routes['print-on-demand/order'] = () => ({ body: { parts: [PART] } })
    routes['print-on-demand/order/action'] = () => ({ body: { part: { ...PART, status: 'submitted', actions: ['refresh', 'cancel'] } } })
    render(<OrderPodParts hostId="h" order={{ id: 'o' }} />)
    expect(await screen.findByText(/Printful charged \$28\.49/)).toBeTruthy()
    expect(screen.getByText(/a margin of \$21\.49/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open in Printful' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm for production' }))
    expect(await screen.findByText('Sent')).toBeTruthy()
    expect(sent.at(-1)?.body).toEqual({ hostId: 'h', orderId: 'o', provider: 'printful', action: 'confirm' })
  })

  it('says a refusal and shows the part as it now stands', async () => {
    routes['print-on-demand/order'] = () => ({
      body: { parts: [{ ...PART, status: 'failed', sourceOrderId: null, lastError: 'Printful: Invalid address', actions: ['retry'] }] },
    })
    routes['print-on-demand/order/action'] = () => ({
      status: 409,
      body: { error: 'Printful: Invalid address', part: { ...PART, status: 'failed', lastError: 'Printful: Invalid address', actions: ['retry'] } },
    })
    render(<OrderPodParts hostId="h" order={{ id: 'o' }} />)
    expect(await screen.findByText('Not sent')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }))
    await waitFor(() => expect(mockSnack).toHaveBeenCalledWith('Printful: Invalid address', expect.anything()))
  })
})

describe('the product editor’s Print on demand section', () => {
  it('shows what the service charges per variant', async () => {
    routes['print-on-demand/product-link'] = () => ({ body: { link: LINK } })
    render(<ProductPodSource hostId="h" product={{ id: 'prod-1' }} />)
    expect(await screen.findByText('Made and shipped by Printful')).toBeTruthy()
    const row = screen.getByText('Black / S').closest('tr') as HTMLElement
    expect(within(row).getByText('$11.50')).toBeTruthy()
    expect(within(row).getByText('$24.99')).toBeTruthy()
  })

  it('draws nothing for a product no service makes, or one not saved yet', async () => {
    routes['print-on-demand/product-link'] = () => ({ body: { link: null } })
    const { container } = render(<ProductPodSource hostId="h" product={{ id: 'prod-2' }} />)
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(container.innerHTML).toBe('')
    const unsaved = render(<ProductPodSource hostId="h" product={{ id: null }} />)
    expect(unsaved.container.innerHTML).toBe('')
  })
})
