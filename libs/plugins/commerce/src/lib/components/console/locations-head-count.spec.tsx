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
 * The aggregate has answered AND its answer has reached state. The call
 * count lands on mount while the resolution is still a microtask.
 */
const settled = async () => {
  await waitFor(() => expect(countSpy).toHaveBeenCalled())
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('the inventory-locations cap is a server aggregate (AGL-1716)', () => {
  it('reads the site total in the caption, not the loaded rows', async () => {
    render(<LocationsCard hostId="host-1" />)
    await settled()

    // Before the fix this read "25/50 locations on your plan" — the cap
    // presented as the site's usage, on the line whose job is saying where
    // the site sits in its band. Sixty warehouses against fifty is over,
    // and the window could not say so at any count.
    await waitFor(() =>
      expect(
        screen.queryByText('60/50 locations on your plan'),
      ).not.toBeNull(),
    )
    expect(screen.queryByText('25/50 locations on your plan')).toBeNull()
  })

  it('refuses Add over the band the loaded window hid', async () => {
    render(<LocationsCard hostId="host-1" />)
    await settled()

    fireEvent.change(screen.getByLabelText(/New location/), {
      target: { value: 'Overflow depot' },
    })
    fireEvent.click(screen.getByText('Add'))

    await waitFor(() =>
      expect(
        enqueueSnackbar.mock.calls.some((call) =>
          String(call[0]).includes('Your plan includes 50 locations'),
        ),
      ).toBe(true),
    )
    // The API would have refused it anyway; the point is that the card
    // stopped promising otherwise first.
    expect(mockCreateResource).not.toHaveBeenCalled()
  })

  it('keeps the list capped and reads the count once, from locations', async () => {
    render(<LocationsCard hostId="host-1" />)
    await settled()

    expect(limitSpy).toHaveBeenCalledWith(25)
    expect(countSpy).toHaveBeenCalledTimes(1)
    expect(countSpy).toHaveBeenCalledWith('locations')
  })

  it('re-reads the count after a HARD delete frees a slot', async () => {
    render(<LocationsCard hostId="host-1" />)
    await settled()
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
    await settled()

    // The 25 known rows stand in — a lower bound, and this card's prior
    // behaviour. A defaulted 0 would print "0/50" on a site with sixty
    // warehouses, which is the flattering direction again.
    expect(screen.queryByText('25/50 locations on your plan')).not.toBeNull()
    expect(screen.queryByText('0/50 locations on your plan')).toBeNull()
  })
})
