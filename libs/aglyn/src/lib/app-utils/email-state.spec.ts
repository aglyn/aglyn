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
  CRM_EMAIL_STATE_LABELS,
  CRM_EMAIL_STATE_STATUSES,
  crmEmailStateForbidsEmail,
  crmEmailStateRefusal,
  nextCrmEmailState,
  readCrmEmailState,
  type CrmEmailState,
} from './email-state'

const AT = Date.UTC(2026, 8, 22, 15, 30)
const state = (status: CrmEmailState['status'], extra: Partial<CrmEmailState> = {}): CrmEmailState => ({
  status,
  atMs: AT,
  source: 'outreach',
  detail: null,
  ...extra,
})

describe('a record’s email state (AGL-3245)', () => {
  it('reads a stored state held to its shape, and nothing from a record that holds none', () => {
    expect(readCrmEmailState({ emailState: { status: 'blocked', atMs: AT, source: 'outreach', detail: 'x', enrollmentId: 'e1' } })).toEqual(
      { status: 'blocked', atMs: AT, source: 'outreach', detail: 'x', enrollmentId: 'e1' },
    )
    expect(readCrmEmailState({ emailState: { status: 'whim' } })).toBeNull()
    expect(readCrmEmailState({ emailState: { status: 'bounced', atMs: 'soon', source: 'robot' } })).toEqual({
      status: 'bounced',
      atMs: 0,
      source: 'campaign',
      detail: null,
    })
    expect(readCrmEmailState({})).toBeNull()
    expect(readCrmEmailState(null)).toBeNull()
  })

  it('forbids email for every state but ok, and labels every state', () => {
    for (const status of CRM_EMAIL_STATE_STATUSES) {
      expect(crmEmailStateForbidsEmail(state(status))).toBe(status !== 'ok')
      expect(CRM_EMAIL_STATE_LABELS[status]).toBeTruthy()
    }
    expect(crmEmailStateForbidsEmail(null)).toBe(false)
  })

  it('keeps the stronger verdict: a member’s mark over a bounce, a block over a bounce, never ok over a refusal', () => {
    expect(nextCrmEmailState(state('do_not_contact', { source: 'member' }), state('bounced')).status).toBe('do_not_contact')
    expect(nextCrmEmailState(state('bounced'), state('blocked')).status).toBe('blocked')
    expect(nextCrmEmailState(state('blocked'), state('bounced')).status).toBe('blocked')
    expect(nextCrmEmailState(state('bounced', { atMs: 1 }), state('bounced')).atMs).toBe(AT)
    expect(nextCrmEmailState(state('unsubscribed'), state('ok')).status).toBe('unsubscribed')
    expect(nextCrmEmailState(state('unsubscribed'), state('ok'), { force: true }).status).toBe('ok')
    expect(nextCrmEmailState(null, state('ok')).status).toBe('ok')
  })

  it('says why the record must not be emailed, with the date and the sender’s words', () => {
    expect(crmEmailStateRefusal(state('blocked', { detail: '550 (the address:blocked)' }))).toBe(
      'Their mail gateway blocked email to this address on Sep 22, 2026. 550 (the address:blocked)',
    )
    expect(crmEmailStateRefusal(state('bounced'))).toBe(
      'Email to this address bounced on Sep 22, 2026: the mailbox does not exist.',
    )
    expect(crmEmailStateRefusal(state('do_not_contact', { atMs: 0, source: 'member', detail: 'Asked on a call' }))).toBe(
      'On the do-not-contact list. Asked on a call',
    )
    expect(crmEmailStateRefusal(state('ok'))).toBeNull()
    expect(crmEmailStateRefusal(null)).toBeNull()
  })
})
