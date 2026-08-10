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
 * The commerce cards must not write a whole document back from a seed the
 * server never confirmed (AGL-1358).
 *
 * Both cards here open a dialog seeded by copying a stored row out of a
 * LISTENER, then save every field of it. `merge: true` protects nothing in
 * that shape — the untouched fields are all in the payload — and under
 * `persistentLocalCache` the seed can be arbitrarily old, because a refused
 * listen keeps serving cached snapshots and each one resets the hook's retry
 * budget so `status` never reaches `'error'`. `fromCache` is the only signal
 * that fires.
 *
 * What that costs, concretely:
 *
 * - suppliers — `webhookSecret` rides in the payload of a write with NO
 *   options argument, a full document replace. Rotate the secret elsewhere,
 *   rename the supplier here, and the retired secret is stored again.
 * - discounts — `redemptions` is a live counter the checkout engine
 *   increments. A stale seed rolls it back and re-issues uses buyers already
 *   spent.
 *
 * BOTH directions are asserted for each card, and the positive control is the
 * one that matters most: this guard stands in front of the ordinary save, so
 * a false positive breaks the feature for every seller.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { addDoc, setDoc, updateDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import DiscountsCard from './discounts-card.component'
import ProductsHubCard from './products-hub-card.component'
import SuppliersCard from './suppliers-card.component'

/** Mutable so each spec picks the listener's verdict before rendering. */
const listener = {
  fromCache: false,
  status: 'success' as 'success' | 'error',
}

const supplierDocs = [
  {
    $id: 'sup-1',
    name: 'Acme Fulfillment',
    email: 'ops@acme.test',
    webhookUrl: 'https://acme.test/hook',
    // The value a stale seed would restore over a rotated one.
    webhookSecret: 'secret-that-was-rotated',
  },
]
const discountDocs = [
  {
    $id: 'disc-1',
    code: 'SPRING',
    kind: 'percent',
    valuePct: 10,
    enabled: true,
    maxRedemptions: 100,
    // The live counter a stale seed would roll backwards.
    redemptions: 87,
  },
]
const productDocs = [
  {
    $id: 'prod-1',
    name: 'Desk lamp',
    slug: 'desk-lamp',
    status: 'active',
    type: 'physical',
    // The live stock a stale seed would recompute from and overwrite.
    variants: [{ id: 'v1', priceUsd: 40, inventory: 12 }],
  },
]
const collections: Record<string, Array<Record<string, unknown>>> = {
  suppliers: supplierDocs,
  discounts: discountDocs,
  products: productDocs,
  locations: [],
  licenseKeys: [],
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: listener.status,
    fromCache: listener.fromCache,
  }),
  // Products hub only: a paying, settled plan, so nothing below is refused
  // for the AGL-1064 reason instead of the one under test.
  useOrgPlan: () => ({ org: { plan: 'business' }, ready: true }),
  useHostResourceApi: () => jest.fn(),
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  useFirestoreDoc: () => ({ data: undefined }),
  // The REAL guard, not a stub. A stubbed guard would pass these specs with
  // the wiring removed, which is the only thing they exist to prove.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

// Only the ref builders are stubbed; the real module rides along because
// `@aglyn/shared-util-timestamp` extends the SDK's `Timestamp`.
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, _a: string, _b: string, name: string) => name,
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  deleteDoc: jest.fn(),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  addDoc: jest.fn().mockResolvedValue(undefined),
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
jest.mock(
  '@aglyn/shared-ui-next/contexts/next-page-title-provider',
  () => ({ NextPageTitle: () => null }),
  { virtual: true },
)

beforeEach(() => {
  jest.clearAllMocks()
  listener.fromCache = false
  listener.status = 'success'
})

/** Open the row's editor and press Save. */
function editFirstRowAndSave() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('SuppliersCard (AGL-1358)', () => {
  it('REFUSES to rewrite a supplier seeded from an unconfirmed read', async () => {
    listener.fromCache = true
    render(<SuppliersCard hostId="host-1" />)

    editFirstRowAndSave()

    // Settled, so this cannot pass merely by asserting too early.
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    // The refusal explains itself and names a next step, rather than looking
    // like a save that quietly did nothing.
    const [message] = enqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('supplier'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // …and the dialog is still open with what was typed.
    expect(screen.getByLabelText('Webhook secret')).toBeTruthy()
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<SuppliersCard hostId="host-1" />)

    editFirstRowAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect(payload.name).toBe('Acme Fulfillment')
  })

  /**
   * A NEW supplier is built from blanks at a fresh uid and can overwrite
   * nothing, so guarding it would refuse a save that was never unsafe. The
   * first snapshot of any listener is `fromCache: true`, so this is the
   * common case, not a corner.
   */
  it('still adds a NEW supplier while the listener is unconfirmed', async () => {
    listener.fromCache = true
    render(<SuppliersCard hostId="host-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Add supplier' }))
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Globex' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
  })
})

describe('DiscountsCard (AGL-1358)', () => {
  it('REFUSES to rewrite a discount seeded from an unconfirmed read', async () => {
    listener.fromCache = true
    render(<DiscountsCard hostId="host-1" />)

    editFirstRowAndSave()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    // The redemption counter was never rolled back.
    expect(setDoc).not.toHaveBeenCalled()
    expect(enqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringContaining('discount'),
    )
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<DiscountsCard hostId="host-1" />)

    editFirstRowAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect(payload.redemptions).toBe(87)
  })

  /**
   * The other listener signal. A read that FAILED would write blanks over a
   * populated document, and it is refused for a different stated reason.
   */
  it('REFUSES when the seeding read failed outright', async () => {
    listener.status = 'error'
    render(<DiscountsCard hostId="host-1" />)

    editFirstRowAndSave()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    expect(enqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })
})

/**
 * Stock adjustment (AGL-1358).
 *
 * The dangerous part is that this does NOT write a delta. It recomputes the
 * whole `variants` array from the seeded product and replaces it, so a
 * cached seed silently reverts every sale, return and adjustment the server
 * has recorded since that snapshot — across every variant and location.
 *
 * The refusal has to cover the adjustment LOG too: a logged adjustment whose
 * stock write never happened leaves the history disagreeing with the count it
 * is supposed to explain, which is worse than neither.
 */
describe('ProductsHubCard stock adjustment (AGL-1358)', () => {
  const openStockDialogAndApply = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Stock' }))
    fireEvent.change(screen.getByLabelText('Change'), {
      target: { value: '5' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  }

  it('REFUSES to recompute stock from an unconfirmed read', async () => {
    listener.fromCache = true
    render(<ProductsHubCard hostId="host-1" />)

    openStockDialogAndApply()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(updateDoc).not.toHaveBeenCalled()
    // And no orphaned history entry claiming an adjustment that never landed.
    expect(addDoc).not.toHaveBeenCalled()
    expect(enqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringContaining('stock'),
    )
  })

  it('APPLIES the adjustment once the server has confirmed the seed', async () => {
    render(<ProductsHubCard hostId="host-1" />)

    openStockDialogAndApply()

    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (updateDoc as jest.Mock).mock.calls[0]
    expect(payload.variants[0].inventory).toBe(17)
    // The history entry rides along with the write it explains.
    expect(addDoc).toHaveBeenCalledTimes(1)
  })
})
