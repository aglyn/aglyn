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
 * The inventory-locations cap is a server aggregate, not the length of a
 * capped listener (AGL-1716, the AGL-1706 shape) — the narrowest margin of
 * the eight, and real for exactly one plan.
 *
 * The listener is `limit(25)` and `inventoryLocations` runs 1 / 1 / 2 / 4 /
 * 6 / 10 / 50, so only Agency's 50 sits above the window. An agency site
 * with more than 25 stock buckets read its cap as satisfiable and printed
 * "25/50 locations on your plan", while `api/hosts/resources` counted the
 * collection and refused the add.
 *
 * Contracts: the gate refuses over the band the window hid AND the caption
 * beside it stops quoting the window (both red before the fix), the list
 * keeps its cap, a hard delete re-reads the count — locations are the one
 * card of this sweep where a removal really does free a slot on both sides —
 * and an unanswered aggregate falls back to the loaded rows rather than to
 * 0.
 *
 * No counting RULE moves: `checkQuota` is untouched and this number is not
 * metered by `report-usage`.
 *
 * NO STRIPE PATH IS EXERCISED and no production data is read.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

/** What the server says the site actually has. */
const SERVER_LOCATIONS = 60
/** What the `limit(25)` listener can ever hand back. */
const ROWS = 25

const locationDocs = Array.from({ length: ROWS }, (_, index) => ({
  $id: `loc-${index}`,
  name: `Warehouse ${String(index).padStart(2, '0')}`,
  isDefault: index === 0,
}))
const collections: Record<string, Array<Record<string, unknown>>> = {
  locations: locationDocs,
}

/** Mutable so a spec can choose how the aggregate resolves. */
const aggregate: { count: number | null } = { count: SERVER_LOCATIONS }

/** Stable, like the real hook — `firestore` keys the head-count effect. */
const FIRESTORE = {}
const mockCreateResource = jest.fn().mockResolvedValue({ id: 'loc-new' })
/** Stock `agency`: `inventoryLocations: 50`, the only band above the window. */
const ORG_PLAN = { org: { $id: 'org-1', plan: 'agency' }, ready: true }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useOrgPlan: () => ORG_PLAN,
  useHostResourceApi: () => mockCreateResource,
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
}))

const limitSpy = jest.fn((value: number) => value)
const countSpy = jest.fn(async (name: string) => {
  // A server aggregate is a NETWORK round-trip: its answer cannot land in the
  // same drain as the mount that asked for it. Resolving it there was the
  // fixture's own fiction, and it is what let a settle helper that flushed a
  // fixed number of microtasks look correct (AGL-1756/AGL-1758).
  //
  // TWO macrotasks, not the one AGL-1756's sibling needed, and the difference
  // is measured rather than guessed: `await act(async () => …)` resolves
  // through React's `enqueueTask` (`setImmediate`, else a `MessageChannel`),
  // so the old helper's own settle already yielded to the task queue once and
  // a single-macrotask aggregate still slipped in under it — all five cases
  // passed. Two is the first schedule it cannot beat, and it is still orders
  // of magnitude cheaper than any real `getCountFromServer`. Any tick-counting
  // settle now fails deterministically instead of only under a loaded worker.
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (aggregate.count == null) {
    throw Object.assign(new Error('denied'), { code: 'permission-denied' })
  }
  return { data: () => ({ count: aggregate.count }), name } as any
})

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: (value: number) => limitSpy(value),
  doc: () => ({}),
  getCountFromServer: (name: string) => countSpy(name),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  setDoc: jest.fn().mockResolvedValue(undefined),
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

import LocationsCard from './locations-card.component'

beforeEach(() => {
  jest.clearAllMocks()
  confirm.mockResolvedValue(undefined)
  aggregate.count = SERVER_LOCATIONS
})

/**
 * Wait until the card is SHOWING `count` — the aggregate's answer has not
 * merely resolved, it has reached a render and is the number the caption
 * quotes and the gate is computed from (they are the same `locationCount`).
 *
 * This replaces a helper that waited for `countSpy` to have been CALLED and
 * then flushed a fixed two microtasks, assuming the answer had arrived
 * (AGL-1758, the byte-identical helper AGL-1756 removed from the products
 * sibling). On any promise chain longer than those two ticks it returned
 * early, the click read the `limit(25)` fallback of 25 — UNDER agency's band
 * of 50 — so nothing was refused, and the trailing `waitFor` spent RTL's
 * 1,000ms default before reporting a value mismatch that reads as a timeout.
 *
 * A tick budget cannot be made large enough, only large enough for today's
 * promise chain, so the condition replaces it rather than widening it.
 *
 * Unlike the products hub, this card needs NO mock seam to observe it: the
 * caption renders `${locationCount}/${quota.limit}`, so 60 and 25 print
 * different strings and the rendered consequence IS the condition.
 */
const showingCount = async (count: number) => {
  await waitFor(() =>
    expect(
      screen.queryByText(`${count}/50 locations on your plan`),
    ).not.toBeNull(),
  )
}

/**
 * The DENIED case has no `showingCount` signal to wait for: its fallback is
 * also the value the FIRST render used, so `showingCount(ROWS)` would be
 * satisfied before the read had failed — passing while proving nothing.
 * Await the very promise the card awaited instead. Settled is settled; no
 * tick count is involved either way.
 */
const readRejected = async () => {
  await waitFor(() => expect(countSpy).toHaveBeenCalled())
  await act(async () => {
    await countSpy.mock.results[0].value.catch(() => undefined)
  })
}

describe('the inventory-locations cap is a server aggregate (AGL-1716)', () => {
  it('reads the site total in the caption, not the loaded rows', async () => {
    render(<LocationsCard hostId="host-1" />)
    // Before the fix this read "25/50 locations on your plan" — the cap
    // presented as the site's usage, on the line whose job is saying where
    // the site sits in its band. Sixty warehouses against fifty is over,
    // and the window could not say so at any count.
    await showingCount(SERVER_LOCATIONS)

    expect(screen.queryByText('25/50 locations on your plan')).toBeNull()
  })

  it('refuses Add over the band the loaded window hid', async () => {
    render(<LocationsCard hostId="host-1" />)
    await showingCount(SERVER_LOCATIONS)

    fireEvent.change(screen.getByLabelText(/New location/), {
      target: { value: 'Overflow depot' },
    })
    fireEvent.click(screen.getByText('Add'))

    // Asserted directly, not inside a `waitFor`: `handleAdd` enqueues before
    // it awaits anything, so there is nothing here to wait FOR. A budget
    // around a synchronous assertion only decides how long a real failure
    // takes to report.
    expect(
      enqueueSnackbar.mock.calls.some((call) =>
        String(call[0]).includes('Your plan includes 50 locations'),
      ),
    ).toBe(true)
    // The API would have refused it anyway; the point is that the card
    // stopped promising otherwise first.
    expect(mockCreateResource).not.toHaveBeenCalled()
  })

  it('keeps the list capped and reads the count once, from locations', async () => {
    render(<LocationsCard hostId="host-1" />)
    await showingCount(SERVER_LOCATIONS)

    expect(limitSpy).toHaveBeenCalledWith(25)
    expect(countSpy).toHaveBeenCalledTimes(1)
    expect(countSpy).toHaveBeenCalledWith('locations')
  })

  it('re-reads the count after a HARD delete frees a slot', async () => {
    render(<LocationsCard hostId="host-1" />)
    await showingCount(SERVER_LOCATIONS)
    countSpy.mockClear()

    // Unlike every other card in this sweep, locations are hard-deleted, so
    // a removal genuinely lowers the number on both sides. A one-shot that
    // missed it would keep refusing an add the API would now allow.
    fireEvent.click(screen.getAllByText('Remove')[0])

    await waitFor(() => expect(countSpy).toHaveBeenCalledWith('locations'))
  })

  it('falls back to the loaded rows, never to zero, when the read fails', async () => {
    aggregate.count = null
    render(<LocationsCard hostId="host-1" />)
    await readRejected()

    // The 25 known rows stand in — a lower bound, and this card's prior
    // behaviour. A defaulted 0 would print "0/50" on a site with sixty
    // warehouses, which is the flattering direction again.
    expect(screen.queryByText('25/50 locations on your plan')).not.toBeNull()
    expect(screen.queryByText('0/50 locations on your plan')).toBeNull()
  })
})
