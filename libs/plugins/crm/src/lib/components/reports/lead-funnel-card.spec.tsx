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
 * The lead funnel at the ORGANIZATION level (AGL-2634): every site the
 * mount lists, one bounded window each, totaled — and the caption says the
 * bound is per site when any site had more than its window.
 */

import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CrmOrgMountProvider } from '../../hooks/use-crm-org-mount'
import { crmRoutes } from '../../model/crm-routes'
import { LEAD_CEILING, LeadFunnelCard } from './lead-funnel-card'
import type { CrmReportScope } from './report-scope'
import { resetAggregateReadCache } from './use-aggregate-read'

type Clause = { field: string; op: string; value: unknown }
type FakeQuery = { path: string; clauses: Clause[]; limit?: number }

/** Each site's leads in the period, as documents. */
let leadsBySite: Record<string, Array<Record<string, unknown>>> = {}

const firestore = {}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => firestore,
}))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]): FakeQuery => ({
    path: segments.join('/'),
    clauses: [],
  }),
  where: (field: string, op: string, value: unknown): Clause => ({ field, op, value }),
  orderBy: () => undefined,
  limit: (value: number) => ({ field: '__limit', op: 'limit', value }),
  query: (base: FakeQuery, ...clauses: Array<Clause | undefined>): FakeQuery => ({
    path: base.path,
    clauses: [...base.clauses, ...clauses.filter((c): c is Clause => Boolean(c))],
  }),
  getCountFromServer: async (target: FakeQuery) => {
    const site = target.path.split('/')[1]
    const from = Number(target.clauses.find((c) => c.op === '>=')?.value ?? 0)
    const rows = (leadsBySite[site] ?? []).filter((row) => Number(row['firstSeenAtMs']) >= from)
    return { data: () => ({ count: rows.length }) }
  },
  getDocs: async (target: FakeQuery) => {
    const site = target.path.split('/')[1]
    const max = Number(target.clauses.find((c) => c.op === 'limit')?.value ?? Infinity)
    const rows = (leadsBySite[site] ?? []).slice(0, max)
    return { docs: rows.map((row, index) => ({ id: `lead-${index}`, data: () => row })) }
  },
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  CardDisplay: ({
    header,
    subheader,
    children,
  }: {
    header: ReactNode
    subheader?: ReactNode
    children: ReactNode
  }) => (
    <section>
      <h2>{header}</h2>
      {subheader ? <p>{subheader}</p> : null}
      {children}
    </section>
  ),
}))
jest.mock('@aglyn/shared-ui-jsx/components/measured-figures.component', () => ({
  percent: (value: number) => `${Math.round(value * 100)}%`,
  Section: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h3>{title}</h3>
      {children}
    </div>
  ),
}))
jest.mock('./report-export', () => ({
  ReportExport: ({ caption }: { caption?: string }) => (
    <p data-testid="caption">{caption ?? ''}</p>
  ),
}))

const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000
const report: CrmReportScope = {
  scope: ['orgs', 'org-1'],
  tokens: null,
  groupId: null,
  org: null,
  period: '30d',
  range: {
    from: NOW - 30 * DAY,
    to: NOW,
    previousFrom: NOW - 60 * DAY,
    previousTo: NOW - 30 * DAY,
  } as CrmReportScope['range'],
  nowMs: NOW,
  routes: crmRoutes('/acme/crm'),
}

const lead = (status: string | undefined, ageDays = 1, reason?: string) => ({
  firstSeenAtMs: NOW - ageDays * DAY,
  ...(status ? { status } : {}),
  ...(reason ? { unqualifiedReason: reason } : {}),
})

function orgMount(hosts: Array<{ id: string; name: string; subdomain: string }>) {
  return function Mount({ children }: { children: ReactNode }) {
    return (
      <CrmOrgMountProvider
        mount={{ orgId: 'org-1', hosts, hostsReady: true, hostsPath: '/acme/hosts' }}
      >
        {children}
      </CrmOrgMountProvider>
    )
  }
}

const TWO_SITES = [
  { id: 'site-1', name: 'One', subdomain: 'one' },
  { id: 'site-2', name: 'Two', subdomain: 'two' },
]

beforeEach(() => {
  resetAggregateReadCache()
  leadsBySite = {}
})

describe('LeadFunnelCard at the organization level', () => {
  it('totals every site’s captured count and places every site’s window', async () => {
    leadsBySite = {
      'site-1': [lead('qualified'), lead(undefined), lead('unqualified', 2, 'No budget')],
      'site-2': [lead('working'), lead('qualified', 3)],
    }
    render(<LeadFunnelCard report={report} hostId={null} />, { wrapper: orgMount(TWO_SITES) })
    expect(screen.getByText('Every site (2)')).toBeTruthy()
    // 3 + 2 captured; 2 qualified across both; 1 unqualified; 2 still open.
    await waitFor(() => expect(screen.getByText('5')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('No budget')).toBeTruthy())
    expect(screen.getByText('40% of those captured')).toBeTruthy()
    expect(screen.getByTestId('caption').textContent).toBe('')
  })

  it('says the window is per site when one site had more than its window', async () => {
    leadsBySite = {
      'site-1': Array.from({ length: LEAD_CEILING + 1 }, (_, index) => lead('working', index % 20)),
      'site-2': [lead('qualified')],
    }
    render(<LeadFunnelCard report={report} hostId={null} />, { wrapper: orgMount(TWO_SITES) })
    await waitFor(() =>
      expect(screen.getByTestId('caption').textContent).toContain(
        `Placed from the ${LEAD_CEILING + 1} most recently captured leads across 2 sites — at most ${LEAD_CEILING} per site`,
      ),
    )
  })

  it('says so when the organization has no sites to read', () => {
    render(<LeadFunnelCard report={report} hostId={null} />, { wrapper: orgMount([]) })
    expect(screen.getByText(/has no sites yet/)).toBeTruthy()
  })
})
