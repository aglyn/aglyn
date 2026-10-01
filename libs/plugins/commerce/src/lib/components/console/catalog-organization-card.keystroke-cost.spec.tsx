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

import { within } from '@testing-library/dom'
import {
  type FiberRenderCounter,
  installFiberRenderCounter,
} from '@aglyn/shared-ui-jsx/testing/fiber-render-counter'

/**
 * What one keystroke costs in the categories & collections card (AGL-3423).
 *
 * Both editors keep their draft in the card, and one letter typed in either
 * used to redraw the card: both lists with a match count per collection,
 * both pagers, and every field of the dialog — some 500 to 700 components
 * per letter, and every field of a smart collection's rules. When each
 * keystroke costs that much, typed input queues and is processed back to
 * back, and a chip list redrawn by every one of them leaves React's
 * nested-update count climbing until it throws #185. A keystroke now redraws
 * the field it lands in. Counted off React's own commits, so the budget is
 * what actually rendered, not what a reading of the code expects to.
 *
 * The input budget is two, not one: a field typed into from empty draws once
 * for the keystroke and once more when its `FormControl` notices it is
 * filled.
 */

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => mockUser,
  useFirestore: () => mockFirestore,
  // The same rows on every render, as a live listener hands them on.
  useFirestoreCollection: (build: () => unknown) => ({
    data: mockCollections[String(build())] ?? null,
    status: 'success',
    fromCache: false,
  }),
  writeGuardedBySeed: async () => ({ ok: true }),
  collectionCeiling: (name: string) => name,
  ceilingedWindow: (read: unknown[] | undefined) => ({
    rows: read ?? [],
    truncated: false,
  }),
}))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, _a: string, _b: string, name: string) => name,
  doc: () => ({}),
  setDoc: async () => undefined,
  deleteDoc: async () => undefined,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => mockSnackbar,
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: (props: { children: unknown }) => props.children,
  useConfirmationContext: () => mockConfirmation,
}))

const mockUser = { data: null }
const mockFirestore = {}
const mockSnackbar = { enqueueSnackbar: () => undefined }
const mockConfirmation = { confirm: async () => undefined }
const mockCollections: Record<string, unknown[]> = {
  productCategories: Array.from({ length: 8 }, (_, index) => ({
    $id: `cat-${index}`,
    name: `Category ${index}`,
    slug: `category-${index}`,
    parentId: index > 3 ? 'cat-0' : null,
    order: index,
  })),
  collections: [
    {
      $id: 'col-featured',
      name: 'Featured',
      slug: 'featured',
      kind: 'catalog',
      mode: 'manual',
      productIds: ['prod-1', 'prod-2'],
    },
    {
      $id: 'col-sale',
      name: 'On sale',
      slug: 'on-sale',
      kind: 'catalog',
      mode: 'smart',
      matchAll: true,
      rules: [
        { field: 'priceUsd', op: 'lt', value: 40 },
        { field: 'tag', op: 'eq', value: 'sale' },
      ],
    },
  ],
  products: Array.from({ length: 60 }, (_, index) => ({
    $id: `prod-${index}`,
    name: `Product ${index}`,
    slug: `product-${index}`,
    status: 'active',
    type: 'physical',
    tags: index % 2 ? ['sale'] : [],
    variants: [{ id: 'v1', priceUsd: 10 + index, inventory: 1 }],
  })),
}

describe('one keystroke in the categories & collections card (AGL-3423)', () => {
  let counter: FiberRenderCounter
  let react: typeof import('react')
  let unmount: () => Promise<void>

  beforeEach(async () => {
    counter = installFiberRenderCounter()
    jest.resetModules()
    react = jest.requireActual<typeof import('react')>('react')
    const client = jest.requireActual<typeof import('react-dom/client')>('react-dom/client')
    const Card = jest.requireActual<typeof import('./catalog-organization-card.component')>(
      './catalog-organization-card.component',
    ).default
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = client.createRoot(host)
    await react.act(async () => {
      root.render(react.createElement(Card, { hostId: 'host-1' }))
    })
    unmount = async () => {
      await react.act(async () => root.unmount())
      host.remove()
    }
  })

  afterEach(async () => {
    await unmount()
    counter.uninstall()
    jest.restoreAllMocks()
  })

  const click = (element: HTMLElement) =>
    react.act(async () => {
      element.click()
    })

  /** Types one letter's worth into `field` the way the browser delivers it. */
  const type = async (field: HTMLElement, value: string) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    counter.reset()
    await react.act(async () => {
      setValue?.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect((field as HTMLInputElement).value).toBe(value)
  }

  /** The editor open over the card, by its title. */
  const editor = (title: string) =>
    within(
      [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((node) =>
        node.textContent?.includes(title),
      ) as HTMLElement,
    )

  /** The Edit button on the list row that reads `name`. */
  const edit = (name: string) =>
    [...document.querySelectorAll('p')]
      .find((row) => row.textContent?.startsWith(name))
      ?.parentElement?.querySelector('button') as HTMLElement

  it('redraws only the category Name typed into, and neither list', async () => {
    await click(within(document.body).getByRole('button', { name: 'Add category' }))
    await type(editor('New category').getByRole('textbox', { name: 'Name' }), 'P')
    expect(counter.rendered('InputBase')).toBeLessThanOrEqual(2)
    expect(counter.rendered('ListPagination')).toBe(0)
  })

  it('redraws only the collection Name typed into, and never its products', async () => {
    await click(edit('Featured'))
    const dialog = editor('Edit collection')
    // Premise: the products are chips, so a zero below is a list left alone.
    expect(dialog.getByRole('combobox', { name: 'Products' })).toBeTruthy()
    await type(dialog.getByRole('textbox', { name: 'Name' }), 'Featured picks')
    expect(counter.rendered('Autocomplete')).toBe(0)
    expect(counter.rendered('InputBase')).toBeLessThanOrEqual(2)
    expect(counter.rendered('ListPagination')).toBe(0)
  })

  it('redraws only the rule value typed into, not the other rule', async () => {
    await click(edit('On sale'))
    const dialog = editor('Edit collection')
    await type(dialog.getByDisplayValue('sale'), 'sales')
    expect(counter.rendered('InputBase')).toBeLessThanOrEqual(2)
    expect(counter.rendered('ListPagination')).toBe(0)
  })
})
