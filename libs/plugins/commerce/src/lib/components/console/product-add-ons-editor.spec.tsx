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
 * The product editor's add-ons and its variant ceiling (AGL-4100).
 *
 * Add-ons are edited on every store, point of sale or not, and a group made
 * here is shown on the website unless switched off. Options that would make
 * more than 100 variants used to be cut to the first 100 without a word; the
 * editor now says how many, keeps every value typed, and refuses Save until
 * some are removed.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import { expandVariantMatrix } from '../../model/commerce'
import {
  newAddOnGroup,
  priceByLabel,
  ProductAddOnsFields,
  withVariantPrice,
} from './product-add-ons-fields.component'

jest.mock('@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change', () =>
  jest
    .requireActual('@aglyn/tenant-feature-instance/testing/site-wide-change-double')
    .siteWideChangeThroughSdk(() => jest.requireMock('firebase/firestore')),
)

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: null }),
  useFirestore: () => mockFirestore,
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

jest.mock('@aglyn/aglyn', () => ({
  useMediaPicker: () => ({ pickMedia: async () => null }),
}))

/** A store on a plan WITHOUT the point of sale: add-ons are still edited. */
jest.mock('./entitlement-gate.component', () => ({
  EntitlementUpsell: () => null,
  useCommerceEntitlement: (_hostId: string, key: string) =>
    key === 'pos'
      ? { ready: true, entitled: false, upgradeHref: '/x', planLabel: 'Pro' }
      : { ready: true, entitled: true, upgradeHref: '/x', planLabel: 'Pro' },
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

import ProductEditorDialog from './product-editor-dialog.component'

const mockFirestore = {}

const SIZES = Array.from({ length: 10 }, (_, at) => `Size ${at + 1}`)
const COLORS = Array.from({ length: 10 }, (_, at) => `Color ${at + 1}`)

/**
 * A product at the ceiling: ten sizes in ten colors are 100 combinations.
 * Four of its variants are stored, to keep the table short — the editor
 * builds the matrix only when the options change, which is what is tested.
 */
function fullProduct() {
  const options = [
    { name: 'Size', values: SIZES },
    { name: 'Color', values: COLORS },
  ]
  return {
    $id: 'prod-1',
    name: 'Canopy',
    slug: 'canopy',
    status: 'active',
    type: 'physical',
    options,
    variants: expandVariantMatrix(options)
      .slice(0, 4)
      .map((combo, at) => ({ id: `v${at}`, options: combo, priceUsd: 900, inventory: null })),
  } as never
}

const valuesInput = (index: number) => screen.getAllByLabelText('Values')[index] as HTMLInputElement

function typeValue(index: number, value: string) {
  const input = valuesInput(index)
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

const saveButton = () => screen.getByRole('button', { name: 'Save product' }) as HTMLButtonElement

beforeEach(() => {
  jest.clearAllMocks()
})

describe('more combinations than a product holds', () => {
  it('says how many, keeps the value typed, points to add-ons and refuses Save', async () => {
    render(<ProductEditorDialog hostId="host-1" product={fullProduct()} seedFromCache={false} open onClose={jest.fn()} />)
    expect(saveButton().disabled).toBe(false)
    typeValue(1, 'Color 11')

    const warning = screen.getByText(/These options make 110 combinations/)
    expect(warning.textContent).toContain('at most 100')
    expect(warning.textContent).toContain('Add-ons')
    // Kept as typed, not dropped.
    expect(screen.getByText('Color 11')).toBeTruthy()
    // Nothing built short: the variants stand as they were.
    expect(screen.getAllByLabelText(/^Stock — /)).toHaveLength(4)
    expect(saveButton().disabled).toBe(true)
    fireEvent.click(saveButton())
    expect(setDoc).not.toHaveBeenCalled()
  })

  it('builds the matrix again, and saves, once the options fit', async () => {
    render(<ProductEditorDialog hostId="host-1" product={fullProduct()} seedFromCache={false} open onClose={jest.fn()} />)
    typeValue(1, 'Color 11')
    expect(saveButton().disabled).toBe(true)
    // Removing the color option leaves ten sizes.
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1])
    expect(screen.queryByText(/combinations, and a product holds/)).toBeNull()
    expect(screen.getAllByLabelText(/^Stock — /)).toHaveLength(10)
    fireEvent.click(saveButton())
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect(payload.options).toEqual([{ name: 'Size', values: SIZES }])
    expect(payload.variants).toHaveLength(10)
  })
})

describe('the add-ons section', () => {
  it('is offered on a store without the point of sale, and a new group is shown on the website', async () => {
    render(
      <ProductEditorDialog
        hostId="host-1"
        product={{ ...(fullProduct() as object), options: [], variants: [{ id: 'default', priceUsd: 900 }] } as never}
        seedFromCache={false}
        open
        onClose={jest.fn()}
      />,
    )
    expect(screen.getByText('Add-ons')).toBeTruthy()
    expect(screen.queryByText('Quick key at the register')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New add-on group' }))
    const group = screen.getByRole('group', { name: 'Add-on group' })
    expect((within(group).getByRole('switch', { name: 'Show on the website' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.change(within(group).getByLabelText('Group name'), { target: { value: 'Walls' } })
    fireEvent.change(within(group).getByLabelText('Choice'), { target: { value: 'Back wall' } })
    fireEvent.blur(within(group).getByLabelText('Adds ($)'), { target: { value: '90' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect(payload.modifierGroups).toEqual([
      expect.objectContaining({
        name: 'Walls',
        min: 0,
        max: 1,
        online: true,
        options: [expect.objectContaining({ name: 'Back wall', priceCents: 9000 })],
      }),
    ])
  })
})

describe('a choice priced by size', () => {
  const walls = {
    ...newAddOnGroup(),
    id: 'walls',
    name: 'Walls',
    options: [{ id: 'back', name: 'Back wall', priceCents: 9000 }],
  }

  it('is named by the option a product varies by', () => {
    expect(priceByLabel([{ name: 'Size' }])).toBe('Price by size')
    expect(priceByLabel([{ name: 'Size' }, { name: 'Color' }])).toBe('Price by variant')
  })

  it('sets a price on one variant, and a cleared one follows the choice’s own again', () => {
    const priced = withVariantPrice(walls.options[0], 'large', '150')
    expect(priced).toEqual({ id: 'back', name: 'Back wall', priceCents: 9000, priceCentsByVariant: { large: 15000 } })
    expect(withVariantPrice(priced, 'large', ' ')).toEqual({ id: 'back', name: 'Back wall', priceCents: 9000 })
  })

  it('lists each size for the choice, and writes what it adds on one', () => {
    const update = jest.fn()
    render(
      <ProductAddOnsFields
        modifierGroups={[walls]}
        options={[{ name: 'Size', values: ['10x10', '10x20'] }]}
        variants={[
          { id: 'small', options: { Size: '10x10' } },
          { id: 'large', options: { Size: '10x20' } },
        ]}
        update={update}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Price by size' }))
    fireEvent.blur(screen.getByLabelText('10x20'), { target: { value: '150' } })
    expect(update).toHaveBeenCalledWith({
      modifierGroups: [
        expect.objectContaining({
          options: [{ id: 'back', name: 'Back wall', priceCents: 9000, priceCentsByVariant: { large: 15000 } }],
        }),
      ],
    })
  })

  it('turns a group off the website, to the register only', () => {
    const update = jest.fn()
    render(<ProductAddOnsFields modifierGroups={[walls]} options={[]} variants={[{ id: 'default' }]} update={update} />)
    expect(screen.queryByRole('button', { name: /^Price by/ })).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Show on the website' }))
    expect(update).toHaveBeenCalledWith({ modifierGroups: [expect.objectContaining({ online: false })] })
  })
})
