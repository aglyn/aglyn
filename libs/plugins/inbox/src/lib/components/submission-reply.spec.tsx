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
 * The composer, and the one sentence it exists to say.
 *
 * The assertions that matter are about what the merchant is TOLD, not about
 * the send: nothing receives mail for this platform, so a composer that looks
 * like a mail client without saying where answers go teaches someone to wait
 * here for a reply that is already in their own inbox. The send itself is
 * asserted against the handler in `../server.spec.ts`, where the envelope is.
 *
 * No jest-dom in this repo; plain DOM assertions throughout.
 */

import { fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SubmissionReply } from './submission-reply.component'

let host: Record<string, unknown> | undefined
let sentReplies: Array<Record<string, unknown>>

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreDoc: () => ({ data: host }),
  useFirestoreCollection: () => ({ data: sentReplies }),
  useUser: () => ({
    data: { email: 'owner@lumen.co', getIdToken: async () => 'token' },
  }),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

jest.mock('firebase/firestore', () => ({
  collection: () => ({}),
  doc: () => ({}),
  limit: () => ({}),
  orderBy: () => ({}),
  query: () => ({}),
}))

const SUBMISSION = {
  $id: 'sub1',
  formName: 'Contact',
  fields: { name: 'Priya Nair', email: 'priya@lumen.co', message: 'Ship to IE?' },
}

beforeEach(() => {
  host = { displayName: 'Lumen Studio' }
  sentReplies = []
  enqueueSnackbar.mockReset()
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ sent: true, to: 'priya@lumen.co', replyId: 'r1' }),
  }) as never
})

/**
 * The load-bearing sentence. A merchant who does not read this will wait in
 * the Inbox for an answer that arrives in their own mailbox.
 */
it('says answers arrive in the merchant email, not in the Inbox', () => {
  const { container } = render(
    <SubmissionReply hostId="host1" submission={SUBMISSION} />,
  )
  expect(container.textContent).toContain('Answers arrive in your email, not in this Inbox.')
})

it('names the address answers will come back to', () => {
  const { container } = render(
    <SubmissionReply hostId="host1" submission={SUBMISSION} />,
  )
  expect(container.textContent).toContain('owner@lumen.co')
})

it('shows the address the reply will go to', () => {
  const { container } = render(
    <SubmissionReply hostId="host1" submission={SUBMISSION} />,
  )
  expect(container.textContent).toContain('To priya@lumen.co')
})

/**
 * A form with no email field cannot be answered at all, and the composer says
 * so rather than offering a Send that would refuse server-side.
 */
it('offers no composer when the submission carried no address', () => {
  const { container } = render(
    <SubmissionReply
      hostId="host1"
      submission={{ $id: 'sub2', fields: { name: 'Priya' } }}
    />,
  )
  expect(container.textContent).toContain('nobody to reply to')
  expect(container.querySelector('textarea')).toBeNull()
})

it('seeds the subject from the site name, which is what the recipient recognizes', () => {
  const { container } = render(
    <SubmissionReply hostId="host1" submission={SUBMISSION} />,
  )
  const subject = container.querySelector('input') as HTMLInputElement
  expect(subject.value).toBe('Re: your message to Lumen Studio')
})

it('will not send an empty message', () => {
  const { getByText } = render(
    <SubmissionReply hostId="host1" submission={SUBMISSION} />,
  )
  expect((getByText('Send reply').closest('button') as HTMLButtonElement).disabled).toBe(
    true,
  )
})

it('posts the submission id and lets the server resolve the recipient', async () => {
  const { container, getByText } = render(
    <SubmissionReply hostId="host1" submission={SUBMISSION} />,
  )
  const textarea = container.querySelector('textarea') as HTMLTextAreaElement
  fireEvent.change(textarea, { target: { value: 'Yes, we ship to Ireland.' } })
  fireEvent.click(getByText('Send reply'))
  await waitFor(() => expect(global.fetch).toHaveBeenCalled())
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toBe('/api/inbox/reply')
  const body = JSON.parse(init.body)
  expect(body).toEqual({
    hostId: 'host1',
    submissionId: 'sub1',
    subject: 'Re: your message to Lumen Studio',
    message: 'Yes, we ship to Ireland.',
  })
  expect(body).not.toHaveProperty('to')
})

/**
 * A refusal from the handler is the merchant's answer — a suppressed address
 * is the case this matters for, and swallowing it would leave someone
 * believing a message went out.
 */
it('surfaces the server refusal instead of reporting success', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue({
    ok: false,
    json: async () => ({
      error: 'This address unsubscribed from this site, so it cannot be mailed.',
    }),
  })
  const { container, getByText } = render(
    <SubmissionReply hostId="host1" submission={SUBMISSION} />,
  )
  fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, {
    target: { value: 'Hello' },
  })
  fireEvent.click(getByText('Send reply'))
  await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
  expect(enqueueSnackbar.mock.calls[0][0]).toContain('unsubscribed')
  expect(enqueueSnackbar.mock.calls[0][1].variant).toBe('warning')
})

/**
 * One-sided by construction: this list holds what was sent, and there is no
 * inbound path that could ever add the other half.
 */
it('lists the replies already sent', () => {
  sentReplies = [
    { $id: 'r1', sentAtMs: 1756400000000, to: 'priya@lumen.co', message: 'We do.' },
  ]
  const { container } = render(
    <SubmissionReply hostId="host1" submission={SUBMISSION} />,
  )
  expect(container.textContent).toContain('Replies sent')
  expect(container.textContent).toContain('We do.')
})
