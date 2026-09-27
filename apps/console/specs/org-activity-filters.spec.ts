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
 * The organization's activity log filters on the SERVER (AGL-3321).
 *
 * Every clause the log's toolbar sends and the search word land on a query
 * — Action, Who, When and the search on each subject's, Where on which
 * subjects are read — and one member's activity in the organization is their
 * equality on each of its subjects, so nothing is read and then discarded.
 * These cases drive the readers against a fake Firestore that answers the
 * where clauses it is handed, so a filter applied to the page instead of the
 * query shows up as a wrong page.
 */

interface FakeDoc {
  id: string
  parent: string
  /** Fractional, as a stored timestamp is. */
  seconds: number
  data: Record<string, unknown>
}

let mockCorpus: FakeDoc[] = []
let mockHostsInOrg: string[] = []
/** Each query's where clauses, as `field op value`. */
let mockWheres: string[][] = []

jest.mock('@aglyn/tenant-data-admin', () => {
  const seconds = (value: any) =>
    typeof value?.toMillis === 'function' ? value.toMillis() / 1000 : value
  const matches = (doc: FakeDoc, [field, op, value]: [string, string, unknown]) => {
    const stored = field === 'createdAt' ? doc.seconds : doc.data[field]
    const wanted = seconds(value)
    switch (op) {
      case '==':
        return stored === wanted
      case 'in':
        return (wanted as unknown[]).includes(stored)
      case '<':
        return (stored as number) < (wanted as number)
      case '>=':
        return (stored as number) >= (wanted as number)
      case 'array-contains':
        return Array.isArray(stored) && stored.includes(wanted)
      default:
        throw new Error(`unexpected operator ${op}`)
    }
  }
  const build = (state: {
    parent: string | null
    wheres: Array<[string, string, unknown]>
    after?: string | null
    limit: number
  }): any => ({
    where: (field: string, op: string, value: unknown) =>
      build({ ...state, wheres: [...state.wheres, [field, op, value]] }),
    orderBy: () => build(state),
    select: () => build(state),
    startAfter: (doc: { ref: { path: string } }) => build({ ...state, after: doc.ref.path }),
    limit: (value: number) => build({ ...state, limit: value }),
    get: async () => {
      mockWheres.push(
        state.wheres.map(([field, op, value]) => `${field} ${op} ${JSON.stringify(seconds(value))}`),
      )
      const ordered = mockCorpus
        .filter((doc) => state.parent === null || doc.parent === state.parent)
        .filter((doc) => state.wheres.every((where) => matches(doc, where)))
        .sort((a, b) => b.seconds - a.seconds)
      const start = state.after
        ? ordered.findIndex((doc) => `${doc.parent}/activity/${doc.id}` === state.after) + 1
        : 0
      const docs = ordered.slice(start, start + state.limit)
      return {
        empty: docs.length === 0,
        docs: docs.map((doc) => ({
          id: doc.id,
          data: () => ({ ...doc.data, createdAt: { seconds: Math.floor(doc.seconds) } }),
          ref: {
            path: `${doc.parent}/activity/${doc.id}`,
            parent: { parent: { path: doc.parent } },
          },
        })),
      }
    },
  })
  return {
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collectionGroup: () => build({ parent: null, wheres: [], limit: 25 }),
          doc: (path: string) => ({
            get: async () => ({
              exists: mockCorpus.some((doc) => `${doc.parent}/activity/${doc.id}` === path),
              ref: { path },
            }),
          }),
          collection: (name: string) => ({
            where: () => ({
              select: () => ({
                get: async () => ({ docs: mockHostsInOrg.map((id) => ({ id })) }),
              }),
            }),
            doc: (id: string) => ({
              collection: () => build({ parent: `${name}/${id}`, wheres: [], limit: 25 }),
            }),
          }),
        }),
      }),
      firestore: {
        FieldPath: { documentId: () => '__name__' },
        Timestamp: {
          fromMillis: (millis: number) => ({ toMillis: () => millis }),
          fromDate: (date: Date) => ({ toMillis: () => date.getTime() }),
        },
      },
    },
  }
})

import { activitySearchTokens } from '@aglyn/aglyn/app-utils/activity-search'
import { readOrgWideActivity } from '../utils/server/actor-activity'
import { readAuditLogFilters } from '../utils/server/audit-log-filter'
import {
  ORG_ACTIVITY_FILTER_FIELDS,
  ORG_ACTIVITY_QUERY,
  activityActorBase,
} from '../utils/activity-list-query'

const doc = (
  id: string,
  parent: string,
  seconds: number,
  data: Record<string, unknown> = {},
): FakeDoc => {
  const entry: Record<string, unknown> = {
    actorId: 'u1',
    actorEmail: 'ada@example.test',
    action: 'Saved the screen',
    target: { type: 'screen', name: `Screen ${id}` },
    ...data,
  }
  // Stamped the way every writer stamps it.
  return { id, parent, seconds, data: { ...entry, searchTokens: activitySearchTokens(entry) } }
}

/** Every page of a reader, followed to the end. */
async function walk(
  read: (cursor: string | null) => Promise<{ entries: Array<{ $id: string }>; nextCursor: string | null }>,
): Promise<string[][]> {
  const pages: string[][] = []
  let cursor: string | null = null
  for (let guard = 0; guard < 50; guard += 1) {
    const page = await read(cursor)
    pages.push(page.entries.map((entry) => entry.$id))
    cursor = page.nextCursor
    if (!cursor) break
  }
  return pages
}

beforeEach(() => {
  mockCorpus = []
  mockHostsInOrg = []
  mockWheres = []
})

describe('the filters a request carries', () => {
  it('reads the JSON clause list, and refuses one that is not', () => {
    expect(readAuditLogFilters({}, ORG_ACTIVITY_FILTER_FIELDS)).toEqual([])
    expect(
      readAuditLogFilters(
        { filters: JSON.stringify([{ field: 'action', op: 'equals', value: 'x' }]) },
        ORG_ACTIVITY_FILTER_FIELDS,
      ),
    ).toEqual([{ field: 'action', op: 'equals', value: 'x' }])
    expect(readAuditLogFilters({ filters: 'not json' }, ORG_ACTIVITY_FILTER_FIELDS)).toBeNull()
    expect(readAuditLogFilters({ filters: '{"field":"action"}' }, ORG_ACTIVITY_FILTER_FIELDS)).toBeNull()
  })
})

describe('the org-wide log', () => {
  beforeEach(() => {
    mockHostsInOrg = ['h1', 'h2']
    mockCorpus = [
      doc('a', 'orgs/o1', 900.5, { action: 'Invited a member' }),
      doc('b', 'hosts/h1', 800.5, { action: 'Saved the screen' }),
      doc('c', 'hosts/h2', 700.5, { action: 'Saved the screen', actorId: 'u2', actorEmail: 'bo@example.test' }),
      doc('d', 'hosts/h1', 600.5, { action: 'Published the site' }),
      doc('e', 'hosts/h2', 500.5, { action: 'Saved the screen' }),
    ]
  })

  it('puts an Action filter on EVERY subject’s query, not the merged page', async () => {
    const page = await readOrgWideActivity({
      orgId: 'o1',
      limit: 10,
      declaration: ORG_ACTIVITY_QUERY,
      clauses: [{ field: 'action', op: 'equals', value: 'Saved the screen' }],
    })
    expect(page.entries.map((entry) => entry.$id)).toEqual(['b', 'c', 'e'])
    expect(mockWheres).toHaveLength(3)
    for (const wheres of mockWheres) expect(wheres).toEqual(['action == "Saved the screen"'])
  })

  it('puts Who and When on every subject’s query too', async () => {
    const page = await readOrgWideActivity({
      orgId: 'o1',
      limit: 10,
      declaration: ORG_ACTIVITY_QUERY,
      clauses: [
        { field: 'actorId', op: 'equals', value: 'u2' },
        // A day the whole corpus precedes, wherever the run's clock is.
        { field: 'createdAt', op: 'before', value: '1970-01-02' },
      ],
    })
    expect(page.entries.map((entry) => entry.$id)).toEqual(['c'])
    for (const wheres of mockWheres) {
      expect(wheres[0]).toBe('actorId == "u2"')
      expect(wheres[1]).toMatch(/^createdAt < \d+$/)
    }
  })

  it('reads only the subjects Where names', async () => {
    const page = await readOrgWideActivity({
      orgId: 'o1',
      limit: 10,
      paths: new Set(['hosts/h1']),
    })
    expect(page.entries.map((entry) => entry.$id)).toEqual(['b', 'd'])
    expect(mockWheres).toHaveLength(1)
  })

  it('pages a filtered log forward with a cursor, never repeating or dropping a row', async () => {
    const pages = await walk((cursor) =>
      readOrgWideActivity({
        orgId: 'o1',
        limit: 1,
        cursor,
        clauses: [{ field: 'action', op: 'equals', value: 'Saved the screen' }],
      }),
    )
    expect(pages).toEqual([['b'], ['c'], ['e']])
  })

  it('puts the search word on every subject’s query, so every page is a full page of matches', async () => {
    mockCorpus = Array.from({ length: 12 }, (_, at) =>
      doc(`n${at}`, at % 2 ? 'hosts/h1' : 'orgs/o1', 1000 - at + 0.5, {
        actorEmail: at % 4 === 0 ? 'ada@example.test' : 'bo@example.test',
      }),
    )
    const pages = await walk((cursor) =>
      readOrgWideActivity({ orgId: 'o1', limit: 2, cursor, search: ['Ada'] }),
    )
    expect(pages).toEqual([['n0', 'n4'], ['n8']])
    for (const wheres of mockWheres) expect(wheres[0]).toBe('searchTokens array-contains "ada"')
  })

  it('keeps every entry of a boundary second whose stored time has a fraction', async () => {
    // Three entries inside one second, split across pages: a `<=` bound on
    // the whole second would drop the ones written later within it.
    mockHostsInOrg = []
    mockCorpus = [
      doc('x', 'orgs/o1', 400.9),
      doc('y', 'orgs/o1', 400.6),
      doc('z', 'orgs/o1', 400.2),
    ]
    const pages = await walk((cursor) => readOrgWideActivity({ orgId: 'o1', limit: 1, cursor }))
    expect(pages.flat()).toEqual(['x', 'y', 'z'])
  })
})

describe('one member’s activity in the organization', () => {
  beforeEach(() => {
    mockHostsInOrg = ['h1']
    mockCorpus = [
      doc('a', 'hosts/h1', 900, { action: 'Saved the screen' }),
      doc('b', 'hosts/elsewhere', 800, { action: 'Saved the screen' }),
      doc('c', 'orgs/o1', 700, { action: 'Invited a member' }),
      doc('d', 'hosts/h1', 600, { action: 'Saved the screen', actorId: 'u2' }),
      doc('e', 'hosts/h1', 500, { action: 'Saved the screen' }),
    ]
  })

  it('is the person’s equality on each of the organization’s subjects, with Action beside it', async () => {
    const page = await readOrgWideActivity({
      orgId: 'o1',
      limit: 10,
      clauses: [{ field: 'action', op: 'equals', value: 'Saved the screen' }],
      base: activityActorBase('u1'),
    })
    expect(page.entries.map((entry) => entry.$id)).toEqual(['a', 'e'])
    // Two subjects — the organization and its one site — and nothing from
    // any other organization is read to be thrown away.
    expect(mockWheres).toEqual([
      ['actorId == "u1"', 'action == "Saved the screen"'],
      ['actorId == "u1"', 'action == "Saved the screen"'],
    ])
  })

  it('pages the person’s feed to its end, every page full', async () => {
    const pages = await walk((cursor) =>
      readOrgWideActivity({ orgId: 'o1', limit: 2, cursor, base: activityActorBase('u1') }),
    )
    expect(pages).toEqual([['a', 'c'], ['e']])
  })
})
