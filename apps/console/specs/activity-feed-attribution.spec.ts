/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
 */
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
 * AGL-118 — the staff user page shows exactly the rows an actor is recorded
 * on, and nothing else.
 *
 * No artifact under a host recorded its creator until this issue, and three
 * template surfaces logged nothing at all, so `actorId == uid` returned zero
 * for someone who had built a whole site and the page read as an account that
 * had never used the product. The reconstruction fills the actor in where a
 * host's access set is exhaustive and holds one person; where it does not,
 * the row keeps no actor and belongs to the SITE's feed, not to anybody's
 * page.
 *
 * Which makes one property load-bearing: a row with no actor must never be
 * reachable by the query that answers "what did this account do", however
 * strongly its surroundings suggest who it was.
 */

interface FakeDoc {
  id: string
  parent: string
  data: Record<string, unknown>
}

// `mock`-prefixed so the factory below may close over them.
let mockCorpus: FakeDoc[] = []
let mockHostsByOrg: Record<string, string[]> = {}
let mockUserOrgs: Array<{ id: string; role: string }> = []

const snapshotFor = (docs: FakeDoc[]) => ({
  empty: docs.length === 0,
  docs: docs.map((entry) => ({
    id: entry.id,
    data: () => entry.data,
    ref: {
      path: `${entry.parent}/activity/${entry.id}`,
      parent: { parent: { path: entry.parent } },
    },
  })),
})

jest.mock('@aglyn/tenant-data-admin', () => {
  /**
   * The collection-group double filters on `actorId` for real.
   *
   * A double that ignored the predicate would let the unattributed reader
   * "pass" while returning attributed rows — the exact confusion under test.
   */
  const build = (state: {
    after?: string | null
    limit: number
    actorId?: unknown
  }): any => ({
    where: (_field: string, _op: string, value: unknown) =>
      build({ ...state, actorId: value }),
    orderBy: () => build(state),
    startAfter: (doc: { ref: { path: string } }) =>
      build({ ...state, after: doc.ref.path }),
    limit: (value: number) => build({ ...state, limit: value }),
    get: async () => {
      const matching = mockCorpus.filter(
        (entry) => entry.data['actorId'] === state.actorId,
      )
      const index = state.after
        ? matching.findIndex(
            (entry) => `${entry.parent}/activity/${entry.id}` === state.after,
          ) + 1
        : 0
      return snapshotFor(matching.slice(index, index + state.limit))
    },
  })
  return {
    __esModule: true,
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collectionGroup: () => build({ limit: 25 }),
          doc: (path: string) => ({
            get: async () => {
              const found = mockCorpus.find(
                (entry) => `${entry.parent}/activity/${entry.id}` === path,
              )
              return { exists: Boolean(found), ref: { path } }
            },
          }),
          collection: (name: string) => ({
            // `hosts` where orgId == <org>, for orgActivityScopePaths.
            where: (_f: string, _op: string, orgId: string) => ({
              select: () => ({
                get: async () => ({
                  docs: (mockHostsByOrg[orgId] ?? []).map((id) => ({ id })),
                }),
              }),
            }),
            // `users/{uid}/orgs`, for administeredScopePaths.
            doc: () => ({
              collection: () => ({
                select: () => ({
                  get: async () => ({
                    docs: mockUserOrgs.map((entry) => ({
                      id: entry.id,
                      get: (field: string) =>
                        field === 'role' ? entry.role : undefined,
                    })),
                  }),
                }),
              }),
            }),
            get: async () => ({ docs: [] }),
          }),
        }),
      }),
    },
  }
})

import { readActorActivity } from '../utils/server/actor-activity'

const THEM = 'uid-the-account-this-page-is-about'

/** A row somebody is recorded as having performed. */
const attributed = (id: string, parent: string, seconds: number): FakeDoc => ({
  id,
  parent,
  data: {
    actorId: THEM,
    action: 'Saved the screen',
    target: { type: 'screen', name: 'Home' },
    createdAt: { seconds },
  },
})

/** A row nobody is recorded as having performed. */
const unattributed = (id: string, parent: string, seconds: number): FakeDoc => ({
  id,
  parent,
  data: {
    actorId: null,
    action: 'Created screen (reconstructed)',
    target: { type: 'screen', name: 'Home' },
    createdAt: { seconds },
    reconstructed: true,
    reconstructedFrom: `${parent}/screens/${id}`,
  },
})

beforeEach(() => {
  mockCorpus = []
  mockHostsByOrg = {}
  mockUserOrgs = []
})

describe('the two feeds cannot bleed into each other (AGL-118)', () => {
  it('THE CONTROL — a person with real attributed activity still sees it', async () => {
    // First, and load-bearing. Every separation assertion below would also
    // pass against a page that showed nothing at all, which is the bug.
    mockCorpus = [
      attributed('a1', 'hosts/h1', 900),
      unattributed('r1', 'hosts/h1', 800),
    ]
    const page = await readActorActivity({ actorId: THEM, pageSize: 25 })
    expect(page.entries.map((entry) => entry.$id)).toEqual(['a1'])
  })

  it('a reconstructed row never appears under the attributed heading', async () => {
    // The whole point. A row whose actor was never recorded must not be
    // reachable by the query that answers "what did this account do", however
    // strongly the surrounding evidence suggests it was them.
    mockCorpus = [
      unattributed('r1', 'hosts/h1', 900),
      unattributed('r2', 'hosts/h1', 800),
    ]
    const page = await readActorActivity({ actorId: THEM, pageSize: 25 })
    expect(page.entries).toEqual([])
  })
})
