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
import type { OutreachEnrollmentThreadResponse } from '../model/outreach-api'
import type { OutreachEnrollment, OutreachInboundMessage } from '../model/outreach.types'
import { OutreachReplyDialog, outreachReplyThreadLines } from './reply-dialog'

/**
 * THE REPLY COMPOSER (AGL-4020): what a member sees before answering a
 * person who wrote back — where it goes, the conversation, anything that
 * still refuses — and what Send hands the route.
 */

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

const T = Date.parse('2026-10-21T13:02:00Z') // 8:02 AM in Chicago

const theirReply = (fields: Partial<OutreachInboundMessage> = {}): OutreachInboundMessage => ({
  id: 'in-1',
  threadId: 'thread-1',
  messageId: '<reply-1@prospect.example.com>',
  references: ['<step-1@rep.example.org>'],
  from: 'pat@prospect.example.com',
  fromName: 'Pat Example',
  replyTo: null,
  subject: 'Re: Your restoration sites',
  atMs: T,
  kind: 'reply',
  body: 'Interesting — what does onboarding look like?',
  ...fields,
})

const enrollment = (overrides: Partial<OutreachEnrollment> = {}): OutreachEnrollment =>
  ({
    id: 'seq-1_c-1',
    sequenceId: 'seq-1',
    contactName: 'Pat Example',
    email: 'pat@prospect.example.com',
    status: 'replied',
    stopReason: 'reply',
    stoppedAtMs: T,
    inboundMessages: [theirReply()],
    stepRecords: [{ stepIndex: 0, stepId: 'a', kind: 'email', atMs: T - 86_400_000, subject: 'Your restoration sites' }],
    ...overrides,
  }) as OutreachEnrollment

const answer = (overrides: Partial<OutreachEnrollmentThreadResponse> = {}): OutreachEnrollmentThreadResponse => ({
  ok: true,
  enrollment: enrollment(),
  inboundMessages: [theirReply()],
  draft: {
    answerId: 'in-1',
    tracksLinks: false,
    to: 'pat@prospect.example.com',
    subject: 'Re: Your restoration sites',
    from: { address: 'zach@rep.example.org', name: 'Zach Rep', provider: 'microsoft' },
  },
  refusal: null,
  readMailbox: false,
  ...overrides,
})

const api = { readEnrollmentThread: jest.fn(), replyToEnrollment: jest.fn() }

const open = (props: Partial<Parameters<typeof OutreachReplyDialog>[0]> = {}) => {
  const onClose = jest.fn()
  const onSent = jest.fn()
  render(
    <OutreachReplyDialog
      enrollment={enrollment()}
      api={api}
      timeZone="America/Chicago"
      onClose={onClose}
      onSent={onSent}
      {...props}
    />,
  )
  return { onClose, onSent }
}

beforeEach(() => {
  jest.clearAllMocks()
  api.readEnrollmentThread.mockResolvedValue(answer())
  api.replyToEnrollment.mockResolvedValue({
    ok: true,
    enrollment: enrollment(),
    record: { kind: 'manual_reply' },
    sentTo: 'pat@prospect.example.com',
    subject: 'Re: Your restoration sites',
    alreadySent: false,
  })
})

describe('the conversation, as the composer lists it', () => {
  it('puts their words, every answer and the sequence’s emails in the order they happened', () => {
    const lines = outreachReplyThreadLines(
      enrollment({
        inboundMessages: [theirReply(), theirReply({ id: 'in-2', atMs: T + 7_200_000, body: 'Thanks!' })],
        stepRecords: [
          { stepIndex: 0, stepId: 'a', kind: 'email', atMs: T - 86_400_000, subject: 'Your restoration sites' },
          { stepIndex: 1, stepId: '', kind: 'manual_reply', atMs: T + 3_600_000, from: 'zach@rep.example.org', body: 'About a week.' },
        ],
      }),
    )
    expect(lines.map((line) => [line.who, line.inbound])).toEqual([
      ['Sequence email', false],
      ['Pat Example <pat@prospect.example.com>', true],
      ['You, from zach@rep.example.org', false],
      ['Pat Example <pat@prospect.example.com>', true],
    ])
  })
})

describe('the composer', () => {
  it('reads the thread, says where the answer goes, and sends the member’s words in it', async () => {
    const { onClose, onSent } = open()
    expect(screen.getByRole('status').textContent).toContain('Reading their reply…')
    await screen.findByText('Zach Rep <zach@rep.example.org>')
    const dialog = screen.getByRole('dialog', { name: 'Reply to Pat Example' })
    expect(within(dialog).getByText('Zach Rep <zach@rep.example.org>')).toBeTruthy()
    expect(within(dialog).getByText('pat@prospect.example.com')).toBeTruthy()
    expect(within(dialog).getAllByText('Re: Your restoration sites').length).toBeGreaterThan(0)
    const conversation = within(dialog).getByRole('list', { name: 'The conversation' })
    expect(within(conversation).getByText('Interesting — what does onboarding look like?')).toBeTruthy()
    expect(api.readEnrollmentThread).toHaveBeenCalledWith('seq-1_c-1')

    const send = within(dialog).getByRole('button', { name: 'Send answer' })
    expect((send as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('Your answer'), { target: { value: 'About a week, start to finish.' } })
    expect((send as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(send)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(api.replyToEnrollment).toHaveBeenCalledWith({
      enrollmentId: 'seq-1_c-1',
      body: 'About a week, start to finish.',
      answerId: 'in-1',
      replyKey: expect.stringMatching(/^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/),
    })
    expect(onSent).toHaveBeenCalled()
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith('Answer sent to pat@prospect.example.com.', { variant: 'success' })
  })

  it('says the links go out tracked on a sequence that counts clicks (AGL-4022)', async () => {
    api.readEnrollmentThread.mockResolvedValue(answer({ draft: { ...answer().draft!, tracksLinks: true } }))
    open()
    expect(await screen.findByText(/Links you write go out as tracked short links/)).toBeTruthy()
  })

  it('says why an answer cannot go before anything is typed, and offers no Send', async () => {
    api.readEnrollmentThread.mockResolvedValue(
      answer({
        refusal: {
          code: 'mailbox-unavailable',
          message: 'zach@rep.example.org is paused. Resume it on the Mailboxes page to answer from it.',
        },
      }),
    )
    open()
    expect(
      await screen.findByText('zach@rep.example.org is paused. Resume it on the Mailboxes page to answer from it.'),
    ).toBeTruthy()
    expect(screen.queryByLabelText('Your answer')).toBeNull()
    expect((screen.getByRole('button', { name: 'Send answer' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says so when nothing they wrote could be read', async () => {
    api.readEnrollmentThread.mockResolvedValue(answer({ draft: null, inboundMessages: [] }))
    open({ enrollment: enrollment({ inboundMessages: undefined }) })
    expect(await screen.findByText(/Nothing they wrote could be read from the mailbox/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Send answer' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps the words when the send fails, and sends the SAME answer again', async () => {
    api.replyToEnrollment.mockRejectedValueOnce(new Error('The mail provider is not answering. Try again.'))
    open()
    const field = await screen.findByLabelText('Your answer')
    fireEvent.change(field, { target: { value: 'About a week.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }))
    expect(await screen.findByText('The mail provider is not answering. Try again.')).toBeTruthy()
    expect((screen.getByLabelText('Your answer') as HTMLTextAreaElement).value).toBe('About a week.')
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }))
    await waitFor(() => expect(api.replyToEnrollment).toHaveBeenCalledTimes(2))
    const [first, second] = api.replyToEnrollment.mock.calls.map(([input]) => input.replyKey)
    expect(second).toBe(first)
  })
})
