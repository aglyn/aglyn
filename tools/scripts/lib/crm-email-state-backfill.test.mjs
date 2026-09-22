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

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import {
  personKey,
  planRecordEmailState,
  stateFromDoNotContact,
  stateFromSuppression,
  strongestState,
  toMs,
} from './crm-email-state-backfill.mjs'

const AT = 1_790_000_000_000

describe('the address key (AGL-3245)', () => {
  it('is sha256 of the normalized address, as every list keys it', () => {
    assert.equal(personKey(' Morgan@KCorp.Example '), createHash('sha256').update('morgan@kcorp.example').digest('hex'))
    assert.equal(personKey('nobody'), null)
  })

  it('reads a Timestamp, a number or a date as epoch ms', () => {
    assert.equal(toMs({ toMillis: () => AT }), AT)
    assert.equal(toMs({ seconds: 1_790_000_000 }), AT)
    assert.equal(toMs(AT), AT)
    assert.equal(toMs('2026-09-22T15:30:00Z'), Date.UTC(2026, 8, 22, 15, 30))
    assert.equal(toMs(null), 0)
  })
})

describe('what each list says', () => {
  it('reads a platform suppression: a bounce, a complaint, a staff entry, never a released one', () => {
    assert.deepEqual(stateFromSuppression({ reason: 'bounce', context: 'campaign', suppressedAt: AT }), {
      status: 'bounced',
      atMs: AT,
      source: 'campaign',
      detail: 'Reported by the campaign send.',
    })
    assert.equal(stateFromSuppression({ reason: 'complaint', context: 'outreach', suppressedAt: AT }).status, 'complained')
    assert.equal(stateFromSuppression({ reason: 'complaint', context: 'outreach', suppressedAt: AT }).source, 'outreach')
    assert.deepEqual(stateFromSuppression({ reason: 'staff', suppressedAt: AT }), {
      status: 'do_not_contact',
      atMs: AT,
      source: 'member',
      detail: 'Suppressed by staff.',
    })
    assert.equal(stateFromSuppression({ reason: 'bounce', suppressedAt: AT, releasedAt: AT + 1 }), null)
    assert.equal(stateFromSuppression(null), null)
  })

  it('reads a do-not-contact entry by its reason, keeping the member and the enrollment', () => {
    assert.deepEqual(
      stateFromDoNotContact({ reason: 'gateway_block', source: 'runtime', addedAtMs: AT, detail: '550 (the address:blocked)', enrollmentId: 'e1' }),
      { status: 'blocked', atMs: AT, source: 'outreach', detail: '550 (the address:blocked)', enrollmentId: 'e1' },
    )
    assert.equal(stateFromDoNotContact({ reason: 'manual', source: 'member', addedAtMs: AT }).source, 'member')
    assert.equal(stateFromDoNotContact({ reason: 'unsubscribe', source: 'runtime', addedAtMs: AT }).status, 'unsubscribed')
    assert.equal(stateFromDoNotContact({ reason: 'opt_out_reply', source: 'runtime', addedAtMs: AT }).status, 'do_not_contact')
    assert.equal(stateFromDoNotContact({ reason: 'hard_bounce', source: 'runtime', addedAtMs: AT }).status, 'bounced')
  })

  it('keeps the strongest verdict, and the latest of equals', () => {
    const bounced = { status: 'bounced', atMs: AT, source: 'campaign', detail: null }
    const blocked = { status: 'blocked', atMs: AT - 1, source: 'outreach', detail: null }
    const later = { ...bounced, atMs: AT + 5 }
    assert.equal(strongestState([bounced, blocked]).status, 'blocked')
    assert.equal(strongestState([bounced, later]).atMs, AT + 5)
    assert.equal(strongestState([null, undefined]), null)
  })
})

describe('what a record should hold', () => {
  const suppression = { reason: 'bounce', context: 'outreach', suppressedAt: AT }
  const doNotContact = { reason: 'gateway_block', source: 'runtime', addedAtMs: AT, detail: 'blocked' }

  it('plans the strongest verdict for a record that holds none', () => {
    assert.deepEqual(planRecordEmailState({ record: {}, suppression, doNotContact }), {
      status: 'blocked',
      atMs: AT,
      source: 'outreach',
      detail: 'blocked',
    })
  })

  it('plans nothing when the lists hold nothing, when the record already holds it, or when it holds something stronger', () => {
    assert.equal(planRecordEmailState({ record: {}, suppression: null, doNotContact: null }), null)
    assert.equal(
      planRecordEmailState({
        record: { emailState: { status: 'blocked', atMs: AT, source: 'outreach', detail: 'blocked' } },
        suppression,
        doNotContact,
      }),
      null,
    )
    assert.equal(
      planRecordEmailState({
        record: { emailState: { status: 'do_not_contact', atMs: 1, source: 'member', detail: 'Asked' } },
        suppression,
        doNotContact,
      }),
      null,
    )
    // A weaker verdict already held is replaced.
    assert.equal(
      planRecordEmailState({
        record: { emailState: { status: 'bounced', atMs: 1, source: 'campaign', detail: null } },
        suppression,
        doNotContact,
      }).status,
      'blocked',
    )
  })
})
