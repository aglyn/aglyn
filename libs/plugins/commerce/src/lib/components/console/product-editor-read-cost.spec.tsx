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
 *
 * @jest-environment jsdom
 */

/**
 * What the catalog page pays for an editor nobody opened.
 *
 * `ProductEditorDialog` is rendered UNCONDITIONALLY by the products hub and
 * told whether it is open through a prop. That is the ordinary MUI shape and
 * it is fine for markup — a closed `<Dialog>` renders nothing — but the
 * component's body still runs on every render of the page, so any listener
 * built there subscribes whether or not the editor is ever opened.
 *
 * Three collections feed three pickers inside it. Ungated, opening the catalog
 * paid for all three: a merchant browsing their products was charged for
 * categories, suppliers and a second full pass over products, none of which
 * reached the screen.
 *
 * A rendering assertion cannot see any of this. A closed dialog draws nothing
 * either way, so both designs look identical on screen and differ only in the
 * bill. The meter therefore sits at the Firestore boundary and counts distinct
 * SUBSCRIPTIONS as path plus the ceiling the query carries — that ceiling is
 * the billable number, and a listener re-registered under a new query identity
 * is a new subscription.
 */

import { cleanup, render } from '@testing-library/react'

interface CapturedQuery {
  __path: string
  __limit: number
  /** What the cap is a cap ON. Empty means the query named no order. */
  __order: string
}

/** Every distinct listen this render opened. */
const mockListens: string[] = []

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ __path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ __path: path.join('/') }),
  getDoc: async () => ({ exists: () => false, data: () => undefined }),
  setDoc: async () => undefined,
  query: (base: { __path: string }, ...constraints: any[]) => ({
    __path: base.__path,
    __limit:
      constraints.find((entry) => entry?.__constraint === 'limit')?.args?.[0] ??
      0,
    __order: String(
      constraints.find((entry) => entry?.__constraint === 'orderBy')?.args?.[0] ??
        '',
    ),
  }),
  limit: (...args: unknown[]) => ({ __constraint: 'limit', args }),
  orderBy: (...args: unknown[]) => ({ __constraint: 'orderBy', args }),
  documentId: () => '__name__',
}))

jest.mock('@aglyn/tenant-feature-instance', () => {
  const firestore = require('firebase/firestore')
  return {
    useFirestore: () => ({}),
    useHostResourceApi: () => async () => ({ id: 'x' }),
    writeGuardedBySeed: async () => undefined,
    collectionCeiling: (ref: { __path: string }, ceiling: number) =>
      firestore.query(
        ref,
        firestore.orderBy(firestore.documentId()),
        firestore.limit(ceiling + 1),
      ),
    ceilingedWindow: (read: unknown[] | undefined, ceiling: number) => ({
      rows: (read ?? []).slice(0, ceiling),
      truncated: (read ?? []).length > ceiling,
    }),
    useFirestoreCollection: (build: () => CapturedQuery | null) => {
      const ref = build()
      /*
       * `null` is the skip, and a subscription that never opened must not be
       * recorded as one — that is the whole point of the gate.
       *
       * The ordering rides in the key beside the ceiling: an unordered cap of
       * the same size bills the same and answers a different question, so a
       * key carrying only the number would call the two identical.
       */
      if (ref) mockListens.push(`${ref.__path}#${ref.__limit}#${ref.__order}`)
      return { data: [] }
    },
  }
})

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))

jest.mock('@aglyn/aglyn', () => ({
  useMediaPicker: () => async () => null,
}))

jest.mock('./entitlement-gate.component', () => ({
  EntitlementUpsell: () => null,
  useCommerceEntitlement: () => ({
    ready: true,
    entitled: true,
    upgradeHref: '/x',
    planLabel: 'Pro',
  }),
}))

import ProductEditorDialog from './product-editor-dialog.component'

beforeEach(() => {
  mockListens.length = 0
})

afterEach(cleanup)

describe('the closed editor is free', () => {
  it('opens no listener at all while it is closed', () => {
    render(
      <ProductEditorDialog
        hostId="host-1"
        product={null}
        seedFromCache={false}
        open={false}
        onClose={() => undefined}
      />,
    )

    // Not "few" — none. The catalog page renders this on every visit.
    expect(mockListens).toEqual([])
  })

  it('opens exactly three, at their pinned ceilings, once it is open', () => {
    render(
      <ProductEditorDialog
        hostId="host-1"
        product={null}
        seedFromCache={false}
        open
        onClose={() => undefined}
      />,
    )

    // THE CONTROL for the case above: a gate that never opened anything would
    // satisfy it perfectly. Each ceiling probes one past itself, so the
    // billable numbers are 251, 301 and 51.
    expect([...mockListens].sort()).toEqual([
      'hosts/host-1/productCategories#251#__name__',
      'hosts/host-1/products#301#__name__',
      'hosts/host-1/suppliers#51#__name__',
    ])
  })

  it('stops listening again when the editor closes', () => {
    const { rerender } = render(
      <ProductEditorDialog
        hostId="host-1"
        product={null}
        seedFromCache={false}
        open
        onClose={() => undefined}
      />,
    )
    mockListens.length = 0

    rerender(
      <ProductEditorDialog
        hostId="host-1"
        product={null}
        seedFromCache={false}
        open={false}
        onClose={() => undefined}
      />,
    )

    expect(mockListens).toEqual([])
  })
})
