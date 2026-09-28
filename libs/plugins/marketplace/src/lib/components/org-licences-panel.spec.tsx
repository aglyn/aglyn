/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
 *
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
 * The Licenses tab's presentation (AGL-2486), and its two lists on their
 * queries (AGL-3321).
 *
 * The panel shipped as two bare headings with a sentence under each, on a
 * page where every sibling tab is built from cards — so the tab read as
 * unfinished rather than empty. Cards are the easy half; the half worth a
 * test is that the sentences under them are GATED. "You have not bought
 * anything" is a claim about someone's purchase history, and a refused or
 * unfinished read supports no such claim (AGL-1066) — which matters more
 * here than on most lists, because the conclusion this tab invites is
 * "buy it again".
 *
 * Each list is a LIST QUERY now: the contract's double runs the real plan
 * and answers it over the purchases fixture as Firestore would, so the owner
 * clause, the refund exclusion and the listing-name search are all asserted
 * by what comes back — not by a filter the panel runs over what it loaded.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { nameSearchTokens } from '@aglyn/aglyn/app-utils/name-search'
import OrgLicencesPanel from './org-licences-panel.component'

interface Status {
  status: string
  serverDenied: boolean
}
const LOADED: Status = { status: 'success', serverDenied: false }

let mockPurchases: Array<Record<string, unknown>> = []
/** Keyed by the owner clause each table's query carries. */
let mockStatus: Record<'buyerOrgId' | 'buyerUid', Status> = {
  buyerOrgId: LOADED,
  buyerUid: LOADED,
}
const mockListings: Record<string, string> = {}

/*
 * The grids' props, by label, so a search is typed the way the grid reports
 * one — through `onFilterModelChange` — without waiting on its debounced box.
 */
const mockGrids: Record<string, any> = {}
jest.mock('@aglyn/shared-ui-jsx/components/list-table.component', () => {
  const actual = jest.requireActual('@aglyn/shared-ui-jsx/components/list-table.component')
  return {
    ...actual,
    ListTable: (props: any) => {
      mockGrids[props['aria-label']] = props
      return <actual.ListTable {...props} />
    },
  }
})
const search = (grid: string, words: string[]) =>
  act(async () => {
    mockGrids[grid].onFilterModelChange({ items: [], quickFilterValues: words })
  })

jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () => {
  const { useListQueryDouble } = jest.requireActual(
    '@aglyn/tenant-feature-instance/testing/list-query-double',
  )
  return {
    ...jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query'),
    useListQuery: (options: any) => {
      const result = useListQueryDouble(
        () => (options.collection ? mockPurchases : []),
        options,
      )
      const owner = result.plan.filters.some((filter: any) => filter.path === 'buyerOrgId' && filter.op === '==' && filter.value === 'org1')
        ? 'buyerOrgId'
        : 'buyerUid'
      const status = options.collection ? mockStatus[owner] : { status: 'loading', serverDenied: false }
      return { ...result, ...status }
    },
  }
})

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/'), constraints: [] }),
  query: (base: any, ...constraints: unknown[]) => ({
    path: base?.path,
    constraints: [...(base?.constraints ?? []), ...constraints],
  }),
  where: (field: unknown, op: string, value: unknown) => ({ where: field, op, value }),
  orderBy: (field: unknown, direction?: string) => ({ orderBy: field, direction }),
  limit: (value: number) => ({ limit: value }),
  documentId: () => '__name__',
  Timestamp: { fromDate: (date: Date) => date },
  getDocs: async (built: any) => {
    const ids: string[] = built.constraints.find((item: any) => item.op === 'in')?.value ?? []
    return {
      docs: ids
        .filter((id) => mockListings[id])
        .map((id) => ({ id, get: () => mockListings[id] })),
    }
  },
}))

/** One instance, as the real provider hands out. */
const mockFirestore = {}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  useUser: () => ({ data: { uid: 'u1' } }),
  // The listing-name lookup: the listings whose name holds the searched token.
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    if (!built) return { data: [], status: 'success', serverDenied: false }
    const token = built.constraints.find((item: any) => item.op === 'array-contains')?.value
    return {
      data: Object.entries(mockListings)
        .filter(([, name]) => nameSearchTokens(name).includes(token))
        .map(([$id]) => ({ $id })),
      status: 'success',
      serverDenied: false,
    }
  },
}))

const renderPanel = (
  purchases: Array<Record<string, unknown>>,
  status: Partial<Record<'buyerOrgId' | 'buyerUid', Status>> = {},
) => {
  mockPurchases = purchases
  mockStatus = { buyerOrgId: LOADED, buyerUid: LOADED, ...status }
  return render(<OrgLicencesPanel orgId="org1" basePath="/acme/marketplace" />)
}

/** A purchase as the billing webhook's first record writes it. */
const purchase = (fields: Record<string, unknown>) => ({
  refundedAt: null,
  taxCents: 0,
  ...fields,
})

const ORG_ZERO_STATE = /this workspace holds no licenses/i
const MINE_ZERO_STATE = /you have not bought anything yet/i

beforeEach(() => {
  for (const key of Object.keys(mockListings)) delete mockListings[key]
})

describe('OrgLicencesPanel presents its empty tab like the rest of the console', () => {
  it('renders both zero-states on cards once both reads have SETTLED', () => {
    const { container } = renderPanel([])

    expect(screen.getByText(ORG_ZERO_STATE)).toBeTruthy()
    expect(screen.getByText(MINE_ZERO_STATE)).toBeTruthy()
    expect(container.querySelectorAll('.MuiCard-root')).toHaveLength(2)
  })

  it('makes NEITHER claim while a read is still in flight', () => {
    const loading = { status: 'loading', serverDenied: false }
    renderPanel([], { buyerOrgId: loading, buyerUid: loading })

    expect(screen.queryByText(ORG_ZERO_STATE)).toBeNull()
    expect(screen.queryByText(MINE_ZERO_STATE)).toBeNull()
  })

  it('makes NEITHER claim when the listen was refused', () => {
    // A session denying every server read leaves the cache painting an empty
    // list, and `status` for such a listen still reads `success`.
    const denied = { status: 'success', serverDenied: true }
    renderPanel([], { buyerOrgId: denied, buyerUid: denied })

    expect(screen.queryByText(ORG_ZERO_STATE)).toBeNull()
    expect(screen.queryByText(MINE_ZERO_STATE)).toBeNull()
    expect(screen.getAllByText(/could not be loaded/i).length).toBe(2)
  })

  it('gates the two lists SEPARATELY — they are two different reads', () => {
    renderPanel([], { buyerUid: { status: 'loading', serverDenied: false } })

    expect(screen.getByText(ORG_ZERO_STATE)).toBeTruthy()
    expect(screen.queryByText(MINE_ZERO_STATE)).toBeNull()
  })

  it('puts real rows on a card with its heading', () => {
    // A colleague's purchase for this workspace: in "This workspace", and not
    // among the reader's own receipts.
    renderPanel([
      purchase({ $id: 'p1', listingId: 'l1', buyerUid: 'u2', buyerOrgId: 'org1', amountCents: 2500 }),
    ])

    expect(screen.getByText('This workspace')).toBeTruthy()
    expect(screen.getByText('$25.00')).toBeTruthy()
    expect(screen.getByText(MINE_ZERO_STATE)).toBeTruthy()
  })

  it('never lists a refunded purchase as a licence — the query excludes it', () => {
    // AGL-1546. `refundedAt == null` is on the query, so a refunded-only
    // workspace reaches "holds no licenses".
    renderPanel([
      purchase({
        $id: 'p1',
        listingId: 'l1',
        buyerUid: 'u2',
        buyerOrgId: 'org1',
        amountCents: 2500,
        refundedAt: { seconds: 1 },
      }),
    ])

    expect(screen.queryByText('$25.00')).toBeNull()
    expect(screen.getByText(ORG_ZERO_STATE)).toBeTruthy()
  })

  it('lists both in the shared grid, which scrolls its own columns inside the card (AGL-3045)', () => {
    const { container } = renderPanel([
      purchase({ $id: 'p1', listingId: 'l1', buyerUid: 'u1', buyerOrgId: 'org1', amountCents: 2500, taxCents: 500 }),
      purchase({ $id: 'p2', listingId: 'l2', buyerUid: 'u1', buyerOrgId: null, amountCents: 900 }),
    ])

    expect(container.querySelectorAll('table')).toHaveLength(0)
    const held = screen.getByRole('grid', { name: 'Licenses this workspace holds' })
    const mine = screen.getByRole('grid', { name: 'Licenses you bought' })
    // What was paid, before tax, and who paid it.
    expect(within(held).getByText('$20.00')).toBeTruthy()
    expect(within(held).getByText('You')).toBeTruthy()
    // Which workspace each purchase licensed, and the one that names none.
    expect(within(mine).getByText('This workspace')).toBeTruthy()
    expect(within(mine).getByText('Every workspace you belong to')).toBeTruthy()
  })
})

describe('each list searches by LISTING NAME on its query (AGL-3321)', () => {
  it('finds a license whose listing is past the first page', async () => {
    // Thirty licenses in this workspace, ten to a page; the one whose listing
    // is named "Zebra Stripes" sorts last. A search over the loaded page
    // would answer "no match".
    const purchases = Array.from({ length: 30 }, (_, index) => {
      const id = `p${String(index).padStart(2, '0')}`
      const listingId = `l${String(index).padStart(2, '0')}`
      mockListings[listingId] = index === 29 ? 'Zebra Stripes' : `Widget ${index}`
      return purchase({ $id: id, listingId, buyerUid: 'u2', buyerOrgId: 'org1', amountCents: 100 * (index + 1) })
    })
    renderPanel(purchases)
    const held = screen.getByRole('grid', { name: 'Licenses this workspace holds' })
    await waitFor(() => expect(held.textContent).toContain('Widget 0'))
    expect(held.textContent).not.toContain('Zebra Stripes')

    await search('Licenses this workspace holds', ['zeb'])
    await waitFor(() => expect(held.textContent).toContain('Zebra Stripes'))
    expect(held.textContent).not.toContain('Widget 0')
  })

  it('refuses a word that names more listings than one query can hold', async () => {
    const purchases = Array.from({ length: 31 }, (_, index) => {
      const listingId = `l${index}`
      mockListings[listingId] = `Widget ${index}`
      return purchase({ $id: `p${index}`, listingId, buyerUid: 'u2', buyerOrgId: 'org1', amountCents: 100 })
    })
    renderPanel(purchases)
    await search('Licenses this workspace holds', ['widget'])
    await waitFor(() =>
      expect(screen.getByText(/Search is not applied: more than 30 listings/)).toBeTruthy(),
    )
  })
})
