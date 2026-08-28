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
 * The actions list is ORDERED, CEILINGED and PAGED (AGL-2501).
 *
 * It was `limit(100)` with no `orderBy`, every surviving row rendered at once,
 * and no footer anywhere. `ACTIONS_MAX_PER_HOST` is 500, so on a busy site the
 * hundred that came back was a pseudo-random sample of a fifth of the
 * automations — and the `localeCompare` beneath it arranged that sample
 * alphabetically, which is what made the absence invisible.
 *
 * ## Why the QUERY is not paged
 *
 * `hosts/{id}/actions` holds TWO audiences. A row whose trigger names a leaf
 * selector is an element interaction (AGL-1478) and is reported as a COUNT
 * rather than listed; everything else is a site action and is listed. Both
 * partitions are computed from the rows in hand, so a ten-row server page
 * would turn "3 interactions are set up on their own elements" into "3 on this
 * page" — the count-that-is-a-window-length defect, arriving as a fix.
 *
 * So the read is a ceiling with a probe, and the page is a slice of it.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'

jest.setTimeout(30_000)

/** The card's own ceiling. */
const CEILING = 100

/**
 * A hundred rows inside the ceiling plus one past it.
 *
 * Ids run OPPOSITE to names, so the ceiling's bound is visible on screen: the
 * document the probe finds is the alphabetically FIRST action, and its absence
 * from page one is the whole claim.
 */
const TOTAL = CEILING + 1
const actionDocs = Array.from({ length: TOTAL }, (_, index) => {
  const name = `act_${String(TOTAL - 1 - index).padStart(3, '0')}`
  const base: Record<string, any> = {
    $id: `ac-${String(index).padStart(3, '0')}`,
    name,
    trigger: { event: 'formSubmission' },
    steps: [],
  }
  // Interleaved rather than clustered: a partition that only worked because
  // the element rows sat at one end would pass a fixture that grouped them.
  if (index % 8 === 3) {
    base.trigger = { event: 'click', selector: '[data-aglyn="leaf:node-1"]' }
  } else if (index % 12 === 5) {
    base.deletedAt = { seconds: 1 }
  }
  return base
})

const LEAF = /^\[data-aglyn="leaf:.+"\]$/

/**
 * What the card should end up listing, DERIVED from the fixture.
 *
 * Written out rather than counted by hand: the two client filters and the
 * ceiling interact, and a hand-written total is a second implementation of the
 * thing under test that goes stale the moment the fixture is edited.
 */
const listedNames = actionDocs
  // The window: document-id order, ceiling rows, the probe row excluded.
  .slice(0, CEILING)
  .filter((doc) => !doc.deletedAt)
  .filter((doc) => !LEAF.test(String(doc.trigger?.selector ?? '')))
  .map((doc) => doc.name as string)
  .sort()
const LISTED = listedNames.length
/** Element interactions inside the window — reported as a count, not listed. */
const ELEMENT_SCOPED = actionDocs
  .slice(0, CEILING)
  .filter((doc) => !doc.deletedAt)
  .filter((doc) => LEAF.test(String(doc.trigger?.selector ?? ''))).length

/** Mixed writers, for the trap case: `orderBy` filters as well as sorts. */
const mixedWriters = [
  ...actionDocs.slice(0, 4),
  { $id: 'ac-900', steps: [] },
  { $id: 'ac-901', steps: [] },
]

const byCollection: Record<string, Array<Record<string, any>>> = {
  actions: actionDocs,
  workflows: [],
  datasets: [],
  overlays: [],
  lists: [],
  campaigns: [],
  webhooks: [],
}

const firestoreAnswer = (
  all: Array<Record<string, any>>,
  constraints: Array<Record<string, any>>,
) => {
  const order = constraints.find((item) => 'orderBy' in item)
  const cap = constraints.find((item) => 'limit' in item)?.limit
  const field = order
    ? order.orderBy === '__name__'
      ? '$id'
      : order.orderBy
    : null
  // `orderBy` FILTERS: Firestore matches only documents that have the field.
  const matching = field ? all.filter((doc) => doc[field] !== undefined) : all
  const sorted = [...matching].sort((a, b) =>
    String(a[field ?? '$id']) < String(b[field ?? '$id']) ? -1 : 1,
  )
  return typeof cap === 'number' ? sorted.slice(0, cap) : sorted
}

/**
 * Every cap asked for, KEYED BY COLLECTION.
 *
 * The card issues seven capped reads and six of them are pickers. A flat
 * `toContain(101)` would be satisfied by whichever sibling happened to ask for
 * that number, and would keep passing if the actions read stopped capping
 * altogether — which is how two assertions in this sweep passed for the wrong
 * reason. The assertions below name the collection and the whole SET.
 */
let mockCapsAsked: Record<string, number[]> = {}
let served = TOTAL
const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useHostResourceApi: () => jest.fn().mockResolvedValue({ id: 'new' }),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'] }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
  // The real builders: a stub would decide the ordering this spec is about.
  collectionCeiling: jest.requireActual('@aglyn/tenant-feature-instance')
    .collectionCeiling,
  ceilingedWindow: jest.requireActual('@aglyn/tenant-feature-instance')
    .ceilingedWindow,
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    const name = String(built?.path ?? '').split('/').pop() ?? ''
    const cap = (built?.constraints ?? []).find(
      (item: any) => 'limit' in item,
    )?.limit
    if (typeof cap === 'number') {
      mockCapsAsked[name] = [...(mockCapsAsked[name] ?? []), cap]
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
  where: () => ({ where: true }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
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
jest.mock('./host-run-history-card.component', () => ({
  __esModule: true,
  default: () => null,
  HostRunHistoryCard: () => null,
}))

import { HostActionsCard } from './host-actions-card.component'

const ORG = { $id: 'org-1', plan: 'scale' } as any

beforeEach(() => {
  mockCapsAsked = {}
  served = TOTAL
})

const mount = async () => {
  render(<HostActionsCard hostId="host-1" org={ORG} />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const renderedNames = () =>
  Array.from(document.querySelectorAll('p'))
    .map((node) => (node.textContent ?? '').trim())
    .filter((text) => /^act_\d{3}$/.test(text))

describe('the actions list is ceilinged and paged (AGL-2501)', () => {
  it('THE CONTROL: naming the order changes nothing, and that is the claim', () => {
    const bare = firestoreAnswer(actionDocs, [{ limit: CEILING }])
    const named = firestoreAnswer(actionDocs, [
      { orderBy: '__name__' },
      { limit: CEILING },
    ])
    expect(named.map((row) => row.$id)).toEqual(bare.map((row) => row.$id))
  })

  it('THE TRAP: ordering on `name` would hide rows, not reorder them', () => {
    const onName = firestoreAnswer(mixedWriters, [{ orderBy: 'name' }])
    expect(onName).toHaveLength(4)
    expect(onName.length).toBeLessThan(mixedWriters.length)
    expect(
      firestoreAnswer(mixedWriters, [{ orderBy: '__name__' }]),
    ).toHaveLength(mixedWriters.length)
  })

  it('caps the ACTIONS read at the ceiling plus a probe', async () => {
    await mount()
    // The set, not "some read asked for 101". Six sibling pickers cap too,
    // and an assertion that could be satisfied by one of them would survive
    // the actions read losing its cap entirely.
    expect(mockCapsAsked['actions']).toEqual([CEILING + 1])
    expect(Object.keys(mockCapsAsked).sort()).toEqual([
      'actions',
      'campaigns',
      'datasets',
      'lists',
      'overlays',
      'webhooks',
      'workflows',
    ])
  })

  it('renders ONE page, not the whole window', async () => {
    await mount()
    expect(renderedNames()).toEqual(
      listedNames.slice(0, TABLE_PAGE_SIZE_DEFAULT),
    )
    // `act_000` lives on the document the probe found and the window does not
    // hold, so the alphabetically first action is on no page at all.
    expect(listedNames).not.toContain('act_000')
  })

  it('pages to a row the first page never held', async () => {
    const secondPage = listedNames.slice(
      TABLE_PAGE_SIZE_DEFAULT,
      TABLE_PAGE_SIZE_DEFAULT * 2,
    )
    await mount()
    expect(renderedNames()).not.toContain(secondPage[0])
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() => expect(renderedNames()).toEqual(secondPage))
  })

  it('counts element interactions across the WINDOW, not the page', async () => {
    await mount()
    // The reason the query is not server-paged, asserted as a number: the
    // caption describes every element-scoped row the card read, and page one
    // holds ten rows.
    expect(
      screen.getByText(new RegExp(`^${ELEMENT_SCOPED} interactions are set up`)),
    ).toBeTruthy()
    expect(ELEMENT_SCOPED).toBeGreaterThan(TABLE_PAGE_SIZE_DEFAULT)
  })

  it('pages over the LIVE rows, and the footer counts those', async () => {
    await mount()
    // Soft-deleted and element-scoped rows are filtered after the read, so
    // the footer's total is neither the ceiling nor the window length.
    expect(screen.getByText(`1–10 of ${LISTED}`)).toBeTruthy()
    expect(LISTED).toBeLessThan(CEILING)
  })

  it('says so when the ceiling bit, and stays quiet when it did not', async () => {
    await mount()
    expect(screen.getByText(/There are more/)).toBeTruthy()

    // Exactly the ceiling: the off-by-one a `length >= CEILING` comparison
    // gets wrong, in the one collection size where it matters.
    served = CEILING
    document.body.innerHTML = ''
    await mount()
    expect(screen.queryByText(/There are more/)).toBeNull()
  })
})
