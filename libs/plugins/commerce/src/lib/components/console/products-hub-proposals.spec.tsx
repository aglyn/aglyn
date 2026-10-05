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
 *  2. The import wizard's After import step (AGL-3531) hosts `productImport`
 *     with the dry run's count of new products, and the options a widget
 *     sets there reach `productsHub` with the ids of the products the
 *     import created, read from the job's results when the wizard closes.
 *
 * NO STRIPE PATH IS EXERCISED and no production data is read.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { getDoc, updateDoc } from 'firebase/firestore'
import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import {
  TransferLauncherContext,
  type TransferImportLaunch,
  type TransferLauncher,
} from '@aglyn/aglyn/app-utils/transfer-launcher-context'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { ProductImportOptionsStep } from '../../transfer/product-import-step.component'
import type {
  ConsoleProductImportZoneProps,
  ConsoleProductsHubZoneProps,
} from './product-zones'
import { productSearchFields } from '../../model/commerce'

const ORG_PLAN = { org: { $id: 'org-1', plan: 'pro' }, ready: true }
const FIRESTORE = {}
const mockCreateResource = jest.fn()
/** As the writers store a product: live, with the keys the table orders by. */
const stored = (product: { name: string; variants: never[] } & Record<string, unknown>) => ({
  ...product,
  ...productSearchFields({ name: product.name, variants: product.variants }),
  deletedAt: null,
})
const mockCollections: Record<string, Array<Record<string, unknown>>> = {
  products: [
    stored({
      $id: 'lamp',
      name: 'Desk lamp',
      slug: 'desk-lamp',
      status: 'active',
      type: 'physical',
      variants: [{ id: 'v1', priceUsd: 40, inventory: null }] as never[],
    }),
    stored({
      $id: 'candle',
      name: 'Wild mint soy candle',
      slug: 'wild-mint-soy-candle',
      status: 'archived',
      type: 'physical',
      variants: [{ id: 'default' }] as never[],
    }),
  ],
  locations: [],
  licenseKeys: [],
}

jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () => {
  const { useListQueryDouble } = jest.requireActual(
    '@aglyn/tenant-feature-instance/testing/list-query-double',
  )
  return {
    ...jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query'),
    useListQuery: (options: unknown) =>
      useListQueryDouble(() => mockCollections['products'], options),
  }
})

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
  // The slug ledger asks the store which slugs are held (AGL-3321): none.
  getDocs: async () => ({ docs: [] }),
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
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: jest.fn(),
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

/** The shell's launcher, recording what the hub opened. */
const opened: TransferImportLaunch[] = []
const launcher: TransferLauncher = {
  openImport: (launch) => void opened.push(launch),
  openExport: jest.fn(),
  close: jest.fn(),
  can: () => true,
}

const mount = () =>
  render(
    <TransferLauncherContext.Provider value={launcher}>
      <ConsoleWidgetSlotContext.Provider value={ShellSlot as never}>
        <ProductsHubCard hostId="host-1" />
      </ConsoleWidgetSlotContext.Provider>
    </TransferLauncherContext.Provider>,
  )

/** The wizard's After import step, as the wizard renders it for a job. */
function AfterImport() {
  const [value, setValue] = useState<unknown>({})
  return (
    <ConsoleWidgetSlotContext.Provider value={ShellSlot as never}>
      <ProductImportOptionsStep
        resource="commerce.products"
        orgId="org-1"
        hostId="host-1"
        jobId="job-1"
        value={value}
        setValue={setValue}
        setComplete={() => undefined}
      />
    </ConsoleWidgetSlotContext.Provider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  opened.length = 0
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

describe('what an import does next (AGL-2916, AGL-3531)', () => {
  it('hands the import zone the new products the dry run counts, and the options it set to the hub zone with what the import created', async () => {
    jest.mocked(getDoc).mockResolvedValueOnce({
      get: (path: string) => (path === 'summary.create' ? 2 : undefined),
    } as never)
    jest.mocked(authorizedFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        rows: [
          { row: 0, outcome: 'created', recordId: 'new-mug' },
          { row: 1, outcome: 'created', recordId: 'new-mug' },
          { row: 2, outcome: 'updated', recordId: 'lamp' },
          { row: 3, outcome: 'created', recordId: 'new-bowl' },
        ],
      }),
    } as never)
    mount()
    expect(zones.productsHub?.lastImport).toBeNull()
    fireEvent.click(await screen.findByText('Import'))
    expect(opened).toEqual([expect.objectContaining({ resource: 'commerce.products', scope: 'host', hostId: 'host-1' })])

    // The wizard draws its After import step for the job.
    render(<AfterImport />)
    fireEvent.click(await screen.findByText('Write copy for 2'))
    await waitFor(() => expect(zones.productImport?.options).toEqual({ 'ai.writeCopy': true }))

    // The person leaves the wizard from its results.
    act(() => opened[0]?.onFinished?.())
    await waitFor(() => expect(zones.productsHub?.lastImport?.productIds).toEqual(['new-mug', 'new-bowl']))
    expect(zones.productsHub?.lastImport?.options).toEqual({ 'ai.writeCopy': true })
    expect(jest.mocked(authorizedFetch).mock.calls[0]?.[1]).toBe('/api/transfer/status')
    expect(JSON.parse(String(jest.mocked(authorizedFetch).mock.calls[0]?.[2]?.body))).toEqual({
      orgId: 'org-1',
      jobId: 'job-1',
      include: 'results',
    })
  })
})
