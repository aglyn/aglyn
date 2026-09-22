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
 *
 * @jest-environment node
 */

import {
  composeOutreachMailboxNotice,
  outreachMailboxNoticeName,
  outreachReconnectRequiredSentence,
} from './mailbox-notice'

const MAILBOX = { email: 'avery@example.com', sendAs: 'avery@example.com', displayName: 'Avery Quinn' }
const URL = 'https://app.aglyn.com/example-co/outreach/mailboxes'

describe('composeOutreachMailboxNotice (AGL-3244)', () => {
  it('tells the owner of a pause in the engine’s own words, with the count waiting and the Resume link', () => {
    const email = composeOutreachMailboxNotice(
      {
        kind: 'auto_pause',
        mailbox: MAILBOX,
        message: 'Paused: 2 of the last 50 emails hard-bounced (4.0%). Re-check the addresses in your sequences before resuming.',
        waiting: 3,
      },
      { mailboxesUrl: URL },
    )
    expect(email.subject).toBe('Sequences paused your mailbox avery@example.com')
    expect(email.text).toBe(
      [
        'Sequences paused the mailbox Avery Quinn <avery@example.com>.',
        'Paused: 2 of the last 50 emails hard-bounced (4.0%). Re-check the addresses in your sequences before resuming.',
        '3 enrollments are active on it and waiting; their next emails go out once the mailbox sends again.',
        'Re-check the addresses in the sequences it sends, then open Mailboxes and select Resume.',
        URL,
        'You are getting this because the mailbox is yours, or you manage the organization it belongs to.',
      ].join('\n\n'),
    )
  })

  it('tells the owner a mailbox needs reconnecting, with the Reconnect link', () => {
    const email = composeOutreachMailboxNotice(
      {
        kind: 'reconnect_required',
        mailbox: { ...MAILBOX, sendAs: 'sales@example.com' },
        message: outreachReconnectRequiredSentence('invalid_grant'),
        waiting: 1,
      },
      { mailboxesUrl: URL },
    )
    expect(email.subject).toBe('Your mailbox avery@example.com needs reconnecting')
    expect(email.text).toContain('The mailbox Avery Quinn <avery@example.com>, sending as sales@example.com needs reconnecting.')
    expect(email.text).toContain('Google stopped accepting this mailbox’s connection (invalid_grant)')
    expect(email.text).toContain('1 enrollment is active on it and waiting;')
    expect(email.text).toContain('Open Mailboxes and select Reconnect to connect it again.\n\n' + URL)
  })

  it('says where Mailboxes is when no link can be minted, and that nothing is waiting when nothing is', () => {
    const email = composeOutreachMailboxNotice(
      { kind: 'auto_pause', mailbox: { ...MAILBOX, displayName: '' }, message: 'Paused.', waiting: 0 },
      { mailboxesUrl: null },
    )
    expect(email.text).toContain('Sequences paused the mailbox avery@example.com.')
    expect(email.text).toContain('No enrollment is waiting on it right now.')
    expect(email.text).toContain('Mailboxes is under Sequences in your workspace’s console.')
    expect(email.text).not.toContain('https://')
  })

  it('names the mailbox by its display name, and its send-as only when that differs', () => {
    expect(outreachMailboxNoticeName(MAILBOX)).toBe('Avery Quinn <avery@example.com>')
    expect(outreachMailboxNoticeName({ ...MAILBOX, sendAs: 'Avery@Example.com' })).toBe('Avery Quinn <avery@example.com>')
    expect(outreachMailboxNoticeName({ ...MAILBOX, displayName: ' ', sendAs: '' })).toBe('avery@example.com')
  })
})
