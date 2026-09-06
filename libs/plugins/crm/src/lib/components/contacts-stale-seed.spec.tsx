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
 * The contact record refuses a save over an unconfirmed read (AGL-1358),
 * from the page a person is now edited on (AGL-2596).
 *
 * The v1 drawer seeded its tags and notes from the LIST's listener; the
 * record page seeds every field of the profile from its own one-document
 * listener, and the guard is the same: a snapshot the server never confirmed
 * — from the cache, or from a failed read — is not a seed a write may be
 * built on. The shape that makes this the AGL-1358 defect is unchanged too:
 * edit ONE field and every other field on the card goes back with it, so a
 * cached seed rolls the tags back, and tags are what a saved segment sends
 * to.
 *
 * Mounted DIRECTLY rather than through the hub, with the document listener
 * doubled: this file is about the guard, and the hub's own switch has a spec
 * of its own.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { updateDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import ContactDetailPage from './contact-detail-page'

/** Mutable so each spec picks the listener's verdict before rendering. */
const listener = {
  fromCache: false,
  status: 'success' as 'success' | 'error',
}

const contactDoc = {
  $id: 'con-1',
  email: 'ada@example.test',
  name: 'Ada Lovelace',
  // The HOLDER's own records. A contact row is shared by every site that
  // captured the person; the notes, tags and timeline on it are not, so
  // they sit under the viewing group's facet.
  facets: {
    'host-1': {
      sources: { inbox: true },
      interactions: [{ type: 'inbox', summary: 'Submitted the contact form', atMs: 1 }],
      // The tags a stale seed would roll back — and with them, who a saved
      // segment sends to.
      tags: ['vip', 'newsletter'],
      notes: 'Prefers email',
      phone: '+15125550107',
    },
  },
  visibleTo: ['host:host-1'],
}

// The recent-activity feed under the list (AGL-2600) opens a listener of
// its own and reads hooks the wholesale mock below does not provide. It is
// not what this file asserts, so it is drawn away.
/*
 * The record page composes the timeline, deals and tasks cards and the
 * add-to-list button beside the Properties card under test. Each opens its
 * own listeners; none is what this suite asks about, so they render nothing
 * here and the seed gate on Save is the only thing the doubles have to answer.
 */
jest.mock('./contact-timeline-card', () => ({ __esModule: true, default: () => null, ContactTimelineCard: () => null }))
jest.mock('./contact-custom-fields-card', () => ({ __esModule: true, default: () => null, ContactCustomFieldsCard: () => null }))
jest.mock('./contact-deals-card', () => ({ __esModule: true, default: () => null, ContactDealsCard: () => null }))
jest.mock('./record-tasks-card', () => ({ __esModule: true, default: () => null, RecordTasksCard: () => null }))
jest.mock('./add-to-list-button', () => ({ __esModule: true, default: () => null, AddToListButton: () => null }))
jest.mock('./recent-activity-feed', () => ({
  __esModule: true,
  default: () => null,
  RecentActivityFeed: () => null,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1' }),
  // The company picker's listen (AGL-2613); no company is what this file
  // needs, so the picker offers none and the save carries no link change.
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
  // The site's campaigns, which fill the filing picker on the card beside
  // the one under test.
  useHostCampaigns: () => ({ options: [], truncated: false, ready: true }),
  // The ONE document the page reads, carrying the listener's verdict.
  useFirestoreDoc: () => ({
    data: contactDoc,
    status: listener.status,
    fromCache: listener.fromCache,
  }),
  useUser: () => ({ data: { uid: 'user-1' } }),
  useHostActivityLogger: () => jest.fn(),
  // The REAL guard, not a stub. A stub would let the write through whatever
  // the page passed it, which is the one thing this spec disproves.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  doc: () => ({}),
  deleteField: () => ({ __deleteField: true }),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
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
  AppLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/row-actions-menu.component', () => ({
  __esModule: true,
  default: () => null,
}))
// The attribution and the campaign picker each open a listen of their own;
// neither is what this file is about.
jest.mock(
  '@aglyn/plugins-marketing/components/conversion-attribution.component',
  () => ({ __esModule: true, default: () => null }),
)
jest.mock(
  '@aglyn/shared-ui-email-campaigns/components/campaign-picker.component',
  () => ({ __esModule: true, default: () => null }),
)
// The roster, which the owner picker lists; nobody is needed here.
jest.mock('./use-org-members', () => ({
  useOrgMembers: () => ({
    options: [],
    ready: true,
    memberName: (uid: string) => uid,
  }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  listener.fromCache = false
  listener.status = 'success'
})

const renderPage = () =>
  render(
    <ContactDetailPage
      hostId="host-1"
      id="con-1"
      basePath="/acme/hosts/shop/crm"
    />,
  )

/**
 * Edit only the NOTES, and save — the case that makes this the AGL-1358
 * shape, because the tags ride along untouched.
 */
function editNotesAndSave() {
  fireEvent.change(screen.getByLabelText('About'), {
    target: { value: 'Prefers a phone call' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('ContactDetailPage (AGL-1358, AGL-2596)', () => {
  it('REFUSES to write a contact seeded from an unconfirmed read', async () => {
    listener.fromCache = true
    renderPage()

    editNotesAndSave()

    // Settled, so this cannot pass merely by asserting too early.
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(updateDoc).not.toHaveBeenCalled()
    const [message] = enqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('contact'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // The card keeps what was typed, so the refusal is not a silent no-op.
    expect((screen.getByLabelText('About') as HTMLInputElement).value).toEqual(
      'Prefers a phone call',
    )
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    renderPage()

    editNotesAndSave()

    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (updateDoc as jest.Mock).mock.calls[0]
    // Written into THIS holder's facet by dotted path, so no other holder's
    // notes are replaced by the save.
    expect(payload['facets.host-1.notes']).toBe('Prefers a phone call')
    // The tags ride along untouched — which is exactly why the guard is here.
    expect(payload['facets.host-1.tags']).toEqual(['vip', 'newsletter'])
    // The phone the record already had is re-written as it was, and echoed
    // to the top of the document for the search.
    expect(payload['facets.host-1.phone']).toBe('+15125550107')
    expect(payload['phone']).toBe('+15125550107')
    // Never a nested `facets` object: that would replace every holder's map.
    expect(payload).not.toHaveProperty('facets')
  })

  it('REFUSES when the contact read failed, and says so differently', async () => {
    listener.status = 'error'
    renderPage()

    editNotesAndSave()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(updateDoc).not.toHaveBeenCalled()
    expect(enqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })
})
