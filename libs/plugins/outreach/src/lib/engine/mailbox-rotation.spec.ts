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
  createOutreachMailboxRotation,
  OUTREACH_SEQUENCE_MAX_MAILBOXES,
  outreachSequenceMailboxIds,
  type OutreachRotationCandidate,
} from './mailbox-rotation'

const candidate = (id: string, activeEnrollments: number, fields: Partial<OutreachRotationCandidate> = {}) => ({
  id,
  status: 'connected' as const,
  activeEnrollments,
  schedulable: true,
  ...fields,
})

describe('the mailboxes a sequence sends from (AGL-3489)', () => {
  it('is its own first, then its rotation, each once', () => {
    expect(outreachSequenceMailboxIds({ mailboxId: 'a', mailboxIds: ['b', 'a', ' c ', '', 'b'] })).toEqual(['a', 'b', 'c'])
    expect(outreachSequenceMailboxIds({ mailboxId: 'a' })).toEqual(['a'])
    expect(outreachSequenceMailboxIds({ mailboxId: '', mailboxIds: null })).toEqual([])
    const many = Array.from({ length: 40 }, (_, index) => `m${index}`)
    expect(outreachSequenceMailboxIds({ mailboxId: 'a', mailboxIds: many })).toHaveLength(OUTREACH_SEQUENCE_MAX_MAILBOXES)
  })
})

describe('sharing enrollments out across a rotation (AGL-3489)', () => {
  it('evens six cold inboxes out from where they stand, the earlier on a tie', () => {
    const next = createOutreachMailboxRotation([
      candidate('m1', 4),
      candidate('m2', 0),
      candidate('m3', 2),
      candidate('m4', 0),
      candidate('m5', 4),
      candidate('m6', 4),
    ])
    const picks = Array.from({ length: 12 }, () => next())
    expect(picks.slice(0, 4)).toEqual(['m2', 'm4', 'm2', 'm4'])
    const totals = new Map<string, number>([['m1', 4], ['m2', 0], ['m3', 2], ['m4', 0], ['m5', 4], ['m6', 4]])
    for (const pick of picks) totals.set(pick as string, (totals.get(pick as string) ?? 0) + 1)
    // 14 waiting before, 26 after: no inbox is more than one ahead of another.
    const loads = [...totals.values()]
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1)
  })

  it('passes over a mailbox that is not sending or whose hours never open, and answers null with none left', () => {
    const next = createOutreachMailboxRotation([
      candidate('paused', 0, { status: 'paused' }),
      candidate('reconnect', 0, { status: 'reconnect_required' }),
      candidate('closed', 0, { schedulable: false }),
      candidate('open', 9),
    ])
    expect([next(), next()]).toEqual(['open', 'open'])
    expect(createOutreachMailboxRotation([candidate('paused', 0, { status: 'paused' })])()).toBeNull()
    expect(createOutreachMailboxRotation([])()).toBeNull()
  })
})
