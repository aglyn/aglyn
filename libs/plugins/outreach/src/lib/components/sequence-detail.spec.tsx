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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { OutreachMailbox, OutreachSequence } from '../model/outreach.types'
import {
  OutreachSequenceDetail,
  type OutreachSequenceDetailProps,
} from './sequence-detail'
import { OutreachRouteError } from './use-outreach-api'
import type { OutreachLoad } from './use-outreach-data'

/**
 * One sequence (AGL-2980): each state its read can be in, the actions each
 * status offers, the activation refusal and the issues behind it, the two
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
const renderDetail = (props: Partial<OutreachSequenceDetailProps> = {}) =>
  render(
    <OutreachSequenceDetail
      orgId="org-1"
      sectionPath={SECTION}
      sequenceId="seq-1"
      tab="steps"
      settings={{
        status: 'ready',
        settings: null,
        message: null,
        reload: jest.fn(),
      }}
      mailboxes={[
        { id: 'mbx-1', timezone: 'America/Chicago' } as OutreachMailbox,
      ]}
      {...props}
    />,
  )

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
