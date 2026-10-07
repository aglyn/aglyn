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
  aiBuildActiveSlot,
  aiBuildCanRetry,
  aiBuildItemRefundCopy,
  aiBuildItemRows,
  aiBuildOutcomeLine,
  aiSitePartialCopy,
} from './ai-build-progress'
import type { AiJobItemLedger } from './ai-jobs.types'

const row = (over: Partial<AiJobItemLedger> & Pick<AiJobItemLedger, 'slot' | 'op' | 'label'>): AiJobItemLedger => ({
  status: 'succeeded',
  attempt: 1,
  creditsSpent: 0,
  creditsRefunded: 0,
  outputs: [],
  ...over,
})

describe('a build item by item, as every surface shows it (AGL-3616)', () => {
  const items = [
    row({ slot: 'f', op: 'form', label: 'Contact', status: 'failed', creditsSpent: 4, creditsRefunded: 4, failure: { ours: true, reason: 'step-failure', message: 'It could not be built this time.' } }),
    row({ slot: 'p0', op: 'page', label: 'Contact', status: 'degraded', degradedBy: ['f'], note: 'Built without the form “Contact”.' }),
    row({ slot: 'p1', op: 'page', label: 'About' }),
    row({ slot: 'e', op: 'email', label: 'Welcome', status: 'failed', creditsSpent: 3, failure: { ours: false, reason: 'refused', message: 'The AI declined to build this one.' } }),
  ]

  it('says our failure was not charged, and a refusal what it used', () => {
    expect(aiBuildItemRefundCopy(items[0])).toBe(
      'This one’s on us — you weren’t charged. The 4 credits it used are back in your AI credits.',
    )
    expect(aiBuildItemRefundCopy(items[3])).toBe('It used 3 credits.')
    expect(aiBuildItemRefundCopy(items[2])).toBeNull()
  })

  it('reads one row an item, a degraded item as built with its note', () => {
    const rows = aiBuildItemRows({ items })
    expect(rows.map((one) => [one.label, one.state])).toEqual([
      ['Form: Contact', 'failed'],
      ['Page: Contact', 'done'],
      ['Page: About', 'done'],
      ['Email design: Welcome', 'failed'],
    ])
    expect(rows[1].detail).toBe('Built without the form “Contact”.')
  })

  it('sums the outcome once finished', () => {
    expect(aiBuildOutcomeLine({ items, status: 'running' })).toBeNull()
    expect(aiBuildOutcomeLine({ items, status: 'done' })).toBe('2 of 4 built; 2 failed.')
  })

  it('offers Try again for a finished build or a site that built part of itself, never one that built nothing', () => {
    expect(aiBuildCanRetry({ kind: 'build', status: 'done', items })).toBe(true)
    expect(aiBuildCanRetry({ kind: 'site', status: 'done', items })).toBe(true)
    expect(aiBuildCanRetry({ kind: 'site', status: 'failed', items })).toBe(false)
    expect(aiBuildCanRetry({ kind: 'build', status: 'running', items })).toBe(false)
  })

  it('a partly built site says what was not built, and that it was on us only when it was', () => {
    const ours = [items[0], items[1], items[2]]
    expect(aiSitePartialCopy({ items: ours, status: 'done' })).toBe(
      'Built 2 of 2 pages. The form “Contact” couldn’t be built — that one’s on us, you weren’t charged for it. The 4 credits it used are back in your AI credits. Try again builds only what failed.',
    )
    expect(aiSitePartialCopy({ items, status: 'done' })).toContain('couldn’t be built. The 4 credits')
    expect(aiSitePartialCopy({ items: [items[2]], status: 'done' })).toBeNull()
  })
})

/*
 * The runner settles an item in the write that records its pass and never
 * marks the one it is on running, so a build mid-way reads every open item as
 * pending (AGL-3596). The item it is on is the first of them, and it is shown
 * as building, with a time to count from — never a page of "Waiting" rows.
 */
describe('the item a build is on (AGL-3596)', () => {
  const steps = [
    { name: 'plan', status: 'done', startedAt: '2026-10-07T17:11:00.000Z', endedAt: null, creditsSpent: 12, error: null },
    { name: 'generate', status: 'pending', startedAt: '2026-10-07T17:12:08.000Z', endedAt: null, creditsSpent: 0, error: null },
  ] as never
  const ledger = (settledAt?: string) => [
    row({ slot: 'l', op: 'layout', label: 'Main Layout', ...(settledAt ? { settledAt } : {}) }),
    row({ slot: 'f', op: 'form', label: 'Contact Request Form', ...(settledAt ? { settledAt: '2026-10-07T17:12:20.000Z' } : {}) }),
    row({ slot: 'p0', op: 'page', label: 'Home', status: 'pending' }),
    row({ slot: 'p1', op: 'page', label: 'Contact', status: 'pending' }),
  ]

  it('is the first pending item while the job moves, counted from when the last item settled', () => {
    for (const status of ['queued', 'running'] as const) {
      const rows = aiBuildItemRows({ items: ledger('2026-10-07T17:12:15.000Z'), status, steps })
      expect(rows.map((one) => one.state)).toEqual(['done', 'done', 'active', 'waiting'])
      expect(rows[2].startedAt).toBe('2026-10-07T17:12:20.000Z')
      expect(rows.filter((one) => one.startedAt !== undefined)).toHaveLength(1)
    }
  })

  it('counts from the build step’s start on a ledger that records no settle', () => {
    const rows = aiBuildItemRows({ items: ledger(), status: 'running', steps })
    expect(rows[2]).toMatchObject({ state: 'active', startedAt: '2026-10-07T17:12:08.000Z' })
  })

  it('keeps the item the ledger marks running, and marks nothing on a job that is not moving', () => {
    const items = ledger().map((one) => (one.slot === 'p1' ? { ...one, status: 'running' as const } : one))
    expect(aiBuildActiveSlot({ items, status: 'queued' })).toBe('p1')
    expect(aiBuildActiveSlot({ items: ledger(), status: 'needs_input' })).toBeNull()
    expect(aiBuildActiveSlot({ items: ledger(), status: 'done' })).toBeNull()
    expect(aiBuildItemRows({ items: ledger() }).map((one) => one.state)).toEqual(['done', 'done', 'waiting', 'waiting'])
  })
})
