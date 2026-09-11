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
 * LINKING A PERSON FROM A COMPANY'S PAGE (AGL-2597, AGL-2804).
 *
 * The link is the viewing holder's facet — `facets.{groupId}.companyId` —
 * with its mirror and the company's count beside it, and a facet is the
 * server's to write: linking and unlinking are posts to
 * `crm/contact-update`, which plans the mirror and the count, and nothing is
 * written client-direct.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { soloConsentGroup } from '@aglyn/aglyn'
import { crmRoutes } from '../model/crm-routes'
import { CompanyContactsCard } from './company-contacts-card'

/** Every client-direct write the store received — which must stay empty. */
let writes: Array<{ path: string; data: unknown }>

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (base: unknown) => base,
  where: () => undefined,
  orderBy: () => undefined,
  limit: () => undefined,
  startAt: () => undefined,
  endAt: () => undefined,
  getCountFromServer: async () => ({ data: () => ({ count: 1 }) }),
  // The one search the "Add contact" box runs.
  getDocs: async () => ({
    docs: [
      {
        id: 'c2',
        data: () => ({
          email: 'bea@example.test',
          name: 'Bea',
          visibleTo: ['host:host-1'],
          facets: {},
        }),
      },
    ],
  }),
  arrayUnion: (...values: unknown[]) => ({ op: 'union', values }),
  arrayRemove: (...values: unknown[]) => ({ op: 'remove', values }),
  deleteField: () => ({ op: 'delete' }),
  increment: (by: number) => ({ op: 'increment', by }),
  serverTimestamp: () => ({ op: 'serverTimestamp' }),
  writeBatch: () => {
    const staged: Array<{ path: string; data: unknown }> = []
    return {
      update: (ref: { path: string }, data: unknown) => void staged.push({ path: ref.path, data }),
      commit: async () => void writes.push(...staged),
    }
  },
  updateDoc: async (ref: { path: string }, data: unknown) =>
    void writes.push({ path: ref.path, data }),
}))

/** The contacts this holder has filed under Acme. */
const LINKED = [
  {
    $id: 'c1',
    email: 'ada@example.test',
    name: 'Ada',
    visibleTo: ['host:host-1'],
    companyIds: ['c-acme'],
    facets: { 'host-1': { sources: {}, interactions: [], companyId: 'c-acme' } },
  },
]
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
  usePagedCollection: () => ({
    rows: LINKED,
    status: 'success',
    hasMore: false,
    page: 0,
    setPage: jest.fn(),
    pageSize: 10,
    setPageSize: jest.fn(),
  }),
}))

let notices: string[]
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: unknown) => void notices.push(String(message)),
  }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
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
  MdiIcon: () => null,
}))
jest.mock('@aglyn/shared-ui-jsx/components/list-pagination.component', () => ({
  ListPagination: () => null,
}))
jest.mock('@aglyn/shared-ui-jsx/components/empty-state.component', () => ({
  __esModule: true,
  default: () => null,
}))

/** Every post to a CRM route. */
let posted: Array<{ route: string; payload: Record<string, any> }>
jest.mock('./use-crm-api', () => ({
  useCrmApi: () => async (route: string, payload: Record<string, any>) => {
    posted.push({ route, payload })
    return {
      response: { ok: true, status: 200 },
      payload: {
        ok: true,
        results: (payload['contactIds'] ?? []).map((contactId: string) => ({
          contactId,
          ok: true,
        })),
      },
    }
  },
}))

const GROUP = soloConsentGroup('host-1')
const crmScope = {
  scope: ['orgs', 'org-1'] as const,
  orgId: 'org-1',
  ready: true,
  level: 'site' as const,
  hostId: 'host-1',
  consentGroup: GROUP,
  visibleTo: ['org', 'host:host-1'],
  createHostId: 'host-1',
  createGroup: GROUP,
  createTokens: ['host:host-1'],
}

const renderCard = () =>
  render(
    <CompanyContactsCard
      companyId="c-acme"
      companyName="Acme"
      crmScope={crmScope as never}
      routes={crmRoutes('/acme/hosts/shop/crm')}
    />,
  )

beforeEach(() => {
  writes = []
  notices = []
  posted = []
})

describe("a company's contacts", () => {
  it('unlinks a person through crm/contact-update, writing nothing client-direct', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Unlink Ada' }))
    await waitFor(() => expect(notices).toContain('Ada unlinked'))
    expect(posted).toEqual([
      { route: 'contact-update', payload: { contactIds: ['c1'], set: { companyId: null } } },
    ])
    expect(writes).toEqual([])
  })

  it('links a person found by address through the route', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))
    fireEvent.change(screen.getByLabelText('Find by email or name'), {
      target: { value: 'bea@example.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Link' }))
    await waitFor(() => expect(notices).toContain('Bea linked to Acme'))
    expect(posted).toEqual([
      { route: 'contact-update', payload: { contactIds: ['c2'], set: { companyId: 'c-acme' } } },
    ])
    expect(writes).toEqual([])
  })
})
