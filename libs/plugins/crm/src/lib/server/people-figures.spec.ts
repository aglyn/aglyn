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

import { Timestamp } from 'firebase-admin/firestore'
import { normalizePluginFigureTable } from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { crmPeopleFigureReader } from './people-figures'

/**
 * The leads and contacts the CRM gained over a window (AGL-3867): one
 * `count()` per figure, a lead on its first sighting and a contact on its
 * creation, narrowed to a site's shared records when a site is named.
 */

const NOW = new Date('2026-10-11T23:59:59.999Z')
const at = (day: string) => Date.parse(`${day}T12:00:00Z`)

type Doc = Record<string, unknown>

function firestoreOf(collections: Record<string, Doc[]>) {
  const millis = (value: unknown) => (value instanceof Timestamp ? value.toMillis() : Number(value))
  const query = (rows: Doc[], applied: Array<(doc: Doc) => boolean>): any => ({
    where: (field: string, op: string, value: any) => {
      const bound = millis(value)
      const test = (doc: Doc) =>
        op === '>='
          ? millis(doc[field]) >= bound
          : op === '<'
            ? millis(doc[field]) < bound
            : op === 'array-contains-any'
              ? ((doc[field] as string[]) ?? []).some((token) => value.includes(token))
              : true
      return query(rows, [...applied, test])
    },
    count: () => ({
      get: async () => ({ data: () => ({ count: rows.filter((doc) => applied.every((test) => test(doc))).length }) }),
    }),
  })
  return {
    collection: () => ({
      doc: () => ({
        collection: (name: string) => ({ ...query(collections[name] ?? [], []), parent: { parent: { id: 'orgs' } } }),
      }),
    }),
  } as never
}

describe('crm.people (AGL-3867)', () => {
  const firestore = firestoreOf({
    leads: [
      { firstSeenAtMs: at('2026-10-06'), visibleTo: ['h1'] },
      { firstSeenAtMs: at('2026-10-10'), visibleTo: ['h2'] },
      { firstSeenAtMs: at('2026-09-30'), visibleTo: ['h1'] },
      { firstSeenAtMs: at('2026-10-12'), visibleTo: ['h1'] },
    ],
    contacts: [
      { createdAt: Timestamp.fromMillis(at('2026-10-07')), visibleTo: ['*'] },
      { createdAt: Timestamp.fromMillis(at('2026-09-29')), visibleTo: ['h1'] },
      { createdAt: Timestamp.fromMillis(at('2026-09-30')), visibleTo: ['h1'] },
    ],
  })
  const reader = crmPeopleFigureReader(() => firestore)

  it('counts the week’s new leads and contacts against the week before, for one site', async () => {
    const read = await reader.read({ orgId: 'o1', hostId: 'h1', days: 7, now: NOW, uid: null, params: {} })
    expect(read.ok).toBe(true)
    if (read.ok === false) return
    expect(normalizePluginFigureTable(read.table)).not.toBeNull()
    expect(read.table.period).toEqual({ from: '2026-10-05', to: '2026-10-11', days: 7 })
    expect(read.table.rows).toEqual([
      { figure: 'New leads', current: 1, previous: 1, change: 0 },
      { figure: 'New contacts', current: 1, previous: 2, change: -50 },
    ])
  })

  it('counts the whole workspace without a site', async () => {
    const read = await reader.read({ orgId: 'o1', hostId: null, days: 7, now: NOW, uid: null, params: {} })
    if (read.ok === false) throw new Error(read.error)
    expect(read.table.rows[0]).toMatchObject({ figure: 'New leads', current: 2 })
  })

  it('refuses a window it is not read over', async () => {
    const read = await reader.read({ orgId: 'o1', hostId: null, days: 5, now: NOW, uid: null, params: {} })
    expect(read).toMatchObject({ ok: false, status: 400 })
  })
})
