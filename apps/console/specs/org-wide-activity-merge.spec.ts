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
 * Paging a feed that is a MERGE (AGL-1490).
 *
 * The org-wide scope is not a collection — it is one bounded query per
 * subject, merged by date. That has no "row after this one" for a cursor to
 * name, so the cursor is a TIME plus the ids already shown at that instant.
 *
 * The boundary second is the whole risk and the reason this file exists. A
 * strict `<` drops every entry sharing the last second, and entries share a
 * second routinely — a save and its revalidation, a bulk role change. A
 * non-strict `<=` repeats them instead. Either way the reader is never told;
 * on an audit log the missing entry is the one nobody thinks to look for.
 */

interface FakeDoc {
  id: string
  parent: string
  seconds: number
}

let mockCorpus: FakeDoc[] = []
let mockHostsInOrg: string[] = []
/** Every per-subject query's limit, so the fan-out's cost is assertable. */
let mockLimits: number[] = []

jest.mock('@aglyn/tenant-data-admin', () => {
  const activityQuery = (state: {
    parent: string
    before?: number
    limit: number
  }): any => ({
    orderBy: () => activityQuery(state),
    select: () => activityQuery(state),
    where: (_field: string, _op: string, value: { toMillis: () => number }) =>
      activityQuery({ ...state, before: value.toMillis() / 1000 }),
    limit: (value: number) => {
      mockLimits.push(value)
      return activityQuery({ ...state, limit: value })
    },
    get: async () => {
      const docs = mockCorpus
        .filter((entry) => entry.parent === state.parent)
        .filter((entry) =>
          state.before === undefined ? true : entry.seconds <= state.before,
        )
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, state.limit)
      return {
        empty: docs.length === 0,
        docs: docs.map((entry) => ({
          id: entry.id,
          data: () => ({
            action: `did ${entry.id}`,
            target: { type: 'screen' },
            actorEmail: 'someone@example.test',
            createdAt: { seconds: entry.seconds },
          }),
          ref: { parent: { parent: { path: entry.parent } } },
        })),
      }
    },
  })

  return {
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: (name: string) => ({
            // The org's site list.
            where: () => ({
              select: () => ({
                get: async () => ({
                  docs: mockHostsInOrg.map((id) => ({ id })),
                }),
              }),
            }),
            doc: (id: string) => ({
              collection: () => activityQuery({ parent: `${name}/${id}`, limit: 25 }),
            }),
          }),
        }),
      }),
      firestore: {
        Timestamp: {
          fromMillis: (millis: number) => ({ toMillis: () => millis }),
        },
      },
    },
  }
})

import { readOrgWideActivity } from '../utils/server/actor-activity'

const entry = (id: string, parent: string, seconds: number): FakeDoc => ({
  id,
  parent,
  seconds,
})

beforeEach(() => {
  mockCorpus = []
  mockHostsInOrg = []
  mockLimits = []
})

describe('readOrgWideActivity paging', () => {
  it('merges every subject newest-first', async () => {
    mockHostsInOrg = ['h1', 'h2']
    mockCorpus = [
      entry('a', 'orgs/org-1', 300),
      entry('b', 'hosts/h1', 200),
      entry('c', 'hosts/h2', 100),
    ]
    const page = await readOrgWideActivity({ orgId: 'org-1', limit: 10 })
    expect(page.entries.map((e) => e.$id)).toEqual(['a', 'b', 'c'])
    expect(page.nextCursor).toBeNull()
  })

  it('asks each subject for one row past the page', async () => {
    // `limit` from EACH subject, because the newest `limit` overall could all
    // have come from one site; the extra row tells a full subject from an
    // exhausted one.
    mockHostsInOrg = ['h1']
    mockCorpus = [entry('a', 'orgs/org-1', 300)]
    await readOrgWideActivity({ orgId: 'org-1', limit: 10 })
    expect(mockLimits).toEqual([11, 11])
  })

  it('walks the whole feed without repeating or dropping a row', async () => {
    mockHostsInOrg = ['h1']
    mockCorpus = [
      entry('a', 'orgs/org-1', 500),
      entry('b', 'hosts/h1', 400),
      entry('c', 'orgs/org-1', 300),
      entry('d', 'hosts/h1', 200),
      entry('e', 'orgs/org-1', 100),
    ]
    const seen: string[] = []
    let cursor: string | null = null
    for (let guard = 0; guard < 10; guard += 1) {
      const page: Awaited<ReturnType<typeof readOrgWideActivity>> =
        await readOrgWideActivity({ orgId: 'org-1', limit: 2, cursor })
      seen.push(...page.entries.map((item) => item.$id))
      cursor = page.nextCursor
      if (!cursor) break
    }
    expect(seen).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('THE BOUNDARY SECOND: rows sharing the cut are shown exactly once', async () => {
    /*
     * Four entries at the SAME instant, paged two at a time. A strict `<`
     * would lose the two that did not fit on page one; a plain `<=` with no
     * exclusion list would serve the first two again forever.
     */
    mockHostsInOrg = ['h1']
    mockCorpus = [
      entry('a', 'orgs/org-1', 400),
      entry('b', 'orgs/org-1', 400),
      entry('c', 'hosts/h1', 400),
      entry('d', 'hosts/h1', 400),
    ]
    const seen: string[] = []
    let cursor: string | null = null
    for (let guard = 0; guard < 10; guard += 1) {
      const page: Awaited<ReturnType<typeof readOrgWideActivity>> =
        await readOrgWideActivity({ orgId: 'org-1', limit: 2, cursor })
      seen.push(...page.entries.map((item) => item.$id))
      cursor = page.nextCursor
      if (!cursor) break
    }
    expect(seen.slice().sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(new Set(seen).size).toBe(4)
  })

  it('an unreadable cursor restarts at the top rather than throwing', async () => {
    mockHostsInOrg = []
    mockCorpus = [entry('a', 'orgs/org-1', 300)]
    const page = await readOrgWideActivity({
      orgId: 'org-1',
      limit: 10,
      cursor: 'not-base64-json',
    })
    expect(page.entries.map((e) => e.$id)).toEqual(['a'])
  })
})
