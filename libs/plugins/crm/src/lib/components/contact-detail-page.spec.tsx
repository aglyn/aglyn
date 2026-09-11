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
 * THE CONTACT RECORD ON A PLAN WITHOUT THE CRM SUITE (AGL-2788).
 *
 * Reading the person, their tags and notes, deleting and erasing them are on
 * every plan; working them is the suite's. On Free the page must:
 *
 *  1. carry the notice, naming what is locked and the plan that includes it;
 *  2. lock the header's call log and email, and the overflow's merge, while
 *     delete stays;
 *  3. hand the properties card, the timeline and the duplicates card their
 *     lock;
 *  4. draw none of the suite's own cards — custom fields, deals, tasks, files.
 *
 * On Starter none of it happens. Each card is doubled to record the props
 * the page handed it; what a card does with its lock has a spec of its own.
 */

import { soloConsentGroup } from '@aglyn/aglyn'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import ContactDetailPage from './contact-detail-page'

/** The props each doubled card was last handed, by card. */
const handed: Record<string, Record<string, unknown>> = {}
const double = (name: string) => (props: Record<string, unknown>) => {
  handed[name] = props
  return <div data-testid={name} />
}

jest.mock('./contact-associations-card', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => double('associations')(props),
}))
jest.mock('./contact-custom-fields-card', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => double('custom-fields')(props),
}))
jest.mock('./contact-duplicates-card', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => double('duplicates')(props),
}))
jest.mock('./contact-known-by-card', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => double('known-by')(props),
}))
jest.mock('./contact-merge-dialog', () => ({
  __esModule: true,
  default: () => null,
  useContactMergeDialog: () => ({ state: {}, open: jest.fn(), close: jest.fn() }),
}))
jest.mock('./contact-properties-card', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => double('properties')(props),
}))
jest.mock('./contact-timeline-card', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => double('timeline')(props),
}))
jest.mock('./add-to-list-button', () => ({ AddToListButton: () => null }))
jest.mock('./book-meeting-action', () => ({ useBookingDoor: () => ({ open: false }) }))
jest.mock('./crm-send-email-button', () => ({
  CrmSendEmailButton: (props: Record<string, unknown>) => double('send-email')(props),
}))
jest.mock('./contact-deals-card', () => ({
  ContactDealsCard: (props: Record<string, unknown>) => double('deals')(props),
}))
jest.mock('./crm-call-actions', () => ({
  CrmCallButton: (props: Record<string, unknown>) => double('call')(props),
}))
/** The header, drawn as its actions, its overflow items and its children. */
jest.mock('./crm-record-header', () => ({
  CrmRecordChip: () => null,
  CrmRecordHeader: (props: {
    actions?: ReactNode
    menuItems?: Array<{ key: string; label: string; disabled?: boolean; disabledReason?: string }>
    children?: ReactNode
  }) => (
    <header>
      {props.actions}
      <ul>
        {(props.menuItems ?? []).map((item) => (
          <li
            key={item.key}
            data-disabled={item.disabled ? 'true' : 'false'}
            title={item.disabled ? item.disabledReason : undefined}
          >
            {item.label}
          </li>
        ))}
      </ul>
      {props.children}
    </header>
  ),
}))
jest.mock('./erase-person-action', () => ({
  useErasePersonAction: () => ({ menuItems: [], banner: null, dialog: null }),
}))
jest.mock('./record-files-card', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => double('files')(props),
}))
jest.mock('./record-tasks-card', () => ({
  RecordTasksCard: (props: Record<string, unknown>) => double('tasks')(props),
}))
jest.mock('./use-emails-hub-path', () => ({ useEmailsHubPath: () => null }))
jest.mock('./use-org-members', () => ({
  useOrgMembers: () => ({
    options: [],
    ready: true,
    memberName: (uid: string) => uid,
    memberEmail: (uid: string) => uid,
  }),
}))
jest.mock('../hooks/use-crm-activity-logger', () => ({
  useCrmActivityLogger: () => jest.fn(),
}))
jest.mock('../hooks/use-crm-org-mount', () => ({
  CrmCreateSiteDefault: ({ children }: { children: ReactNode }) => <>{children}</>,
  useCrmOrgMount: () => null,
}))

const mockGroup = soloConsentGroup('host-1')
jest.mock('../hooks/use-crm-scope', () => ({
  useCrmScope: () => ({
    scope: ['orgs', 'org-1'],
    orgId: 'org-1',
    consentGroup: mockGroup,
    visibleTo: ['host:host-1'],
  }),
}))

/** The person, as the record's listener answers with them. */
const mockRow = {
  $id: 'con-1',
  email: 'ada@example.test',
  name: 'Ada Lovelace',
  visibleTo: ['host:host-1'],
  facets: { 'host-1': { tags: ['vip'], notes: '' } },
}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreDoc: () => ({ data: mockRow, status: 'success', fromCache: false }),
}))
jest.mock('firebase/firestore', () => ({
  arrayRemove: jest.fn(),
  deleteDoc: jest.fn(),
  deleteField: jest.fn(),
  doc: jest.fn(),
  updateDoc: jest.fn(),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'acme', host: 'shop' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

const renderPage = (org: Record<string, unknown>) =>
  render(
    <ContactDetailPage
      {...({
        hostId: 'host-1',
        org,
        id: 'con-1',
        basePath: '/acme/hosts/shop/crm',
      } as unknown as Parameters<typeof ContactDetailPage>[0])}
    />,
  )

const SUITE_CARDS = ['custom-fields', 'deals', 'tasks', 'files']

beforeEach(() => {
  for (const key of Object.keys(handed)) delete handed[key]
})

describe('the contact record on Free', () => {
  it('carries the notice naming what is locked and the plan that includes it', () => {
    renderPage({ plan: 'free' })
    expect(screen.getByText(/is part of the CRM\. Included from Starter\./)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View plans' }).getAttribute('href')).toBe(
      '/acme/billing',
    )
  })

  it('locks the call log, the email and the merge, and keeps delete', () => {
    renderPage({ plan: 'free' })
    expect(handed['call']).toMatchObject({ suiteLocked: true })
    expect(handed['send-email']).toMatchObject({ suiteLocked: true })
    const merge = screen.getByText('Merge into…')
    expect(merge.getAttribute('data-disabled')).toBe('true')
    expect(merge.getAttribute('title')).toBe('Part of the CRM, included from Starter')
    expect(screen.getByText('Delete contact').getAttribute('data-disabled')).toBe('false')
  })

  it("hands the lock to the cards that carry the suite's fields, and draws none of its cards", () => {
    renderPage({ plan: 'free' })
    expect(handed['properties']).toMatchObject({ suiteLocked: true })
    expect(handed['timeline']).toMatchObject({ suiteLocked: true })
    expect(handed['duplicates']).toMatchObject({ suiteLocked: true })
    for (const card of SUITE_CARDS) {
      expect([card, screen.queryByTestId(card)]).toEqual([card, null])
    }
    // The relationship — sources, consent, filing — is not the suite's.
    expect(screen.getByTestId('associations')).toBeTruthy()
  })
})

describe('the contact record on Starter', () => {
  it('locks nothing, draws every card and no notice', () => {
    renderPage({ plan: 'starter' })
    expect(screen.queryByText(/part of the CRM/)).toBeNull()
    expect(handed['properties']).toMatchObject({ suiteLocked: false })
    expect(handed['timeline']).toMatchObject({ suiteLocked: false })
    expect(handed['call']).toMatchObject({ suiteLocked: false })
    expect(handed['send-email']).toMatchObject({ suiteLocked: false })
    expect(screen.getByText('Merge into…').getAttribute('data-disabled')).toBe('false')
    for (const card of [...SUITE_CARDS, 'timeline', 'duplicates']) {
      expect(screen.getByTestId(card)).toBeTruthy()
    }
  })
})
