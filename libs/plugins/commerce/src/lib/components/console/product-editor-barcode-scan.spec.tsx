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

import { act, fireEvent, render, screen } from '@testing-library/react'
import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'

/*
 * The product editor's barcode field takes a camera scan (AGL-3619): the
 * scan button beside each variant's barcode opens the scanner, and what it
 * reads lands in that variant's field exactly as typing it would.
 */

jest.mock('../../barcode/barcode-scanner.component', () => ({
  BarcodeScanner: (props: { title: string; onDetected: (code: string, format: string) => void }) => (
    <div role="dialog" aria-label={props.title}>
      <button onClick={() => props.onDetected('036000291452', 'upc_a')}>{'mock read'}</button>
    </div>
  ),
}))
jest.mock('@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change', () => ({
  writeSiteWideChange: async () => undefined,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => mockUser,
  useFirestore: () => mockFirestore,
  // The same rows on every render, as a live listener hands them on.
  useFirestoreCollection: (build: () => unknown) => ({
    data: mockCollections[String(build())] ?? null,
    status: 'success',
    fromCache: false,
  }),
  useHostResourceApi: () => mockCreate,
  writeGuardedBySeed: async () => ({ ok: true }),
  collectionCeiling: (name: string) => name,
  ceilingedWindow: (read: unknown[] | undefined) => ({
    rows: read ?? [],
    truncated: false,
  }),
}))
jest.mock('./smart-collections', () => ({
  productCollectionFields: async () => ({ collectionIds: [] }),
}))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, _a: string, _b: string, name: string) => name,
  doc: () => ({}),
  getDoc: async () => ({ get: () => undefined }),
}))
jest.mock('@aglyn/aglyn', () => ({
  useMediaPicker: () => mockPicker,
}))
jest.mock('./entitlement-gate.component', () => ({
  EntitlementUpsell: () => null,
  useCommerceEntitlement: () => mockEntitled,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => mockSnackbar,
}))
// Named, so the counter can say whether a keystroke beside them drew them.
jest.mock('./paid-media', () => ({
  MembersVideosField: function MembersVideosField() {
    return null
  },
  PaidDownloadAddButton: function PaidDownloadAddButton() {
    return null
  },
  PaidMediaProtection: function PaidMediaProtection() {
    return null
  },
}))

const mockUser = { data: null }
const mockFirestore = {}
const mockCreate = jest.fn()
const mockPicker = { pickMedia: async () => null }
const mockEntitled = { ready: true, entitled: true, upgradeHref: '/x', planLabel: 'Pro' }
const mockSnackbar = { enqueueSnackbar: () => undefined }
const mockCollections: Record<string, unknown[]> = {
  productCategories: [
    { $id: 'cat-lighting', name: 'Lighting' },
    { $id: 'cat-office', name: 'Home office' },
  ],
  products: [
    { $id: 'prod-1', name: 'Desk lamp' },
    { $id: 'prod-2', name: 'Shade' },
  ],
  suppliers: [{ $id: 'sup-1', name: 'Lamps Inc' }],
}

/** A product with all four chip lists filled, and a matrix to type into. */
const lamp = {
  $id: 'prod-1',
  name: 'Desk lamp',
  slug: 'desk-lamp',
  description: 'A lamp.',
  status: 'active',
  type: 'physical',
  tags: ['lamp'],
  categoryIds: ['cat-lighting'],
  relatedProductIds: ['prod-2'],
  mediaUrls: ['media:host-1/lamp'],
  options: [
    { name: 'finish', values: ['Brass', 'Black'] },
    { name: 'size', values: ['S', 'L'] },
  ],
  variants: [
    { id: 'v1', options: { finish: 'Brass', size: 'S' }, priceUsd: 40, sku: 'L-BS', inventory: 3 },
    { id: 'v2', options: { finish: 'Brass', size: 'L' }, priceUsd: 41, sku: 'L-BL', inventory: 3 },
    { id: 'v3', options: { finish: 'Black', size: 'S' }, priceUsd: 42, sku: 'L-KS', inventory: 0 },
    { id: 'v4', options: { finish: 'Black', size: 'L' }, priceUsd: 43, sku: 'L-KL', inventory: 0 },
  ],
  seo: { title: 'Desk lamp', description: 'A lamp.', imageUrl: 'media:host-1/share' },
}


import ProductEditorDialog from './product-editor-dialog.component'

describe('the product editor barcode field scans with the camera (AGL-3619)', () => {
  it('fills the variant’s barcode from a scan', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <ConsoleWidgetSlotContext.Provider value={(() => null) as never}>
        <ProductEditorDialog hostId="host-1" product={lamp as never} seedFromCache={false} open onClose={() => undefined} />
      </ConsoleWidgetSlotContext.Provider>,
    )
    const scan = screen.getAllByRole('button', { name: /^Scan the barcode for / })
    expect(scan).toHaveLength(4)
    fireEvent.click(scan[2])
    const scanner = await screen.findByRole('dialog', { name: /^Scan the barcode for / })
    await act(async () => {
      fireEvent.click(scanner.querySelector('button') as HTMLButtonElement)
    })
    const fields = screen.getAllByRole('textbox', { name: /^Barcode — / }) as HTMLInputElement[]
    expect(fields.map((field) => field.value)).toEqual(['', '', '036000291452', ''])
    expect(screen.queryByRole('dialog', { name: /^Scan the barcode for / })).toBeNull()
  })
})
