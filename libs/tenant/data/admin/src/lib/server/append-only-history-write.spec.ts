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
 * THE WRITE SIDE OF AN APPEND-ONLY HISTORY (AGL-3959), reused by AGL-3970.
 * A row is always a `create` (so it can never overwrite one), and a staff
 * change mirrors it to `adminAudit` in the same writer.
 */

import { historyRow } from '@aglyn/aglyn/app-utils/append-only-history'
import { FieldValue } from 'firebase-admin/firestore'
import { appendHistoryRow, commitHistoryRow, readHistoryRows } from './append-only-history-write'

jest.spyOn(FieldValue, 'serverTimestamp').mockImplementation(() => '__now__' as never)

let ids = 0
function fakeFirestore() {
  const ops: Array<{ op: string; path: string; data: Record<string, unknown> }> = []
  const collection = (path: string) => ({
    path,
    doc: (id?: string) => ({ id: id ?? `id${++ids}`, path: `${path}/${id ?? `id${ids}`}` }),
  })
  const writer = {
    create: (ref: { path: string }, data: Record<string, unknown>) => ops.push({ op: 'create', path: ref.path, data }),
    set: (ref: { path: string }, data: Record<string, unknown>) => ops.push({ op: 'set', path: ref.path, data }),
  }
  const firestore = {
    collection,
    batch: () => ({ ...writer, commit: async () => ops.push({ op: 'commit', path: '', data: {} }) }),
  }
  return { ops, writer, firestore }
}

const ROW = historyRow({
  atMs: 10,
  by: { uid: 'staff-1', email: 'staff@aglyn.com' },
  kind: 'minutes.corrected',
  summary: 'Corrected the time from 90 min to 2 h.',
  reason: 'Logged the wrong number',
  before: { minutesLogged: 90 },
  after: { minutesLogged: 120 },
  stripe: { object: 'invoiceitem', id: 'ii_1', amountCents: 15_800 },
  subjectId: 't1',
})

describe('appendHistoryRow', () => {
  it('creates the row and mirrors it to the staff audit in the same writer', () => {
    const { ops, writer, firestore } = fakeFirestore()
    const history = firestore.collection('supportTickets/t1/siteCareHistory')
    const ref = appendHistoryRow(
      writer as never,
      firestore as never,
      history as never,
      ROW,
      { action: 'siteCare.minutes.corrected', scope: 'siteCare', target: 'orgs/org-1/siteCare/t1' },
    )
    expect(ref.id).toBeTruthy()
    expect(ops[0]).toEqual({ op: 'create', path: `supportTickets/t1/siteCareHistory/${ref.id}`, data: ROW })
    expect(ops[1].op).toBe('set')
    expect(ops[1].path.startsWith('adminAudit/')).toBe(true)
    expect(ops[1].data).toEqual(
      expect.objectContaining({
        actorUid: 'staff-1',
        actorEmail: 'staff@aglyn.com',
        action: 'siteCare.minutes.corrected',
        scope: 'siteCare',
        target: 'orgs/org-1/siteCare/t1',
        reason: 'Logged the wrong number',
        note: 'Corrected the time from 90 min to 2 h.',
        before: { minutesLogged: 90 },
        after: { minutesLogged: 120 },
        stripe: { object: 'invoiceitem', id: 'ii_1', amountCents: 15_800 },
      }),
    )
  })

  it('writes no audit row for a platform step', () => {
    const { ops, writer, firestore } = fakeFirestore()
    appendHistoryRow(writer as never, firestore as never, firestore.collection('h') as never, ROW)
    expect(ops.map((op) => op.op)).toEqual(['create'])
  })
})

describe('commitHistoryRow', () => {
  it('commits the row and its audit in one batch', async () => {
    const { ops, firestore } = fakeFirestore()
    await commitHistoryRow(firestore as never, firestore.collection('h') as never, ROW, {
      action: 'a',
      scope: 's',
      target: 'orgs/org-1',
    })
    expect(ops.map((op) => op.op)).toEqual(['create', 'set', 'commit'])
  })
})

describe('readHistoryRows', () => {
  it('returns rows oldest first with their ids', async () => {
    const docs = [
      { id: 'b', data: () => ({ ...ROW, atMs: 20 }) },
      { id: 'a', data: () => ({ ...ROW, atMs: 10 }) },
    ]
    const history = { orderBy: () => ({ limit: () => ({ get: async () => ({ docs }) }) }) }
    const rows = await readHistoryRows(history as never)
    expect(rows.map((row) => [row.$id, row.atMs])).toEqual([
      ['a', 10],
      ['b', 20],
    ])
  })
})
