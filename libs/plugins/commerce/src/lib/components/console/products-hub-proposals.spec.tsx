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
 * The products hub with products nobody has priced yet, and the zones it
 * hosts for what an import does next (AGL-2916).
 *
 *  1. A product with a variant that has no price says so in the Price column
 *     rather than reading `$0`, and the hub will not activate it.
 *  2. The import dialog hosts `productImport` with the import's size, and the
 *     options a widget sets there reach `productsHub` with the ids of the
 *     products the import created.
 *
 * NO STRIPE PATH IS EXERCISED and no production data is read.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { updateDoc } from 'firebase/firestore'
import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import type {
  ConsoleProductImportZoneProps,
  ConsoleProductsHubZoneProps,
} from '@aglyn/aglyn/plugin-manager/feature-plugins'

const ORG_PLAN = { org: { $id: 'org-1', plan: 'pro' }, ready: true }
const FIRESTORE = {}
const mockCreateResource = jest.fn()
const mockCollections: Record<string, Array<Record<string, unknown>>> = {
  products: [
    {
      $id: 'lamp',
      name: 'Desk lamp',
      slug: 'desk-lamp',
      status: 'active',
      type: 'physical',
      variants: [{ id: 'v1', priceUsd: 40, inventory: null }],
    },
    {
      $id: 'candle',
      name: 'Wild mint soy candle',
      slug: 'wild-mint-soy-candle',
      status: 'archived',
      type: 'physical',
      variants: [{ id: 'default' }],
    },
  ],
  locations: [],
  licenseKeys: [],
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useConsoleHostRoute: () => ({ base: null, orgSlug: null, subdomain: null }),
  listFilterConstraints: jest.requireActual('@aglyn/tenant-feature-instance').listFilterConstraints,
  useFirestore: () => FIRESTORE,
  collectionCeiling: (ref: unknown) => ref,
  ceilingedWindow: (read: unknown[] | undefined, ceiling: number) => ({
    rows: (read ?? []).slice(0, ceiling),
    truncated: (read ?? []).length > ceiling,
  }),
  useFirestoreCollection: (build: () => unknown) => ({
    data: mockCollections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useOrgPlan: () => ORG_PLAN,
  useHostResourceApi: () => mockCreateResource,
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  useFirestoreDoc: () => ({ data: undefined, status: 'success' }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance').writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, _a: string, _b: string, name: string) => name,
  query: (name: string) => name,
  limit: (value: number) => value,
  doc: () => ({}),
  getCountFromServer: async () => ({ data: () => ({ count: 2 }) }),
  addDoc: jest.fn().mockResolvedValue(undefined),
  getDoc: jest.fn().mockResolvedValue({ get: () => undefined }),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  runTransaction: jest.fn(),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn().mockResolvedValue(undefined) }),
}))
jest.mock(
  '@aglyn/shared-ui-next/contexts/next-page-title-provider',
  () => ({ NextPageTitle: () => null }),
  { virtual: true },
)

import ProductsHubCard from './products-hub-card.component'

/** What the shell's renderer was last handed, by zone. */
const zones: {
  productsHub?: ConsoleProductsHubZoneProps
  productImport?: ConsoleProductImportZoneProps
} = {}

/** A stand-in for the shell's gated renderer: one widget on the import zone that sets an option. */
function ShellSlot(props: { slot: string } & Record<string, unknown>) {
  if (props.slot === 'productsHub') zones.productsHub = props as unknown as ConsoleProductsHubZoneProps
  if (props.slot !== 'productImport') return null
  const zone = props as unknown as ConsoleProductImportZoneProps
  zones.productImport = zone
  return (
    <button type="button" onClick={() => zone.setOption('ai.writeCopy', true)}>
      {`Write copy for ${zone.count}`}
    </button>
  )
}

const mount = () =>
  render(
    <ConsoleWidgetSlotContext.Provider value={ShellSlot as never}>
      <ProductsHubCard hostId="host-1" />
    </ConsoleWidgetSlotContext.Provider>,
  )

beforeEach(() => {
  jest.clearAllMocks()
  delete zones.productsHub
  delete zones.productImport
})

describe('a product nobody has priced yet, in the products hub (AGL-2916)', () => {
  it('says the price is missing instead of reading $0, and reads the others as before', async () => {
    mount()
    expect(await screen.findByText('Set a price')).toBeTruthy()
    expect(screen.getByText('$40')).toBeTruthy()
    expect(screen.queryByText('$0')).toBeNull()
    expect(zones.productsHub?.products.map((product) => [product.id, product.priceMissing])).toEqual([
      ['lamp', false],
      ['candle', true],
    ])
  })

  it('will not activate it, and says what it needs', async () => {
    mount()
    fireEvent.click(await screen.findByText('Activate'))
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        'Set a price for every variant of Wild mint soy candle before activating it.',
        expect.objectContaining({ variant: 'info' }),
      ),
    )
    expect(updateDoc).not.toHaveBeenCalled()
  })
})

describe('what an import does next (AGL-2916)', () => {
  it('hands the import zone its size, and the options it set to the hub zone with what the import created', async () => {
    mockCreateResource.mockResolvedValueOnce({ id: 'new-mug' }).mockResolvedValueOnce({ id: 'new-bowl' })
    mount()
    expect(zones.productsHub?.lastImport).toBeNull()
    fireEvent.click(await screen.findByText('Import'))
    fireEvent.change(screen.getByLabelText('CSV'), {
      target: { value: 'Handle,Title,Variant Price\nmug,Mug,12\nbowl,Bowl,20' },
    })
    fireEvent.click(await screen.findByText('Write copy for 2'))
    expect(zones.productImport?.options).toEqual({ 'ai.writeCopy': true })

    fireEvent.click(screen.getByRole('button', { name: 'Import 2' }))
    await waitFor(() => expect(zones.productsHub?.lastImport?.productIds).toEqual(['new-mug', 'new-bowl']))
    expect(zones.productsHub?.lastImport?.options).toEqual({ 'ai.writeCopy': true })
  })
})
