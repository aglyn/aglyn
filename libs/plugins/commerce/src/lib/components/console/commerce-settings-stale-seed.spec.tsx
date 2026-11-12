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
import { setSeedConfirmWaitMs } from '@aglyn/tenant-feature-instance/hooks/helpers/listen-confirmation'
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

/** How the signed-in account answers `getIdToken()` for the test at hand. */
let mockTokenBehavior: 'mints' | 'signed-out' = 'mints'
const mockGetIdToken = jest.fn(async () => 'token-owner')

// The card saves through `writeSiteWideChange` (AGL-3386); the double sends
// each staged write to this spec's own `firebase/firestore` mock.
jest.mock('@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change', () =>
  jest
    .requireActual('@aglyn/tenant-feature-instance/testing/site-wide-change-double')
    .siteWideChangeThroughSdk(() => jest.requireMock('firebase/firestore')),
)

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useMerchantPayments: () => ({ state: 'ready', settled: true, ready: true, blocked: false, reason: null, href: null }),
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
  // Modelled rather than stubbed: the real hook over-fetches by one and
  // hands back the page WITHOUT the probe row. A stub returning everything
  // would render rows the component cannot actually be given, and hide an
  // off-by-one instead of catching it.
  usePagedCollection: (
    build: (pageLimit: number) => unknown,
    _deps: unknown,
    options: { pageSize?: number } = {},
  ) => {
    const pageSize = options.pageSize ?? 25
    const data = collections[build(pageSize + 1) as string] ?? []
    return {
      rows: data.slice(0, pageSize),
      hasMore: data.length > pageSize,
      loadMore: () => undefined,
      windowSize: pageSize,
      // The footer's own state. Absent, `page` reached `ListPagination` as
      // undefined and every card that reads it rendered a broken control.
      page: 0,
      setPage: () => undefined,
      pageSize,
      setPageSize: () => undefined,
      data,
      status: listener.status,
      fromCache: listener.fromCache,
    }
  },
  // A token that is actually minted. `jest.fn()` resolves `undefined`, which
  // is a signed-out account: the route this card posts to answers 401
  // without a bearer token, so the write would never be issued.
  useUser: () => ({
    data:
      mockTokenBehavior === 'signed-out'
        ? { uid: 'uid-owner' }
        : { uid: 'uid-owner', getIdToken: mockGetIdToken },
  }),
  // The REAL guard, not a stub. A stub would let the write through whatever
  // the card passed it, which is the one thing these specs disprove.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
  // The real builders (AGL-2501): the ordering and the ceiling belong to the
  // cards, not to this double.
  collectionCeiling: jest.requireActual('@aglyn/tenant-feature-instance')
    .collectionCeiling,
  ceilingedWindow: jest.requireActual('@aglyn/tenant-feature-instance')
    .ceilingedWindow,
  collectionPage: jest.requireActual('@aglyn/tenant-feature-instance')
    .collectionPage,
}))

// Only the ref builders are stubbed; the real module rides along because
// `@aglyn/shared-util-timestamp` extends the SDK's `Timestamp`.
/*
 * The host's smart collections, which every product write asks the store for
 * to stamp `collectionIds` (AGL-3321): none on this site.
 */
jest.mock('./smart-collections', () => ({
  readSmartCollections: async () => [],
  productCollectionFields: async () => ({ collectionIds: [] }),
}))

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
  mockTokenBehavior = 'mints'
  mockGetIdToken.mockImplementation(async () => 'token-owner')
  listener.fromCache = false
  listener.status = 'success'
  confirm.mockResolvedValue(undefined)
  ;(globalThis as any).fetch = fetchMock
})

/** Long enough for a press that was going to write to have written. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

// This spec pins the refusal, not the wait before it (AGL-4120).
beforeAll(() => setSeedConfirmWaitMs(0))
afterAll(() => setSeedConfirmWaitMs())

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

  /**
   * The first press is never refused for a late server (AGL-4047): Save is
   * HELD while the settings read is the cache's, with the reason beside it,
   * and what was typed stays.
   */
  it('KEEPS a Save pressed, with the reason beside it, while the read is unconfirmed', async () => {
    listener.fromCache = true
    render(<StoreSettingsCard hostId="host-1" />)

    editAndSave()
    // Kept, not dropped (AGL-4047): the press says Saving… at once.
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy()
    await settle()

    // No confirmation came within the guard's wait (0 in this spec), so the
    // press ends in the guard's refusal, and Save can be pressed again.
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        expect.stringMatching(/could not confirm your store settings with the server yet, so nothing was saved/),
        expect.anything(),
      ),
    )
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Save store settings' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    )
    expect(screen.getByRole('status').textContent).toBe(
      'Checking your store settings with the server…',
    )
    expect(setDoc).not.toHaveBeenCalled()
    // The form keeps what was typed.
    expect(
      (screen.getByLabelText('Terms URL') as HTMLInputElement).value,
    ).toEqual('https://shop.test/legal')
  })

  /**
   * The half that keeps the guard's protection while Save is held: the edit
   * is replayed onto what the server confirms, so a field nobody touched is
   * saved as the server has it, never as the cache had it.
   */
  it('saves the edit onto the settings the server confirms, on the first press', async () => {
    listener.fromCache = true
    const { rerender } = render(<StoreSettingsCard hostId="host-1" />)
    fireEvent.change(screen.getByLabelText('Terms URL'), {
      target: { value: 'https://shop.test/legal' },
    })

    // Since the cached snapshot, guest checkout was switched off elsewhere.
    storeDoc.guestCheckout = false
    listener.fromCache = false
    try {
      rerender(<StoreSettingsCard hostId="host-1" />)
      expect(screen.queryByRole('status')).toBeNull()
      fireEvent.click(
        screen.getByRole('button', { name: 'Save store settings' }),
      )

      await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
      const [, payload] = (setDoc as jest.Mock).mock.calls[0]
      expect(payload.termsUrl).toBe('https://shop.test/legal')
      expect(payload.guestCheckout).toBe(false)
    } finally {
      storeDoc.guestCheckout = true
    }
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

  it('KEEPS a Save pressed while the read is unconfirmed, and saves onto the server’s rates', async () => {
    listener.fromCache = true
    const { rerender } = render(<ShippingSettingsCard hostId="host-1" />)

    editAndSave()
    await settle()

    expect(setDoc).not.toHaveBeenCalled()
    // Kept, not dropped (AGL-4047): no confirmation came within the
    // guard's wait (0 in this spec), so the press ends in the guard's refusal.
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        expect.stringMatching(/could not confirm your .+ with the server yet, so nothing was saved/),
        expect.anything(),
      ),
    )
    expect(screen.getByRole('status').textContent).toBe(
      'Checking your shipping settings with the server…',
    )

    // A rate was added elsewhere since the cached snapshot.
    const before = storeDoc.shipping
    storeDoc.shipping = {
      ...before,
      rates: [
        ...before.rates,
        { id: 'r2', zoneId: 'z1', name: 'Express', priceCents: 1500 },
      ],
    }
    listener.fromCache = false
    try {
      rerender(<ShippingSettingsCard hostId="host-1" />)
      fireEvent.click(
        screen.getByRole('button', { name: 'Save shipping settings' }),
      )

      await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
      const [, payload] = (setDoc as jest.Mock).mock.calls[0]
      // The new zone, and the rate table as the server has it.
      expect(payload.shipping.zones).toHaveLength(2)
      expect(payload.shipping.rates).toHaveLength(2)
    } finally {
      storeDoc.shipping = before
    }
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

  it('KEEPS a Save pressed while the read is unconfirmed, and saves onto the server’s mode', async () => {
    listener.fromCache = true
    const { rerender } = render(<TaxSettingsCard hostId="host-1" />)

    editAndSave()
    await settle()

    expect(setDoc).not.toHaveBeenCalled()
    // Kept, not dropped (AGL-4047): no confirmation came within the
    // guard's wait (0 in this spec), so the press ends in the guard's refusal.
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        expect.stringMatching(/could not confirm your .+ with the server yet, so nothing was saved/),
        expect.anything(),
      ),
    )
    expect(screen.getByRole('status').textContent).toBe(
      'Checking your tax settings with the server…',
    )

    // The store moved to automatic tax since the cached snapshot.
    const before = storeDoc.tax
    storeDoc.tax = { ...before, mode: 'stripe' }
    listener.fromCache = false
    try {
      rerender(<TaxSettingsCard hostId="host-1" />)
      fireEvent.click(screen.getByRole('button', { name: 'Save tax settings' }))

      await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
      const [, payload] = (setDoc as jest.Mock).mock.calls[0]
      expect(payload.tax.pricesIncludeTax).toBe(true)
      // Never put back to `manual` from the cache.
      expect(payload.tax.mode).toBe('stripe')
    } finally {
      storeDoc.tax = before
    }
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

  it('saves an undecided store’s choice as shown, with no edit first', async () => {
    // The select fires no change for the option already on screen, so a
    // Save that waited for an edit could never record "Manual rates".
    const decided = storeDoc.tax
    ;(storeDoc as { tax?: unknown }).tax = undefined
    try {
      render(<TaxSettingsCard hostId="host-1" />)
      fireEvent.click(screen.getByRole('button', { name: 'Save tax settings' }))
      await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
      expect((setDoc as jest.Mock).mock.calls[0][1].tax).toEqual({ mode: 'manual' })
    } finally {
      storeDoc.tax = decided
    }
  })

  it('keeps Save off for a decided store until something changes', () => {
    render(<TaxSettingsCard hostId="host-1" />)
    expect(
      (screen.getByRole('button', { name: 'Save tax settings' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})

describe('ReservationsCard (AGL-1358)', () => {
  const editFirstResourceAndSave = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  }

  it('KEEPS a Save pressed while the rows are unconfirmed, and saves onto the server’s row', async () => {
    listener.fromCache = true
    const { rerender } = render(<ReservationsCard hostId="host-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Garden suite (renovated)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await settle()

    expect(setDoc).not.toHaveBeenCalled()
    // Kept, not dropped (AGL-4047): no confirmation came within the
    // guard's wait (0 in this spec), so the press ends in the guard's refusal.
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        expect.stringMatching(/could not confirm your .+ with the server yet, so nothing was saved/),
        expect.anything(),
      ),
    )
    expect(screen.getByRole('status').textContent).toBe(
      'Checking your resource with the server…',
    )

    // Dates were blocked elsewhere since the cached snapshot.
    const before = resourceDocs[0].blocks
    resourceDocs[0].blocks = [...before, { fromDayMs: 5, toDayMs: 6 }]
    listener.fromCache = false
    try {
      rerender(<ReservationsCard hostId="host-1" />)
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
      const [, payload] = (setDoc as jest.Mock).mock.calls[0]
      expect(payload.name).toBe('Garden suite (renovated)')
      // The closed dates stay closed.
      expect(payload.blocks).toHaveLength(2)
    } finally {
      resourceDocs[0].blocks = before
    }
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

  it('KEEPS a category Save pressed while the rows are unconfirmed, and saves onto the server’s row', async () => {
    listener.fromCache = true
    const { rerender } = render(<CatalogOrganizationCard hostId="host-1" />)

    // Tents, the child, so the server can move it under another parent.
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1])
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Tents & tarps' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await settle()

    expect(setDoc).not.toHaveBeenCalled()
    // Kept, not dropped (AGL-4047): no confirmation came within the
    // guard's wait (0 in this spec), so the press ends in the guard's refusal.
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        expect.stringMatching(/could not confirm your .+ with the server yet, so nothing was saved/),
        expect.anything(),
      ),
    )
    expect(
      screen
        .getAllByRole('status')
        .map((note) => note.textContent),
    ).toContain('Checking your category with the server…')

    // Reparented to the top level elsewhere since the cached snapshot.
    categoryDocs[1].parentId = null as never
    listener.fromCache = false
    try {
      rerender(<CatalogOrganizationCard hostId="host-1" />)
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
      const [, payload] = (setDoc as jest.Mock).mock.calls[0]
      expect(payload.name).toBe('Tents & tarps')
      expect(payload.parentId).toBeNull()
    } finally {
      categoryDocs[1].parentId = 'cat-1'
    }
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
  it('HOLDS the delete-and-reparent, with the reason, while the rows are unconfirmed', async () => {
    listener.fromCache = true
    render(<CatalogOrganizationCard hostId="host-1" />)

    const remove = screen.getAllByRole('button', { name: 'Delete' })[0] as HTMLButtonElement
    expect(remove.disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toBe(
      'Checking your categories with the server…',
    )
    clickCategoryAction('Delete')
    await settle()

    // Neither half of the sequence ran, and nothing was refused.
    expect(setDoc).not.toHaveBeenCalled()
    expect(deleteDoc).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    expect(enqueueSnackbar).not.toHaveBeenCalled()
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

  it('KEEPS a collection Save pressed while the rows are unconfirmed, and posts onto the server’s row', async () => {
    listener.fromCache = true
    const { rerender } = render(<CatalogOrganizationCard hostId="host-1" />)

    // The collection list renders after the category tree.
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' }).at(-1)!)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await settle()

    // The request never left the browser, and nothing was refused.
    expect(fetchMock).not.toHaveBeenCalled()
    // Kept, not dropped (AGL-4047): no confirmation came within the
    // guard's wait (0 in this spec), so the press ends in the guard's refusal.
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        expect.stringMatching(/could not confirm your .+ with the server yet, so nothing was saved/),
        expect.anything(),
      ),
    )
    expect(
      screen
        .getAllByRole('status')
        .map((note) => note.textContent),
    ).toContain('Checking your collection with the server…')

    // A product joined the collection elsewhere since the cached snapshot.
    const before = collectionDocs[0].productIds
    collectionDocs[0].productIds = [...before, 'prod-3']
    listener.fromCache = false
    try {
      rerender(<CatalogOrganizationCard hostId="host-1" />)
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
      expect(body.data.productIds).toEqual(['prod-1', 'prod-2', 'prod-3'])
    } finally {
      collectionDocs[0].productIds = before
    }
  })

  it('issues NOTHING when the account cannot be authorized', async () => {
    /*
     * The route answers 401 without a bearer token. Assembled as
     * `...(idToken ? { Authorization } : {})`, a merchant whose token could
     * not be minted sent this catalog write anonymously and was told the
     * save failed rather than that they are signed out.
     */
    mockTokenBehavior = 'signed-out'
    render(<CatalogOrganizationCard hostId="host-1" />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' }).at(-1)!)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(String(enqueueSnackbar.mock.calls[0][0])).toMatch(/signed out/i)
  })

  it('POSTS the collection update once the server has confirmed the seed', async () => {
    render(<CatalogOrganizationCard hostId="host-1" />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' }).at(-1)!)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const init = fetchMock.mock.calls[0][1] as any
    // Authorized, and unconditionally so: a header assembled only when a
    // token happened to exist would have sent this write anonymously.
    expect(init.headers.Authorization).toBe('Bearer token-owner')
    const body = JSON.parse(init.body)
    expect(body.action).toBe('update')
    // The whole membership rides in the payload.
    expect(body.data.productIds).toEqual(['prod-1', 'prod-2'])
    // …and then the products are re-stamped for the collection it saved
    // (AGL-3321), which a smart collection's storefront query reads.
    expect(String(fetchMock.mock.calls[1][0])).toBe('/api/commerce/collection-membership')
    expect(JSON.parse((fetchMock.mock.calls[1][1] as any).body)).toMatchObject({
      hostId: 'host-1',
      collectionId: body.id,
    })
  })
})
