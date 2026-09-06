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
 * A contact's timeline is ONE stream, and logging into it lands in the
 * contact's own scope (AGL-2600).
 *
 * Four things the card must do, each of which the v1 drawer could not:
 *
 *  1. Interleave what the platform captured with what a person logged,
 *     newest first, and say on every row which of the two it is.
 *  2. Read the captured side off THIS holder's facet alone — a second
 *     holder's booking on the shared row must not surface.
 *  3. Write a new activity with the full scope stamp: the tokens the contact
 *     itself would be captured under, the site, the author's uid and name,
 *     and the contact it is filed against.
 *  4. Offer edit and delete to the author and not to a scoped colleague.
 *
 * The listener is stubbed — the merge and the render are the assertions,
 * and the query shape has a pure helper of its own.
 */

import {
  CRM_ACTIVITIES_PER_RECORD_CEILING,
  CRM_ACTIVITY_LOG_FULL_MESSAGE,
} from '@aglyn/aglyn'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { addDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import { ContactTimelineCard } from './contact-timeline-card'

const activityRows = [
  {
    $id: 'act-1',
    kind: 'call',
    body: 'Called about the renewal',
    atMs: 4_000,
    byUid: 'u-2',
    byName: 'Grace Hopper',
    hostId: 'host-1',
    visibleTo: ['host:host-1'],
    contactId: 'con-1',
    outcome: 'Left a voicemail',
    durationMinutes: 5,
  },
  {
    $id: 'act-2',
    kind: 'note',
    body: 'Prefers to be called after lunch',
    atMs: 2_000,
    byUid: 'u-1',
    byName: 'Ada Admin',
    hostId: 'host-1',
    visibleTo: ['host:host-1'],
    contactId: 'con-1',
  },
]

const contact = {
  email: 'ada@example.test',
  facets: {
    'host-1': {
      sources: { form: true, order: true },
      interactions: [
        {
          type: 'form',
          atMs: 3_000,
          summary: 'Submitted the contact form',
          path: '/pricing',
          refId: 'sub-7',
          hostId: 'host-1',
        },
        {
          type: 'order',
          atMs: 1_000,
          summary: 'Placed order #12',
          refId: 'ord-12',
          hostId: 'host-1',
        },
        // Written before the door stamped the site: shown, never linked —
        // even though a booking's page needs no id to be addressed.
        { type: 'booking', atMs: 500, summary: 'An older booking', refId: 'bk-1' },
      ],
    },
    // Another holder's history on the same shared row.
    'host-2': {
      sources: { booking: true },
      interactions: [{ type: 'booking', atMs: 5_000, summary: 'Other client booking' }],
    },
  },
  visibleTo: ['host:host-1', 'host:host-2'],
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  usePagedCollection: () => ({
    data: activityRows,
    rows: activityRows,
    hasMore: false,
    page: 0,
    pageSize: 100,
    setPage: jest.fn(),
    setPageSize: jest.fn(),
    status: 'success',
    fromCache: false,
  }),
  // A SCOPED member, settled: the org-wide fallback must not admit them.
  useScopeTokens: () => ({ tokens: ['host:host-1'], orgWide: false, loaded: true }),
  useUser: () => ({ data: { uid: 'u-1' } }),
  useUserName: () => 'Ada Admin',
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (name: string) => name,
  where: () => undefined,
  orderBy: () => undefined,
  limit: () => undefined,
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  // The per-record ceiling's one aggregate before a log (AGL-2611).
  getCountFromServer: async () => ({ data: () => ({ count: mockLogged }) }),
  addDoc: jest.fn().mockResolvedValue({ id: 'act-3' }),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

/** Activities the record already carries, as the ceiling's aggregate answers. */
let mockLogged = 0
const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  CardDisplay: ({
    header,
    actions,
    children,
  }: {
    header: ReactNode
    actions: ReactNode
    children: ReactNode
  }) => (
    <section>
      <h2>{header}</h2>
      {actions}
      {children}
    </section>
  ),
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'acme', host: 'shop' }),
}))

beforeEach(() => {
  jest.clearAllMocks()
})

const renderCard = () =>
  render(
    <ContactTimelineCard
      hostId="host-1"
      org={{}}
      contactId="con-1"
      contact={contact}
    />,
  )

describe('ContactTimelineCard (AGL-2600)', () => {
  it('draws captured and logged entries as one newest-first stream, each saying which it is', () => {
    const { container } = renderCard()
    const text = container.textContent ?? ''
    const position = (needle: string) => {
      const at = text.indexOf(needle)
      expect(at).toBeGreaterThanOrEqual(0)
      return at
    }
    // 4000 → 3000 → 2000 → 1000, across the two sources.
    expect(position('Called about the renewal')).toBeLessThan(
      position('Submitted the contact form'),
    )
    expect(position('Submitted the contact form')).toBeLessThan(
      position('Prefers to be called after lunch'),
    )
    expect(position('Prefers to be called after lunch')).toBeLessThan(
      position('Placed order #12'),
    )
    // Which is which, on every row.
    expect(screen.getAllByText('Captured')).toHaveLength(3)
    expect(screen.getAllByText('Logged')).toHaveLength(2)
    // The door's label and the entry point, on the captured row.
    expect(screen.getByText('Form')).toBeTruthy()
    expect(screen.getByText(/\/pricing/)).toBeTruthy()
    // How the call went, on the logged row.
    expect(screen.getByText(/Left a voicemail · 5 min/)).toBeTruthy()
    expect(screen.getByText(/Grace Hopper/)).toBeTruthy()
  })

  it("reads THIS holder's facet alone — another holder's booking never surfaces", () => {
    renderCard()
    expect(screen.queryByText('Other client booking')).toBeNull()
  })

  /**
   * A captured entry opens the record the door left (AGL-2622): the
   * submission in the Inbox reader, the order in its dialog. Only an entry
   * stamped with THIS site links — a sibling site's record is read on that
   * site's console — and one written before the stamp is shown unlinked
   * rather than pointed at a row this site may not hold.
   */
  it('links a captured submission to the Inbox reader and an order to its dialog', () => {
    renderCard()
    const submission = screen.getByRole('link', { name: 'Open submission' })
    expect(submission.getAttribute('href')).toBe(
      '/acme/hosts/shop/inbox/submissions?submission=sub-7',
    )
    const order = screen.getByRole('link', { name: 'Open order' })
    expect(order.getAttribute('href')).toBe('/acme/hosts/shop/products/orders?order=ord-12')
    // The unstamped older booking is on screen and carries no link.
    expect(screen.getByText('An older booking')).toBeTruthy()
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('logs a new activity against the contact with the full scope stamp', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Log activity' }))
    fireEvent.change(screen.getByLabelText('What happened'), {
      target: { value: 'Agreed to a trial' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Log' }))

    await waitFor(() => expect(addDoc).toHaveBeenCalledTimes(1))
    const [path, payload] = (addDoc as jest.Mock).mock.calls[0]
    expect(path).toBe('orgs/org-1/crmActivities')
    expect(payload).toEqual(
      expect.objectContaining({
        kind: 'call',
        body: 'Agreed to a trial',
        contactId: 'con-1',
        // The contact create path's own stamp: this site, since the org has
        // declared no group and no org-wide default.
        visibleTo: ['host:host-1'],
        hostId: 'host-1',
        byUid: 'u-1',
        byName: 'Ada Admin',
      }),
    )
    expect(typeof payload.atMs).toBe('number')
    // Filed against the contact and nothing else.
    expect(payload).not.toHaveProperty('companyId')
    expect(payload).not.toHaveProperty('dealId')
  })

  it('refuses to log onto a record at the activity ceiling, and says so (AGL-2611)', async () => {
    mockLogged = CRM_ACTIVITIES_PER_RECORD_CEILING
    try {
      renderCard()
      fireEvent.click(screen.getByRole('button', { name: 'Log activity' }))
      fireEvent.change(screen.getByLabelText('What happened'), {
        target: { value: 'One too many' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Log' }))

      await waitFor(() =>
        expect(enqueueSnackbar).toHaveBeenCalledWith(
          CRM_ACTIVITY_LOG_FULL_MESSAGE,
          expect.objectContaining({ variant: 'warning' }),
        ),
      )
      // Refused AND unwritten: the count is read before the write, so the
      // five-thousand-and-first entry never lands.
      expect(addDoc).not.toHaveBeenCalled()
    } finally {
      mockLogged = 0
    }
  })

  it("offers edit and delete on the author's own row and not on a colleague's", () => {
    renderCard()
    // Two logged rows; one is the signed-in user's, one is a colleague's,
    // and the viewer is a scoped member — so exactly one row has controls.
    expect(screen.getAllByLabelText('Edit activity')).toHaveLength(1)
    expect(screen.getAllByLabelText('Delete activity')).toHaveLength(1)
  })
})
