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
 * The collaborator roster's search and Site access filter reach its QUERY
 * (AGL-3321): a search is a range on the stored address beneath the
 * roster's email order, not a narrowing of the page on screen.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

/** A built query, as the doubles below spell it: its path and constraints. */
type MockQuery = { path: string; constraints: unknown[] }

/** Every query the card handed its pager, newest last. */
const mockBuilt: MockQuery[] = []

const mockMemberRows = [
  { $id: 'm-1', uid: 'uid-1', email: 'ann@example.test', role: 'author' },
  { $id: 'm-2', uid: 'uid-2', email: 'bo@example.test', role: 'editor' },
]

/**
 * The clauses the Filters panel would hold, set directly: the free grid's
 * panel is not something jsdom can drive. Undefined leaves the hook its own.
 */
let mockClauses: Array<{ field: string; op: string; value: string }> | undefined

jest.mock('@aglyn/shared-ui-jsx/hooks/use-list-grid-filter', () => {
  const actual = jest.requireActual('@aglyn/shared-ui-jsx/hooks/use-list-grid-filter')
  const useListGridFilter = (options: Record<string, unknown>) =>
    actual.useListGridFilter(
      mockClauses ? { ...options, clauses: mockClauses, onChange: () => undefined } : options,
    )
  return { __esModule: true, useListGridFilter, default: useListGridFilter }
})

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string, ...constraints: unknown[]) => ({ path, constraints }),
  where: (path: unknown, op: string, value: unknown) => ['where', path, op, value],
  orderBy: (path: string, direction?: string) => ['orderBy', path, direction ?? 'asc'],
  limit: (value: number) => ['limit', value],
  documentId: () => '__name__',
  getCountFromServer: jest.fn(() => Promise.resolve({ data: () => ({ count: 2 }) })),
}))

/**
 * ONE Firestore double, held. The count effect keys on the instance the
 * way the real hook's stable instance lets it; a fresh `{}` per call would
 * re-send the aggregate on every render the card's other reads cause.
 */
const mockFirestore = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  useUser: () => ({ data: { uid: 'admin-1', getIdToken: async () => 'tok' } }),
  /*
   * Modelled rather than stubbed. The card's whole defect was a PAGE of rows
   * presented as the site's seat usage, so a double that handed back every
   * staged row would erase the distinction this file exists to guard.
   */
  usePagedCollection: (
    build: (pageLimit: number) => unknown,
    _deps: unknown,
    options: { pageSize?: number } = {},
  ) => {
    const pageSize = options.pageSize ?? 10
    mockBuilt.push(build(pageSize + 1) as MockQuery)
    return {
      rows: mockMemberRows,
      hasMore: false,
      page: 0,
      setPage: () => undefined,
      pageSize,
      setPageSize: () => undefined,
      data: mockMemberRows,
      status: 'success',
      error: undefined,
      fromCache: false,
      serverDenied: false,
    }
  },
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
jest.mock('../hooks/use-org-scope', () => {
  // The collaborator columns zone (AGL-2940) reaches the org scope through
  // the plugin gate; one held object, never rebuilt per call (AGL-2105).
  const scope = {
    orgs: [],
    currentOrg: null,
    selectOrg: () => undefined,
    orgSlug: 'acme',
    pathOrgSlug: 'acme',
    loading: false,
    confirmed: true,
    slugExists: true,
    error: false,
    retry: () => undefined,
    hasMoreOrgs: false,
    loadMoreOrgs: () => undefined,
  }
  return { __esModule: true, useOrgSlug: () => 'acme', useOrgScope: () => scope, default: () => scope }
})
// The plugin column zone (AGL-2940) asks which plugins the workspace runs.
jest.mock('./console-plugins-gate.component', () => ({
  __esModule: true,
  useEnabledPluginIds: () => [],
  // No workspace to load plugins for (AGL-3142): this file's registry is a
  // double, so a zone or a route here draws from it rather than fetching a
  // plugin's code, and the loading hooks are settled at once.
  usePluginLoadScope: () => ({ orgId: null, user: undefined }),
}))
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
  default: () => ({ data: [] }),
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

jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

import HostMembersCard from './host-members-card.component'

const lastRosterQuery = () =>
  [...mockBuilt].reverse().find((built) => built.path === 'hosts/host-1/members')

beforeEach(() => {
  mockBuilt.length = 0
  mockClauses = undefined
})

describe('the collaborator roster filters through its query (AGL-3321)', () => {
  it('reads the roster by address, unfiltered, with the toolbar on', async () => {
    render(<HostMembersCard hostId="host-1" />)
    expect(lastRosterQuery()?.constraints).toEqual([
      ['orderBy', 'email', 'asc'],
      ['limit', 11],
    ])
    expect(screen.getByRole('grid', { name: 'Site collaborators' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Filters/ })).toBeTruthy()
    expect(screen.getByRole('searchbox')).toBeTruthy()
    await act(async () => undefined)
  })

  it('counts the pinned owner row in the footer, once', async () => {
    render(<HostMembersCard hostId="host-1" />)
    // Two roster rows and the owner above them: three on screen, three counted.
    expect(screen.getByText('1–3 of 3')).toBeTruthy()
    await act(async () => undefined)
  })

  it('serves a search as a range on the stored address, beneath the same order', async () => {
    render(<HostMembersCard hostId="host-1" />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Ann' } })
    await waitFor(() =>
      expect(lastRosterQuery()?.constraints).toEqual([
        ['where', 'email', '>=', 'ann'],
        ['where', 'email', '<=', 'ann\uf8ff'],
        ['orderBy', 'email', 'asc'],
        ['limit', 11],
      ]),
    )
  })

  it('serves Site access as an equality on the stored role, beneath the same order', async () => {
    mockClauses = [{ field: 'role', op: 'equals', value: 'author' }]
    render(<HostMembersCard hostId="host-1" />)
    expect(lastRosterQuery()?.constraints).toEqual([
      ['where', 'role', '==', 'author'],
      ['orderBy', 'email', 'asc'],
      ['limit', 11],
    ])
    // The clause shows as a chip, by the role's label.
    expect(screen.getByText('Site access is Author')).toBeTruthy()
    // The owner's row reads Admin, so an Author filter leaves it out.
    const grid = screen.getByRole('grid', { name: 'Site collaborators' })
    expect(grid.textContent).not.toContain('Owner')
    await act(async () => undefined)
  })

  it('serves several roles and a search together', async () => {
    mockClauses = [{ field: 'role', op: 'isAnyOf', value: 'viewer,admin' }]
    render(<HostMembersCard hostId="host-1" />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bo' } })
    await waitFor(() =>
      expect(lastRosterQuery()?.constraints).toEqual([
        ['where', 'role', 'in', ['viewer', 'admin']],
        ['where', 'email', '>=', 'bo'],
        ['where', 'email', '<=', 'bo\uf8ff'],
        ['orderBy', 'email', 'asc'],
        ['limit', 11],
      ]),
    )
  })

  it('keeps the Add form, the role pickers and each row\'s Remove', async () => {
    render(<HostMembersCard hostId="host-1" />)
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2)
    const grid = screen.getByRole('grid', { name: 'Site collaborators' })
    expect(grid.textContent).toContain('ann@example.test')
    expect(grid.textContent).toContain('Owner')
    await act(async () => undefined)
  })
})
