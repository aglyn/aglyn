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
  OutreachComplianceSettingsDocument,
  OutreachMailbox,
  OutreachSequence,
} from '../model/outreach.types'
import {
  OutreachSequenceDetail,
  type OutreachSequenceDetailProps,
} from './sequence-detail'
import { OutreachRouteError } from './use-outreach-api'
import type { OutreachLoad } from './use-outreach-data'
import type { OutreachMailboxesResult } from './use-outreach-mailboxes'
import type { OutreachSettingsLoad } from './use-outreach-settings'

/**
 * One sequence (AGL-2980): each state its read can be in, the actions each
 * status offers, what stops activation — said before a click, with Activate
 * disabled — and the refusal when the route finds more, the two
 * confirmations, and the enroll dialog an active sequence opens. The editor,
 * the enrollments table and the dialog are stubbed to the props they were
 * handed; each has a spec of its own.
 */

const mockApi = { setSequenceStatus: jest.fn(), deleteSequence: jest.fn() }
let mockSequence: OutreachLoad<OutreachSequence | null>
const mockPush = jest.fn()
const mockEnqueueSnackbar = jest.fn()

jest.mock('./use-outreach-api', () => ({
  ...jest.requireActual('./use-outreach-api'),
  useOutreachApi: () => mockApi,
}))
jest.mock('./use-outreach-data', () => ({
  useOutreachSequence: () => mockSequence,
  useOutreachEnrollments: () => ({
    status: 'ready',
    data: [],
    hasMore: false,
    showMore: jest.fn(),
  }),
}))
jest.mock('./sequence-editor', () => ({
  OutreachSequenceEditor: () => (
    <div role="form" aria-label="Sequence editor" />
  ),
}))
jest.mock('./enrollments-table', () => ({
  OutreachEnrollmentsTable: (props: {
    timeZone: string | null
    enrollAction?: ReactNode
  }) => (
    <div role="table" aria-label="Enrollments">
      {`zone:${props.timeZone}`}
      {props.enrollAction}
    </div>
  ),
}))
jest.mock('./enroll-dialog', () => ({
  OutreachEnrollDialog: (props: { open: boolean; contactGroupId: string }) =>
    props.open ? (
      <div
        role="dialog"
        aria-label="Enroll people"
      >{`group:${props.contactGroupId}`}</div>
    ) : null,
}))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-rep' } }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({ MdiIcon: () => null }))

const sequence = (status: OutreachSequence['status']): OutreachSequence =>
  ({
    id: 'seq-1',
    name: 'Second locations',
    status,
    hostId: 'host-1',
    mailboxId: 'mbx-1',
    steps: [],
    settings: { window: null, allowedCountries: ['US'], allowCustomers: false },
    createdAtMs: 1,
    updatedAtMs: 1,
  }) as OutreachSequence

const SECTION = '/acme/outreach/sequences'
const MAILBOXES = '/acme/outreach/mailboxes'
const COMPLIANCE = '/acme/outreach/compliance'

const footer: OutreachComplianceSettingsDocument = {
  legalName: 'Example Shop LLC',
  brandName: 'Example Shop',
  postalAddress: '100 Example St\nSpringfield, IL 62701',
  allowedCountries: ['US'],
  updatedAtMs: 1,
  updatedByUid: 'uid-owner',
}
const settingsOf = (
  settings: OutreachComplianceSettingsDocument | null,
  status: OutreachSettingsLoad['status'] = 'ready',
): OutreachSettingsLoad => ({ status, settings, message: null, reload: jest.fn() })

const mailboxesOf = (
  status: OutreachMailbox['status'] | null,
  loadStatus: OutreachMailboxesResult['status'] = 'ready',
): OutreachMailboxesResult =>
  ({
    status: loadStatus,
    mailboxes: status
      ? [
          {
            id: 'mbx-1',
            timezone: 'America/Chicago',
            status,
            connectedByUid: 'uid-rep',
          } as OutreachMailbox,
        ]
      : [],
  }) as OutreachMailboxesResult

const renderDetail = (props: Partial<OutreachSequenceDetailProps> = {}) =>
  render(
    <OutreachSequenceDetail
      orgId="org-1"
      sectionPath={SECTION}
      mailboxesPath={MAILBOXES}
      compliancePath={COMPLIANCE}
      sequenceId="seq-1"
      tab="steps"
      settings={settingsOf(footer)}
      mailboxes={mailboxesOf('connected')}
      {...props}
    />,
  )

const blockers = () => screen.queryByTestId('outreach-activation-blockers')

const button = (name: string) =>
  screen.queryByRole('button', { name }) as HTMLButtonElement | null

beforeEach(() => {
  jest.clearAllMocks()
  mockSequence = { status: 'ready', data: sequence('draft') }
})

describe('a sequence: what it shows (AGL-2980)', () => {
  it('shows progress, a failure, a refusal, and a sequence that no longer exists', () => {
    mockSequence = { status: 'loading', data: null }
    const loading = renderDetail()
    expect(screen.getByRole('status').textContent).toContain(
      'Loading the sequence',
    )
    loading.unmount()
    mockSequence = { status: 'error', data: null }
    const failed = renderDetail()
    expect(
      screen.getByText(
        'The sequence could not be loaded. Reload the page to try again.',
      ),
    ).toBeTruthy()
    failed.unmount()
    mockSequence = { status: 'refused', data: null }
    const refused = renderDetail()
    expect(screen.getByText(/Use Outreach permission/)).toBeTruthy()
    refused.unmount()
    mockSequence = { status: 'ready', data: null }
    renderDetail()
    expect(screen.getByText('This sequence no longer exists')).toBeTruthy()
  })

  it('offers what each status allows', () => {
    const draft = renderDetail()
    expect(button('Activate')).toBeTruthy()
    expect(button('Delete')).toBeTruthy()
    expect(button('Pause')).toBeNull()
    expect(button('Enroll people')).toBeNull()
    expect(
      screen.getByText('A draft sends nothing. Activate it to enroll people.'),
    ).toBeTruthy()
    draft.unmount()
    mockSequence = { status: 'ready', data: sequence('active') }
    const active = renderDetail()
    expect(button('Pause')).toBeTruthy()
    expect(button('Archive')).toBeTruthy()
    expect(button('Activate')).toBeNull()
    expect(button('Enroll people')?.disabled).toBe(false)
    active.unmount()
    mockSequence = { status: 'ready', data: sequence('archived') }
    renderDetail()
    expect(button('Archive')).toBeNull()
    expect(button('Activate')).toBeNull()
  })

  it('shows the enrollments in the mailbox’s timezone, and switches tabs by URL', () => {
    renderDetail({ tab: 'enrollments' })
    expect(
      screen.getByRole('table', { name: 'Enrollments' }).textContent,
    ).toContain('zone:America/Chicago')
    fireEvent.click(screen.getByRole('tab', { name: 'Steps' }))
    expect(mockPush).toHaveBeenCalledWith(`${SECTION}/seq-1`)
  })
})

describe('a sequence: what it does (AGL-2980)', () => {
  it('activates, or says every reason activation was refused', async () => {
    mockApi.setSequenceStatus.mockRejectedValueOnce(
      new OutreachRouteError(
        "Add your organization's postal address in Outreach settings.",
        'activation-refused',
        409,
        [
          {
            path: 'orgSettings.postalAddress',
            code: 'postal_address_required',
            severity: 'error',
            message:
              "Add your organization's postal address in Outreach settings.",
          },
          {
            path: 'mailboxId',
            code: 'mailbox_required',
            severity: 'error',
            message: 'Choose the mailbox this sequence sends from.',
          },
        ],
      ),
    )
    renderDetail()
    fireEvent.click(button('Activate') as HTMLButtonElement)
    expect(
      await screen.findByText(
        "Add your organization's postal address in Outreach settings.",
      ),
    ).toBeTruthy()
    expect(
      screen.getByText('Choose the mailbox this sequence sends from.'),
    ).toBeTruthy()
    mockApi.setSequenceStatus.mockResolvedValueOnce({
      ok: true,
      sequence: sequence('active'),
      stoppedEnrollments: 0,
    })
    fireEvent.click(button('Activate') as HTMLButtonElement)
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith('Sequence activated.', {
        variant: 'success',
      }),
    )
    expect(mockApi.setSequenceStatus).toHaveBeenLastCalledWith(
      'seq-1',
      'activate',
    )
  })

  it('archives only once confirmed, and says how many people it stopped', async () => {
    mockSequence = { status: 'ready', data: sequence('active') }
    mockApi.setSequenceStatus.mockResolvedValue({
      ok: true,
      sequence: sequence('archived'),
      stoppedEnrollments: 3,
    })
    renderDetail()
    fireEvent.click(button('Archive') as HTMLButtonElement)
    expect(
      screen.getByText(
        'Archiving is final. Everyone still in it is stopped, and it takes no one new.',
      ),
    ).toBeTruthy()
    expect(mockApi.setSequenceStatus).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Archive' }).at(-1) as HTMLElement,
    )
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Sequence archived. 3 people were stopped.',
        { variant: 'success' },
      ),
    )
  })

  it('deletes a draft once confirmed, and goes back to the list', async () => {
    mockApi.deleteSequence.mockResolvedValue({ ok: true })
    renderDetail()
    fireEvent.click(button('Delete') as HTMLButtonElement)
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Delete' }).at(-1) as HTMLElement,
    )
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(SECTION))
    expect(mockApi.deleteSequence).toHaveBeenCalledWith('seq-1')
  })

  it('opens the enroll dialog for an active sequence, with its site’s consent group', () => {
    mockSequence = { status: 'ready', data: sequence('active') }
    renderDetail({
      org: {
        consentGroups: {
          'group-brand': {
            name: 'Example Brand',
            hostIds: ['host-1', 'host-2'],
          },
        },
      },
    })
    fireEvent.click(button('Enroll people') as HTMLButtonElement)
    expect(
      screen.getByRole('dialog', { name: 'Enroll people' }).textContent,
    ).toBe('group:group-brand')
  })
})

describe('a sequence: what stops activation, said before a click (AGL-2980)', () => {
  it('names a mailbox that is not sending, and sends the member to Mailboxes', () => {
    renderDetail({ mailboxes: mailboxesOf('paused') })
    expect(button('Activate')?.disabled).toBe(true)
    const said = blockers() as HTMLElement
    expect(said.textContent).toContain(
      "This sequence's mailbox is paused. Resume it in Mailboxes, then activate the sequence.",
    )
    fireEvent.click(within(said).getByRole('link', { name: 'Open Mailboxes' }))
    expect(mockPush).toHaveBeenCalledWith(MAILBOXES)
  })

  it('names a mailbox waiting to be reconnected', () => {
    renderDetail({ mailboxes: mailboxesOf('reconnect_required') })
    expect(button('Activate')?.disabled).toBe(true)
    expect(blockers()?.textContent).toContain(
      "Google stopped accepting this sequence's mailbox. Reconnect it in Mailboxes, then activate the sequence.",
    )
  })

  it('asks for a mailbox where there is none, or the one it named is gone, on its own steps', () => {
    const gone = renderDetail({ mailboxes: mailboxesOf(null) })
    expect(blockers()?.textContent).toContain(
      "This sequence's mailbox is no longer connected. Choose another before activating it.",
    )
    fireEvent.click(within(blockers() as HTMLElement).getByRole('link', { name: 'Choose a mailbox' }))
    expect(mockPush).toHaveBeenCalledWith(`${SECTION}/seq-1`)
    gone.unmount()
    mockSequence = { status: 'ready', data: { ...sequence('draft'), mailboxId: '' } }
    renderDetail()
    expect(button('Activate')?.disabled).toBe(true)
    expect(blockers()?.textContent).toContain('Choose the mailbox this sequence sends from before activating it.')
  })

  it('names a footer the organization cannot write yet, and sends the member to Compliance', () => {
    renderDetail({ settings: settingsOf({ ...footer, postalAddress: '' }) })
    expect(button('Activate')?.disabled).toBe(true)
    const said = blockers() as HTMLElement
    expect(said.textContent).toContain("Add your organization's postal address in Outreach settings.")
    fireEvent.click(within(said).getByRole('link', { name: 'Open Compliance' }))
    expect(mockPush).toHaveBeenCalledWith(COMPLIANCE)
  })

  it('claims nothing while the mailboxes or the settings are still being read', () => {
    renderDetail({
      mailboxes: mailboxesOf(null, 'loading'),
      settings: settingsOf(null, 'loading'),
    })
    expect(blockers()).toBeNull()
    expect(button('Activate')?.disabled).toBe(false)
  })

  it('warns on an active sequence whose mailbox stopped sending, and stops enrolling onto one that is gone', () => {
    mockSequence = { status: 'ready', data: sequence('active') }
    const paused = renderDetail({ mailboxes: mailboxesOf('paused') })
    expect(
      screen.getByText(/This sequence’s mailbox is paused, so nothing is sent until it is resumed\./),
    ).toBeTruthy()
    expect(button('Enroll people')?.disabled).toBe(false)
    paused.unmount()
    renderDetail({ mailboxes: mailboxesOf('disconnected') })
    expect(screen.getByText(/no longer connected, so nothing is sent from it\./)).toBeTruthy()
    expect(button('Enroll people')?.disabled).toBe(true)
  })
})
