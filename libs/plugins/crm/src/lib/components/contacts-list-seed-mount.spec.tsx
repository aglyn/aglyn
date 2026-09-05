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
 * The Contacts list opened from another surface (AGL-2612).
 *
 * Two contracts the seed parser cannot prove on its own, because both are
 * about the QUERY the section builds from it:
 *
 *  1. A FORM LINK QUERIES THE MIRROR WITHOUT THE SCOPE CLAUSE. `formIds`
 *     is an `array-contains`, and Firestore takes one array clause per
 *     query, so the `visibleTo` predicate every other listener carries has
 *     to go — and the list must still be ordered. A query that kept the
 *     clause would fail on every org; one that dropped the order would be
 *     a random sample.
 *  2. AN ADDRESS LINK OPENS THE RECORD when exactly one row answers, and
 *     only then: two rows is a list to look at, and none is the honest
 *     answer for a submission whose contact the band dropped.
 *
 * NO STRIPE PATH IS EXERCISED and no production data is read.
 */

import { render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ContactsPeopleSection } from './contacts-section'

const ORG = { $id: 'org-1', plan: 'pro' } as any
const BASE_PATH = '/acme/hosts/shop/crm'

/** The address the section reads, set per spec. */
let search = ''
/** Every row the listener hands back, set per spec. */
let rows: Array<Record<string, unknown>> = []
/** The constraints of the last contacts query built. */
let lastConstraints: unknown[] = []
const replace = jest.fn()

jest.mock('./recent-activity-feed', () => ({
  __esModule: true,
  default: () => null,
  RecentActivityFeed: () => null,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  listFilterConstraints: jest.requireActual(
    '@aglyn/tenant-feature-instance',
  ).listFilterConstraints,
  useFirestore: () => ({}),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'] as const, orgId: 'org-1' }),
  useHostCampaigns: () => ({ options: [], truncated: false, ready: true }),
  useFirestoreCollection: (build: () => unknown) => {
    const built = build() as { name: string; constraints: unknown[] } | null
    if (built?.name === 'contacts') lastConstraints = built.constraints
    return {
      data: built?.name === 'contacts' ? rows : [],
      status: 'success',
      fromCache: false,
    }
  },
  useFirestoreDoc: () => ({ data: { total: 0 }, status: 'success', fromCache: false }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
  useUser: () => ({ data: { uid: 'user-1' } }),
  useHostActivityLogger: () => jest.fn(),
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string, ...constraints: unknown[]) => ({ name, constraints }),
  where: (path: string, op: string, value: unknown) => ({ where: path, op, value }),
  orderBy: (path: string, direction?: string) => ({ orderBy: path, direction }),
  limit: (value: number) => ({ limit: value }),
  doc: () => ({}),
  getCountFromServer: async () => ({ data: () => ({ count: 1 }) }),
  addDoc: jest.fn().mockResolvedValue(undefined),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
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
jest.mock('@aglyn/shared-ui-jsx/components/list-table.component', () => ({
  ListTable: () => null,
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace }),
  useSearchParams: () => new URLSearchParams(search),
}))

const contact = (id: string, email: string) => ({
  $id: id,
  email,
  name: email,
  visibleTo: ['host:site-1'],
  facets: { 'site-1': { sources: { form: true }, interactions: [], tags: [] } },
})

const renderList = () =>
  render(
    <ContactsPeopleSection
      hostId="site-1"
      entitled
      org={ORG}
      basePath={BASE_PATH}
      releaseFlag={{ released: true, ready: true } as any}
    />,
  )

beforeEach(() => {
  search = ''
  rows = []
  lastConstraints = []
  replace.mockClear()
})

describe('opened for one form', () => {
  it('queries the mirror by array-contains, ordered, with no scope clause', () => {
    search = 'source=form&formId=Fx9_Q-mixed'
    rows = [contact('c1', 'a@example.com')]
    renderList()
    expect(lastConstraints).toEqual(
      expect.arrayContaining([
        { where: 'formIds', op: 'array-contains', value: 'Fx9_Q-mixed' },
        expect.objectContaining({ orderBy: 'updatedAt' }),
        { limit: 1000 },
      ]),
    )
    expect(
      lastConstraints.some(
        (constraint) => (constraint as { where?: string }).where === 'visibleTo',
      ),
    ).toBe(false)
  })

  it('THE CONTROL: an unseeded list still carries the scope clause', () => {
    rows = [contact('c1', 'a@example.com')]
    renderList()
    expect(lastConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ where: 'visibleTo', op: 'array-contains-any' }),
        expect.objectContaining({ orderBy: 'updatedAt' }),
      ]),
    )
  })
})

describe('opened for one address', () => {
  it('moves on to the record when exactly one row answers', async () => {
    search = 'email=Ada%40Example.com'
    rows = [contact('c-ada', 'ada@example.com')]
    renderList()
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(`${BASE_PATH}/contacts/c-ada`),
    )
    // Filtered by the normalized address, under the scope the viewer may read.
    expect(lastConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ where: 'visibleTo' }),
        { where: 'email', op: '==', value: 'ada@example.com' },
      ]),
    )
  })

  it('stays on the list when nobody, or more than one person, answers', async () => {
    search = 'email=ada%40example.com'
    rows = []
    const { unmount } = renderList()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(replace).not.toHaveBeenCalled()
    unmount()

    rows = [contact('c1', 'ada@example.com'), contact('c2', 'ada@example.com')]
    renderList()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(replace).not.toHaveBeenCalled()
  })
})
