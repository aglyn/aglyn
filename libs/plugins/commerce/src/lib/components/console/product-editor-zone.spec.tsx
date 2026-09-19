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
 * The product editor hosts the product zone (AGL-2916).
 *
 * A widget there is handed the product as the editor holds it — saved or
 * staged — with the site's categories, and a `proposeValues` door. A proposal
 * is STAGED: the fields show it, option names move with every variant kept,
 * nothing is written, and Save product is the write. A proposed product with
 * no price opens with its price marked, and Save waits for one.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import type { ConsoleProductEditorZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  useFirestoreCollection: (build: () => unknown) => ({
    data: build() === 'productCategories' ? mockCategories : [],
    status: 'success',
    fromCache: false,
  }),
  useHostResourceApi: () => mockCreate,
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance').writeGuardedBySeed,
  collectionCeiling: (name: string) => name,
  ceilingedWindow: (read: unknown[] | undefined, ceiling: number) => ({
    rows: (read ?? []).slice(0, ceiling),
    truncated: false,
  }),
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, _a: string, _b: string, name: string) => name,
  doc: () => ({}),
  getDoc: jest.fn().mockResolvedValue({ get: () => undefined }),
  setDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/aglyn', () => ({
  useMediaPicker: () => ({ pickMedia: async () => null }),
}))

jest.mock('./entitlement-gate.component', () => ({
  EntitlementUpsell: () => null,
  useCommerceEntitlement: () => ({ ready: true, entitled: true, upgradeHref: '/x', planLabel: 'Pro' }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

import ProductEditorDialog from './product-editor-dialog.component'

/** One double of each for every render, so nothing keys an effect on a fresh object. */
const mockFirestore = {}
const mockCreate = jest.fn().mockResolvedValue({ id: 'prod-new' })
const mockCategories = [
  { $id: 'cat-lighting', name: 'Lighting' },
  { $id: 'cat-office', name: 'Home office' },
]

const product = {
  $id: 'prod-1',
  name: 'Desk lamp',
  slug: 'desk-lamp',
  description: 'A lamp.',
  status: 'active',
  type: 'physical',
  tags: ['lamp'],
  mediaUrls: ['media:host-1/lamp', 'media:host-1/lamp-side'],
  options: [{ name: 'finish', values: ['Brass', 'Black'] }],
  variants: [
    { id: 'v-brass', options: { finish: 'Brass' }, priceUsd: 40, sku: 'L-B', inventory: 3 },
    { id: 'v-black', options: { finish: 'Black' }, priceUsd: 42, sku: 'L-K', inventory: 0 },
  ],
  seo: { imageUrl: 'media:host-1/share' },
} as never

/** What the shell's renderer was last handed for the product zone. */
let zone: (ConsoleProductEditorZoneProps & { slot: string }) | null = null

/** A stand-in for the shell's gated renderer, with one widget on the product zone that proposes. */
function ShellSlot(props: ConsoleProductEditorZoneProps & { slot: string }) {
  if (props.slot !== 'productEditor') return null
  zone = props
  return (
    <button
      type="button"
      onClick={() =>
        props.proposeValues(
          {
            description: 'An adjustable brass desk lamp.\n\nShade: [material].',
            tags: ['desk lamp', 'brass'],
            categoryIds: ['cat-lighting'],
            optionNames: ['Finish'],
            seoTitle: 'Brass desk lamp',
            seoDescription: 'An adjustable brass desk lamp for the home office.',
          },
          'job-1',
        )
      }
    >
      {'Propose copy'}
    </button>
  )
}

const renderDialog = (seed: unknown = product) =>
  render(
    <ConsoleWidgetSlotContext.Provider value={ShellSlot as never}>
      <ProductEditorDialog hostId="host-1" product={seed as never} seedFromCache={false} open onClose={jest.fn()} />
    </ConsoleWidgetSlotContext.Provider>,
  )

beforeEach(() => {
  jest.clearAllMocks()
  zone = null
})

describe('the product editor’s product zone (AGL-2916)', () => {
  it('hands the zone the product as the editor holds it, and the site’s categories', () => {
    renderDialog()
    expect(zone).toMatchObject({
      slot: 'productEditor',
      hostId: 'host-1',
      product: {
        id: 'prod-1',
        name: 'Desk lamp',
        type: 'physical',
        description: 'A lamp.',
        tags: ['lamp'],
        categoryIds: [],
        options: [{ name: 'finish', values: ['Brass', 'Black'] }],
        mediaUrls: ['media:host-1/lamp', 'media:host-1/lamp-side'],
        seoTitle: '',
        seoDescription: '',
      },
      categories: [
        { id: 'cat-lighting', name: 'Lighting' },
        { id: 'cat-office', name: 'Home office' },
      ],
    })
  })

  it('stages a proposal in the fields, renames options keeping every variant, and writes nothing until Save product', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Propose copy' }))

    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe(
      'An adjustable brass desk lamp.\n\nShade: [material].',
    )
    expect((screen.getByLabelText('Option') as HTMLInputElement).value).toBe('Finish')
    expect(zone?.product.tags).toEqual(['desk lamp', 'brass'])
    expect(setDoc).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save product' }))
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect(payload).toMatchObject({
      description: 'An adjustable brass desk lamp.\n\nShade: [material].',
      tags: ['desk lamp', 'brass'],
      categoryIds: ['cat-lighting'],
      seo: {
        imageUrl: 'media:host-1/share',
        title: 'Brass desk lamp',
        description: 'An adjustable brass desk lamp for the home office.',
      },
      options: [{ name: 'Finish', values: ['Brass', 'Black'] }],
    })
    expect(payload.variants).toEqual([
      { id: 'v-brass', options: { Finish: 'Brass' }, priceUsd: 40, sku: 'L-B', inventory: 3 },
      { id: 'v-black', options: { Finish: 'Black' }, priceUsd: 42, sku: 'L-K', inventory: 0 },
    ])
  })

  it('opens a proposed product with its price marked, and saves it only once it has one', async () => {
    renderDialog({
      $id: 'prod-2',
      name: 'Wild mint soy candle',
      slug: 'wild-mint-soy-candle',
      status: 'draft',
      type: 'physical',
      variants: [{ id: 'default' }],
    })
    expect(screen.getByText('Set a price for every variant')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save product' }) as HTMLButtonElement).disabled).toBe(true)
    const price = screen.getByPlaceholderText('Set') as HTMLInputElement
    expect(price.getAttribute('aria-invalid')).toBe('true')

    fireEvent.change(price, { target: { value: '18' } })
    expect(screen.queryByText('Set a price for every variant')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }))
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    expect((setDoc as jest.Mock).mock.calls[0][1].variants).toEqual([{ id: 'default', priceUsd: 18 }])
  })
})
