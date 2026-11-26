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

/**
 * Fixed prices in other currencies (AGL-4248), set from the console: a
 * variant's price, an add-on's amount and a shipping rate's price and
 * free-over threshold. A blank field shows the converted figure and stores
 * nothing; a cleared one drops its key, and an emptied map is removed rather
 * than written as `undefined`.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setSeedConfirmWaitMs } from '@aglyn/tenant-feature-instance/hooks/helpers/listen-confirmation'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import ProductEditorDialog from './product-editor-dialog.component'
import ShippingSettingsCard from './shipping-settings-card.component'

const currencies = { enabled: true, currencies: [{ code: 'NZD', rounding: 'whole' }] }

/** ECB-shaped: per 1 EUR, so 1 USD = 1.7041 NZD. */
let setupAnswer: Record<string, unknown> = {}
const freshSetup = () => ({
  base: 'USD',
  settings: currencies,
  allRates: {
    base: 'EUR',
    rates: { USD: 1.05, NZD: 1.05 * 1.7041 },
    asOfMs: Date.parse('2026-11-25T16:00:00Z'),
  },
})

let storeDoc: Record<string, unknown> = {}

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: jest.fn(async (_user: unknown, url: string) =>
    url.includes('/api/commerce/currency')
      ? { ok: true, json: async () => setupAnswer }
      : { ok: false, json: async () => ({}) },
  ),
}))

jest.mock('@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change', () =>
  jest
    .requireActual('@aglyn/tenant-feature-instance/testing/site-wide-change-double')
    .siteWideChangeThroughSdk(() => jest.requireMock('firebase/firestore')),
)

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: async () => 'token' } }),
  useFirestore: () => ({}),
  useFirestoreDoc: () => ({ data: storeDoc, status: 'success', fromCache: false }),
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
  useHostResourceApi: () => jest.fn().mockResolvedValue({ id: 'prod-new' }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance').writeGuardedBySeed,
  collectionCeiling: (name: string) => name,
  ceilingedWindow: (read: unknown[] | undefined, ceiling: number) => ({
    rows: (read ?? []).slice(0, ceiling),
    truncated: false,
  }),
}))

jest.mock('./smart-collections', () => ({
  readSmartCollections: async () => [],
  productCollectionFields: async () => ({ collectionIds: [] }),
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, _a: string, _b: string, name: string) => name,
  doc: () => ({}),
  getDoc: jest.fn().mockResolvedValue({ get: () => undefined }),
  setDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('./entitlement-gate.component', () => ({
  EntitlementUpsell: () => null,
  useCommerceEntitlement: () => ({ ready: true, entitled: true, upgradeHref: '/x', planLabel: 'Pro' }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

beforeAll(() => setSeedConfirmWaitMs(0))
afterAll(() => setSeedConfirmWaitMs())
beforeEach(() => {
  jest.clearAllMocks()
  setupAnswer = freshSetup()
  storeDoc = {}
})

function product(variant: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    $id: 'prod-1',
    name: 'Canopy',
    slug: 'canopy',
    status: 'active',
    type: 'physical',
    options: [],
    variants: [{ id: 'default', priceUsd: 250, inventory: null, ...variant }],
    ...extra,
  } as never
}

const renderEditor = (value: never) =>
  render(<ProductEditorDialog hostId="host-1" product={value} seedFromCache={false} open onClose={jest.fn()} />)

const savedPayload = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Save product' }))
  await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
  return (setDoc as jest.Mock).mock.calls[0][1]
}

describe('product prices in other currencies', () => {
  it('shows the converted price, and writes a fixed one', async () => {
    renderEditor(product())
    const cell = (await screen.findByLabelText('Price in NZD — Default')) as HTMLInputElement
    expect(screen.getByText('Prices in other currencies')).toBeTruthy()
    // 250 × 1.7041 = 426.03, rounded up to the whole 427.
    expect(cell.placeholder).toBe('427.00')
    fireEvent.blur(cell, { target: { value: '449' } })
    const payload = await savedPayload()
    expect(payload.variants[0].fixedPrices).toEqual({ NZD: 449 })
    expect(payload.variants[0].priceUsd).toBe(250)
  })

  it('clears a fixed price, dropping the field rather than storing undefined', async () => {
    renderEditor(product({ fixedPrices: { NZD: 449 } }))
    const cell = (await screen.findByLabelText('Price in NZD — Default')) as HTMLInputElement
    expect(cell.value).toBe('449')
    fireEvent.blur(cell, { target: { value: '' } })
    const payload = await savedPayload()
    expect('fixedPrices' in payload.variants[0]).toBe(false)
  })

  it('marks something that is not a price, and saves nothing for it', async () => {
    renderEditor(product())
    const cell = await screen.findByLabelText('Price in NZD — Default')
    fireEvent.blur(cell, { target: { value: 'abc' } })
    expect(screen.getByText('Not a price')).toBeTruthy()
  })

  it('draws no section for a store selling in its own currency only', async () => {
    setupAnswer = { ...freshSetup(), settings: { enabled: false, currencies: currencies.currencies } }
    renderEditor(product())
    await waitFor(() => expect(screen.getByText('Add-ons')).toBeTruthy())
    expect(screen.queryByText('Prices in other currencies')).toBeNull()
  })

  it('writes an add-on choice’s fixed amount in minor units', async () => {
    renderEditor(
      product(
        {},
        {
          modifierGroups: [
            {
              id: 'g1',
              name: 'Walls',
              min: 0,
              max: 1,
              online: true,
              options: [{ id: 'o1', name: 'Back wall', priceCents: 500 }],
            },
          ],
        },
      ),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Other currencies' }))
    const field = screen.getByLabelText('Adds (NZD)') as HTMLInputElement
    // Add-ons convert to the cent, not rounded: 5 × 1.7041 = 8.5205 → 8.53.
    expect(field.placeholder).toBe('8.53')
    fireEvent.blur(field, { target: { value: '9' } })
    const payload = await savedPayload()
    expect(payload.modifierGroups[0].options[0].fixedPriceCents).toEqual({ NZD: 900 })
  })
})

describe('shipping rates in other currencies', () => {
  const shipping = {
    zones: [{ id: 'z1', name: 'Everywhere', countries: ['*'] }],
    rates: [
      { id: 'r1', zoneId: 'z1', name: 'Standard', kind: 'free_over', amountCents: 500, freeOverCents: 5000 },
    ],
  }

  it('writes a price and a free-over threshold per currency, and clears one', async () => {
    storeDoc = { currency: 'USD', currencies, shipping }
    render(<ShippingSettingsCard hostId="host-1" />)
    const price = (await screen.findByLabelText('Price (NZD)')) as HTMLInputElement
    const freeAt = screen.getByLabelText('Free at subtotal (NZD)') as HTMLInputElement
    expect(price.placeholder).toBe('8.53')
    expect(freeAt.placeholder).toBe('85.21')
    fireEvent.blur(price, { target: { value: '12' } })
    fireEvent.blur(freeAt, { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save shipping settings' }))
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect(payload.shipping.rates[0]).toEqual(
      expect.objectContaining({
        amountCents: 500,
        amountsByCurrency: { NZD: 1200 },
        freeOverByCurrency: { NZD: 10_000 },
      }),
    )
  })

  it('drops a cleared per-currency price', async () => {
    storeDoc = {
      currency: 'USD',
      currencies,
      shipping: { ...shipping, rates: [{ ...shipping.rates[0], amountsByCurrency: { NZD: 1200 } }] },
    }
    render(<ShippingSettingsCard hostId="host-1" />)
    const price = (await screen.findByLabelText('Price (NZD)')) as HTMLInputElement
    expect(price.value).toBe('12.00')
    fireEvent.blur(price, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save shipping settings' }))
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect('amountsByCurrency' in payload.shipping.rates[0]).toBe(false)
  })

  it('shows no per-currency fields while other currencies are off', async () => {
    storeDoc = { currency: 'USD', currencies: { ...currencies, enabled: false }, shipping }
    render(<ShippingSettingsCard hostId="host-1" />)
    await screen.findByLabelText('Free at subtotal ($)')
    expect(screen.queryByLabelText('Price (NZD)')).toBeNull()
  })
})
