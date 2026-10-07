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

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  scopedToHost: (ref: any, hostId: string) => ref.where('visibleTo', 'array-contains-any', [hostId, '*']),
}))

import { normalizePluginFigureTable } from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { crmClosedDealsFigureReader, crmPipelineFigureReader } from './deal-figures'

/**
 * The organization's deals as figure tables (AGL-3603): the open pipeline by
 * stage, at each stage's odds, and the deals won and lost in a window — each
 * a query on `status`, scoped to a site's shared deals when a site is named,
 * and nothing of a deal's title or its people in a table.
 */

const NOW = new Date('2026-10-06T15:00:00.000Z')
const dayMs = 86_400_000
const ago = (days: number) => Date.UTC(2026, 9, 6) - days * dayMs + 3_600_000

const PIPELINE = {
  name: 'Sales',
  visibleTo: ['*'],
  stages: [
    { id: 'qualify', name: 'Qualify', order: 1, probability: 10, kind: 'open' },
    { id: 'proposal', name: 'Proposal', order: 2, probability: 50, kind: 'open' },
    { id: 'won', name: 'Won', order: 3, probability: 100, kind: 'won' },
    { id: 'lost', name: 'Lost', order: 4, probability: 0, kind: 'lost' },
  ],
}

type Doc = Record<string, unknown>

function firestoreOf(collections: Record<string, Doc[]>) {
  const filters: string[] = []
  const query = (rows: Doc[], applied: Array<(doc: Doc) => boolean>): any => ({
    where: (field: string, op: string, value: any) => {
      filters.push(`${field} ${op}`)
      const test = (doc: Doc) =>
        op === '=='
          ? doc[field] === value
          : op === '>='
            ? Number(doc[field]) >= value
            : op === '<'
              ? Number(doc[field]) < value
              : op === 'array-contains-any'
                ? ((doc[field] as string[]) ?? []).some((token) => value.includes(token))
                : true
      return query(rows, [...applied, test])
    },
    orderBy: () => query(rows, applied),
    select: () => query(rows, applied),
    limit: () => query(rows, applied),
    get: async () => ({
      docs: rows.filter((doc) => applied.every((test) => test(doc))).map((doc, index) => ({ id: String(doc['$id'] ?? index), data: () => doc })),
    }),
  })
  const firestore = {
    collection: () => ({ doc: () => ({ collection: (name: string) => query(collections[name] ?? [], []) }) }),
  } as unknown as FirebaseFirestore.Firestore
  return { firestore, filters }
}

const deal = (fields: Doc): Doc => ({
  title: 'Acme renewal',
  contactName: 'Avery Buyer',
  pipelineId: 'p1',
  currency: 'usd',
  visibleTo: ['*'],
  ...fields,
})

describe('the deal pipeline', () => {
  it('counts the open deals by stage, at each stage’s odds, leaving out what closed', async () => {
    const { firestore, filters } = firestoreOf({
      pipelines: [{ $id: 'p1', ...PIPELINE }],
      deals: [
        deal({ status: 'open', stageId: 'qualify', amountCents: 100_000 }),
        deal({ status: 'open', stageId: 'proposal', amountCents: 300_000 }),
        deal({ status: 'won', stageId: 'won', amountCents: 999_900 }),
      ],
    })
    const read = await crmPipelineFigureReader(() => firestore).read({ orgId: 'org-1', hostId: null, days: 0, now: NOW, uid: null, params: {} })
    if (read.ok === false) throw new Error(read.error)
    expect(read.table.rows).toEqual([
      { pipeline: 'All pipelines', stage: 'All open stages', deals: 2, value: 4000, weighted: 1600 },
      { pipeline: 'Sales', stage: 'Qualify', deals: 1, value: 1000, weighted: 100 },
      { pipeline: 'Sales', stage: 'Proposal', deals: 1, value: 3000, weighted: 1500 },
    ])
    expect(read.table.columns.find((column) => column.key === 'value')?.currency).toBe('USD')
    expect(JSON.stringify(read.table)).not.toMatch(/Acme|Avery/)
    expect(filters).toContain('status ==')
    expect(normalizePluginFigureTable(read.table)).not.toBeNull()
  })

  it('reads only the deals shared with a site when a site is named', async () => {
    const { firestore } = firestoreOf({
      pipelines: [{ $id: 'p1', ...PIPELINE }],
      deals: [
        deal({ status: 'open', stageId: 'qualify', amountCents: 100_000, visibleTo: ['host-2'] }),
        deal({ status: 'open', stageId: 'qualify', amountCents: 200_000, visibleTo: ['host-1'] }),
      ],
    })
    const read = await crmPipelineFigureReader(() => firestore).read({ orgId: 'org-1', hostId: 'host-1', days: 0, now: NOW, uid: null, params: {} })
    if (read.ok === false) throw new Error(read.error)
    expect(read.table.rows[0]).toEqual(expect.objectContaining({ deals: 1, value: 2000 }))
  })
})

describe('deals won and lost', () => {
  it('counts the window’s won and lost, what was won, the win rate and the change in won', async () => {
    const { firestore, filters } = firestoreOf({
      deals: [
        deal({ status: 'won', closedAtMs: ago(1), amountCents: 50_000 }),
        deal({ status: 'won', closedAtMs: ago(2), amountCents: 25_000 }),
        deal({ status: 'lost', closedAtMs: ago(3), amountCents: 10_000 }),
        deal({ status: 'won', closedAtMs: ago(9), amountCents: 10_000 }),
      ],
    })
    const read = await crmClosedDealsFigureReader(() => firestore).read({ orgId: 'org-1', hostId: null, days: 7, now: NOW, uid: null, params: {} })
    if (read.ok === false) throw new Error(read.error)
    expect(read.table.rows).toEqual([{ won: 2, lost: 1, wonValue: 750, winRate: 66.7, change: 100 }])
    expect(filters).toEqual(expect.arrayContaining(['status ==', 'closedAtMs >=', 'closedAtMs <']))
  })

  it('refuses a window it does not cover', async () => {
    const reader = crmClosedDealsFigureReader(() => firestoreOf({}).firestore)
    expect(await reader.read({ orgId: 'org-1', hostId: null, days: 5, now: NOW, uid: null, params: {} })).toMatchObject({ ok: false })
  })
})
