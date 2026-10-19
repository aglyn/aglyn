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
 * APPEND-ONLY HISTORY ROWS (AGL-3959). The shape every billable change is
 * recorded in, shared with AGL-3970.
 */

import {
  HISTORY_TEXT_MAX,
  cleanHistoryReason,
  historyRow,
  requireHistoryReason,
  sortHistoryRows,
} from './append-only-history'

describe('historyRow', () => {
  it('fills every field so a reader never guesses', () => {
    expect(
      historyRow({ atMs: 1_000.7, by: { uid: 'u', email: null }, kind: 'timer.started', summary: ' Started work. ' }),
    ).toEqual({
      atMs: 1_000,
      byUid: 'u',
      byEmail: null,
      kind: 'timer.started',
      summary: 'Started work.',
      reason: null,
      before: null,
      after: null,
      stripe: null,
      subjectId: null,
    })
  })

  it('keeps the structured telling beside the plain one', () => {
    const row = historyRow({
      atMs: 5,
      by: { uid: null, email: null },
      kind: 'charge.created',
      summary: 'Added 1 hour of extra time.',
      reason: '  because  ',
      before: { hours: 0 },
      after: { hours: 1 },
      stripe: { object: 'invoiceitem', id: 'ii_1', amountCents: 7_900 },
      subjectId: 'ticket-1',
    })
    expect(row.reason).toBe('because')
    expect(row.stripe).toEqual({ object: 'invoiceitem', id: 'ii_1', amountCents: 7_900 })
    expect(row.subjectId).toBe('ticket-1')
  })

  it('bounds the summary', () => {
    const row = historyRow({ atMs: 1, by: { uid: null, email: null }, kind: 'k', summary: 'x'.repeat(900) })
    expect(row.summary).toHaveLength(HISTORY_TEXT_MAX)
  })
})

describe('reasons', () => {
  it('is required on a correction', () => {
    expect(requireHistoryReason('  ')).toEqual({ ok: false, error: 'Say why — a reason is required.' })
    expect(requireHistoryReason(undefined).ok).toBe(false)
    expect(requireHistoryReason(' Typo in the minutes ')).toEqual({ ok: true, reason: 'Typo in the minutes' })
    expect(cleanHistoryReason('y'.repeat(900))).toHaveLength(HISTORY_TEXT_MAX)
    expect(cleanHistoryReason(42)).toBeNull()
  })
})

describe('sortHistoryRows', () => {
  it('orders oldest first and keeps ties in read order', () => {
    const rows = [
      { atMs: 3, id: 'c' },
      { atMs: 1, id: 'a' },
      { atMs: 3, id: 'd' },
      { atMs: 2, id: 'b' },
    ]
    expect(sortHistoryRows(rows).map((row) => row.id)).toEqual(['a', 'b', 'c', 'd'])
    // The input is not reordered in place.
    expect(rows[0].id).toBe('c')
  })
})
