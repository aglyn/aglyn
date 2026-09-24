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

import type { OutreachSequenceStep } from '../model/outreach.types'
import {
  outreachStepOverrideRequests,
  outreachStepOverridesRefused,
  readOutreachStepOverrideRequests,
} from './step-overrides'

/**
 * What a request may store as one person's copy of a step (AGL-3324): an
 * email step of the sequence, once, validated, and stamped by the route.
 */

const steps: OutreachSequenceStep[] = [
  { id: 'a', kind: 'email', delayBusinessDays: 0, subject: 'Hi', replyInThread: false, body: 'Hi', templateId: null },
  { id: 'b', kind: 'task', taskKind: 'call', title: 'Call', delayBusinessDays: 1 },
  { id: 'c', kind: 'email', delayBusinessDays: 3, subject: '', replyInThread: true, body: 'Again', templateId: null },
]
const STAMP = { uid: 'uid-rep', nowMs: 1_700_000_000_000 }

describe('readOutreachStepOverrideRequests', () => {
  it('reads each copy, keyed by step index, stamped with who confirmed and when', () => {
    const read = readOutreachStepOverrideRequests(
      [
        { stepIndex: 0, subject: '  Casey,  your sites ', body: 'Hi Casey,\r\n\r\nSaw it.', source: 'ai', edited: true, prompt: 'P', model: 'm-1' },
        { stepIndex: 2, subject: 'ignored in thread', body: 'Following up.', source: 'member', prompt: 'not kept', edited: true },
      ],
      steps,
      STAMP,
    )
    expect(read.refusal).toBeNull()
    expect(read.issues).toEqual([])
    expect(read.overrides).toEqual({
      '0': {
        subject: 'Casey, your sites',
        body: 'Hi Casey,\n\nSaw it.',
        source: 'ai',
        edited: true,
        prompt: 'P',
        model: 'm-1',
        draftedAtMs: STAMP.nowMs,
        draftedByUid: 'uid-rep',
      },
      // A member's own words carry no prompt, no model and no "edited".
      '2': { body: 'Following up.', source: 'member', draftedAtMs: STAMP.nowMs, draftedByUid: 'uid-rep' },
    })
    expect(outreachStepOverridesRefused(read)).toBe(false)
  })

  it('reads an absent or empty list as no copies', () => {
    expect(readOutreachStepOverrideRequests(undefined, steps, STAMP)).toEqual({ overrides: {}, issues: [], refusal: null })
    expect(readOutreachStepOverrideRequests([], steps, STAMP).overrides).toEqual({})
  })

  it('refuses a task step, a step the sequence lacks, an unknown source, and the same step twice', () => {
    const cases: Array<[unknown, string]> = [
      [[{ stepIndex: 1, body: 'x', source: 'ai' }], 'email steps'],
      [[{ stepIndex: 9, body: 'x', source: 'ai' }], 'email steps'],
      [[{ stepIndex: 0, body: 'x', source: 'robot' }], 'who wrote it'],
      [[{ stepIndex: 0, body: 'x', source: 'ai' }, { stepIndex: 0, body: 'y', source: 'ai' }], 'once per person'],
      [['not an object'], 'is an object'],
    ]
    for (const [raw, words] of cases) {
      const read = readOutreachStepOverrideRequests(raw, steps, STAMP)
      expect(read.refusal).toContain(words)
      expect(read.overrides).toEqual({})
      expect(outreachStepOverridesRefused(read)).toBe(true)
    }
  })

  it('carries the validator’s verdict, and an error refuses the read', () => {
    const read = readOutreachStepOverrideRequests(
      [{ stepIndex: 0, subject: 'Hi', body: 'See https://a.example and https://b.example — 20% off today', source: 'ai' }],
      steps,
      STAMP,
    )
    expect(read.refusal).toBeNull()
    expect(read.issues.map((issue) => [issue.path, issue.code])).toEqual([
      ['stepOverrides.0.body', 'too_many_links'],
      ['stepOverrides.0.body', 'discount_language'],
    ])
    expect(outreachStepOverridesRefused(read)).toBe(true)
  })
})

describe('outreachStepOverrideRequests', () => {
  it('turns stored copies back into the request shape, in step order', () => {
    expect(
      outreachStepOverrideRequests({
        '2': { body: 'Again', source: 'member', draftedAtMs: 1 },
        '0': { subject: 'Hi', body: 'Hi', source: 'ai', edited: true, prompt: 'P', model: 'm', draftedAtMs: 1, draftedByUid: 'u' },
      }),
    ).toEqual([
      { stepIndex: 0, subject: 'Hi', body: 'Hi', source: 'ai', edited: true, prompt: 'P', model: 'm' },
      { stepIndex: 2, body: 'Again', source: 'member' },
    ])
    expect(outreachStepOverrideRequests(undefined)).toEqual([])
  })
})
