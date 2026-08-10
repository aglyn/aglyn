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
 * The remaining commerce console surfaces must not write a whole object back
 * from a seed the server never confirmed (AGL-1358).
 *
 * The three settings cards share one document, `hosts/{h}/settings/store`, in
 * disjoint key namespaces. `merge: true` keeps them from clobbering each
 * other and protects nothing of their own: each writes every key it owns,
 * seeded from the same listener. What that costs:
 *
 * - store — `guestCheckout`, and two template ids that fall back to `null`,
 *   which is how a storefront's product and collection URLs start 404ing.
 * - shipping — `zones` and `rates` are arrays, and a merge replaces an array
 *   wholesale. A zone lost with the rest means `resolveShippingRates` matches
 *   nothing: a checkout offering no shipping option at all.
 * - tax — `mode` back from `stripe` to `manual` stops automatic calculation
 *   and the store under-collects, silently.
 *
 * None of the three has a create path to exempt, which is the distinction
 * this issue keeps turning on: they write a FIXED document path, so the
 * all-defaults state produced when the cache has never seen the doc is not
 * the harmless blank a fresh uid would be.
 *
 * The other two are the ordinary shape:
 *
 * - reservations — a whole resource row, `blocks` included: the manually
 *   blocked dates `isRangeAvailable` reads, so a rollback re-opens closed
 *   dates and lets the next guest book a room already spoken for.
 * - catalog — the delete's REPARENT is this issue at its least visible. No
 *   editor was opened, so nothing on screen looks stale, and `{...child}` is
 *   a full replace of a cached row for a document the author never touched.
 *   The guard encloses the delete too: children are found from the same seed,
 *   so half the sequence is worse than none of it.
 *
 * Both directions asserted at every site. The positive controls matter most:
 * these stand in front of the ordinary save.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { deleteDoc, setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import CatalogOrganizationCard from './catalog-organization-card.component'
import ReservationsCard from './reservations-card.component'
import ShippingSettingsCard from './shipping-settings-card.component'
import StoreSettingsCard from './store-settings-card.component'
import TaxSettingsCard from './tax-settings-card.component'

/** Mutable so each spec picks the listener's verdict before rendering. */
const listener = {
  fromCache: false,
  status: 'success' as 'success' | 'error',
}

/** The one settings doc all three cards are seeded from. */
const storeDoc = {
  pdpScreenId: 'screen-pdp',
  collectionScreenId: 'screen-collection',
  currency: 'USD',
  guestCheckout: true,
  termsUrl: 'https://shop.test/terms',
  receiptFooter: 'Thanks for shopping',
  shipping: {
    zones: [{ id: 'z1', name: 'Domestic', countries: ['US'] }],
    rates: [{ id: 'r1', zoneId: 'z1', name: 'Standard', priceCents: 500 }],
    localPickup: false,
  },
  // `mode` rides in the payload on every save, which is what makes a stale
  // seed expensive here: one that still says `manual` writes it over a store
  // the server has since moved to `stripe`, and automatic tax stops.
  tax: {
    mode: 'manual',
    pricesIncludeTax: false,
    rates: [{ country: 'US', pct: 7.5 }],
  },
}

const resourceDocs = [
  {
    $id: 'res-1',
    name: 'Garden suite',
    nightlyRateUsd: 180,
    depositPct: 30,
    minNights: 2,
    // The blocked dates a stale seed would re-open.
    blocks: [{ fromDayMs: 1, toDayMs: 2 }],
  },
]
const categoryDocs = [
  { $id: 'cat-1', name: 'Outdoor', parentId: null, order: 0 },
  // The child the delete reparents from a cached row.
  { $id: 'cat-2', name: 'Tents', parentId: 'cat-1', order: 1 },
]
const collectionDocs = [
  {
    $id: 'col-1',
    kind: 'catalog',
    name: 'Summer picks',
    slug: 'summer-picks',
    mode: 'manual',
    // The membership a stale seed would drop.
    productIds: ['prod-1', 'prod-2'],
    rules: [],
    matchAll: true,
  },
]
const collections: Record<string, Array<Record<string, unknown>>> = {
  resources: resourceDocs,
  reservations: [],
  productCategories: categoryDocs,
  collections: collectionDocs,
  products: [],
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreDoc: () => ({
    data: storeDoc,
    status: listener.status,
    fromCache: listener.fromCache,
  }),
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: listener.status,
    fromCache: listener.fromCache,
  }),
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  // The REAL guard, not a stub. A stub would let the write through whatever
  // the card passed it, which is the one thing these specs disprove.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

// Only the ref builders are stubbed; the real module rides along because
// `@aglyn/shared-util-timestamp` extends the SDK's `Timestamp`.
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
const confirm = jest.fn().mockResolvedValue(undefined)
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm }),
}))

/** The collection save posts to the AGL-978 route rather than writing
 * directly, so the request is what a refusal has to stop. */
const fetchMock = jest.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({}),
})

beforeEach(() => {
  jest.clearAllMocks()
  listener.fromCache = false
  listener.status = 'success'
  confirm.mockResolvedValue(undefined)
  ;(globalThis as any).fetch = fetchMock
})

describe('StoreSettingsCard (AGL-1358)', () => {
  /** Save is disabled until the form differs from the seed. */
  const editAndSave = () => {
    fireEvent.change(screen.getByLabelText('Terms URL'), {
      target: { value: 'https://shop.test/legal' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Save store settings' }),
    )
  }

  it('REFUSES to rewrite store settings from an unconfirmed read', async () => {
    listener.fromCache = true
    render(<StoreSettingsCard hostId="host-1" />)

    editAndSave()

    // Settled, so this cannot pass merely by asserting too early.
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    const [message] = enqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('store settings'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // The form keeps what was typed, so the refusal is not a silent no-op.
    expect(
      (screen.getByLabelText('Terms URL') as HTMLInputElement).value,
    ).toEqual('https://shop.test/legal')
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<StoreSettingsCard hostId="host-1" />)

    editAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect(payload.termsUrl).toBe('https://shop.test/legal')
    // Every other key rides along — which is why the guard is the only thing
    // standing between a stale seed and the rest of them.
    expect(payload.pdpScreenId).toBe('screen-pdp')
  })

  it('REFUSES when the settings read failed, and says so differently', async () => {
    listener.status = 'error'
    render(<StoreSettingsCard hostId="host-1" />)

    editAndSave()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    expect(enqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })
})

describe('ShippingSettingsCard (AGL-1358)', () => {
  const editAndSave = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Add zone' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Save shipping settings' }),
    )
  }

  it('REFUSES to rewrite shipping settings from an unconfirmed read', async () => {
    listener.fromCache = true
    render(<ShippingSettingsCard hostId="host-1" />)

    editAndSave()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    const [message] = enqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('shipping settings'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<ShippingSettingsCard hostId="host-1" />)

    editAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    // The stored rate table rides along with the new zone.
    expect(payload.shipping.rates).toHaveLength(1)
  })
})

describe('TaxSettingsCard (AGL-1358)', () => {
  const editAndSave = () => {
    fireEvent.click(screen.getByLabelText('Prices include tax (VAT-style)'))
    fireEvent.click(screen.getByRole('button', { name: 'Save tax settings' }))
  }

  it('REFUSES to rewrite tax settings from an unconfirmed read', async () => {
    listener.fromCache = true
    render(<TaxSettingsCard hostId="host-1" />)

    editAndSave()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    expect(enqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringContaining('tax settings'),
    )
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<TaxSettingsCard hostId="host-1" />)

    editAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect(payload.tax.pricesIncludeTax).toBe(true)
    // `mode` and the whole rate table ride along untouched — the payload the
    // guard is the only thing standing in front of.
    expect(payload.tax.mode).toBe('manual')
    expect(payload.tax.rates[0].pct).toBe(7.5)
  })
})

describe('ReservationsCard (AGL-1358)', () => {
  const editFirstResourceAndSave = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  }

  it('REFUSES to rewrite a resource seeded from an unconfirmed read', async () => {
    listener.fromCache = true
    render(<ReservationsCard hostId="host-1" />)

    editFirstResourceAndSave()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    const [message] = enqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('resource'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // The dialog is still open with what was being edited.
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toEqual(
      'Garden suite',
    )
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<ReservationsCard hostId="host-1" />)

    editFirstResourceAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    // The blocked dates ride in the payload, untouched by the edit.
    expect(payload.blocks).toHaveLength(1)
  })

  /**
   * A NEW resource is built from defaults at a fresh uid and can overwrite
   * nothing, so guarding it would refuse a save that was never unsafe — and
   * the first snapshot of any listener is `fromCache: true`, so that is the
   * common case rather than a corner.
   */
  it('still adds a NEW resource while the listener is unconfirmed', async () => {
    listener.fromCache = true
    render(<ReservationsCard hostId="host-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Add resource' }))
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Loft' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
  })
})

describe('CatalogOrganizationCard (AGL-1358)', () => {
  /** Categories and collections both render Edit/Delete; the category tree
   * comes first, so index 0 is the parent category's row. */
  const clickCategoryAction = (name: 'Edit' | 'Delete') =>
    fireEvent.click(screen.getAllByRole('button', { name })[0])

  it('REFUSES to rewrite a category seeded from an unconfirmed read', async () => {
    listener.fromCache = true
    render(<CatalogOrganizationCard hostId="host-1" />)

    clickCategoryAction('Edit')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    expect(enqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringContaining('category'),
    )
    // The dialog is still open with what was being edited.
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toEqual(
      'Outdoor',
    )
  })

  it('SAVES a category normally once the server has confirmed the seed', async () => {
    render(<CatalogOrganizationCard hostId="host-1" />)

    clickCategoryAction('Edit')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect(payload.name).toBe('Outdoor')
  })

  /**
   * The reparent is the site nobody would look at: no editor was opened, so
   * nothing on screen looks stale. The delete is inside the guard with it,
   * because `children` is found from the same seed — a delete that lands
   * without its reparent leaves the children pointing at a category that no
   * longer exists.
   */
  it('REFUSES the delete-and-reparent when the rows it reads are unconfirmed', async () => {
    listener.fromCache = true
    render(<CatalogOrganizationCard hostId="host-1" />)

    clickCategoryAction('Delete')

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    // Neither half of the sequence ran.
    expect(deleteDoc).not.toHaveBeenCalled()
    const [message] = enqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('categories'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
  })

  it('DELETES and reparents normally once the server has confirmed the seed', async () => {
    render(<CatalogOrganizationCard hostId="host-1" />)

    clickCategoryAction('Delete')

    await waitFor(() => expect(deleteDoc).toHaveBeenCalledTimes(1))
    // The one child was reparented to the root before the parent went.
    expect(setDoc).toHaveBeenCalledTimes(1)
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect(payload.parentId).toBeNull()
  })

  it('REFUSES to post a collection update seeded from an unconfirmed read', async () => {
    listener.fromCache = true
    render(<CatalogOrganizationCard hostId="host-1" />)

    // The collection list renders after the category tree.
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' }).at(-1)!)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    // The request never left the browser.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(enqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringContaining('collection'),
    )
  })

  it('POSTS the collection update once the server has confirmed the seed', async () => {
    render(<CatalogOrganizationCard hostId="host-1" />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' }).at(-1)!)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    expect(body.action).toBe('update')
    // The whole membership rides in the payload.
    expect(body.data.productIds).toEqual(['prod-1', 'prod-2'])
  })
})
