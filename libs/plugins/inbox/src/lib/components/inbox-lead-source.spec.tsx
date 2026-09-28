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
 * The writers keep `sources` now — every surface that captured the person,
 * `arrayUnion`ed by `addHostLead` — and a lead written before it carries the
 * one `source` it came in by; the Source column reads either.
 *
 * WHAT THIS CATCHES. Two leads from two different sources must render two
 * different chips. A page printing a constant, or the first row's source
 * beside every row, looks right in a screenshot and is wrong for every row but
 * one — so the fixture below is deliberately heterogeneous, and the negative
 * control proves a row with no source still renders rather than printing
 * `undefined`.
 */

import { act, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { InboxConsolePage } from './inbox-console-page'
import { INBOX_CONSOLE_SECTIONS } from './inbox-console-sections'

/** Collection contents by collection NAME, as the page's queries address them. */
let collections: Record<string, Array<Record<string, unknown>>>

jest.mock('@aglyn/tenant-feature-instance', () => ({
  // The lead silo is the org's (AGL-3275), so these cards resolve it.
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  useFirestore: () => ({}),
  // The signed-in account a member removal is authorized as (AGL-3308).
  useUser: () => ({ data: null }),
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useFirestoreDoc: () => ({
    data: undefined,
    status: 'success',
    fromCache: false,
  }),
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    __name: segments[segments.length - 1],
  }),
  doc: (_db: unknown, ...segments: string[]) => segments[segments.length - 1],
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

// Each list's query, answered by the shared double over the collection the
// card opened — routed by collection NAME, exactly as Firestore would. One
// shared blob would hand the leads table the members and pass on data the
// real reads can never produce.
jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () => {
  const actual = jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query')
  const { useListQueryDouble } = jest.requireActual(
    '@aglyn/tenant-feature-instance/testing/list-query-double',
  )
  return {
    ...actual,
    useListQuery: (options: { collection: { __name: string } | null }) =>
      useListQueryDouble(() => collections[options.collection?.__name ?? ''] ?? [], options),
  }
})

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))
// The rail's chrome, passed through (AGL-2501). Sections are routes now, so
// the page builds ONE section's body and the URL says which — no stub can make
// a closed section render, and this spec names the section it is about.
jest.mock('@aglyn/shared-ui-next', () => ({
  HubSections: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const BASE_PATH = '/acme/hosts/shop/inbox'

/**
 * The Members & leads section, as the shell mounts it. Named rather than
 * defaulted: the leads table is not the section a bare `/inbox` lands on, and
 * a render that opened the wrong one would make every assertion below vacuous.
 */
const renderPage = () =>
  render(
    <InboxConsolePage
      hostId="host-1"
      entitled
      basePath={BASE_PATH}
      sections={INBOX_CONSOLE_SECTIONS.map((section) => ({
        id: section.id,
        label: section.label,
        href: `${BASE_PATH}/${section.id}`,
        visible: true,
      }))}
      section="contacts"
      segments={['contacts']}
    />,
  )

beforeEach(() => {
  collections = {}
})

/** The Leads list of the section: Members is the one it opens on. */
const renderLeads = async () => {
  const view = renderPage()
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'Leads' }))
  })
  return view
}

describe('AGL-2338 · the inbox says where each lead came from', () => {
  it('renders EACH lead’s own source, not one constant', async () => {
    collections.leads = [
      {
        $id: 'l-1',
        email: 'dana@example.com',
        name: 'Dana Reed',
        sources: ['booking'],
        visibleTo: ['host:host-1'],
        createdAt: { seconds: 2 },
      },
      {
        // Written before `sources`: the one surface it came in by.
        $id: 'l-2',
        email: 'sam@example.com',
        name: 'Sam Okafor',
        source: 'signup',
        visibleTo: ['host:host-1'],
        createdAt: { seconds: 1 },
      },
    ]
    const text = (await renderLeads()).container.textContent ?? ''
    // Both, from their own rows. A page rendering a constant — or the first
    // row's source beside every row — cannot produce both strings.
    expect(text).toContain('Booking')
    expect(text).toContain('Sign-up')
  })

  it('shows the lead’s name beside the address', async () => {
    // The AGL-2303 half: a list of bare addresses is a list nobody recognises
    // anyone in, and the writers now store the name the person typed.
    collections.leads = [
      {
        $id: 'l-1',
        email: 'dana@example.com',
        name: 'Dana Reed',
        sources: ['booking'],
        visibleTo: ['org'],
        createdAt: { seconds: 1 },
      },
    ]
    const text = (await renderLeads()).container.textContent ?? ''
    expect(text).toContain('dana@example.com')
    expect(text).toContain('Dana Reed')
  })

  it('NEGATIVE CONTROL: a row written before the field renders no source', async () => {
    // Not `undefined`, and not an empty chip. A lead recorded before AGL-109,
    // or by a future writer that omits the field, is still a lead.
    collections.leads = [
      { $id: 'l-1', email: 'old@example.com', visibleTo: ['org'], createdAt: { seconds: 1 } },
    ]
    const view = await renderLeads()
    const text = view.container.textContent ?? ''
    expect(text).toContain('old@example.com')
    expect(text).not.toContain('undefined')
    expect(view.container.querySelectorAll('[data-field="sources"] .MuiChip-root')).toHaveLength(0)
  })

  it('a lead who became a member is in both lists, each as what it is there', async () => {
    // Two paged collections cannot be deduped against each other (AGL-3321):
    // the person is a member in Members and a lead in Leads, which is what
    // each collection holds.
    collections.leads = [
      {
        $id: 'l-1',
        email: 'dana@example.com',
        sources: ['signup'],
        visibleTo: ['host:host-1'],
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
    const view = renderPage()
    expect(view.getByRole('grid', { name: 'Site members' }).textContent).toContain(
      'dana@example.com',
    )
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Leads' }))
    })
    const leads = view.getByRole('grid', { name: 'Leads' }).textContent ?? ''
    expect(leads).toContain('dana@example.com')
    expect(leads).toContain('Sign-up')
  })
})
