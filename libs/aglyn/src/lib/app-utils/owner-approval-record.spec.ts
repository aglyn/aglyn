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
 * THE OWNER'S RECORDED YES (AGL-3959). Extra time bills only on a record
 * staff wrote: how and when the owner agreed, for how many hours. These
 * cases hold what such a record may and may not say, because AGL-3970's
 * project invoices read the same module.
 */

import {
  OWNER_APPROVAL_CHANNELS,
  OWNER_APPROVAL_MAX_HOURS,
  describeHours,
  ownerApprovalSentence,
  readOwnerApprovalInput,
  readOwnerApprovalRecord,
  type OwnerApprovalRecord,
} from './owner-approval-record'

const NOW = Date.UTC(2026, 9, 19, 15, 0)
const CONTEXT = { rateUsd: 79, nowMs: NOW, by: { uid: 'staff-1', email: 'staff@aglyn.com' } }
const INPUT = { hours: 2, channel: 'phone', approvedAtMs: NOW - 60_000, note: '  New footer  ' }

describe('readOwnerApprovalInput', () => {
  it('records a first yes with who, how and when', () => {
    const read = readOwnerApprovalInput(INPUT, CONTEXT)
    expect(read).toEqual({
      ok: true,
      record: {
        hours: 2,
        rateUsd: 79,
        channel: 'phone',
        approvedAtMs: NOW - 60_000,
        recordedAtMs: NOW,
        recordedByUid: 'staff-1',
        recordedByEmail: 'staff@aglyn.com',
        note: 'New footer',
        version: 1,
        corrected: false,
        correctionReason: null,
      },
    })
  })

  it('refuses hours that are not a whole number in range', () => {
    for (const hours of [0, 1.5, OWNER_APPROVAL_MAX_HOURS + 1, 'two', undefined]) {
      const read = readOwnerApprovalInput({ ...INPUT, hours }, CONTEXT)
      expect(read.ok).toBe(false)
    }
  })

  it('refuses an unknown channel, a missing date and a yes from the future', () => {
    expect(readOwnerApprovalInput({ ...INPUT, channel: 'fax' }, CONTEXT)).toEqual({
      ok: false,
      error: 'Choose how the owner said yes.',
    })
    expect(readOwnerApprovalInput({ ...INPUT, approvedAtMs: 0 }, CONTEXT).ok).toBe(false)
    expect(readOwnerApprovalInput({ ...INPUT, approvedAtMs: NOW + 5 * 60_000 }, CONTEXT)).toEqual({
      ok: false,
      error: 'The owner’s yes cannot be in the future.',
    })
    // A minute of clock skew is tolerated.
    expect(readOwnerApprovalInput({ ...INPUT, approvedAtMs: NOW + 30_000 }, CONTEXT).ok).toBe(true)
  })

  it('needs a reason to correct, and versions the correction', () => {
    const first = (readOwnerApprovalInput(INPUT, CONTEXT) as { record: OwnerApprovalRecord }).record
    expect(readOwnerApprovalInput({ ...INPUT, hours: 3 }, { ...CONTEXT, previous: first })).toEqual({
      ok: false,
      error: 'Say why the approval is being corrected.',
    })
    const corrected = readOwnerApprovalInput(
      { ...INPUT, hours: 3, reason: 'Owner called back for one more hour' },
      { ...CONTEXT, previous: first },
    )
    expect(corrected).toEqual({
      ok: true,
      record: expect.objectContaining({
        hours: 3,
        version: 2,
        corrected: true,
        correctionReason: 'Owner called back for one more hour',
      }),
    })
  })

  it('ignores a reason on a first record', () => {
    const read = readOwnerApprovalInput({ ...INPUT, reason: 'stray' }, CONTEXT)
    expect(read.ok && read.record.correctionReason).toBeNull()
  })
})

describe('readOwnerApprovalRecord', () => {
  it('reads a stored record back with every field', () => {
    const first = (readOwnerApprovalInput(INPUT, CONTEXT) as { record: OwnerApprovalRecord }).record
    expect(readOwnerApprovalRecord(first)).toEqual(first)
  })

  it('refuses what is not a record', () => {
    expect(readOwnerApprovalRecord(null)).toBeNull()
    expect(readOwnerApprovalRecord('yes')).toBeNull()
    expect(readOwnerApprovalRecord({ hours: 0, channel: 'phone' })).toBeNull()
    expect(readOwnerApprovalRecord({ hours: 1, channel: 'carrier pigeon' })).toBeNull()
  })

  it('defaults what an old record left out', () => {
    expect(readOwnerApprovalRecord({ hours: 1, channel: 'email' })).toEqual(
      expect.objectContaining({ version: 1, corrected: false, note: null, recordedByEmail: null }),
    )
  })
})

describe('the confirmation sentence', () => {
  it('says what, how and when in the owner’s words', () => {
    expect(OWNER_APPROVAL_CHANNELS).toEqual(['in-person', 'phone', 'text', 'email'])
    expect(describeHours(1)).toBe('1 hour')
    expect(describeHours(3)).toBe('3 hours')
    expect(
      ownerApprovalSentence(
        { hours: 2, rateUsd: 79, channel: 'in-person', approvedAtMs: NOW },
        'New footer',
        () => 'Oct 19, 2026',
      ),
    ).toBe('You approved up to 2 hours of extra time at $79 an hour for “New footer”, in person on Oct 19, 2026.')
  })
})
