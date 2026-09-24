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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type {
  OutreachDomainIntel,
  OutreachEnrollment,
  OutreachEnrollmentHistoryEntry,
  OutreachMailbox,
  OutreachSequence,
} from '../model/outreach.types'
import {
  OutreachEnrollmentDetail,
  outreachCrmRecordHref,
  outreachGmailThreadUrl,
} from './enrollment-detail'
import type { OutreachLoad } from './use-outreach-data'
import type { OutreachMailboxesResult } from './use-outreach-mailboxes'

/**
 * ONE PERSON'S PAGE (AGL-3332): the header a seller reads first — who, which
 * record, where they stand, what can be done — the timeline of everything
 * that happened to them, and the rest behind Details. The reads are stubbed
 * to what the page was handed; the timeline's own rules have a spec of their
 * own (`model/enrollment-timeline.spec.ts`).
 */

const mockApi = { actOnEnrollment: jest.fn(), curateDrafts: jest.fn(), saveCuratedStep: jest.fn() }
const mockEnqueueSnackbar = jest.fn()
let mockSequence: OutreachLoad<OutreachSequence | null>
let mockEnrollment: OutreachLoad<OutreachEnrollment | null>
let mockHistory: OutreachLoad<OutreachEnrollmentHistoryEntry[]>
let mockIntel: OutreachLoad<OutreachDomainIntel | null>

jest.mock('./use-outreach-api', () => ({
  ...jest.requireActual('./use-outreach-api'),
  useOutreachApi: () => mockApi,
}))
jest.mock('./use-outreach-data', () => ({ useOutreachSequence: () => mockSequence }))
jest.mock('./use-outreach-enrollment', () => ({
  useOutreachEnrollment: () => mockEnrollment,
  useOutreachEnrollmentHistory: () => mockHistory,
  useOutreachDomainIntel: () => mockIntel,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useOrgMemberOptions: () => ({
    options: [
      { uid: 'uid-zach', label: 'Zach Gover' },
      { uid: 'uid-lynn', label: 'Lynn Park' },
    ],
    ready: true,
    error: null,
  }),
  useOrgCampaigns: () => ({ options: [{ value: 'camp-1', label: 'Q4 food makers' }], ready: true, truncated: false }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/acme/outreach/sequences/seq-1/enrollments/seq-1_c-1',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@aglyn/aglyn', () => ({
  // The shell's page heading, drawn where a spec can read what the page published.
  PageHeaderRecord: ({ title }: { title?: string }) => <h1>{title}</h1>,
  pluginDocsHelp: () => undefined,
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: (props: {
    children?: ReactNode
    header?: ReactNode
    subheader?: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <section aria-label={String(props.header)}>
      <p>{props.subheader}</p>
      {props.HeaderProps?.action}
      {props.children}
    </section>
  ),
  MdiIcon: () => null,
  AppLink: ({ componentVariant: _variant, nativeButton: _native, ...props }: Record<string, unknown>) => (
    <a {...(props as object)} />
  ),
}))

const SECTION = '/acme/outreach/sequences'
const T = Date.parse('2026-09-24T15:30:00Z') // 10:30 AM in Chicago
const MIN = 60_000

const sequence = (): OutreachSequence =>
  ({
    id: 'seq-1',
    name: 'Food makers',
    status: 'active',
    hostId: 'host-shop',
    mailboxId: 'mbx-1',
    steps: [
      { id: 'a', kind: 'email', delayBusinessDays: 0, subject: 'Hi', replyInThread: false, body: 'Hi', templateId: null },
      { id: 'b', kind: 'email', delayBusinessDays: 2, subject: '', replyInThread: true, body: 'Again', templateId: null },
    ],
    settings: { window: null, allowedCountries: ['US'], allowCustomers: false, trackClicks: true, listUnsubscribe: false },
    stats: { clickTracked: true },
    createdAtMs: 1,
    updatedAtMs: 1,
  }) as OutreachSequence

const enrollment = (overrides: Partial<OutreachEnrollment> = {}): OutreachEnrollment =>
  ({
    id: 'seq-1_c-1',
    sequenceId: 'seq-1',
    target: 'lead',
    contactId: '',
    leadId: 'lead-1',
    contactName: 'Keith Example',
    email: 'keith@example.com',
    hostId: 'host-shop',
    mailboxId: 'mbx-1',
    stepIndex: 1,
    nextDueAtMs: T + 2 * 86_400_000,
    status: 'active',
    stopReason: null,
    stopDetail: null,
    stoppedAtMs: null,
    stoppedByUid: null,
    personalLine: 'Saw the new plant in Bethlehem.',
    cold: false,
    attestations: {},
    enrolledByUid: 'uid-zach',
    gmailThreadId: 'thread-1',
    gmailThreadIds: ['thread-1'],
    threadSubject: 'Hi Keith',
    messageIds: ['<m1@example.com>'],
    lastSentAtMs: T,
    campaignIds: ['camp-1'],
    createdAtMs: T - 60 * MIN,
    updatedAtMs: T,
    stepRecords: [{ stepIndex: 0, stepId: 'a', kind: 'email', atMs: T, subject: 'Hi Keith', gmailThreadId: 'thread-1' }],
    engagement: {
      clicks: 2,
      firstClickAtMs: T + MIN,
      lastClickAtMs: T + MIN,
      lastClickUrl: 'https://calendar.example.com/book',
      machineClicks: 0,
    },
    ...overrides,
  }) as OutreachEnrollment

const mailboxes: OutreachMailboxesResult = {
  status: 'ready',
  mailboxes: [{ id: 'mbx-1', email: 'rep@aglyn.com', sendAs: 'rep@aglyn.com', timezone: 'America/Chicago' } as OutreachMailbox],
}

const renderDetail = (orgMount = { orgId: 'org-1', orgSlug: 'acme', hosts: [{ id: 'host-shop', name: 'Shop', subdomain: 'shop' }], hostsReady: true, hostsPath: '/acme/hosts' }) =>
  render(
    <OutreachEnrollmentDetail
      orgId="org-1"
      orgMount={orgMount}
      sectionPath={SECTION}
      sequenceId="seq-1"
      enrollmentId="seq-1_c-1"
      mailboxes={mailboxes}
    />,
  )

const activity = () => within(screen.getByRole('list', { name: 'Activity' }))

beforeEach(() => {
  jest.clearAllMocks()
  mockSequence = { status: 'ready', data: sequence() }
  mockEnrollment = { status: 'ready', data: enrollment() }
  mockHistory = { status: 'ready', data: [] }
  mockIntel = { status: 'ready', data: null }
  mockApi.actOnEnrollment.mockResolvedValue({ ok: true, changed: true, stoppedOthers: 0, enrollment: {} })
})

describe('the header: who, which record, where they stand', () => {
  it('names the person, links their lead in the site’s CRM, and says their status, step and next send', () => {
    renderDetail()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Keith Example')
    const header = within(screen.getByRole('region', { name: 'Enrollment' }))
    expect(header.getByText('keith@example.com · In Food makers')).toBeTruthy()
    expect(header.getByRole('link', { name: /Lead/ }).getAttribute('href')).toBe('/acme/hosts/shop/crm/leads/lead-1')
    expect(header.getByText('Active')).toBeTruthy()
    expect(header.getByText('Step 2 of 2 · Email')).toBeTruthy()
    expect(header.getByText('Next send Sep 26, 10:30 AM CDT')).toBeTruthy()
    expect(header.getByRole('link', { name: 'Back to enrollments' }).getAttribute('href')).toBe(`${SECTION}/seq-1/enrollments`)
  })

  it('reaches a contact at the organization’s CRM when the site cannot be named', () => {
    expect(outreachCrmRecordHref('contact', 'c-9', 'host-gone', { orgSlug: 'acme', hosts: [] })).toBe('/acme/crm/contacts/c-9')
    expect(outreachCrmRecordHref('lead', '', 'host-shop', { orgSlug: 'acme', hosts: [] })).toBeNull()
  })

  it('shows five numbers, a dash for a zero, and says how many links is only a floor', () => {
    renderDetail()
    const numbers = within(screen.getByLabelText('In numbers'))
    const figure = (label: string) => numbers.getByText(label).parentElement?.textContent
    expect(figure('Emails sent')).toBe('1Emails sent')
    expect(figure('Clicks')).toBe('2Clicks')
    expect(figure('Links followed')).toBe('1+Links followedEarlier clicks kept the last link only')
    expect(figure('Scanner clicks')).toBe('—Scanner clicksNot counted')
    expect(figure('Replies')).toBe('—Replies')
  })

  it('says “Nothing yet” and when the first step sends, rather than a row of dashes', () => {
    mockEnrollment = {
      status: 'ready',
      data: enrollment({ stepIndex: 0, stepRecords: [], lastSentAtMs: null, engagement: undefined, nextDueAtMs: T }),
    }
    renderDetail()
    expect(screen.getByText('Nothing yet — step 1 sends Sep 24, 10:30 AM CDT.')).toBeTruthy()
    expect(screen.queryByLabelText('In numbers')).toBeNull()
  })

  it('offers the row menu’s actions: curating as the button, the rest behind the menu', async () => {
    renderDetail()
    expect(screen.getByRole('button', { name: 'Curate next step' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Keith Example' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Pause',
      'Stop',
      'Mark do-not-contact',
    ])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pause' }))
    await waitFor(() => expect(mockApi.actOnEnrollment).toHaveBeenCalledWith('seq-1_c-1', 'pause', undefined))
  })

  it('says why a gateway held the person, and resumes and sends from the header', async () => {
    const reason = 'Barracuda refused this sender twice in the last 30 days and delivered nothing, so this email is held.'
    mockEnrollment = {
      status: 'ready',
      data: enrollment({ status: 'paused', stopReason: 'gateway_blocked_here', stopDetail: reason, stoppedAtMs: T + MIN }),
    }
    renderDetail()
    expect(screen.getByRole('alert').textContent).toBe(reason)
    fireEvent.click(screen.getByRole('button', { name: 'Resume and send' }))
    await waitFor(() => expect(mockApi.actOnEnrollment).toHaveBeenCalledWith('seq-1_c-1', 'resume', undefined))
  })
})

describe('the timeline: everything that happened to them', () => {
  it('lists the send, the earlier clicks as one honest line, and the enrollment — newest first', () => {
    renderDetail()
    const rows = activity().getAllByRole('listitem')
    expect(rows.map((row) => row.getAttribute('data-kind'))).toEqual(['earlier-clicks', 'sent', 'enrolled'])
    expect(rows[0].textContent).toContain('2 earlier clicks, kept as a total')
    expect(within(rows[0]).getByRole('link', { name: 'https://calendar.example.com/book' }).getAttribute('href')).toBe(
      'https://calendar.example.com/book',
    )
    expect(rows[1].textContent).toContain('Subject: Hi Keith')
    expect(within(rows[1]).getByRole('link', { name: 'Open thread in Gmail' }).getAttribute('href')).toBe(
      outreachGmailThreadUrl('thread-1', 'rep@aglyn.com'),
    )
    expect(rows[2].textContent).toContain('By Zach Gover')
  })

  it('lists a click recorded on its own with its destination, its step and its time', () => {
    mockEnrollment = {
      status: 'ready',
      data: enrollment({
        engagement: { clicks: 1, firstClickAtMs: T + 2 * MIN, lastClickAtMs: T + 2 * MIN, lastClickUrl: 'https://aglyn.com/pricing', machineClicks: 0, links: ['https://aglyn.com/pricing'], loggedClicks: 1, loggedMachineClicks: 0 },
      }),
    }
    mockHistory = {
      status: 'ready',
      data: [{ id: 'h1', kind: 'click', atMs: T + 2 * MIN, url: 'https://aglyn.com/pricing', stepIndex: 0, human: true, machineReason: null }],
    }
    renderDetail()
    const [row] = activity().getAllByRole('listitem')
    expect(row.getAttribute('data-kind')).toBe('click')
    expect(row.textContent).toContain('Clicked a link')
    expect(row.textContent).toContain('Sep 24, 10:32 AM CDT')
    expect(row.textContent).toContain('From Email 1 · step 1')
    expect(within(row).getByRole('link', { name: 'https://aglyn.com/pricing' })).toBeTruthy()
  })

  it('shows a bounce with what the server said and the gateway in front of the domain', () => {
    mockEnrollment = {
      status: 'ready',
      data: enrollment({ status: 'bounced', stopReason: 'hard_bounce', stopDetail: '550 5.7.1 Message rejected', stoppedAtMs: T + 5 * MIN, nextDueAtMs: null }),
    }
    mockIntel = {
      status: 'ready',
      data: { domain: 'example.com', mx: ['d1.ess.barracudanetworks.com'], gateway: 'barracuda', resolvedAtMs: T, sent: 3, delivered: 0, blocked: 2, lastBlockedAtMs: T, updatedAtMs: T },
    }
    renderDetail()
    const [row] = activity().getAllByRole('listitem')
    expect(row.textContent).toContain('Bounced')
    expect(row.textContent).toContain('550 5.7.1 Message rejected')
    expect(row.textContent).toContain('Their mail gateway: Barracuda')
  })
})

describe('the timeline without its history rows', () => {
  it('still shows everything the enrollment holds, and says only the click list is missing', () => {
    mockHistory = { status: 'refused', data: [] }
    renderDetail()
    expect(screen.getByText(/Their clicks can’t be listed one by one here/)).toBeTruthy()
    expect(activity().getAllByRole('listitem').map((row) => row.getAttribute('data-kind'))).toEqual([
      'earlier-clicks',
      'sent',
      'enrolled',
    ])
  })
})

describe('Details: everything else, closed until asked for', () => {
  it('opens on the personal line, the campaigns, the curated copy and the id', () => {
    mockEnrollment = {
      status: 'ready',
      data: enrollment({ stepOverrides: { '1': { body: 'Keith — one more thing.', source: 'ai', draftedAtMs: T, draftedByUid: 'uid-zach', edited: true } } }),
    }
    renderDetail()
    expect(screen.queryByText('Saw the new plant in Bethlehem.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(screen.getByText('Saw the new plant in Bethlehem.')).toBeTruthy()
    expect(screen.getByText('Q4 food makers')).toBeTruthy()
    expect(screen.getByText('Keith — one more thing.')).toBeTruthy()
    expect(screen.getByText(/AI draft, edited · confirmed by Zach Gover/)).toBeTruthy()
    expect(screen.getByText('seq-1_c-1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy the enrollment id' })).toBeTruthy()
  })
})

describe('what the page says when it cannot show the person', () => {
  it('shows progress, a refusal, and a person no longer in the sequence', () => {
    mockEnrollment = { status: 'loading', data: null }
    const loading = renderDetail()
    expect(screen.getByRole('status').textContent).toContain('Loading this person')
    loading.unmount()
    mockEnrollment = { status: 'refused', data: null }
    const refused = renderDetail()
    expect(screen.getByText(/Use Sequences permission/)).toBeTruthy()
    refused.unmount()
    mockEnrollment = { status: 'ready', data: null }
    const gone = renderDetail()
    expect(screen.getByText('This person isn’t in this sequence')).toBeTruthy()
    gone.unmount()
    // An id from another sequence reads the same: the URL names both.
    mockEnrollment = { status: 'ready', data: enrollment({ sequenceId: 'seq-2' }) }
    renderDetail()
    expect(screen.getByText('This person isn’t in this sequence')).toBeTruthy()
  })
})
