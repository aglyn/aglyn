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
 * Picking items at the register (AGL-3607): quick keys, photo tiles with the
 * basket count, the item sheet for variants and modifiers, merging identical
 * lines, and reopening a line to change it — what a cashier does one-handed
 * on a tablet before every Charge.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type Row = Record<string, unknown> & { $id: string }
interface Asked {
  path: string
  constraints: Array<Record<string, unknown>>
}

const mockCatalog: Row[] = [
  {
    $id: 'latte',
    name: 'Latte',
    nameLower: 'latte',
    nameTokens: ['latte'],
    status: 'active',
    deletedAt: null,
    posQuickKey: true,
    options: [{ name: 'Size', values: ['Small', 'Large'] }],
    variants: [
      { id: 'small', options: { Size: 'Small' }, priceUsd: 4, inventory: null },
      { id: 'large', options: { Size: 'Large' }, priceUsd: 5, inventory: null },
    ],
    modifierGroups: [
      {
        id: 'milk',
        name: 'Milk',
        min: 1,
        max: 1,
        options: [
          { id: 'whole', name: 'Whole milk', priceCents: 0 },
          { id: 'oat', name: 'Oat milk', priceCents: 75 },
        ],
      },
    ],
  },
  {
    $id: 'cookie',
    name: 'Cookie',
    nameLower: 'cookie',
    nameTokens: ['cookie'],
    status: 'active',
    deletedAt: null,
    variants: [{ id: 'default', priceUsd: 2.5, inventory: 2 }],
  },
]

const mockAsked: Asked[] = []
function mockAnswer(asked: Asked): Row[] {
  const { rowAnswers } = jest.requireActual(
    '@aglyn/tenant-feature-instance/testing/list-query-double',
  )
  if (!asked.path.endsWith('/products')) return []
  mockAsked.push(asked)
  return mockCatalog.filter((row) =>
    asked.constraints.every((entry) => entry.kind !== 'where' || rowAnswers(row, entry)),
  )
}

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/'), constraints: [] }),
  query: (base: Asked, ...constraints: Array<Record<string, unknown>>) => ({
    path: base.path,
    constraints: [...base.constraints, ...constraints],
  }),
  where: (path: string, op: string, value: unknown) => ({ kind: 'where', path, op, value }),
  orderBy: (path: string, direction = 'asc') => ({ kind: 'orderBy', path, direction }),
  limit: (value: number) => ({ kind: 'limit', value }),
  documentId: () => '__name__',
  Timestamp: { fromDate: (date: Date) => date },
  getDocs: async (asked: Asked) => ({
    docs: mockAnswer(asked).map((row) => ({ id: row.$id, data: () => row })),
  }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
  useOrgPlan: () => ({ org: { plan: 'business' }, ready: true }),
  useFirestoreCollection: (build: () => Asked) => ({ data: mockAnswer(build()) }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-next/contexts/next-page-title-provider', () => ({
  NextPageTitle: () => null,
}))
jest.mock('@aglyn/aglyn', () => ({
  checkHostRegisterQuota: () => ({ limit: 5 }),
  checkQuota: () => ({ limit: 5 }),
}))
// Wide, so the basket sits beside the grid where the spec can read it.
jest.mock('@mui/material', () => ({
  ...jest.requireActual('@mui/material'),
  useMediaQuery: () => true,
}))

import { PosConsolePage, posProductPlan } from './pos-page.component'

function tile(name: RegExp) {
  return screen.getByRole('button', { name })
}

beforeEach(() => {
  mockAsked.length = 0
  window.localStorage.clear()
})

describe('picking items at the register (AGL-3607)', () => {
  it('adds a plain product at a tap, counts it on its tile, and merges a second tap', () => {
    render(<PosConsolePage hostId="host-1" {...({} as any)} />)
    expect(screen.getByText('2 left')).toBeTruthy()
    fireEvent.click(tile(/^Cookie, \$2\.50$/))
    fireEvent.click(tile(/^Cookie, \$2\.50$/))
    expect(screen.getByLabelText('2 in the basket')).toBeTruthy()
    expect(screen.getByText('2× Cookie')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Charge \$5\.00/ })).toBeTruthy()
  })

  it('asks for the size and the required milk, priced as it changes, before adding', () => {
    render(<PosConsolePage hostId="host-1" {...({} as any)} />)
    fireEvent.click(tile(/^Latte, From \$4\.00, choose options$/))
    const sheet = screen.getByRole('dialog')
    const add = () => within(sheet).getByRole('button', { name: /Choose milk|Add/ })
    expect(add().textContent).toBe('Choose milk')
    expect((add() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Large' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Oat milk +$0.75' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'One more' }))
    expect(add().textContent).toBe('Add · $11.50')
    fireEvent.click(add())
    expect(screen.getByText('2× Latte')).toBeTruthy()
    expect(screen.getByText('Large / Oat milk')).toBeTruthy()
  })

  it('keeps a different milk on its own line, and reopens a line to change it', () => {
    render(<PosConsolePage hostId="host-1" {...({} as any)} />)
    for (const milk of ['Oat milk +$0.75', 'Whole milk']) {
      fireEvent.click(tile(/^Latte/))
      const sheet = screen.getByRole('dialog')
      fireEvent.click(within(sheet).getByRole('button', { name: milk }))
      fireEvent.click(within(sheet).getByRole('button', { name: /^Add/ }))
    }
    expect(screen.getAllByText('1× Latte')).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'Change Latte' })[1])
    const sheet = screen.getByRole('dialog')
    fireEvent.change(within(sheet).getByLabelText('Quantity'), { target: { value: '3' } })
    fireEvent.click(within(sheet).getByRole('button', { name: /^Update/ }))
    expect(screen.getByText('3× Latte')).toBeTruthy()
    expect(screen.getByText('Small / Whole milk')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Change Latte' })[0])
    act(() => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))
    })
    expect(screen.getAllByText(/× Latte/)).toHaveLength(1)
  })

  it('opens on the quick keys chip it was left on, asking only for quick keys', () => {
    render(<PosConsolePage hostId="host-1" {...({} as any)} />)
    fireEvent.click(screen.getByRole('button', { name: '★ Quick keys' }))
    expect(screen.queryByRole('button', { name: /^Cookie/ })).toBeNull()
    expect(tile(/^Latte/)).toBeTruthy()
    expect(window.localStorage.getItem('aglyn.pos.category')).toBe('__quick')
    expect(
      posProductPlan({ quickKeys: true }).filters.some(
        (filter) => filter.path === 'posQuickKey' && filter.value === true,
      ),
    ).toBe(true)
    // A typed word searches past the quick keys.
    expect(
      posProductPlan({ quickKeys: true, search: 'cook' }).filters.some(
        (filter) => filter.path === 'posQuickKey',
      ),
    ).toBe(false)
  })
})

describe('the quick keys query has its index', () => {
  it('declares deletedAt ==, status ==, posQuickKey ==, nameLower ASC on products', () => {
    const indexes = JSON.parse(
      readFileSync(join(__dirname, '../../../../../../../cloud/firebase-firestore.indexes.json'), 'utf8'),
    ).indexes as Array<{ collectionGroup: string; fields: Array<{ fieldPath: string }> }>
    const plan = posProductPlan({ quickKeys: true })
    const wanted = [...plan.filters.map((filter) => filter.path), plan.orderBy.path]
    expect(
      indexes.some(
        (index) =>
          index.collectionGroup === 'products' &&
          index.fields.length === wanted.length &&
          wanted.every((path) => index.fields.some((field) => field.fieldPath === path)),
      ),
    ).toBe(true)
  })
})
