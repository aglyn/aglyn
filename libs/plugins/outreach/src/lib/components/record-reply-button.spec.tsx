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

import { fireEvent, render, screen } from '@testing-library/react'
import type { OutreachEnrollment } from '../model/outreach.types'
import { OutreachRecordReplyButton, outreachEnrollmentToAnswer } from './record-reply-button'

/**
 * "REPLY IN THREAD FROM <MAILBOX>" ON A CRM RECORD (AGL-4020): offered ahead
 * of Send email once one of the person's enrollments heard from them, and
 * opening the same composer as the enrollment's own page.
 */

const mockApi = { readEnrollmentThread: jest.fn(), replyToEnrollment: jest.fn() }
jest.mock('./use-outreach-api', () => ({ useOutreachApi: () => mockApi }))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: jest.fn() }) }))
// One instance, as the provider hands out: a new one per render would reopen every listener.
const mockDb = {}
jest.mock('@aglyn/tenant-feature-instance', () => ({ useFirestore: () => mockDb }))

/** What each listener answers, by the path it opened. */
let mockDocs: { enrollments: Array<{ id: string; data: Record<string, unknown> }>; mailbox: Record<string, unknown> | null }
const mockQueried: unknown[][] = []
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/'), id: path.at(-1) }),
  where: (...clause: unknown[]) => ({ where: clause }),
  limit: (count: number) => ({ limit: count }),
  query: (ref: { path: string }, ...clauses: unknown[]) => {
    mockQueried.push(clauses)
    return { ...ref, clauses }
  },
  onSnapshot: (ref: { path: string; id?: string; clauses?: unknown[] }, next: (snapshot: unknown) => void) => {
    if (ref.clauses) {
      next({ docs: mockDocs.enrollments.map((entry) => ({ id: entry.id, data: () => entry.data })) })
    } else {
      next({ id: ref.id, exists: () => mockDocs.mailbox !== null, data: () => mockDocs.mailbox ?? undefined })
    }
    return () => undefined
  },
}))

const T = Date.parse('2026-10-21T13:02:00Z')

const stored = (fields: Record<string, unknown> = {}) => ({
  sequenceId: 'seq-1',
  email: 'pat@prospect.example.com',
  contactName: 'Pat Example',
  mailboxId: 'mbx-m365',
  status: 'replied',
  stopReason: 'reply',
  stoppedAtMs: T,
  gmailThreadIds: ['conv-1'],
  messageIds: [],
  ...fields,
})

const reply = { id: 'in-1', from: 'pat@prospect.example.com', atMs: T, kind: 'reply', body: 'Tell me more.' }

beforeEach(() => {
  jest.clearAllMocks()
  mockQueried.length = 0
  mockApi.readEnrollmentThread.mockReturnValue(new Promise(() => undefined))
  mockDocs = {
    enrollments: [{ id: 'seq-1_c-1', data: stored({ inboundMessages: [reply] }) }],
    mailbox: { email: 'zach@tryaglyn.example', sendAs: 'zach@tryaglyn.example', status: 'connected', timezone: 'America/Chicago' },
  }
})

const renderButton = (email: string | null = 'Pat@Prospect.example.com') =>
  render(
    <OutreachRecordReplyButton hostId="host-1" orgId="org-1" kind="lead" recordId="lead-1" name="Pat Example" email={email} />,
  )

describe('the CRM record’s Reply in thread', () => {
  it('names the mailbox the answer goes from, and opens the composer on the person’s enrollment', () => {
    renderButton()
    // The person's enrollments, by their normalized address.
    expect(mockQueried[0]).toEqual([{ where: ['email', '==', 'pat@prospect.example.com'] }, { limit: 20 }])
    fireEvent.click(screen.getByRole('button', { name: 'Reply in thread from zach@tryaglyn.example' }))
    expect(screen.getByRole('dialog', { name: 'Reply to Pat Example' })).toBeTruthy()
    expect(mockApi.readEnrollmentThread).toHaveBeenCalledWith('seq-1_c-1')
  })

  it('draws nothing for a person no sequence heard from, one who opted out, or a mailbox that is gone', () => {
    mockDocs.enrollments = [{ id: 'seq-1_c-1', data: stored({ status: 'active', stopReason: null, stoppedAtMs: null }) }]
    const quiet = renderButton()
    expect(screen.queryByRole('button')).toBeNull()
    quiet.unmount()
    mockDocs.enrollments = [{ id: 'seq-1_c-1', data: stored({ status: 'opted_out', stopReason: 'opt_out_reply', inboundMessages: [reply] }) }]
    const optedOut = renderButton()
    expect(screen.queryByRole('button')).toBeNull()
    optedOut.unmount()
    mockDocs = { enrollments: [{ id: 'seq-1_c-1', data: stored({ inboundMessages: [reply] }) }], mailbox: null }
    renderButton()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('answers in the thread that heard from them last', () => {
    const enrollment = (id: string, fields: Partial<OutreachEnrollment>) =>
      ({ id, status: 'replied', stopReason: 'reply', stoppedAtMs: null, ...fields }) as OutreachEnrollment
    expect(
      outreachEnrollmentToAnswer([
        enrollment('older', { stoppedAtMs: T - 86_400_000 }),
        enrollment('newer', { inboundMessages: [{ ...reply, atMs: T } as never] }),
        enrollment('bounced', { status: 'bounced', stoppedAtMs: T + 1 }),
      ])?.id,
    ).toBe('newer')
    expect(outreachEnrollmentToAnswer([])).toBeNull()
  })
})
