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
 * The glance card's fifth figure is the leads still to work (AGL-2624), and
 * it is a SUBTRACTION of two server counts: every lead on the site, less
 * the ones whose status says they are closed. A lead nobody has touched
 * carries no status field, so no query can select the open ones directly —
 * a count of `status in [new, working]` would read 0 on a site whose every
 * lead is untouched, which is the site the figure exists for.
 */

import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CrmGlanceCard } from './crm-glance-card'
import { resetAggregateReadCache } from './reports/use-aggregate-read'

type Clause = { field: string; op: string; value: unknown }
type FakeQuery = { path: string; clauses: Clause[] }

const counts = { leads: 7, closedLeads: 2 }

/*
 * One Firestore and one scope tuple for the whole run, the way the real
 * hooks hand them back: both are query dependencies of the card's read, and
 * a mock that minted a fresh object per render would re-fire the read on
 * every render — the read's own "loading" state is a new object each time,
 * so the card would never settle.
 */
const firestore = {}
const orgScope = ['orgs', 'org-1'] as const

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => firestore,
  useConsoleHostRoute: () => ({ base: '/acme/hosts/site-1' }),
  useOrgPlan: () => ({ org: null, ready: true }),
  useOrgDataScope: () => ({ scope: orgScope, orgId: 'org-1', ready: true }),
}))
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]): FakeQuery => ({
    path: segments.join('/'),
    clauses: [],
  }),
  where: (field: string, op: string, value: unknown): Clause => ({ field, op, value }),
  query: (base: FakeQuery, ...clauses: Array<Clause | undefined>): FakeQuery => ({
    path: base.path,
    clauses: [...base.clauses, ...clauses.filter((c): c is Clause => Boolean(c))],
  }),
  getCountFromServer: jest.fn(async (target: FakeQuery) => {
    let count = 0
    if (target.path === 'hosts/site-1/leads') {
      const status = target.clauses.find((clause) => clause.field === 'status')
      count = status ? counts.closedLeads : counts.leads
    }
    return { data: () => ({ count }) }
  }),
  getAggregateFromServer: jest.fn(async () => ({ data: () => ({ amountCents: 0 }) })),
}))
jest.mock('@aglyn/shared-ui-email-campaigns/components/report-figures', () => ({
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  CardDisplay: ({ header, children }: { header: ReactNode; children: ReactNode }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
}))

beforeEach(() => {
  resetAggregateReadCache()
  jest.clearAllMocks()
})

describe('CrmGlanceCard leads to work', () => {
  it('shows every lead less the closed ones, linked to the leads section', async () => {
    render(<CrmGlanceCard hostId="site-1" />)
    const tile = await screen.findByText('Leads to work')
    expect(tile).toBeTruthy()
    await waitFor(() => expect(screen.getByText('5')).toBeTruthy())
    const link = screen.getByText('5').closest('a')
    expect(link?.getAttribute('href')).toBe('/acme/hosts/site-1/crm/leads')
  })

  it('subtracts only the statuses that mean closed', async () => {
    const { getCountFromServer } = jest.requireMock('firebase/firestore') as {
      getCountFromServer: jest.Mock
    }
    render(<CrmGlanceCard hostId="site-1" />)
    await waitFor(() => expect(screen.getByText('5')).toBeTruthy())
    const leadQueries: FakeQuery[] = getCountFromServer.mock.calls
      .map(([target]: [FakeQuery]) => target)
      .filter((target: FakeQuery) => target.path === 'hosts/site-1/leads')
    expect(leadQueries).toHaveLength(2)
    const closed = leadQueries.find((target) => target.clauses.length)
    expect(closed?.clauses).toEqual([
      { field: 'status', op: 'in', value: ['qualified', 'unqualified'] },
    ])
  })
})
