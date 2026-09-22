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
  EMAIL_STATE_LABELS,
  EMAIL_STATE_STATUSES,
  emailStateForbidsEmail,
  emailStateRefusal,
  nextEmailState,
  readEmailState,
  type EmailState,
} from './email-state'

const AT = Date.UTC(2026, 8, 22, 15, 30)
const state = (status: EmailState['status'], extra: Partial<EmailState> = {}): EmailState => ({
  status,
  atMs: AT,
  source: 'sequence',
  detail: null,
  ...extra,
})

describe('a record’s email state (AGL-3245)', () => {
  it('reads a stored state held to its shape, and nothing from a record that holds none', () => {
    expect(readEmailState({ emailState: { status: 'blocked', atMs: AT, source: 'sequence', detail: 'x', enrollmentId: 'e1' } })).toEqual(
      { status: 'blocked', atMs: AT, source: 'sequence', detail: 'x', enrollmentId: 'e1' },
    )
    expect(readEmailState({ emailState: { status: 'whim' } })).toBeNull()
    expect(readEmailState({ emailState: { status: 'bounced', atMs: 'soon', source: 'robot' } })).toEqual({
      status: 'bounced',
      atMs: 0,
      source: 'campaign',
      detail: null,
    })
    expect(readEmailState({})).toBeNull()
    expect(readEmailState(null)).toBeNull()
  })

  it('forbids email for every state but ok, and labels every state', () => {
    for (const status of EMAIL_STATE_STATUSES) {
      expect(emailStateForbidsEmail(state(status))).toBe(status !== 'ok')
      expect(EMAIL_STATE_LABELS[status]).toBeTruthy()
    }
    expect(emailStateForbidsEmail(null)).toBe(false)
  })

  it('keeps the stronger verdict: a member’s mark over a bounce, a block over a bounce, never ok over a refusal', () => {
    expect(nextEmailState(state('do_not_contact', { source: 'member' }), state('bounced')).status).toBe('do_not_contact')
    expect(nextEmailState(state('bounced'), state('blocked')).status).toBe('blocked')
    expect(nextEmailState(state('blocked'), state('bounced')).status).toBe('blocked')
    expect(nextEmailState(state('bounced', { atMs: 1 }), state('bounced')).atMs).toBe(AT)
    expect(nextEmailState(state('unsubscribed'), state('ok')).status).toBe('unsubscribed')
    expect(nextEmailState(state('unsubscribed'), state('ok'), { force: true }).status).toBe('ok')
    expect(nextEmailState(null, state('ok')).status).toBe('ok')
  })

  it('says why the record must not be emailed, with the date and the sender’s words', () => {
    expect(emailStateRefusal(state('blocked', { detail: '550 (the address:blocked)' }))).toBe(
      'Their mail gateway blocked email to this address on Sep 22, 2026. 550 (the address:blocked)',
    )
    expect(emailStateRefusal(state('bounced'))).toBe(
      'Email to this address bounced on Sep 22, 2026: the mailbox does not exist.',
    )
    expect(emailStateRefusal(state('do_not_contact', { atMs: 0, source: 'member', detail: 'Asked on a call' }))).toBe(
      'On the do-not-contact list. Asked on a call',
    )
    expect(emailStateRefusal(state('ok'))).toBeNull()
    expect(emailStateRefusal(null)).toBeNull()
  })
})
