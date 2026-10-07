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

import { normalizePluginFigureTable } from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { automationRunFigureReader } from './automation-run-figures'

/**
 * A site's automation runs as a figure table (AGL-3603): exact totals from
 * COUNT aggregates over `result` in the window, a split by automation with
 * the most failures first, and nothing of a run's payload in the table.
 */

const NOW = new Date('2026-10-06T15:00:00.000Z')
const at = (daysAgo: number) => new Date(Date.UTC(2026, 9, 6) - daysAgo * 86_400_000 + 3_600_000)

type Run = { createdAt: Date; result: string; target: { name: string }; payload?: unknown }

function firestoreOf(runs: Run[]) {
  const reads: string[] = []
  const query = (filters: Array<[string, string, unknown]>): any => {
    const matching = () =>
      runs.filter((run) =>
        filters.every(([field, op, value]) =>
          field === 'result'
            ? run.result === value
            : op === '>='
              ? run.createdAt >= (value as Date)
              : run.createdAt < (value as Date),
        ),
      )
    return {
      where: (field: string, op: string, value: unknown) => query([...filters, [field, op, value]]),
      orderBy: () => query(filters),
      select: (...fields: string[]) => {
        reads.push(`select:${fields.join(',')}`)
        return query(filters)
      },
      limit: () => query(filters),
      count: () => ({ get: async () => ({ data: () => ({ count: matching().length }) }) }),
      get: async () => ({
        docs: matching().map((run, index) => ({ id: `r${index}`, get: (field: string) => (run as any)[field] })),
      }),
    }
  }
  const firestore = {
    collection: () => ({ doc: () => ({ collection: (name: string) => (reads.push(name), query([])) }) }),
  } as unknown as FirebaseFirestore.Firestore
  return { firestore, reads }
}

const run = (daysAgo: number, name: string, result = 'succeeded'): Run => ({
  createdAt: at(daysAgo),
  result,
  target: { name },
  payload: { email: 'avery@example.com' },
})

describe('automation runs', () => {
  it('counts succeeded and failed in the window, by automation with the most failures first', async () => {
    const { firestore, reads } = firestoreOf([
      run(0, 'Welcome'),
      run(1, 'Welcome'),
      run(1, 'Notify', 'failed'),
      run(2, 'Notify', 'failed'),
      run(3, 'Notify'),
      run(9, 'Welcome'),
      run(10, 'Notify', 'failed'),
    ])
    const read = await automationRunFigureReader(() => firestore).read({
      orgId: 'org-1',
      hostId: 'host-1',
      days: 7,
      now: NOW,
      uid: null,
      params: {},
    })
    if (read.ok === false) throw new Error(read.error)
    expect(read.table.rows).toEqual([
      { automation: 'All automations', succeeded: 3, failed: 2, failureRate: 40, change: 150 },
      { automation: 'Notify', succeeded: 1, failed: 2, failureRate: 66.7, change: null },
      { automation: 'Welcome', succeeded: 2, failed: 0, failureRate: 0, change: null },
    ])
    expect(JSON.stringify(read.table)).not.toMatch(/avery|example\.com/)
    // Only the run's target is read for the split.
    expect(reads.filter((entry) => entry.startsWith('select:'))).toEqual(['select:target', 'select:target'])
    expect(normalizePluginFigureTable(read.table).rows).toHaveLength(3)
  })

  it('reads only when a site is named, over a window it covers', async () => {
    const reader = automationRunFigureReader(() => firestoreOf([]).firestore)
    const base = { orgId: 'org-1', now: NOW, uid: null, params: {} }
    expect(await reader.read({ ...base, hostId: null, days: 7 })).toMatchObject({ ok: false, status: 400 })
    expect(await reader.read({ ...base, hostId: 'host-1', days: 5 })).toMatchObject({ ok: false, status: 400 })
  })
})
