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
 * @jest-environment node
 */

import { matchOutreachPossibleReply, outreachPossibleReplyNote, outreachPossibleReplyTitle } from './possible-reply'

const enrollment = (id: string, email: string, mailboxId: string, lastSentAtMs = 0) => ({ id, email, mailboxId, lastSentAtMs })

describe('matchOutreachPossibleReply (AGL-4088)', () => {
  const enrollments = [
    enrollment('a', 'owner@acme.com', 'ms_one', 100),
    enrollment('b', 'founder@studio.io', 'ms_two', 200),
    enrollment('c', 'ceo@acme.com', 'ms_two', 300),
    enrollment('d', 'someone@gmail.com', 'ms_one', 400),
  ]

  it('leaves a message from the receiving mailbox’s own enrollment to the sync’s from-search', () => {
    expect(matchOutreachPossibleReply('owner@acme.com', { mailboxId: 'ms_one', enrollments })).toBeNull()
  })

  it('names the enrollment when the person wrote to another of our mailboxes', () => {
    expect(matchOutreachPossibleReply('Founder@Studio.io', { mailboxId: 'ms_one', enrollments })).toEqual({
      enrollment: enrollments[1],
      reason: 'other_inbox',
    })
  })

  it('names the most recently written enrollment at the company when a colleague writes', () => {
    expect(matchOutreachPossibleReply('marketing@acme.com', { mailboxId: 'ms_one', enrollments })).toEqual({
      enrollment: enrollments[2],
      reason: 'colleague',
    })
  })

  it('never treats a public mailbox domain as a company', () => {
    expect(matchOutreachPossibleReply('stranger@gmail.com', { mailboxId: 'ms_two', enrollments })).toBeNull()
  })

  it('ignores a sender with no enrolled company, and an unreadable address', () => {
    expect(matchOutreachPossibleReply('vendor@elsewhere.com', { mailboxId: 'ms_one', enrollments })).toBeNull()
    expect(matchOutreachPossibleReply('not an address', { mailboxId: 'ms_one', enrollments })).toBeNull()
  })
})

describe('the possible-reply task', () => {
  it('titles it with the sender and their company domain', () => {
    expect(outreachPossibleReplyTitle('Pat Lee', 'pat@acme.com')).toBe('Possible reply from Pat Lee (acme.com)')
    expect(outreachPossibleReplyTitle('', 'pat@acme.com')).toBe('Possible reply from pat@acme.com (acme.com)')
  })

  it('says why it was filed and that the sequence was not stopped', () => {
    const note = outreachPossibleReplyNote({
      reason: 'colleague',
      enrolledName: 'Eric B.',
      receivedBy: 'zach@tryaglyn.com',
      excerpt: 'Eric passed this to me.',
    })
    expect(note).toContain('A colleague of Eric B. wrote to zach@tryaglyn.com.')
    expect(note).toContain('keeps going')
    expect(note).toContain('Eric passed this to me.')
  })
})
