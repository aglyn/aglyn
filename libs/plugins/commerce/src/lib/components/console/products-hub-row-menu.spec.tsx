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
 * The Catalog table's rows (2026-11-25).
 *
 * A row showed its actions as a line of inline buttons wider than the column,
 * so the table clipped them: a row offered whichever buttons happened to fit,
 * which read as Duplicate working on some products and not others, and the
 * row itself opened nothing. Now a row opens its product's editor, a
 * modified or middle click opens the editor in a new tab, and every action
 * sits in ONE ⋮ menu that is the same on every row.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { productSearchFields } from '../../model/commerce'

import type { ReactNode } from 'react'

const ORG_PLAN = {
  org: { $id: 'org-1', plan: 'pro', entitlements: { productsPerHost: 2500 } },
  ready: true,
}

const product = (
  id: string,
  name: string,
  extra: Record<string, unknown>,
  variants: Array<Record<string, unknown>>,
): Record<string, any> => ({
  $id: id,
  ...productSearchFields({ name, variants: variants as any }),
  deletedAt: null,
  slug: name.toLowerCase().replace(/\W+/g, '-'),
  type: 'physical',
  status: 'active',
  variants,
  ...extra,
})

/** A shirt in twelve sizes and colours, the kind the old row clipped Duplicate off. */
const SHIRT = product(
  'prod-shirt',
  'Racing shirt',
  {
    options: [
      { name: 'Size', values: ['S', 'M', 'L', 'XL'] },
      { name: 'Color', values: ['Black', 'White', 'Camo'] },
    ],
    modifierGroups: [{ id: 'name', label: 'Name on back', type: 'text' }],
    mediaUrls: ['https://cdn.example/shirt.jpg'],
    seo: { title: 'Racing shirt', description: 'Moto shirt' },
    categoryIds: ['cat-tops'],
    collectionIds: ['smart-1'],
  },
  ['S', 'M', 'L', 'XL'].flatMap((size) =>
    ['Black', 'White', 'Camo'].map((color) => ({
      id: `${size}-${color}`,
      options: { Size: size, Color: color },
      priceUsd: 30,
      inventory: null,
    })),
  ),
)
const DRAFT = product('prod-draft', 'Gear set', { status: 'draft' }, [
  { id: 'default', priceUsd: 250, inventory: 0 },
])
const KEYS = product('prod-keys', 'Track map', { status: 'archived', type: 'digital' }, [
  { id: 'default', priceUsd: 5 },
])
const productDocs = [SHIRT, DRAFT, KEYS]

const FIRESTORE = {}
const mockCreateResource = jest.fn().mockResolvedValue({ id: 'prod-copy' })
const mockGetDocs = jest.fn()
const mockUpdateDoc = jest.fn().mockResolvedValue(undefined)

jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () => {
  const { useListQueryDouble } = jest.requireActual(
    '@aglyn/tenant-feature-instance/testing/list-query-double',
  )
  return {
    ...jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query'),
    useListQuery: (options: unknown) => useListQueryDouble(() => productDocs, options),
  }
})

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useConsoleHostRoute: () => ({ base: null, orgSlug: null, subdomain: null }),
  listFilterConstraints: jest.requireActual('@aglyn/tenant-feature-instance')
    .listFilterConstraints,
  useFirestore: () => FIRESTORE,
  collectionCeiling: (ref: unknown) => ref,
  ceilingedWindow: (read: unknown[] | undefined, ceiling: number) => ({
    rows: (read ?? []).slice(0, ceiling),
    truncated: (read ?? []).length > ceiling,
  }),
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
  useOrgPlan: () => ORG_PLAN,
  useHostResourceApi: () => mockCreateResource,
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  useFirestoreDoc: () => ({ data: undefined, status: 'success' }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

// The copy's smart collections are their own spec's; here they are what the
// source's were.
jest.mock('./smart-collections', () => ({
  productCollectionFields: async () => ({ collectionIds: ['smart-1'] }),
}))
jest.mock('./product-slugs', () => ({
  productSlugLedger: () => ({ claim: async (base: string) => base }),
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  query: (name: string, ...constraints: unknown[]) => ({ name, constraints }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  limit: (value: number) => value,
  orderBy: () => ({}),
  documentId: () => '__name__',
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  getDoc: jest.fn(async () => ({
    exists: () => true,
    get: (field: string) => ({ subdomain: 'crew-demo', cname: null })[field],
  })),
  getDocFromServer: jest.fn(async () => ({ exists: () => false })),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  arrayUnion: (...values: unknown[]) => ({ arrayUnion: values }),
  addDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
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

import ProductsHubCard from './products-hub-card.component'

jest.setTimeout(30_000)

beforeEach(() => {
  jest.clearAllMocks()
  mockGetDocs.mockResolvedValue({
    docs: [{ id: 'manual-1', ref: 'hosts/host-1/collections/manual-1' }],
  })
})

const mount = async () => {
  render(<ProductsHubCard hostId="host-1" />)
  await screen.findByText('Racing shirt')
}

const menuOf = (name: string) =>
  screen.getByRole('button', { name: `More actions for ${name}` })

const openMenu = async (name: string) => {
  fireEvent.click(menuOf(name))
  return screen.findByRole('menu')
}

const labelsIn = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent)

describe('the Catalog table rows', () => {
  it('gives every row one ⋮ menu and no inline action buttons', async () => {
    await mount()
    for (const { name } of productDocs) expect(menuOf(name)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('offers Duplicate on a many-variant product, beside every other action that applies', async () => {
    await mount()
    const labels = labelsIn(await openMenu('Racing shirt'))
    expect(labels).toEqual([
      'Edit',
      expect.stringContaining('Duplicate'),
      'View on site',
      'Print labels',
      expect.stringContaining('Set to draft'),
      'Archive',
      'Delete',
    ])
  })

  it('names the status moves that apply to a draft and an archived product', async () => {
    await mount()
    let labels = labelsIn(await openMenu('Gear set'))
    expect(labels).toEqual(
      expect.arrayContaining(['Adjust stock', 'Set active', 'Archive', 'Delete']),
    )
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    labels = labelsIn(await openMenu('Track map'))
    expect(labels).toEqual(
      expect.arrayContaining(['License keys', 'Set active', 'Unarchive as draft', 'Delete']),
    )
    expect(labels).not.toContain('Print labels')
  })

  it('links an active product to its page on the site, and says why a draft has none', async () => {
    await mount()
    const shirtMenu = await openMenu('Racing shirt')
    await waitFor(() =>
      expect(
        within(shirtMenu).getByRole('menuitem', { name: /View on site/ }).getAttribute('href'),
      ).toContain('/products/racing-shirt'),
    )
    fireEvent.keyDown(shirtMenu, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    const draftMenu = await openMenu('Gear set')
    const view = within(draftMenu).getByRole('menuitem', { name: /View on site/ })
    expect(view.getAttribute('aria-disabled')).toBe('true')
    expect(view.getAttribute('href')).toBeNull()
  })

  it('duplicates a many-variant product whole, as a draft, into the source’s manual collections', async () => {
    await mount()
    fireEvent.click(within(await openMenu('Racing shirt')).getByRole('menuitem', { name: /Duplicate/ }))
    await waitFor(() => expect(mockCreateResource).toHaveBeenCalledTimes(1))
    const { data, resource } = mockCreateResource.mock.calls[0][0]
    expect(resource).toBe('product')
    expect(data).toMatchObject({
      name: 'Racing shirt (copy)',
      slug: 'racing-shirt-copy',
      status: 'draft',
      options: SHIRT.options,
      variants: SHIRT.variants,
      modifierGroups: SHIRT.modifierGroups,
      mediaUrls: SHIRT.mediaUrls,
      seo: SHIRT.seo,
      categoryIds: SHIRT.categoryIds,
      collectionIds: ['smart-1'],
    })
    expect(data.$id).toBeUndefined()
    // The manual collections that hold the source by id gain the copy.
    await waitFor(() =>
      expect(mockUpdateDoc).toHaveBeenCalledWith('hosts/host-1/collections/manual-1', {
        productIds: { arrayUnion: ['prod-copy'] },
      }),
    )
    const [{ constraints }] = mockGetDocs.mock.calls[0]
    expect(constraints).toEqual([
      { field: 'productIds', op: 'array-contains', value: 'prod-shirt' },
    ])
  })

  it('opens the product’s editor from a click anywhere on its row, and not from its menu', async () => {
    await mount()
    fireEvent.click(menuOf('Gear set'))
    expect(screen.queryByText('Edit product')).toBeNull()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    fireEvent.click(screen.getByText('Gear set'))
    expect(await screen.findByText('Edit product')).toBeTruthy()
  })

  it('opens the editor in a new tab on a cmd-click or a middle-click', async () => {
    const open = jest.spyOn(window, 'open').mockImplementation(() => null)
    await mount()
    fireEvent.click(screen.getByText('Gear set'), { metaKey: true })
    expect(open).toHaveBeenLastCalledWith(
      expect.stringMatching(/\?product=prod-draft$/),
      '_blank',
      'noopener',
    )
    fireEvent(
      screen.getByText('Track map'),
      new MouseEvent('auxclick', { bubbles: true, button: 1 }),
    )
    expect(open).toHaveBeenLastCalledWith(
      expect.stringMatching(/\?product=prod-keys$/),
      '_blank',
      'noopener',
    )
    expect(screen.queryByText('Edit product')).toBeNull()
    open.mockRestore()
  })
})
