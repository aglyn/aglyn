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
 *     to go — for a reader who may drop it — and the list must still be
 *     ordered. The query is planned by the real `planListQuery` and answered
 *     by the list-query double (AGL-3321).
 *  2. AN ADDRESS LINK OPENS THE RECORD when exactly one row answers, and
 *     only then: two rows is a list to look at, and none is the honest
 *     answer for a submission whose contact the band dropped.
 *
 * NO STRIPE PATH IS EXERCISED and no production data is read.
 */

import { render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { lastListQueryPlan } from '@aglyn/tenant-feature-instance/testing/list-query-double'
import { ContactsPeopleSection } from './contacts-section'

const ORG = { $id: 'org-1', plan: 'pro' } as any
const BASE_PATH = '/acme/hosts/shop/crm'

/** The address the section reads, set per spec. */
let search = ''
/** Every contact the org holds, set per spec; the query double answers from them. */
let mockRows: Array<Record<string, unknown>> = []
const replace = jest.fn()

jest.mock('./recent-activity-feed', () => ({
  __esModule: true,
  default: () => null,
  RecentActivityFeed: () => null,
}))
jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () =>
  jest
    .requireActual('@aglyn/tenant-feature-instance/testing/list-query-double')
    .listQueryModule(
      () => mockRows,
      jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query'),
    ),
)
jest.mock('@aglyn/tenant-feature-instance', () => ({
  // The reader's reach, for the views control's "may edit" — org-wide here.
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useFirestore: () => ({}),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'] as const, orgId: 'org-1' }),
  useHostCampaigns: () => ({ options: [], truncated: false, ready: true }),
  useOrgCampaigns: () => ({ options: [], truncated: false, ready: true }),
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
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

const contact = (id: string, email: string, formIds: string[] = []) => ({
  $id: id,
  email,
  name: email,
  formIds,
  updatedAt: new Date('2026-09-01T00:00:00Z'),
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
  mockRows = []
  replace.mockClear()
})

describe('opened for one form', () => {
  it('queries the mirror by array-contains, ordered, with no scope clause', () => {
    search = 'source=form&formId=Fx9_Q-mixed'
    mockRows = [contact('c1', 'a@example.com', ['Fx9_Q-mixed']), contact('c2', 'b@example.com')]
    renderList()
    const plan = lastListQueryPlan()
    expect(plan?.filters).toEqual([{ path: 'formIds', op: 'array-contains', value: 'Fx9_Q-mixed' }])
    expect(plan?.orderBy).toEqual({ path: 'updatedAt', direction: 'desc' })
    // The source beside it would be a second array clause; the form implies it.
    expect(plan?.refused).toEqual([])
  })

  it('THE CONTROL: an unseeded list still carries the scope clause', () => {
    mockRows = [contact('c1', 'a@example.com')]
    renderList()
    const plan = lastListQueryPlan()
    expect(plan?.filters).toEqual([
      expect.objectContaining({ path: 'visibleTo', op: 'array-contains-any' }),
    ])
    expect(plan?.orderBy).toEqual({ path: 'updatedAt', direction: 'desc' })
  })
})

describe('opened for one address', () => {
  it('moves on to the record when exactly one row answers', async () => {
    search = 'email=Ada%40Example.com'
    mockRows = [contact('c-ada', 'ada@example.com'), contact('c-bo', 'bo@example.com')]
    renderList()
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(`${BASE_PATH}/contacts/c-ada`),
    )
    // Filtered by the normalized address, under the scope the viewer may read.
    expect(lastListQueryPlan()?.filters).toEqual([
      expect.objectContaining({ path: 'visibleTo' }),
      { path: 'email', op: '==', value: 'ada@example.com' },
    ])
  })

  it('stays on the list when nobody, or more than one person, answers', async () => {
    search = 'email=ada%40example.com'
    mockRows = []
    const { unmount } = renderList()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(replace).not.toHaveBeenCalled()
    unmount()

    mockRows = [contact('c1', 'ada@example.com'), contact('c2', 'ada@example.com')]
    renderList()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(replace).not.toHaveBeenCalled()
  })
})
