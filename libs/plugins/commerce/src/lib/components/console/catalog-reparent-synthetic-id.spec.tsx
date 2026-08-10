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
 * Deleting a category must not write the listener's synthetic `$id` into its
 * children (AGL-1374).
 *
 * `idField: '$id'` stamps the document id onto the in-memory row; nothing
 * persists it. The reparent spread that row — `setDoc(ref, {...child,
 * parentId: null})` — so every delete-with-children added a real `$id` key to
 * each child, permanently. Nothing reads it, so nothing broke; it is the
 * listener's bookkeeping leaking into storage, where no later reader can tell
 * it from a field the card meant to write.
 *
 * `setDoc` is MODELLED here rather than spied on, as the AGL-1372 specs are:
 * the payload is applied to a stored document with Firestore's own merge
 * semantics and the assertions are about what is STORED. A spy asserting the
 * payload has no `$id` would pass against a fix that stripped the key and left
 * the whole-row replace in place; this asserts the outcome, so it holds for
 * either fix and would catch the key arriving by any other route.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import CatalogOrganizationCard from './catalog-organization-card.component'

/** The category being deleted. */
const PARENT = {
  $id: 'cat-parent',
  name: 'Outdoor',
  slug: 'outdoor',
  parentId: null,
  order: 1,
}

/**
 * Its child. `order` and `createdAt` are stored fields the delete has no
 * business touching — the reparent owns `parentId` and nothing else.
 */
const CHILD = {
  $id: 'cat-child',
  name: 'Tents',
  slug: 'tents',
  parentId: 'cat-parent',
  order: 7,
  createdAt: 'seeded-at',
}

const collections: Record<string, Array<Record<string, unknown>>> = {
  productCategories: [PARENT, CHILD],
  collections: [],
  products: [],
  resources: [],
  reservations: [],
}

/** What the CHILD document holds after the writes this delete performs. */
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
  // The REAL guard (AGL-1358). This delete reads a confirmed seed, so the
  // guard lets it through — which is exactly when this bug fires.
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
    // Resolving is a CONFIRMED delete: the card reads `.then(() => true)`.
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  // The STORED child — the synthetic `$id` is not part of it, which is the
  // whole point of `idField`.
  //
  // `order` deliberately DISAGREES with the listener row: 9 here, 7 in the
  // snapshot the card is holding. That is the ordinary case, not a contrived
  // one — someone reordered the tree after this listener's last delivery. It
  // is what makes the whole-row replace visible: the narrow write leaves 9
  // standing, the old `{...child}` payload puts 7 back.
  stored = { ...CHILD, order: 9 }
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

/** Delete the PARENT, which reparents CHILD to the top level. */
function deleteParentCategory() {
  // The parent is the first row in the tree walk; its Delete is the first.
  fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
}

describe('CatalogOrganizationCard delete-with-children (AGL-1374)', () => {
  it('does not store the listener-synthetic $id on the reparented child', async () => {
    render(<CatalogOrganizationCard hostId="host-1" />)

    deleteParentCategory()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    // The key that only ever existed in memory must not exist in the document.
    expect(stored).not.toHaveProperty('$id')
    expect(Object.keys(stored)).not.toContain('$id')
  })

  it('still moves the child to the top level', async () => {
    render(<CatalogOrganizationCard hostId="host-1" />)

    deleteParentCategory()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    // The reparent is the point of the write; `null` is a value, so it merges.
    expect(stored.parentId).toBeNull()
  })

  /**
   * The narrow write's second job. The old payload was a whole-document
   * replace of a CACHED row, so a delete rewrote every field of every child
   * back to that snapshot — the AGL-1358 hazard in miniature. A field the
   * delete does not name must survive it untouched, including one the stored
   * document has moved on from.
   */
  it('leaves the child fields the delete does not own alone', async () => {
    render(<CatalogOrganizationCard hostId="host-1" />)

    deleteParentCategory()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    expect(stored.name).toBe('Tents')
    expect(stored.createdAt).toBe('seeded-at')
    // The stored position stands. The old payload reverted it to the
    // listener's stale 7, silently reordering the storefront's facet chips.
    expect(stored.order).toBe(9)
  })
})
