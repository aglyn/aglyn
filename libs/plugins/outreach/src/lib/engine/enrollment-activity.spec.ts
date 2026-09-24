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
 * The words a sequence files about itself (AGL-3274), and the keys that
 * file each of them once per enrollment.
 */

import {
  OUTREACH_TIMELINE_BY_NAME,
  outreachCuratedEntry,
  outreachCuratedEntryKey,
  outreachEnrolledEntry,
  outreachEnrolledEntryKey,
  outreachStoppedEntry,
} from './enrollment-activity'

describe('outreachEnrolledEntry', () => {
  it('names the sequence and the campaigns it carried the person into, keyed once per enrollment', () => {
    expect(
      outreachEnrolledEntry({
        enrollmentId: 'seq-1_lead-key',
        sequenceName: 'Founder · ICP 2 multi-brand',
        campaignNames: ['Outbound · ICP 2 brands', ' ', 'Spring'],
      }),
    ).toEqual({
      dedupeKey: 'enrolled:seq-1_lead-key',
      body: 'Enrolled in Founder · ICP 2 multi-brand\nFiled under Outbound · ICP 2 brands, Spring',
    })
    expect(outreachEnrolledEntryKey('e-1')).toBe('enrolled:e-1')
  })

  it('reads as one line for a sequence in no campaign, and never prints an empty name', () => {
    expect(outreachEnrolledEntry({ enrollmentId: 'e-1', sequenceName: 'Founder', campaignNames: [] }).body).toBe(
      'Enrolled in Founder',
    )
    expect(outreachEnrolledEntry({ enrollmentId: 'e-1', sequenceName: '', campaignNames: [] }).body).toBe(
      'Enrolled in a sequence',
    )
  })
})

describe('outreachStoppedEntry', () => {
  it('says why the sequence stopped, keyed once per enrollment', () => {
    expect(outreachStoppedEntry({ enrollmentId: 'e-1', sequenceName: 'Founder', reason: 'replied' })).toEqual({
      dedupeKey: 'stopped:e-1',
      body: 'Founder stopped: they replied',
    })
    expect(outreachStoppedEntry({ enrollmentId: 'e-1', sequenceName: '', reason: 'opted_out' }).body).toBe(
      'The sequence stopped: they opted out',
    )
  })
})

describe('outreachCuratedEntry (AGL-3324)', () => {
  it('says who wrote the person’s copy of the step, keyed once per confirmation', () => {
    expect(
      outreachCuratedEntry({ enrollmentId: 'e-1', stepIndex: 1, source: 'ai', edited: true, memberName: 'Zach', atMs: 5 }),
    ).toEqual({ dedupeKey: 'curated:e-1:1:5', body: 'Curated step 2 — AI draft, edited by Zach' })
    expect(
      outreachCuratedEntry({ enrollmentId: 'e-1', stepIndex: 0, source: 'ai', edited: false, memberName: 'Zach', atMs: 5 }).body,
    ).toBe('Curated step 1 — AI draft, confirmed by Zach')
    expect(
      outreachCuratedEntry({ enrollmentId: 'e-1', stepIndex: 2, source: 'member', edited: false, memberName: 'zach@example.com', atMs: 5 }).body,
    ).toBe('Curated step 3 — written by zach@example.com')
    expect(
      outreachCuratedEntry({ enrollmentId: 'e-1', stepIndex: 2, source: 'member', edited: false, memberName: '  ', atMs: 5 }).body,
    ).toBe('Curated step 3 — written by a member')
    expect(outreachCuratedEntryKey('e-1', 3, 9)).toBe('curated:e-1:3:9')
  })
})

describe('the author', () => {
  it('is the runtime, never a member', () => {
    expect(OUTREACH_TIMELINE_BY_NAME).toBe('Sequences')
  })
})
