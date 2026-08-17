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
 * A DIGITAL or SERVICE subscription-only product must not invite a stock
 * number the system never keeps true (AGL-1744, narrowed by AGL-1750).
 *
 * `canPurchase` gates every checkout on stock, subscription sessions
 * included, and nothing decrements for a digital or service subscription —
 * not the initial charge and not any renewal — so one unit of stock sells
 * unlimited subscriptions there. A PHYSICAL subscription is different since
 * AGL-1750: every paid cycle mints an order and decrements the variant, so
 * its stock field stays live and its number is kept true.
 *
 * The fix is in the console, and the load-bearing part of it is what does
 * NOT happen: a merchant who already set stock must not silently lose it.
 * So these specs assert the STORED PAYLOAD field by field rather than just
 * the disabled attribute — a fix that hid the input while dropping the value
 * on save would pass a UI-only assertion and destroy merchant configuration.
 *
 * The halves that must keep working are asserted alongside:
 * `subscriptionOptional` ("Both") products still track stock, because their
 * one-time path genuinely decrements; a PHYSICAL subscription-only product
 * tracks (AGL-1750); and a save of a withdrawn product carries the untouched
 * stock through.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import ProductEditorDialog from './product-editor-dialog.component'

/**
 * A DIGITAL subscription-only feed whose merchant set stock of 7 — the shape
 * that still has no decrementing path anywhere (AGL-1750 left it withdrawn).
 */
const SUBSCRIPTION_ONLY = {
  $id: 'prod-sub',
  name: 'Coffee club feed',
  slug: 'coffee-club-feed',
  status: 'active',
  type: 'digital',
  subscription: { interval: 'month' },
  lowStockThreshold: 2,
  variants: [{ id: 'v1', priceUsd: 25, inventory: 7 }],
}

/** The same product offered one-time OR recurring (AGL-545 "Both"). */
const BOTH = {
  ...SUBSCRIPTION_ONLY,
  $id: 'prod-both',
  subscriptionOptional: true,
}

/**
 * A PHYSICAL monthly box: since AGL-1750 each paid cycle mints an order and
 * decrements the variant, so tracking applies again.
 */
const PHYSICAL_SUBSCRIPTION = {
  $id: 'prod-box',
  name: 'Coffee box',
  slug: 'coffee-box',
  status: 'active',
  type: 'physical',
  subscription: { interval: 'month' },
  lowStockThreshold: 2,
  variants: [{ id: 'v1', priceUsd: 25, inventory: 7 }],
}

/** A plain one-time product — the untouched control. */
const ONE_TIME = {
  $id: 'prod-once',
  name: 'Desk lamp',
  slug: 'desk-lamp',
  status: 'active',
  type: 'physical',
  variants: [{ id: 'v1', priceUsd: 40, inventory: 12 }],
}

const collections: Record<string, Array<Record<string, unknown>>> = {
  productCategories: [],
  products: [SUBSCRIPTION_ONLY, BOTH, PHYSICAL_SUBSCRIPTION, ONE_TIME],
  suppliers: [],
  locations: [],
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useFirestoreDoc: () => ({ data: undefined }),
  useHostResourceApi: () => jest.fn().mockResolvedValue({ id: 'prod-new' }),
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  // The REAL guard (AGL-1358): every seed here is server-confirmed, so it
  // lets the saves through rather than standing in for the thing under test.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, _a: string, _b: string, name: string) => name,
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  setDoc: jest.fn().mockResolvedValue(undefined),
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

beforeEach(() => jest.clearAllMocks())

function open(product: Record<string, unknown>) {
  render(
    <ProductEditorDialog
      hostId="host-1"
      product={product as never}
      seedFromCache={false}
      open
      onClose={jest.fn()}
    />,
  )
}

/** The single stock input for the default variant. */
const stockField = () =>
  screen.getByLabelText('Stock — Default') as HTMLInputElement

/** jest-dom is not on this project's preset, so assertions read the DOM. */
const lowStockField = () =>
  screen.getByLabelText('Low-stock alert at') as HTMLInputElement

/** The document as it was written by the editor's full-replace save. */
async function saveAndRead(): Promise<Record<string, any>> {
  fireEvent.click(screen.getByRole('button', { name: 'Save product' }))
  await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
  const call = (setDoc as jest.Mock).mock.calls[0]
  // Still a full replace; this issue changes what the payload says, not how
  // it is written.
  expect(call[2]).toEqual({ merge: false })
  return call[1]
}

describe('subscription-only products (AGL-1744)', () => {
  it('DISABLES the stock input and says why', () => {
    open(SUBSCRIPTION_ONLY)

    expect(stockField().disabled).toBe(true)
    expect(
      screen.getByText(/not tracked on a digital or service subscription/i),
    ).not.toBeNull()
    expect(lowStockField().disabled).toBe(true)
  })

  it('SURFACES the stranded number instead of hiding or deleting it', () => {
    open(SUBSCRIPTION_ONLY)

    // The merchant's own number, still legible in the disabled field.
    expect(stockField().value).toBe('7')
    const notice = screen.getByRole('alert').textContent ?? ''
    expect(notice).toContain('still has stock set (7)')
    // The two things they would otherwise have to discover by losing a sale.
    expect(notice).toMatch(/does not cap subscribers/i)
    expect(notice).toMatch(/stored 0 still blocks new subscribers/i)
  })

  /**
   * The whole point. `merge: false` means the payload IS the document, so a
   * fix that dropped the field would erase the merchant's stock on the next
   * unrelated save (a name edit, a status flip) with no warning.
   */
  it('CARRIES the stock through an ordinary save, field by field', async () => {
    open(SUBSCRIPTION_ONLY)

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Coffee box (renamed)' },
    })
    const stored = await saveAndRead()

    expect(stored.name).toBe('Coffee box (renamed)')
    expect(stored.variants).toHaveLength(1)
    expect(stored.variants[0].inventory).toBe(7)
    expect(stored.lowStockThreshold).toBe(2)
    // The denormalization the legacy Product block and checkout read.
    expect(stored.inventory).toBe(7)
    expect(stored.subscription).toEqual({ interval: 'month' })
  })

  /**
   * The one destructive move, and the merchant makes it deliberately. It
   * exists because the checkout gate is UNCHANGED: a stored 0 still 409s
   * every new subscriber, and a disabled field with no escape would be a
   * trap.
   */
  it('clears the number only when the merchant asks', async () => {
    open(SUBSCRIPTION_ONLY)

    fireEvent.click(screen.getByRole('button', { name: 'Clear stock' }))

    expect(stockField().value).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()
    const stored = await saveAndRead()
    expect(stored.variants[0].inventory).toBeNull()
    expect(stored.variants[0]).not.toHaveProperty('inventoryByLocation')
    expect(stored.inventory).toBeNull()
  })

  it('shows no notice when no stock was ever set', () => {
    open({
      ...SUBSCRIPTION_ONLY,
      lowStockThreshold: undefined,
      variants: [{ id: 'v1', priceUsd: 25 }],
    })

    expect(stockField().disabled).toBe(true)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('products whose stock still means something (AGL-1744)', () => {
  /**
   * "Both" sells one-time as well: the cart only ever builds
   * `mode: 'payment'` sessions and buy-now with `billing: 'once'` records a
   * plain order, and BOTH decrement. Disabling stock here would delete a
   * control that works and re-open the AGL-1711 oversell on that half.
   */
  it('leaves a subscriptionOptional ("Both") product fully editable', () => {
    open(BOTH)

    expect(stockField().disabled).toBe(false)
    expect(lowStockField().disabled).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(
      screen.getByText(/Blank stock = untracked; 0 shows sold out/),
    ).not.toBeNull()
  })

  /**
   * AGL-1750: each paid cycle of a physical subscription mints an order and
   * decrements the variant — the number moves as the boxes ship, so the
   * editor offers it again. `BOTH` above is digital, so it is genuinely the
   * "Both" half granting that one and the TYPE granting this one.
   */
  it('leaves a PHYSICAL subscription-only product fully editable (AGL-1750)', () => {
    open(PHYSICAL_SUBSCRIPTION)

    expect(stockField().disabled).toBe(false)
    expect(lowStockField().disabled).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(
      screen.getByText(/Blank stock = untracked; 0 shows sold out/),
    ).not.toBeNull()
  })

  it('leaves a one-time product editable and still writes edits', async () => {
    open(ONE_TIME)

    expect(stockField().disabled).toBe(false)
    fireEvent.change(stockField(), { target: { value: '5' } })
    const stored = await saveAndRead()

    expect(stored.variants[0].inventory).toBe(5)
    expect(stored.inventory).toBe(5)
  })
})
