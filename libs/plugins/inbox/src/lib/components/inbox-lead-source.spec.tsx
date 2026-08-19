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
 * A LEAD SAYS WHERE IT CAME FROM (AGL-2338).
 *
 * Both lead writers have stored `source` since AGL-109 — `'signup'` from
 * `membership-register`, `'booking'` from the bookings handler — and nothing
 * read it. Every row rendered the same flat "Lead" chip, so a site owner could
 * not tell a membership sign-up from a booking, and the campaign audience
 * selector treated them alike. Lead attribution collected and invisible: the
 * written-and-never-read shape, on the one field a site owner would use to
 * decide where to spend.
 *
 * `name` is the same row's other half (AGL-2303) — the writers only began
 * storing it once `campaign-send` was found reading it with nobody writing it.
 *
 * WHAT THIS CATCHES. Two leads from two different sources must render two
 * different chips. A page printing a constant, or the first row's source
 * beside every row, looks right in a screenshot and is wrong for every row but
 * one — so the fixture below is deliberately heterogeneous, and the negative
 * control proves a pre-AGL-109 row still renders rather than printing a
 * dangling separator.
 */

import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { InboxConsolePage } from './inbox-console-page'

/** Collection contents by collection NAME, as the page's queries address them. */
let collections: Record<string, Array<Record<string, unknown>>>

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  // Routed by the collection the factory addresses, exactly as Firestore
  // would. One shared blob would hand the leads table the form submissions
  // and pass on data the real reads can never produce.
  useFirestoreCollection: (factory: () => string) => ({
    data: collections[factory()] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useFirestoreDoc: () => ({
    data: undefined,
    status: 'success',
    fromCache: false,
  }),
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  orderBy: () => undefined,
  where: () => undefined,
  doc: (_db: unknown, ...segments: string[]) => segments[segments.length - 1],
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))
// EVERY tab's content, unlike the paused-notice spec's first-tab stub: the
// audience table is not the tab the page opens on, and a stub that rendered
// only the first would make every assertion below vacuous.
jest.mock('@aglyn/shared-ui-next', () => ({
  HubTabs: ({ tabs }: { tabs: Array<{ content: ReactNode }> }) => (
    <div>{tabs.map((tab, index) => (
      <div key={index}>{tab.content}</div>
    ))}</div>
  ),
}))
jest.mock('@aglyn/plugins-email', () => ({ CampaignsCard: () => null }))
jest.mock('@aglyn/plugins-commerce', () => ({ HostOrdersCard: () => null }))

const renderPage = () => render(<InboxConsolePage hostId="host-1" entitled />)

beforeEach(() => {
  collections = {}
})

describe('AGL-2338 · the inbox says where each lead came from', () => {
  it('renders EACH lead’s own source, not one constant', () => {
    collections.leads = [
      {
        $id: 'l-1',
        email: 'dana@example.com',
        name: 'Dana Reed',
        source: 'signup',
        createdAt: { seconds: 2 },
      },
      {
        $id: 'l-2',
        email: 'sam@example.com',
        name: 'Sam Okafor',
        source: 'booking',
        createdAt: { seconds: 1 },
      },
    ]
    const text = renderPage().container.textContent ?? ''
    // Both, from their own rows. A page rendering a constant — or the first
    // row's source beside every row — cannot produce both strings.
    expect(text).toContain('Lead · signup')
    expect(text).toContain('Lead · booking')
  })

  it('shows the lead’s name beside the address', () => {
    // The AGL-2303 half: a list of bare addresses is a list nobody recognises
    // anyone in, and the writers now store the name the person typed.
    collections.leads = [
      {
        $id: 'l-1',
        email: 'dana@example.com',
        name: 'Dana Reed',
        source: 'signup',
        createdAt: { seconds: 1 },
      },
    ]
    const text = renderPage().container.textContent ?? ''
    expect(text).toContain('dana@example.com')
    expect(text).toContain('Dana Reed')
  })

  it('NEGATIVE CONTROL: a row written before the field renders a bare chip', () => {
    // Not `Lead · undefined`, and not a dangling separator. A lead recorded
    // before AGL-109, or by a future writer that omits the field, is still a
    // lead.
    collections.leads = [
      { $id: 'l-1', email: 'old@example.com', createdAt: { seconds: 1 } },
    ]
    const text = renderPage().container.textContent ?? ''
    expect(text).toContain('old@example.com')
    expect(text).toContain('Lead')
    expect(text).not.toContain('Lead ·')
    expect(text).not.toContain('undefined')
  })

  it('a lead who became a member is shown once, as the member', () => {
    // The page already de-duplicates by email. Pinned here because the source
    // chip made the two rows visibly different, and a de-duplication that
    // regressed would now show one person twice with two different labels.
    collections.leads = [
      {
        $id: 'l-1',
        email: 'dana@example.com',
        source: 'signup',
        createdAt: { seconds: 1 },
      },
    ]
    collections.siteMembers = [
      {
        $id: 'm-1',
        email: 'dana@example.com',
        displayName: 'Dana Reed',
        createdAt: { seconds: 2 },
      },
    ]
    const text = renderPage().container.textContent ?? ''
    expect(text).toContain('Member')
    expect(text).not.toContain('Lead · signup')
  })
})
