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
 * The product editor hosts the search listing zone (AGL-2910).
 *
 * The dialog cannot mount the console's slot, so it draws whatever renderer
 * the shell hands down through `ConsoleWidgetSlotContext`, with the product's
 * name and description and a `proposeValues` door. A proposal is STAGED:
 * the fields show it, nothing is written, and Save product is the write —
 * carrying only the fields a product's listing holds.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import type { ConsoleSeoFieldsZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
  useHostResourceApi: () => jest.fn().mockResolvedValue({ id: 'prod-new' }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
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

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

import ProductEditorDialog from './product-editor-dialog.component'

const product = {
  $id: 'prod-1',
  name: 'Desk lamp',
  slug: 'desk-lamp',
  description: 'An adjustable brass desk lamp with a warm dimmable bulb.',
  status: 'active',
  type: 'physical',
  variants: [{ id: 'v1', priceUsd: 40, inventory: 12 }],
} as never

/** What the shell's renderer was last handed for the zone. */
let zone: (ConsoleSeoFieldsZoneProps & { slot: string }) | null = null

/**
 * A stand-in for the shell's gated renderer, with one widget that proposes on
 * the listing zone. The dialog hosts other zones too, where this stand-in has
 * no widget registered, as the shell has none for a zone nobody registered.
 */
function ShellSlot(props: ConsoleSeoFieldsZoneProps & { slot: string }) {
  if (props.slot !== 'seoFields') return null
  zone = props
  return (
    <button
      type="button"
      onClick={() =>
        props.proposeValues(
          {
            title: 'Brass desk lamp with a dimmable bulb',
            description: 'An adjustable brass desk lamp with a warm, dimmable bulb for late reading.',
            // Not a field a product's listing holds: ignored.
            breadcrumb: 'Lamps',
          },
          'proposal-1',
        )
      }
    >
      {'Propose listing'}
    </button>
  )
}

const renderDialog = (withShell: boolean) =>
  render(
    withShell ? (
      <ConsoleWidgetSlotContext.Provider value={ShellSlot as never}>
        <ProductEditorDialog hostId="host-1" product={product} seedFromCache={false} open onClose={jest.fn()} />
      </ConsoleWidgetSlotContext.Provider>
    ) : (
      <ProductEditorDialog hostId="host-1" product={product} seedFromCache={false} open onClose={jest.fn()} />
    ),
  )

beforeEach(() => {
  jest.clearAllMocks()
  zone = null
})

describe('the product editor’s search listing zone (AGL-2910)', () => {
  it('hands the zone the product, the fields a product listing holds, and what they hold', () => {
    renderDialog(true)
    expect(zone).toMatchObject({
      slot: 'seoFields',
      hostId: 'host-1',
      subject: {
        kind: 'product',
        id: 'prod-1',
        name: 'Desk lamp',
        description: 'An adjustable brass desk lamp with a warm dimmable bulb.',
      },
      fields: ['title', 'description'],
      values: { title: '', description: '' },
      hasImage: false,
    })
  })

  it('stages a proposal in the fields and writes nothing until Save product', async () => {
    renderDialog(true)
    fireEvent.click(screen.getByRole('button', { name: 'Propose listing' }))

    expect((screen.getByLabelText('SEO title') as HTMLInputElement).value).toBe(
      'Brass desk lamp with a dimmable bulb',
    )
    expect(setDoc).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save product' }))
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect(payload.seo).toEqual({
      title: 'Brass desk lamp with a dimmable bulb',
      description: 'An adjustable brass desk lamp with a warm, dimmable bulb for late reading.',
    })
  })

  it('renders no zone, and nothing breaks, outside the console shell', () => {
    renderDialog(false)
    expect(zone).toBeNull()
    expect(screen.queryByRole('button', { name: 'Propose listing' })).toBeNull()
    expect(screen.getByLabelText('SEO title')).toBeTruthy()
  })
})
