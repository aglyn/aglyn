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
 * The tasks-due card's two mounts (AGL-2636): under a site its two reads
 * filter on the site's own group's tokens, and beneath the org hub's mount
 * they filter on nothing — the reader is an org-wide member, and a clause
 * would only narrow what the rules already admit. The card is one component,
 * so what this pins is the CLAUSE each mount emits and the link each mount
 * builds: a card that kept the site clause at the org level would list one
 * site's tasks under the organization's name, and one that dropped it under
 * a site would be refused by the rules and read as "the card is broken".
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CrmOrgMountProvider } from '../hooks/use-crm-org-mount'
import { CrmTasksDueCard } from './crm-tasks-due-card'

type Clause = { field: string; op: string; value: unknown }
type FakeQuery = { path: string; clauses: Clause[] }

const DAY_MS = 24 * 60 * 60 * 1000
const UID = 'uid-1'
/*
 * One Firestore and one scope tuple for the run, as the real hooks hand them
 * back — both are query dependencies, and a fresh object per render would
 * re-open the reads on every render.
 */
const firestore = {}
const ORG_SCOPE = ['orgs', 'org-1'] as const

/** Whether the organization has any open task at all — the probe's answer. */
let anyOpenTask = true
/** Every query the card built, in the order it built them. */
let built: FakeQuery[] = []

const MINE = [
  {
    $id: 't-overdue',
    title: 'Call Maya about the decaf',
    status: 'open',
    kind: 'call',
    assigneeUid: UID,
    dueAtMs: Date.now() - DAY_MS,
  },
  {
    $id: 't-later',
    title: 'Send Theo the catalog',
    status: 'open',
    kind: 'email',
    assigneeUid: UID,
    dueAtMs: Date.now() + 7 * DAY_MS,
  },
]

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => firestore,
  useUser: () => ({ data: { uid: UID } }),
  // A site's org is `org-1`; an explicit org is itself; neither is no org.
  useOrgDataScope: (options: { hostId?: string; orgId?: string }) => {
    const orgId = options.orgId ?? (options.hostId ? 'org-1' : undefined)
    return { orgId, ready: true, scope: orgId ? ORG_SCOPE : null }
  },
  useFirestoreCollection: (build: () => FakeQuery | null) => {
    const target = build()
    if (!target) return { data: [], status: 'loading', fromCache: false }
    built.push(target)
    const mine = target.clauses.some((clause) => clause.field === 'assigneeUid')
    return {
      data: mine ? MINE : anyOpenTask ? [MINE[0]] : [],
      status: 'success',
      fromCache: false,
    }
  },
}))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]): FakeQuery => ({
    path: segments.join('/'),
    clauses: [],
  }),
  where: (field: string, op: string, value: unknown): Clause => ({ field, op, value }),
  orderBy: () => undefined,
  limit: () => undefined,
  query: (base: FakeQuery, ...clauses: Array<Clause | undefined>): FakeQuery => ({
    path: base.path,
    clauses: [...base.clauses, ...clauses.filter((c): c is Clause => Boolean(c))],
  }),
}))
jest.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'acme', host: 'site-1' }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  CardDisplay: ({
    header,
    children,
    HeaderProps,
  }: {
    header: ReactNode
    children: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <section>
      <h2>{header}</h2>
      {HeaderProps?.action}
      {children}
    </section>
  ),
}))
jest.mock('./task-cells', () => ({
  TaskKindCell: ({ kind }: { kind: string }) => <i>{kind}</i>,
  TaskDueText: () => <small>due</small>,
}))

beforeEach(() => {
  anyOpenTask = true
  built = []
})

const visibleToOf = (target: FakeQuery) =>
  target.clauses.filter((clause) => clause.field === 'visibleTo')
const viewAllHref = () => screen.getByText('View all').closest('a')?.getAttribute('href')

describe('CrmTasksDueCard', () => {
  it('under a site filters both reads on the site group tokens and links into the site hub', () => {
    render(<CrmTasksDueCard hostId="site-1" />)
    expect(screen.getByText('Tasks due')).toBeTruthy()
    // The probe and the reader's own list, on the org's tasks collection.
    expect(built).toHaveLength(2)
    for (const target of built) {
      expect(target.path).toBe('orgs/org-1/crmTasks')
      expect(visibleToOf(target)).toEqual([
        { field: 'visibleTo', op: 'array-contains-any', value: ['org', 'host:site-1'] },
      ])
    }
    expect(viewAllHref()).toBe('/acme/hosts/site-1/crm/tasks')
  })

  it('at the organization level reads with no scope clause and links into the org hub (AGL-2636)', () => {
    render(
      <CrmOrgMountProvider
        mount={{
          orgId: 'org-1',
          hosts: [
            { id: 'site-1', name: 'One', subdomain: 'one' },
            { id: 'site-2', name: 'Two', subdomain: 'two' },
          ],
          hostsReady: true,
          hostsPath: '/acme/hosts',
        }}
      >
        <CrmTasksDueCard hostId={null} basePath="/acme/crm" />
      </CrmOrgMountProvider>,
    )
    expect(screen.getByText('Tasks due')).toBeTruthy()
    expect(built).toHaveLength(2)
    for (const target of built) {
      // The org from the mount, and NO `visibleTo` clause on either read.
      expect(target.path).toBe('orgs/org-1/crmTasks')
      expect(visibleToOf(target)).toEqual([])
    }
    // The reader's list is still the reader's: assignee and status stay.
    const mine = built.find((target) =>
      target.clauses.some((clause) => clause.field === 'assigneeUid'),
    )
    expect(mine?.clauses).toEqual([
      { field: 'assigneeUid', op: '==', value: UID },
      { field: 'status', op: '==', value: 'open' },
    ])
    // One overdue, and the next-up list names it.
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('Call Maya about the decaf')).toBeTruthy()
    expect(viewAllHref()).toBe('/acme/crm/tasks')
  })

  it('renders nothing at the organization level when no site has an open task', () => {
    anyOpenTask = false
    const { container } = render(
      <CrmOrgMountProvider
        mount={{ orgId: 'org-1', hosts: [], hostsReady: true, hostsPath: '/acme/hosts' }}
      >
        <CrmTasksDueCard hostId={null} basePath="/acme/crm" />
      </CrmOrgMountProvider>,
    )
    expect(container.innerHTML).toBe('')
  })
})
