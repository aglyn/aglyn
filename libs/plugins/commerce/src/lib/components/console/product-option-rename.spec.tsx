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
 * Renaming an option in the product editor keeps every variant (AGL-3066).
 *
 * The editor used to rebuild the variants matrix on every keystroke of an
 * option's name, matching variants by name and value, so a rename found none
 * of them and replaced each with a new id holding the first variant's price
 * and stock. The save that followed wrote that over the product. This drives
 * the dialog the way a person does, types a new name letter by letter, and
 * reads what Save product writes.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'

jest.mock('@aglyn/tenant-feature-instance', () => ({
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

/** One Firestore double for every render, so nothing keys an effect on a fresh object. */
const mockFirestore = {}

const product = {
  $id: 'prod-1',
  name: 'Linen tee',
  slug: 'linen-tee',
  status: 'active',
  type: 'physical',
  options: [
    { name: 'Size', values: ['S', 'M'] },
    { name: 'Color', values: ['Sand', 'Olive'] },
  ],
  variants: [
    { id: 'v-s-sand', options: { Size: 'S', Color: 'Sand' }, priceUsd: 38, sku: 'TEE-S-SAND', inventory: 6 },
    { id: 'v-s-olive', options: { Size: 'S', Color: 'Olive' }, priceUsd: 38, sku: 'TEE-S-OLIVE', inventory: 2 },
    { id: 'v-m-sand', options: { Size: 'M', Color: 'Sand' }, priceUsd: 42, sku: 'TEE-M-SAND', inventory: 0 },
    {
      id: 'v-m-olive',
      options: { Size: 'M', Color: 'Olive' },
      priceUsd: 42,
      compareAtPriceUsd: 50,
      sku: 'TEE-M-OLIVE',
      inventory: 9,
      weightGrams: 210,
    },
  ],
} as never

beforeEach(() => {
  jest.clearAllMocks()
})

describe('renaming a product option (AGL-3066)', () => {
  it('keeps every variant’s id, price, SKU and stock under the new name', async () => {
    render(
      <ProductEditorDialog hostId="host-1" product={product} seedFromCache={false} open onClose={jest.fn()} />,
    )
    const colorField = screen.getAllByLabelText('Option')[1] as HTMLInputElement
    // Letter by letter, through a cleared field, as a person retypes a name.
    for (const typed of ['', 'C', 'Co', 'Col', 'Colo', 'Colou', 'Colour']) {
      fireEvent.change(colorField, { target: { value: typed } })
    }
    expect(colorField.value).toBe('Colour')

    fireEvent.click(screen.getByRole('button', { name: 'Save product' }))
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect(payload.options).toEqual([
      { name: 'Size', values: ['S', 'M'] },
      { name: 'Colour', values: ['Sand', 'Olive'] },
    ])
    expect(payload.variants).toEqual([
      { id: 'v-s-sand', options: { Size: 'S', Colour: 'Sand' }, priceUsd: 38, sku: 'TEE-S-SAND', inventory: 6 },
      { id: 'v-s-olive', options: { Size: 'S', Colour: 'Olive' }, priceUsd: 38, sku: 'TEE-S-OLIVE', inventory: 2 },
      { id: 'v-m-sand', options: { Size: 'M', Colour: 'Sand' }, priceUsd: 42, sku: 'TEE-M-SAND', inventory: 0 },
      {
        id: 'v-m-olive',
        options: { Size: 'M', Colour: 'Olive' },
        priceUsd: 42,
        compareAtPriceUsd: 50,
        sku: 'TEE-M-OLIVE',
        inventory: 9,
        weightGrams: 210,
      },
    ])
  })

  it('refuses to save while two options share a name, and loses nothing once they differ', async () => {
    render(
      <ProductEditorDialog hostId="host-1" product={product} seedFromCache={false} open onClose={jest.fn()} />,
    )
    const colorField = screen.getAllByLabelText('Option')[1] as HTMLInputElement
    fireEvent.change(colorField, { target: { value: 'Size' } })
    expect(screen.getByText('Each option needs its own name')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save product' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(colorField, { target: { value: 'Shade' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }))
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect(
      payload.variants.map((variant: { id: string; options: unknown; priceUsd: number }) => [
        variant.id,
        variant.options,
        variant.priceUsd,
      ]),
    ).toEqual([
      ['v-s-sand', { Size: 'S', Shade: 'Sand' }, 38],
      ['v-s-olive', { Size: 'S', Shade: 'Olive' }, 38],
      ['v-m-sand', { Size: 'M', Shade: 'Sand' }, 42],
      ['v-m-olive', { Size: 'M', Shade: 'Olive' }, 42],
    ])
  })

  it('still rebuilds the variants when an option’s values change', () => {
    render(
      <ProductEditorDialog hostId="host-1" product={product} seedFromCache={false} open onClose={jest.fn()} />,
    )
    // Two sizes and two colors are four variants in the table.
    expect(screen.getAllByLabelText(/^Stock — /)).toHaveLength(4)
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1])
    // Removing the color option leaves one variant a size.
    expect(screen.getAllByLabelText(/^Stock — /)).toHaveLength(2)
  })
})
