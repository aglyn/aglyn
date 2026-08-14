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
 * The member-seat count is a SERVER AGGREGATE, not the page window
 * (AGL-1716 — the shape AGL-1706 fixed on the Contacts page, swept).
 *
 * `members` is one PAGE of collaborators: `limit(MEMBER_PAGE_SIZE + 1)` with
 * the probe row sliced off, so 25 rows, growing 25 at a time on "Load more"
 * (AGL-1124). That array's length was handed to `checkOrgSeatQuota` as the
 * site's seat usage AND printed verbatim as "N of M member seats used".
 *
 * `membersPerHost` is 50 on Business and runs to 250 on Agency — all above
 * the window — so a site with 60 collaborators on Business read
 * "25 of 50 member seats used": comfortably under its band, with the
 * extra-seat upsell suppressed, while it was in fact over. The API still
 * refused the next add (`api/hosts/members` counts server-side), so the
 * damage is a card offering headroom that does not exist and then failing
 * the action, plus a purchase prompt that never appears.
 *
 * The paging comment on the listener exists *because* an unannounced
 * `limit(100)` once made a 120-collaborator site "look complete". The list
 * got that fix; the count sitting next to it did not.
 *
 * Four contracts:
 *
 *  1. THE CAPTION AND THE QUOTA READ THE AGGREGATE, not the page. Red
 *     before the fix — the caption said "25 of 50" and no upsell rendered.
 *  2. THE PAGE WINDOW SURVIVES. Head-count and row list are different
 *     questions; answering the first must not start streaming the second.
 *  3. A MUTATION RE-READS IT. The listener refreshes the list for free; a
 *     one-shot aggregate goes stale after an add or a remove unless asked
 *     again.
 *  4. AN UNANSWERED AGGREGATE DOES NOT ANSWER THE QUESTION — it falls back
 *     to the page length, never to 0. `checkOrgSeatQuota` answers from
 *     whatever it is handed (AGL-1422), and "0 seats used" is a confident
 *     wrong number in the flattering direction.
 *
 * No counting rule moves: `checkSeatQuota` and the server-side enforcement
 * in `api/hosts/members` are untouched. Only this card's INPUT changed.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

/** Collaborators the SERVER says the site has. */
const SERVER_SEATS = 60
/** What one page of the listener can ever hand back (MEMBER_PAGE_SIZE). */
const PAGE_ROWS = 25

/** Mutable so a spec can make the aggregate read fail. */
const mockAggregate: { count: number | null } = { count: SERVER_SEATS }
/** Every collection path a `count()` was sent to, in order. */
const mockCountedPaths: string[] = []
/** Every `limit(n)` the card built, so the page window can be asserted. */
const mockLimits: number[] = []

const mockMemberRows = Array.from({ length: PAGE_ROWS + 1 }, (_, index) => ({
  $id: `member-${index}`,
  uid: `uid-${index}`,
  email: `person-${index}@example.test`,
  role: 'editor',
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string) => path,
  where: () => undefined,
  documentId: () => undefined,
  limit: (value: number) => {
    mockLimits.push(value)
    return undefined
  },
  getCountFromServer: jest.fn((path: string) => {
    mockCountedPaths.push(path)
    if (mockAggregate.count == null) {
      return Promise.reject(
        Object.assign(new Error('denied'), { code: 'permission-denied' }),
      )
    }
    return Promise.resolve({ data: () => ({ count: mockAggregate.count }) })
  }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'admin-1', getIdToken: async () => 'tok' } }),
}))

/**
 * Business: `membersPerHost` 50, `maxMembersPerHost` 100, and a per-seat
 * add-on price — so 60 real collaborators are over the included band and the
 * upsell is exactly what should appear. Real `checkSeatQuota`, real
 * `resolveOrgEntitlements`; only the counts are staged.
 */
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({
    org: { $id: 'org-1', plan: 'business', ownerUid: 'owner-1' },
    orgId: 'org-1',
    ready: true,
  }),
}))
jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({ permissions: { manageMembers: true } }),
}))
jest.mock('../hooks/use-host-activity-logger', () => ({
  __esModule: true,
  default: () => jest.fn(),
}))
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: (build: () => unknown) => ({
    data: build() === 'hosts/host-1/members' ? mockMemberRows : [],
  }),
}))
jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: () => ({ data: null }),
}))
jest.mock('./member-avatar.component', () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

import HostMembersCard from './host-members-card.component'

beforeEach(() => {
  jest.clearAllMocks()
  mockCountedPaths.length = 0
  mockLimits.length = 0
  mockAggregate.count = SERVER_SEATS
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'added' }),
  }) as any
})

const seatCaption = () =>
  screen.queryByText(/member seats used/)?.textContent ?? ''

describe('the member-seat count is a server aggregate (AGL-1716)', () => {
  it('counts the site, not the page of rows on screen', async () => {
    render(<HostMembersCard hostId="host-1" />)

    // Before the fix this read "25 of 50 member seats used" — the page
    // window, presented as the site's seat usage.
    await waitFor(() => expect(seatCaption()).toContain('60 of 50'))
    expect(seatCaption()).not.toContain('25 of 50')
    // Over the included band on a plan that sells seats, so the purchase
    // prompt is reachable at all — it was not while the count saturated.
    expect(seatCaption()).toContain('extra seats $')
    expect(mockCountedPaths).toContain('hosts/host-1/members')
  })

  it('keeps the page window — the paging was never the defect', async () => {
    render(<HostMembersCard hostId="host-1" />)

    // 25 + 1: the page plus AGL-1124's over-fetched "there are more" probe.
    expect(mockLimits).toContain(26)
    // Flush the aggregate's resolution so its state write lands inside this
    // test rather than as unacted-on noise in the next one. Not an assertion
    // — this case is about the window, and it holds either way.
    await act(async () => undefined)
  })

  it('re-reads the count after a mutation moves it', async () => {
    render(<HostMembersCard hostId="host-1" />)
    await waitFor(() => expect(mockCountedPaths.length).toBe(1))

    mockAggregate.count = SERVER_SEATS + 1
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: 'new@example.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    // The listener refreshes the LIST for free; a one-shot aggregate would
    // otherwise sit stale for the rest of the session.
    await waitFor(() => expect(seatCaption()).toContain('61 of 50'))
  })

  it('falls back to the rows on screen, never to zero, when denied', async () => {
    mockAggregate.count = null
    render(<HostMembersCard hostId="host-1" />)

    await waitFor(() => expect(mockCountedPaths.length).toBe(1))
    // The page window is a LOWER bound and this card's prior behaviour. A
    // defaulted 0 would read "0 of 50 member seats used" — the flattering
    // direction, on a site that is actually over.
    await waitFor(() => expect(seatCaption()).toContain('25 of 50'))
    expect(seatCaption()).not.toContain('0 of 50')
  })
})
