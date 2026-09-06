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
 * The Companies section lists SCOPED, ordered, and creates records that
 * every reader's predicate can find (AGL-2597).
 *
 * Three contracts, reached through the hub the way the shell reaches it:
 *
 *  1. THE LISTENER IS SCOPED AND ORDERED. `visibleTo array-contains-any`
 *     over this site's tokens is the predicate the rules evaluate, and
 *     `updatedAt desc` is what makes page one the recently-touched page
 *     rather than a random sample of document ids.
 *  2. A ROW IS A LINK TO THE RECORD, built by the one route helper.
 *  3. A CREATED COMPANY CARRIES ITS SCOPE, its provenance and its search
 *     keys, and opens its own page. A record written without `visibleTo` is
 *     seen by nobody — an absent array matches no predicate — which is the
 *     failure that presents as "I created it and it is not there".
 *
 * The grid is stubbed to a plain table: what is under test is the query
 * and the write, not MUI's data grid.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import CrmConsolePage from './crm-console-page'
import { CRM_CONSOLE_SECTIONS } from './crm-console-sections'
import { crmRoutes } from '../model/crm-routes'

/** Every clause a built query carries, in order. */
interface Clause {
  kind: string
  args: unknown[]
}
interface BuiltQuery {
  path: string
  clauses: Clause[]
}

let built: BuiltQuery[] = []
const pushes: string[] = []
const written: Array<{ path: string; data: Record<string, unknown> }> = []

const COMPANY_ROWS = [
  { $id: 'c-acme', name: 'Acme', domain: 'acme.com', ownerUid: 'uid-1' },
  { $id: 'c-globex', name: 'Globex', ownerUid: 'uid-2' },
]

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    clauses: [] as Clause[],
  }),
  query: (base: BuiltQuery, ...clauses: Clause[]) => ({
    ...base,
    clauses: [...base.clauses, ...clauses],
  }),
  where: (...args: unknown[]): Clause => ({ kind: 'where', args }),
  orderBy: (...args: unknown[]): Clause => ({ kind: 'orderBy', args }),
  limit: (...args: unknown[]): Clause => ({ kind: 'limit', args }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  // The create drawer measures the records band on open (AGL-2611): three
  // aggregates, all empty here, so nothing below is refused at a band.
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  setDoc: jest.fn(async (ref: { path: string }, data: Record<string, unknown>) => {
    written.push({ path: ref.path, data })
  }),
  updateDoc: jest.fn(),
  deleteField: () => ({ op: 'delete' }),
  serverTimestamp: () => ({ op: 'serverTimestamp' }),
}))

const FIRESTORE = {}
// One object for the session, as the real hook hands back.
const USER = { uid: 'uid-1', getIdToken: async () => 'token' }
const DATA_SCOPE = { scope: ['orgs', 'org-1'] as const, orgId: 'org-1', ready: true }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  listFilterConstraints: jest.requireActual('@aglyn/tenant-feature-instance')
    .listFilterConstraints,
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => DATA_SCOPE,
  useUser: () => ({ data: USER }),
  // The drawer logs the add to the site's activity feed (AGL-2622); the feed is not under test.
  useHostActivityLogger: () => jest.fn(),
  // The reader's reach, for the views control's "may edit" (AGL-2617).
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  usePagedCollection: (build: (pageLimit: number) => BuiltQuery | null) => {
    const spec = build(11)
    if (spec) built.push(spec)
    return {
      rows: spec ? COMPANY_ROWS : [],
      data: COMPANY_ROWS,
      status: 'success',
      fromCache: false,
      hasMore: false,
      page: 0,
      setPage: jest.fn(),
      pageSize: 10,
      setPageSize: jest.fn(),
    }
  },
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
  useFirestoreDoc: () => ({ data: null, status: 'loading', fromCache: true }),
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async () => ({
    ok: true,
    json: async () => ({
      members: [
        { $id: 'uid-1', displayName: 'Ada Lovelace', email: 'ada@example.test' },
        { $id: 'uid-2', email: 'grace@example.test' },
      ],
    }),
  }),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => pushes.push(href), replace: jest.fn() }),
  usePathname: () => '/',
  // The views control reads the address for `?view=` (AGL-2617); none here.
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-next', () => ({
  HubSections: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/navigation-drawer.component', () => ({
  NavigationDrawerComponent: ({
    open,
    children,
  }: {
    open: boolean
    children: ReactNode
  }) => (open ? <div>{children}</div> : null),
}))
jest.mock('@aglyn/shared-ui-jsx/components/list-pagination.component', () => ({
  ListPagination: () => null,
}))
/*
 * The grid, as a plain table: one row per record, opened by a button that
 * calls `onOpen` with the row's id — which is the contract the section relies
 * on, and all of the grid this spec is about.
 */
jest.mock('@aglyn/shared-ui-jsx/components/list-table.component', () => ({
  ListTable: ({
    rows,
    onOpen,
  }: {
    rows: Array<{ $id: string; name: string }>
    onOpen: (id: string) => void
  }) => (
    <ul>
      {rows.map((row) => (
        <li key={row.$id}>
          <button type="button" onClick={() => onOpen(row.$id)}>
            {row.name}
          </button>
        </li>
      ))}
    </ul>
  ),
}))

const BASE_PATH = '/acme/hosts/shop/crm'
const routes = crmRoutes(BASE_PATH)

const mount = () =>
  render(
    <CrmConsolePage
      hostId="host-1"
      entitled
      org={{ $id: 'org-1' } as any}
      basePath={BASE_PATH}
      sections={CRM_CONSOLE_SECTIONS.map((section) => ({
        id: section.id,
        label: section.label,
        href: `${BASE_PATH}/${section.id}`,
        visible: true,
      }))}
      section="companies"
      segments={['companies']}
    />,
  )

const field = (label: string) =>
  screen.getByLabelText(label, { exact: false }) as HTMLInputElement

beforeEach(() => {
  built = []
  pushes.length = 0
  written.length = 0
})

describe('the Companies section (AGL-2597)', () => {
  it('lists under the scope predicate, newest activity first, and paged', () => {
    mount()

    const listener = built.find((spec) => spec.path === 'orgs/org-1/companies')
    expect(listener).toBeDefined()
    const clauses = listener?.clauses ?? []
    expect(clauses).toContainEqual({
      kind: 'where',
      args: ['visibleTo', 'array-contains-any', ['org', 'host:host-1']],
    })
    expect(clauses).toContainEqual({ kind: 'orderBy', args: ['updatedAt', 'desc'] })
    expect(clauses).toContainEqual({ kind: 'limit', args: [11] })
  })

  it('opens a row at the address the route helper builds', () => {
    mount()

    fireEvent.click(screen.getByText('Acme'))
    expect(pushes).toEqual([routes.company('c-acme')])
  })

  it('creates a company that carries its scope, provenance and search keys', async () => {
    mount()

    await act(async () => {
      fireEvent.click(screen.getAllByText('New company')[0])
    })
    await act(async () => {
      fireEvent.change(field('Name'), { target: { value: 'Acme Coffee' } })
      fireEvent.change(field('Domain'), {
        target: { value: 'https://www.Acme.com/about' },
      })
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Create company'))
    })

    await waitFor(() => expect(written).toHaveLength(1))
    const [{ path, data }] = written
    expect(path.startsWith('orgs/org-1/companies/')).toBe(true)
    expect(data).toMatchObject({
      name: 'Acme Coffee',
      nameLower: 'acme coffee',
      domain: 'acme.com',
      // A group of one creates for its own site — the agency's isolation,
      // arrived at with nothing configured.
      visibleTo: ['host:host-1'],
      hostId: 'host-1',
      createdByUid: 'uid-1',
      // The person filing it owns it until somebody says otherwise.
      ownerUid: 'uid-1',
      createdAt: { op: 'serverTimestamp' },
      updatedAt: { op: 'serverTimestamp' },
    })
    expect(data['nameTokens']).toEqual(expect.arrayContaining(['cof', 'acme']))
    // And the new record's page opens.
    const id = path.slice('orgs/org-1/companies/'.length)
    expect(pushes).toEqual([routes.company(id)])
  })

  it('refuses a domain that is not one, and writes nothing', async () => {
    mount()

    await act(async () => {
      fireEvent.click(screen.getAllByText('New company')[0])
    })
    await act(async () => {
      fireEvent.change(field('Name'), { target: { value: 'Acme' } })
      fireEvent.change(field('Domain'), { target: { value: 'acme' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Create company'))
    })

    expect(written).toHaveLength(0)
    // The refusal is the ALERT beside the button — the drawer's own intro
    // also says "bare hostname", so the role is what tells them apart.
    expect(screen.getByRole('alert').textContent).toMatch(/bare hostname/)
  })
})
