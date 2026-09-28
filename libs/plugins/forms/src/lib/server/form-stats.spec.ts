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
 * AGL-3330: a form's counters, recounted from the rows they count.
 *
 * The drift this closes was measured on production: a form holding
 * `submissions: 5, leads: 4` over two stored submissions and one lead, and
 * two holding `1` over none — every one a delete or a lost increment the
 * counter could not see.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => null }) },
  orgLeadsForHost: async () => {
    throw new Error('the spec hands the leads collection in')
  },
}))

import { recountFormStats } from './form-stats'

type Row = Record<string, unknown>

/** A stored value as the order compares it: a Timestamp by its millis. */
const ordinal = (value: unknown): number =>
  typeof (value as { toMillis?: unknown })?.toMillis === 'function'
    ? (value as { toMillis: () => number }).toMillis()
    : Number(value)

/** A small in-memory Firestore: paths, equality and array-contains, one order, count. */
function fakeFirestore(rows: Record<string, Row>) {
  const updates: Array<{ path: string; patch: Row }> = []
  const children = (collectionPath: string) =>
    Object.keys(rows).filter((path) => {
      const at = path.lastIndexOf('/')
      return path.slice(0, at) === collectionPath
    })
  const snapshot = (path: string) => ({
    id: path.split('/').pop(),
    exists: rows[path] !== undefined,
    data: () => rows[path],
    get: (field: string) =>
      field.split('.').reduce<unknown>((value, key) => (value as Row | undefined)?.[key], rows[path]),
  })
  const query = (
    collectionPath: string,
    filters: Array<[string, string, unknown]> = [],
    order: [string, 'asc' | 'desc'] | null = null,
    take: number | null = null,
  ): any => {
    const run = () => {
      let paths = children(collectionPath).filter((path) =>
        filters.every(([field, op, value]) => {
          const stored = rows[path]?.[field]
          return op === 'array-contains'
            ? Array.isArray(stored) && stored.includes(value)
            : stored === value
        }),
      )
      if (order) {
        const [field, direction] = order
        paths = paths
          .filter((path) => rows[path]?.[field] !== undefined)
          .sort((a, b) => {
            const left = ordinal(rows[a]?.[field])
            const right = ordinal(rows[b]?.[field])
            return direction === 'desc' ? right - left : left - right
          })
      }
      if (take !== null) paths = paths.slice(0, take)
      return paths
    }
    return {
      kind: 'query',
      where: (field: string, op: string, value: unknown) =>
        query(collectionPath, [...filters, [field, op, value]], order, take),
      orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') =>
        query(collectionPath, filters, [field, direction], take),
      limit: (n: number) => query(collectionPath, filters, order, n),
      count: () => ({ kind: 'count', run }),
      run,
    }
  }
  const doc = (path: string): any => ({
    kind: 'doc',
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collection(`${path}/${name}`),
  })
  const collection = (path: string): any => ({
    ...query(path),
    id: path.split('/').pop(),
    doc: (id: string) => doc(`${path}/${id}`),
  })
  const firestore: any = {
    collection,
    runTransaction: async (body: (tx: any) => Promise<unknown>) =>
      body({
        get: async (target: any) => {
          if (target.kind === 'doc') return snapshot(target.path)
          if (target.kind === 'count') return { data: () => ({ count: target.run().length }) }
          return { docs: target.run().map((path: string) => snapshot(path)) }
        },
        update: (ref: any, patch: Row) => {
          updates.push({ path: ref.path, patch })
          const next: Row = { ...(rows[ref.path] ?? {}) }
          for (const [key, value] of Object.entries(patch)) {
            const [head, tail] = key.split('.')
            if (tail) next[head] = { ...((next[head] as Row) ?? {}), [tail]: value }
            else next[key] = value
          }
          rows[ref.path] = next
        },
      }),
  }
  return { firestore, updates, leads: collection('orgs/org-1/leads') }
}

const FORM = 'hosts/host-1/forms/form-1'
const at = (ms: number) => ({ toMillis: () => ms })

function corpus(overrides: Record<string, Row> = {}): Record<string, Row> {
  return {
    [FORM]: {
      displayName: 'Contact',
      routing: { lead: true },
      stats: { submissions: 5, leads: 4, lastSubmissionAtMs: 9_000_000 },
    },
    'hosts/host-1/formSubmissions/s1': { formId: 'form-1', createdAt: at(1_000_000) },
    'hosts/host-1/formSubmissions/s2': { formId: 'form-1', createdAt: at(2_000_000) },
    'hosts/host-1/formSubmissions/s3': { formId: 'form-other', createdAt: at(8_000_000) },
    'orgs/org-1/leads/p1': { sources: ['form:form-1', 'booking'] },
    'orgs/org-1/leads/p2': { sources: ['booking'] },
    ...overrides,
  }
}

describe('recountFormStats (AGL-3330)', () => {
  it('writes what the rows say when the stored counters drifted', async () => {
    const { firestore, updates, leads } = fakeFirestore(corpus())
    const recount = await recountFormStats({ firestore, leads, hostId: 'host-1', formId: 'form-1' })
    expect(recount?.recounted).toEqual({ submissions: 2, leads: 1, lastSubmissionAtMs: 2_000_000 })
    expect(recount?.drift).toEqual(['submissions', 'leads', 'lastSubmissionAtMs'])
    expect(recount?.written).toBe(true)
    expect(updates).toEqual([
      {
        path: FORM,
        patch: {
          'stats.submissions': 2,
          'stats.leads': 1,
          'stats.lastSubmissionAtMs': 2_000_000,
        },
      },
    ])
  })

  it('is idempotent: a second recount finds nothing and writes nothing', async () => {
    const { firestore, updates, leads } = fakeFirestore(corpus())
    await recountFormStats({ firestore, leads, hostId: 'host-1', formId: 'form-1' })
    const again = await recountFormStats({ firestore, leads, hostId: 'host-1', formId: 'form-1' })
    expect(again?.drift).toEqual([])
    expect(again?.written).toBe(false)
    expect(updates).toHaveLength(1)
  })

  it('reports without writing on a dry run', async () => {
    const { firestore, updates, leads } = fakeFirestore(corpus())
    const recount = await recountFormStats({
      firestore,
      leads,
      hostId: 'host-1',
      formId: 'form-1',
      apply: false,
    })
    expect(recount?.drift).toHaveLength(3)
    expect(recount?.written).toBe(false)
    expect(updates).toEqual([])
  })

  it('holds 0 leads on a lead-routing form that has filed none, and null submissions', async () => {
    const { firestore, leads } = fakeFirestore({
      [FORM]: { routing: { lead: true }, stats: { submissions: 1, leads: null, lastSubmissionAtMs: 5 } },
    })
    const recount = await recountFormStats({ firestore, leads, hostId: 'host-1', formId: 'form-1' })
    expect(recount?.recounted).toEqual({ submissions: null, leads: 0, lastSubmissionAtMs: null })
  })

  it('holds null leads on a form that has never routed any', async () => {
    const { firestore, leads } = fakeFirestore({
      [FORM]: { routing: { lead: false }, stats: { submissions: null, leads: 0, lastSubmissionAtMs: null } },
    })
    const recount = await recountFormStats({ firestore, leads, hostId: 'host-1', formId: 'form-1' })
    expect(recount?.recounted.leads).toBeNull()
    expect(recount?.drift).toEqual(['leads'])
  })

  it('keeps the leads a form filed after its routing was switched off', async () => {
    const { firestore, leads } = fakeFirestore(
      corpus({ [FORM]: { routing: { lead: false }, stats: {} } }),
    )
    const recount = await recountFormStats({ firestore, leads, hostId: 'host-1', formId: 'form-1' })
    expect(recount?.recounted.leads).toBe(1)
  })

  it('stamps the counters a form lacks entirely, since "is empty" cannot find an absent field', async () => {
    const { firestore, leads } = fakeFirestore({ [FORM]: { routing: { lead: false } } })
    const recount = await recountFormStats({ firestore, leads, hostId: 'host-1', formId: 'form-1' })
    expect(recount?.drift).toEqual(['submissions', 'leads', 'lastSubmissionAtMs'])
    expect(recount?.written).toBe(true)
  })

  it('agrees with a last-submission stamp a moment after the row it counted', async () => {
    const { firestore, leads } = fakeFirestore(
      corpus({
        [FORM]: {
          routing: { lead: true },
          stats: { submissions: 2, leads: 1, lastSubmissionAtMs: 2_000_550 },
        },
      }),
    )
    const recount = await recountFormStats({ firestore, leads, hostId: 'host-1', formId: 'form-1' })
    expect(recount?.drift).toEqual([])
  })

  it('never creates a form that does not exist', async () => {
    const { firestore, updates, leads } = fakeFirestore(corpus())
    expect(
      await recountFormStats({ firestore, leads, hostId: 'host-1', formId: 'gone' }),
    ).toBeNull()
    expect(updates).toEqual([])
  })
})

describe('a recount after the lead a form filed is erased (AGL-3330)', () => {
  it('drops the lead from a routing form, which then holds 0', async () => {
    const rows = corpus()
    delete rows['orgs/org-1/leads/p1']
    const { firestore, leads } = fakeFirestore(rows)
    const recount = await recountFormStats({ firestore, leads, hostId: 'host-1', formId: 'form-1' })
    expect(recount?.recounted.leads).toBe(0)
  })
})
