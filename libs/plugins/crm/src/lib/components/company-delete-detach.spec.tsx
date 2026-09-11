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
 * Deleting a company from its page (AGL-2597, AGL-2804).
 *
 * The delete unlinks every contact at the company before the company goes,
 * and the unlink clears each holder's facet that named it — which is the
 * server's to write. So the page's Delete is one post to
 * `crm/company-delete`, whose own spec pins the detach and its bound; what
 * the page must hold is what it says for each answer:
 *
 *  1. DELETED: the sentence names how many contacts were unlinked, and the
 *     page leaves the record it removed.
 *  2. MORE REMAIN: the company stands, the page stays, and the reader is
 *     told to delete again.
 *  3. REFUSED: the route's own sentence, and nothing moves.
 *
 * In none of them does the browser write a contact or delete the company.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import CompanyDetailPage from './company-detail-page'

const COMPANY_ID = 'c-acme'

/** Every client-direct write the store received — which must stay empty. */
const writes: Array<{ kind: string; path: string }> = []
const notices: Array<{ message: string; variant?: string }> = []
const pushes: string[] = []

/** The CRM routes the page posted to, and what the delete route answers. */
let posted: Array<{ route: string; payload: Record<string, any> }> = []
let deleteAnswer: Record<string, unknown> = {}
let deleteRefusal: string | null = null

/*
 * The page composes the deals, tasks and activity cards beside the one under
 * test. Each opens its own listeners; none is what this suite asks about.
 */
jest.mock('./company-deals-card', () => ({ __esModule: true, default: () => null, CompanyDealsCard: () => null }))
jest.mock('./record-tasks-card', () => ({ __esModule: true, default: () => null, RecordTasksCard: () => null }))
jest.mock('./record-activity-card', () => ({ __esModule: true, default: () => null, RecordActivityCard: () => null }))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (base: { path: string }) => base,
  where: () => ({ kind: 'where' }),
  orderBy: () => ({ kind: 'orderBy' }),
  limit: (value: number) => ({ kind: 'limit', value }),
  getDocs: async () => ({ docs: [] }),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  writeBatch: () => ({
    update: (ref: { path: string }) => void writes.push({ kind: 'update', path: ref.path }),
    commit: async () => undefined,
  }),
  deleteDoc: async (ref: { path: string }) => void writes.push({ kind: 'delete', path: ref.path }),
  updateDoc: async (ref: { path: string }) => void writes.push({ kind: 'update', path: ref.path }),
  setDoc: jest.fn(),
  arrayRemove: (...values: unknown[]) => ({ op: 'arrayRemove', values }),
  arrayUnion: (...values: unknown[]) => ({ op: 'arrayUnion', values }),
  deleteField: () => ({ op: 'delete' }),
  serverTimestamp: () => ({ op: 'serverTimestamp' }),
  startAt: () => ({ kind: 'startAt' }),
  endAt: () => ({ kind: 'endAt' }),
}))

const FIRESTORE = {}
// One object for the session, as the real hook hands back.
const USER = { uid: 'uid-1', getIdToken: async () => 'token' }
const DATA_SCOPE = { scope: ['orgs', 'org-1'] as const, orgId: 'org-1', ready: true }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => DATA_SCOPE,
  useUser: () => ({ data: USER }),
  useHostActivityLogger: () => jest.fn(),
  useFirestoreDoc: () => ({
    data: { name: 'Acme', domain: 'acme.com', visibleTo: ['host:host-1'] },
    status: 'success',
    fromCache: false,
  }),
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
  // The company's contacts card pages its window; nobody is linked here.
  usePagedCollection: () => ({
    data: [],
    rows: [],
    status: 'success',
    fromCache: false,
    hasMore: false,
    page: 0,
    setPage: jest.fn(),
    pageSize: 10,
    setPageSize: jest.fn(),
  }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('./use-crm-api', () => ({
  useCrmApi: () => async (route: string, payload: Record<string, any>) => {
    posted.push({ route, payload })
    if (route === 'company-delete' && deleteRefusal) {
      return { response: { ok: false, status: 403 }, payload: { error: deleteRefusal } }
    }
    return {
      response: { ok: true, status: 200 },
      payload: route === 'company-delete' ? { ok: true, ...deleteAnswer } : { ok: true },
    }
  },
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async () => ({ ok: true, json: async () => ({ members: [] }) }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => pushes.push(href), replace: jest.fn() }),
  usePathname: () => '/',
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: string, options?: { variant?: string }) =>
      notices.push({ message, variant: options?.variant }),
  }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    children,
    HeaderProps,
  }: {
    children: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  HelpTip: () => null,
  MdiIcon: () => null,
  SrOnly: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  // The person confirms. `confirm` resolves on accept and rejects on cancel.
  useConfirmationContext: () => ({ confirm: async () => undefined }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/navigation-drawer.component', () => ({
  NavigationDrawerComponent: () => null,
}))

const BASE_PATH = '/acme/hosts/shop/crm'

const mount = () =>
  render(
    <CompanyDetailPage
      id={COMPANY_ID}
      basePath={BASE_PATH}
      hostId="host-1"
      org={{ $id: 'org-1' } as any}
    />,
  )

/**
 * Delete lives behind the record header's overflow menu, never beside Edit
 * — a destructive act one mis-click from the button next to it is the
 * arrangement the shared header exists to end — so the menu opens first.
 */
const clickDelete = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /More actions/ }))
  })
  await act(async () => {
    fireEvent.click(screen.getByText('Delete company'))
  })
}

const deletes = () =>
  posted.filter((call) => call.route === 'company-delete').map((call) => call.payload)

beforeEach(() => {
  writes.length = 0
  notices.length = 0
  pushes.length = 0
  posted = []
  deleteAnswer = { deleted: true, detached: 0, moreRemain: false }
  deleteRefusal = null
})

describe('deleting a company from its page (AGL-2804)', () => {
  it('deletes through crm/company-delete, says how many were unlinked, and leaves the record', async () => {
    deleteAnswer = { deleted: true, detached: 3, moreRemain: false }
    mount()

    await clickDelete()

    await waitFor(() => expect(pushes).toEqual([`${BASE_PATH}/companies`]))
    expect(deletes()).toEqual([{ companyId: COMPANY_ID }])
    expect(notices).toContainEqual({
      message: 'Company deleted and unlinked from 3 contacts',
      variant: 'success',
    })
    // The unlink is the server's: the browser writes no contact and deletes no company.
    expect(writes).toEqual([])
  })

  it('says more remain when a pass hit its bound, and stays on the company', async () => {
    deleteAnswer = { deleted: false, detached: 500, moreRemain: true }
    mount()

    await clickDelete()

    await waitFor(() =>
      expect(notices).toContainEqual({
        message: expect.stringMatching(/500 contacts were unlinked .* more remain/),
        variant: 'warning',
      }),
    )
    expect(pushes).toEqual([])
    expect(writes).toEqual([])
  })

  it("shows the route's refusal in its own words, and nothing moves", async () => {
    deleteRefusal =
      'Your access is limited to specific sites, so the contacts at this company ' +
      'could not be read to unlink them. Ask an organization administrator to delete it.'
    mount()

    await clickDelete()

    await waitFor(() =>
      expect(notices).toContainEqual({ message: deleteRefusal as string, variant: 'error' }),
    )
    expect(pushes).toEqual([])
    expect(writes).toEqual([])
  })
})
