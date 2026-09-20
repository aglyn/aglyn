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

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type {
  OutreachEnrollment,
  OutreachSequenceStep,
} from '../model/outreach.types'
import {
  OutreachEnrollmentsTable,
  outreachCurrentStepLabel,
  outreachStopLabel,
} from './enrollments-table'
import type { OutreachApi } from './use-outreach-api'
import type { OutreachEnrollmentsLoad } from './use-outreach-data'

/**
 * A sequence's enrollments (AGL-2980): each state the read can be in, the
 * columns a row reads as — status, current step, next send in the
 * mailbox's timezone, last activity, stop reason — and the four actions,
 * the two final ones asked first.
 */

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

const steps: OutreachSequenceStep[] = [
  {
    id: 'a',
    kind: 'email',
    delayBusinessDays: 0,
    subject: 'Hi',
    replyInThread: false,
    body: 'Hi',
    templateId: null,
  },
  {
    id: 'b',
    kind: 'task',
    taskKind: 'call',
    title: 'Call',
    delayBusinessDays: 1,
  },
  {
    id: 'c',
    kind: 'email',
    delayBusinessDays: 3,
    subject: '',
    replyInThread: true,
    body: 'Again',
    templateId: null,
  },
]

// 2026-09-22 14:14 UTC is 9:14 AM in Chicago.
const DUE = Date.parse('2026-09-22T14:14:00Z')

const enrollment = (
  overrides: Partial<OutreachEnrollment>,
): OutreachEnrollment =>
  ({
    id: 'seq-1_c-1',
    sequenceId: 'seq-1',
    contactId: 'c-1',
    contactName: 'Casey Morgan',
    email: 'casey.morgan@example.com',
    status: 'active',
    stepIndex: 1,
    nextDueAtMs: DUE,
    stopReason: null,
    stopDetail: null,
    stoppedAtMs: null,
    lastSentAtMs: Date.parse('2026-09-18T15:00:00Z'),
    createdAtMs: Date.parse('2026-09-17T15:00:00Z'),
    ...overrides,
  }) as OutreachEnrollment

const loaded = (
  data: OutreachEnrollment[],
  extra: Partial<OutreachEnrollmentsLoad> = {},
): OutreachEnrollmentsLoad => ({
  status: 'ready',
  data,
  hasMore: false,
  showMore: jest.fn(),
  ...extra,
})

let api: jest.Mocked<Pick<OutreachApi, 'actOnEnrollment'>>

const renderTable = (enrollments: OutreachEnrollmentsLoad) =>
  render(
    <OutreachEnrollmentsTable
      enrollments={enrollments}
      steps={steps}
      timeZone="America/Chicago"
      api={api as unknown as OutreachApi}
      enrollAction={<button>Enroll people</button>}
    />,
  )

const rowOf = (name: string) =>
  screen
    .getByRole('gridcell', { name: new RegExp(name) })
    .closest('[role="row"]') as HTMLElement

beforeEach(() => {
  jest.clearAllMocks()
  api = {
    actOnEnrollment: jest.fn().mockResolvedValue({
      ok: true,
      changed: true,
      stoppedOthers: 0,
      enrollment: {},
    }),
  }
})

describe('the enrollments table: what it shows (AGL-2980)', () => {
  it('shows progress, a failure, a refusal, and an empty sequence with the way to enroll', () => {
    const loading = renderTable(loaded([], { status: 'loading' }))
    expect(screen.getByRole('status').textContent).toContain(
      'Loading enrollments',
    )
    loading.unmount()
    const failed = renderTable(loaded([], { status: 'error' }))
    expect(
      screen.getByText(
        'The enrollments could not be loaded. Reload the page to try again.',
      ),
    ).toBeTruthy()
    failed.unmount()
    const refused = renderTable(loaded([], { status: 'refused' }))
    expect(screen.getByText(/Use Sequences permission/)).toBeTruthy()
    refused.unmount()
    renderTable(loaded([]))
    expect(screen.getByText('Nobody is enrolled yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enroll people' })).toBeTruthy()
  })

  it('reads each row: person, status, step, next send in the mailbox’s zone, last activity, stop reason', () => {
    renderTable(
      loaded([
        enrollment({}),
        enrollment({
          id: 'seq-1_c-2',
          contactId: 'c-2',
          contactName: '',
          email: 'avery.quinn@example.org',
          status: 'opted_out',
          stepIndex: 2,
          nextDueAtMs: null,
          stopReason: 'do_not_contact',
          stopDetail: 'Asked on a call',
          stoppedAtMs: Date.parse('2026-09-19T15:00:00Z'),
        }),
      ]),
    )
    const casey = rowOf('Casey Morgan')
    expect(within(casey).getByText('casey.morgan@example.com')).toBeTruthy()
    expect(within(casey).getByText('Active')).toBeTruthy()
    expect(within(casey).getByText('Step 2 of 3 · Call')).toBeTruthy()
    expect(within(casey).getByText(/Sep 22, 9:14 AM CDT/)).toBeTruthy()
    const avery = rowOf('avery.quinn@example.org')
    expect(within(avery).getByText('Opted out')).toBeTruthy()
    expect(
      within(avery).getByText('On the do-not-contact list — Asked on a call'),
    ).toBeTruthy()
  })

  it('says where a finished person is, and why a stopped one stopped', () => {
    expect(
      outreachCurrentStepLabel({ status: 'finished', stepIndex: 3 }, steps),
    ).toBe('All steps done')
    expect(outreachStopLabel({ stopReason: 'reply', stopDetail: null })).toBe(
      'They replied',
    )
    expect(outreachStopLabel({ stopReason: null, stopDetail: null })).toBe('')
  })

  it('pages the rows it read, and reads another window past the last of them', () => {
    const showMore = jest.fn()
    const many = Array.from({ length: 12 }, (_, index) =>
      enrollment({
        id: `seq-1_c-${index}`,
        contactId: `c-${index}`,
        contactName: `Person ${index}`,
      }),
    )
    renderTable(loaded(many, { hasMore: true, showMore }))
    expect(screen.getAllByRole('row')).toHaveLength(11)
    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
    expect(showMore).toHaveBeenCalled()
  })
})

describe('the enrollments table: what a member can do (AGL-2980)', () => {
  const open = (name: string) =>
    fireEvent.click(
      within(rowOf(name)).getByRole('button', { name: /More actions|Actions/ }),
    )

  it('pauses an active enrollment straight away', async () => {
    renderTable(loaded([enrollment({})]))
    open('Casey Morgan')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pause' }))
    await waitFor(() =>
      expect(api.actOnEnrollment).toHaveBeenCalledWith(
        'seq-1_c-1',
        'pause',
        undefined,
      ),
    )
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith('Paused.', {
        variant: 'success',
      }),
    )
  })

  it('offers resume, not pause, for a paused enrollment', () => {
    renderTable(
      loaded([enrollment({ status: 'paused', stopReason: 'manual' })]),
    )
    open('Casey Morgan')
    expect(screen.getByRole('menuitem', { name: 'Resume' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Pause' })).toBeNull()
  })

  it('asks before stopping, and sends why', async () => {
    renderTable(loaded([enrollment({})]))
    open('Casey Morgan')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop' }))
    expect(screen.getByText(/they can’t be enrolled in it again/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Why (optional)'), {
      target: { value: 'Asked on a call' },
    })
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop' }),
    )
    await waitFor(() =>
      expect(api.actOnEnrollment).toHaveBeenCalledWith(
        'seq-1_c-1',
        'stop',
        'Asked on a call',
      ),
    )
  })

  it('asks before marking do-not-contact, and says which other sequences it stopped', async () => {
    api.actOnEnrollment.mockResolvedValue({
      ok: true,
      changed: true,
      stoppedOthers: 2,
      enrollment: {} as OutreachEnrollment,
    })
    renderTable(
      loaded([
        enrollment({ status: 'finished', stepIndex: 3, nextDueAtMs: null }),
      ]),
    )
    open('Casey Morgan')
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Mark do-not-contact' }),
    )
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Mark do-not-contact',
      }),
    )
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Marked do-not-contact, and stopped in 2 other sequences.',
        {
          variant: 'success',
        },
      ),
    )
  })

  it('says a refused action in the route’s words', async () => {
    api.actOnEnrollment.mockRejectedValue(
      new Error(
        "This enrollment was stopped, so it can't be marked as one that is active.",
      ),
    )
    renderTable(
      loaded([enrollment({ status: 'paused', stopReason: 'manual' })]),
    )
    open('Casey Morgan')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Resume' }))
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        "This enrollment was stopped, so it can't be marked as one that is active.",
        { variant: 'error', allowDuplicate: true },
      ),
    )
  })
})
