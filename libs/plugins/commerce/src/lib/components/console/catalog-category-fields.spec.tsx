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
 * Renaming a category must not delete the fields the form does not own
 * (AGL-1372).
 *
 * This is not the AGL-1358 shape: no cache miss, no dead session. The save
 * wrote a four-key payload with no options argument, which in Firestore is a
 * whole-document REPLACE, so every stored key the form does not send was
 * deleted on a perfectly healthy save — `order`, which both the console tree
 * and `queryPublicCatalog`'s facet chips sort by, and `createdAt`, which the
 * seeder writes and this card never does.
 *
 * `setDoc` is therefore modelled here rather than merely spied on: the specs
 * apply the payload to a stored document with Firestore's own merge
 * semantics, and assert on what SURVIVES. A spy that only inspects the
 * options argument would pass against a payload that carried `order` and no
 * merge, and fail against a correct fix written the other way round; this
 * asserts the outcome both fixes share.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import CatalogOrganizationCard from './catalog-organization-card.component'

/**
 * The stored category. `order` places it in the tree; `createdAt` is written
 * by the seeder (`tools/scripts/seed-demo-host.mjs`). Neither is in the save
 * payload, and neither has a control in this card.
 */
const STORED_CATEGORY = {
  $id: 'cat-1',
  name: 'Outdoor',
  slug: 'outdoor',
  parentId: null,
  order: 3,
  createdAt: 'seeded-at',
}

const collections: Record<string, Array<Record<string, unknown>>> = {
  productCategories: [STORED_CATEGORY],
  collections: [],
  products: [],
  resources: [],
  reservations: [],
}

/** What the document holds after the writes this save performs. */
let stored: Record<string, unknown> = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreDoc: () => ({ data: {}, status: 'success', fromCache: false }),
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  // The REAL guard (AGL-1358). These saves are all confirmed reads, so it
  // lets them through — this issue's bugs fire on exactly those.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  setDoc: jest.fn(),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  stored = { ...STORED_CATEGORY }
  delete (stored as { $id?: string }).$id
  // Firestore's own semantics: with `{ merge: true }` the payload's keys are
  // written over the document; WITHOUT it the document is replaced, and every
  // key the payload omits is gone.
  ;(setDoc as jest.Mock).mockImplementation(
    async (
      _ref: unknown,
      data: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      stored = options?.merge ? { ...stored, ...data } : { ...data }
    },
  )
})

/** Open the stored category's editor, rename it, and save. */
function renameCategoryAndSave() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Outdoor gear' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('CatalogOrganizationCard category save (AGL-1372)', () => {
  it('keeps the tree position when a category is renamed', async () => {
    render(<CatalogOrganizationCard hostId="host-1" />)

    renameCategoryAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    // The rename landed…
    expect(stored.name).toBe('Outdoor gear')
    expect(stored.slug).toBe('outdoor-gear')
    // …and did not take the position with it. Every rename dropped this.
    expect(stored.order).toBe(3)
  })

  it('keeps every other stored key the payload never carries', async () => {
    render(<CatalogOrganizationCard hostId="host-1" />)

    renameCategoryAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    // `order` was the field the issue named; it was never the only one.
    expect(stored.createdAt).toBe('seeded-at')
  })

  it('still writes the fields the form DOES own', async () => {
    render(<CatalogOrganizationCard hostId="host-1" />)

    renameCategoryAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    // A merge must not turn the save into a no-op for its own keys, and
    // `parentId` still clears to an explicit null rather than being skipped.
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect(payload.parentId).toBeNull()
    expect(payload.updatedAt).toBeDefined()
  })

  /**
   * A NEW category is a fresh uid with no stored document, so a merging write
   * still creates it with exactly the four keys the form owns.
   */
  it('creates a NEW category with the payload it sends', async () => {
    stored = {}
    render(<CatalogOrganizationCard hostId="host-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Add category' }))
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Indoor' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    expect(stored.name).toBe('Indoor')
    expect(stored.slug).toBe('indoor')
    expect(stored.parentId).toBeNull()
  })
})
