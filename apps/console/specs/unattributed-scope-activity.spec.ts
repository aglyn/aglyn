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
 * AGL-118 — the staff user page shows unattributed workspace activity WITHOUT
 * claiming the person performed it.
 *
 * No artifact under a host recorded its creator until this issue, and three
 * template surfaces logged nothing at all, so the attributed feed
 * (`actorId == uid`) is empty for someone who built a site from a template and
 * the page reads as an account that never used the product. The second section
 * answers that, and the entire risk it carries is that it answers it by
 * IMPLYING attribution.
 *
 * So the two readers are pinned against each other. The attributed one must
 * never surface a row nothing attributes; the unattributed one must never
 * reach outside the workspaces the person administers; and neither may
 * swallow the other.
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

import {
  administeredScopePaths,
  readActorActivity,
  readUnattributedScopeActivity,
} from '../utils/server/actor-activity'

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

  it('the unattributed feed carries only rows with no actor', async () => {
    mockUserOrgs = [{ id: 'o1', role: 'owner' }]
    mockHostsByOrg = { o1: ['h1'] }
    mockCorpus = [
      attributed('a1', 'hosts/h1', 900),
      unattributed('r1', 'hosts/h1', 800),
    ]
    const page = await readUnattributedScopeActivity({ uid: THEM, pageSize: 25 })
    expect(page.entries.map((entry) => entry.$id)).toEqual(['r1'])
    // Rendered as "not recorded" by the table; never as an empty cell, which
    // reads as a bug and invites the reader to fill the blank in themselves.
    expect(page.entries[0].actorEmail).toBeNull()
  })
})

describe('the unattributed feed is scoped to what the account administers', () => {
  it('does not leak another organization\'s activity', async () => {
    mockUserOrgs = [{ id: 'o1', role: 'owner' }]
    mockHostsByOrg = { o1: ['h1'] }
    mockCorpus = [
      unattributed('mine', 'hosts/h1', 900),
      // Same shape, same absence of an actor, another org's site. Nothing
      // about this row is distinguishable except WHERE it happened.
      unattributed('theirs', 'hosts/h-other', 800),
    ]
    const page = await readUnattributedScopeActivity({ uid: THEM, pageSize: 25 })
    expect(page.entries.map((entry) => entry.$id)).toEqual(['mine'])
  })

  it('counts owner and admin, and not a lesser membership', async () => {
    // "Administers" is narrower than "belongs to" on purpose: an editor on
    // somebody else's site has no administrative relationship to its activity,
    // and listing it on a staff page about them misrepresents their remit.
    mockUserOrgs = [{ id: 'o1', role: 'editor' }]
    mockHostsByOrg = { o1: ['h1'] }
    mockCorpus = [unattributed('r1', 'hosts/h1', 900)]
    const page = await readUnattributedScopeActivity({ uid: THEM, pageSize: 25 })
    expect(page.entries).toEqual([])

    mockUserOrgs = [{ id: 'o1', role: 'admin' }]
    const asAdmin = await readUnattributedScopeActivity({
      uid: THEM,
      pageSize: 25,
    })
    expect(asAdmin.entries.map((entry) => entry.$id)).toEqual(['r1'])
  })

  it('an account that administers nothing gets an empty feed, not the platform\'s', async () => {
    // The scope set is REQUIRED for this reader. An empty one must mean "no
    // rows", never "no filter" — the difference between an empty section and
    // every unattributed row on the platform under one person's name.
    mockUserOrgs = []
    mockCorpus = [unattributed('r1', 'hosts/h1', 900)]
    const page = await readUnattributedScopeActivity({ uid: THEM, pageSize: 25 })
    expect(page.entries).toEqual([])
    expect(page.nextCursor).toBeNull()
  })

  it('the org feed itself is in scope, not only its sites', async () => {
    mockUserOrgs = [{ id: 'o1', role: 'owner' }]
    mockHostsByOrg = { o1: ['h1'] }
    expect([...(await administeredScopePaths(THEM))].sort()).toEqual([
      'hosts/h1',
      'orgs/o1',
    ])
  })
})
