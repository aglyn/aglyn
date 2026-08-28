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
 * The variables and functions lists are ORDERED, CEILINGED and PAGED — and
 * deliberately not paged by the query (AGL-2501).
 *
 * Both were `limit(100)` with no `orderBy` and a `localeCompare` in the
 * browser. Firestore answers an unordered limit in DOCUMENT-ID order, so the
 * window was a pseudo-random hundred arranged into a convincing A-to-Z list;
 * `variablesPerHost` runs to 5,000, so a Scale site with three hundred
 * variables could reach a hundred of them and no more, on any click, ever.
 *
 * ## Why the QUERY is not paged
 *
 * `nameTaken` tests the draft against these rows. Case-insensitive uniqueness
 * is what keeps legacy `{{name}}` and `{{fn:name(...)}}` resolution
 * unambiguous (AGL-185), and on a ten-row server page that check would compare
 * a new variable against a tenth of the site and create the duplicate it
 * exists to prevent. The case below proves the check still reaches a name that
 * is NOT on the page in front of the reader — which is the assertion that
 * fails the moment somebody "finishes the job" by paging the query.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'

jest.setTimeout(30_000)

/** The card's own ceiling. */
const CEILING = 100
/** One past it, so the probe has something to find. */
const TOTAL = 101

/**
 * Ids run OPPOSITE to names, so document-id order and alphabetical order are
 * exact opposites — which is what makes the ceiling's bound visible in the
 * rendered rows, and what makes the field-ordering trap below testable.
 *
 * Every third row carries NO `name`. That is not a contrivance:
 * `/api/hosts/resources` stores an allow-list and validates no field for
 * presence, and `IMPORTABLE_FIELDS` copies a name only if the exported
 * document had one — so a site restored from a bundle is partly made of rows
 * shaped like these.
 */
const rowsFor = (prefix: string) =>
  Array.from({ length: TOTAL }, (_, index) => ({
    $id: `${prefix}-${String(index).padStart(3, '0')}`,
    name: `${prefix}_${String(TOTAL - 1 - index).padStart(3, '0')}`,
    type: 'text',
    value: 'x',
  }))

/**
 * A collection with rows a FIELD ordering could not see, used by the trap case
 * below rather than by the rendered ones.
 *
 * Kept separate on purpose: a nameless row sorts to the TOP of a
 * `localeCompare`, so mixing these into the rendered fixture would fill the
 * first pages with blanks and make every row assertion a statement about the
 * empty string.
 */
const mixedWriters = [
  ...rowsFor('alpha').slice(0, 6),
  // `/api/hosts/resources` stores an allow-list and validates no field for
  // presence; `IMPORTABLE_FIELDS` copies a name only if the export had one.
  { $id: 'alpha-900', type: 'text', value: 'x' },
  { $id: 'alpha-901', type: 'text', value: 'x' },
]

const variableDocs = rowsFor('alpha')
const functionDocs = rowsFor('fn')

const byCollection: Record<string, Array<Record<string, any>>> = {
  variables: variableDocs,
  functions: functionDocs,
  workflows: [],
}

/**
 * Firestore's answer: an `orderBy` SORTS and also FILTERS. Only the
 * document-name ordering is exercised here, but the filter is modelled so a
 * later change to a FIELD ordering fails rather than passing quietly.
 */
const firestoreAnswer = (
  all: Array<Record<string, any>>,
  constraints: Array<Record<string, any>>,
) => {
  const order = constraints.find((item) => 'orderBy' in item)
  const cap = constraints.find((item) => 'limit' in item)?.limit
  const field = order ? (order.orderBy === '__name__' ? '$id' : order.orderBy) : null
  const matching = field ? all.filter((doc) => doc[field] !== undefined) : all
  const sorted = [...matching].sort((a, b) =>
    String(a[field ?? '$id']) < String(b[field ?? '$id']) ? -1 : 1,
  )
  return typeof cap === 'number' ? sorted.slice(0, cap) : sorted
}

/** Every cap the cards asked for. */
let mockCapsAsked: number[] = []
/** How many documents the fixture serves — mutable for the ceiling case. */
let served = TOTAL
const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useHostResourceApi: () => jest.fn().mockResolvedValue({ id: 'new' }),
  useHostActivityLogger: () => jest.fn(),
  useUser: () => ({ data: { uid: 'uid-test', getIdToken: jest.fn() } }),
  useOrgPlan: () => ({ org: { $id: 'org-1', plan: 'scale' }, ready: true }),
  useConsoleHostRoute: () => ({ base: null, orgSlug: null, subdomain: null }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    const name = String(built?.path ?? '').split('/').pop() ?? ''
    const cap = (built?.constraints ?? []).find(
      (item: any) => 'limit' in item,
    )?.limit
    if (typeof cap === 'number' && (name === 'variables' || name === 'functions')) {
      mockCapsAsked.push(cap)
    }
    return {
      data: firestoreAnswer(
        (byCollection[name] ?? []).slice(0, served),
        built?.constraints ?? [],
      ),
      status: 'success',
      fromCache: false,
    }
  },
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    constraints: [],
  }),
  query: (base: any, ...constraints: unknown[]) => ({
    path: base?.path ?? base,
    constraints: [...(base?.constraints ?? []), ...constraints],
  }),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: unknown, direction?: string) => ({
    orderBy: field,
    direction,
  }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  // Under every plan band, so the Add buttons open their dialog instead of
  // refusing: the quota gate is a different card's subject, and a count that
  // tripped it would make these cases fail as "no dialog" rather than as
  // anything about paging.
  getCountFromServer: async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    return { data: () => ({ count: 40 }) }
  },
}))

jest.mock('@aglyn/shared-util-timestamp', () => ({
  Timestamp: { now: () => ({ seconds: 0 }) },
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

import { HostVariablesCard } from './host-variables-card.component'
import { HostFunctionsCard } from './host-functions-card.component'

const ORG = { $id: 'org-1', plan: 'scale' } as any

beforeEach(() => {
  mockCapsAsked = []
  served = TOTAL
})

const mount = async (node: ReactNode) => {
  render(node as any)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/**
 * The name cell of every rendered row, top to bottom.
 *
 * The variables card renders `{{name}}` and the functions card renders the
 * bare name, so the braces are stripped rather than matched — a selector that
 * only knew one of the two would report the other list as empty and pass every
 * "did not contain" assertion for the wrong reason.
 */
const renderedNames = () =>
  Array.from(document.querySelectorAll('p'))
    .map((node) => (node.textContent ?? '').trim().replace(/^\{\{|\}\}$/g, ''))
    .filter((text) => /^(alpha|fn)_\d{3}$/.test(text))

describe('the variables list walks its collection (AGL-2501)', () => {
  it('THE CONTROL: naming the order changes nothing, and that is the claim', () => {
    // Said plainly, because the opposite is the easy thing to believe.
    // Document-id order is what a bare `limit()` ALREADY returns, so
    // `collectionCeiling` hands back the same hundred rows. What it buys is
    // that the order is written down — and this is the trap it is written down
    // to prevent.
    const bare = firestoreAnswer(variableDocs, [{ limit: CEILING }])
    const named = firestoreAnswer(variableDocs, [
      { orderBy: '__name__' },
      { limit: CEILING },
    ])
    expect(named.map((row) => row.$id)).toEqual(bare.map((row) => row.$id))
  })

  it('THE TRAP: ordering on `name` would hide rows, not reorder them', () => {
    // Driven through the same evaluator the cards are fed, so this is a claim
    // about the query rather than about a comment. `orderBy` matches only
    // documents that HAVE the field.
    const onName = firestoreAnswer(mixedWriters, [{ orderBy: 'name' }])
    expect(onName).toHaveLength(6)
    expect(onName.length).toBeLessThan(mixedWriters.length)
    const onDocumentName = firestoreAnswer(mixedWriters, [
      { orderBy: '__name__' },
    ])
    expect(onDocumentName).toHaveLength(mixedWriters.length)
  })

  it('reads the ceiling PLUS a probe, and renders one page of it', async () => {
    await mount(<HostVariablesCard hostId="host-1" org={ORG} />)
    expect(mockCapsAsked).toContain(CEILING + 1)
    expect(renderedNames()).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
    // `alpha_000` lives on `alpha-100`, the document the PROBE found and the
    // window does not hold — so the alphabetically first variable on this site
    // is not the first row, and the notice below is what says so.
    expect(renderedNames()[0]).toBe('alpha_001')
    expect(renderedNames()).not.toContain('alpha_000')
  })

  it('pages to a row the first page never held', async () => {
    await mount(<HostVariablesCard hostId="host-1" org={ORG} />)
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() => expect(renderedNames()[0]).toBe('alpha_011'))
    expect(renderedNames()).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
  })

  it('THE POINT: the duplicate-name check sees a name off the page', async () => {
    await mount(<HostVariablesCard hostId="host-1" org={ORG} />)
    // `alpha_050` is on page six. A server-paged list would compare the draft
    // against the ten rows in front of the reader, find nothing, and create
    // the duplicate that breaks `{{name}}` resolution.
    expect(renderedNames()).not.toContain('alpha_050')
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }))
    const field = await screen.findByLabelText('Name')
    fireEvent.change(field, { target: { value: 'alpha_050' } })
    await waitFor(() =>
      expect(
        screen.getByText('A variable with this name already exists'),
      ).toBeTruthy(),
    )
  })

  it('says so when the ceiling bit, and stays quiet when it did not', async () => {
    await mount(<HostVariablesCard hostId="host-1" org={ORG} />)
    expect(screen.getByText(/a name may already be taken/)).toBeTruthy()

    // Exactly the ceiling: the off-by-one a `length >= CEILING` comparison
    // gets wrong, in the one collection size where it matters.
    served = CEILING
    document.body.innerHTML = ''
    await mount(<HostVariablesCard hostId="host-1" org={ORG} />)
    expect(screen.queryByText(/a name may already be taken/)).toBeNull()
  })
})

describe('the functions list walks its collection (AGL-2501)', () => {
  it('reads the ceiling plus a probe and pages what it holds', async () => {
    await mount(<HostFunctionsCard hostId="host-1" org={ORG} />)
    expect(mockCapsAsked).toContain(CEILING + 1)
    expect(renderedNames()).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
    expect(renderedNames()[0]).toBe('fn_001')
  })

  it('its duplicate-name check also reaches past the page', async () => {
    await mount(<HostFunctionsCard hostId="host-1" org={ORG} />)
    expect(renderedNames()).not.toContain('fn_050')
    fireEvent.click(screen.getByRole('button', { name: 'Add function' }))
    // The FIRST `Name` box is the function's own; the dialog also gives every
    // parameter and every operation one, so a bare `getByLabelText` finds
    // several and this would fail as ambiguity rather than as anything about
    // the check under test.
    const [field] = await screen.findAllByLabelText('Name')
    fireEvent.change(field, { target: { value: 'fn_050' } })
    await waitFor(() =>
      expect(
        screen.getByText('A function with this name already exists'),
      ).toBeTruthy(),
    )
  })
})
