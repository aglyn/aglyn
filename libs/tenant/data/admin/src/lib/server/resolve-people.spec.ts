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
 * AGL-938. The failure shape these guard against is a staff page rendering a
 * raw uid — or worse, crashing — because "resolve the uid" only asked one of
 * the three identity stores. Each case pins one store as the only answerer
 * and asserts the person still comes back, and the last ones assert that a
 * uid nobody knows degrades to an explicit unresolved entry rather than an
 * absent key or a thrown error.
 */

import { resolveUidsToPeople } from './resolve-people'

/** An auth-pool answer in the `PooledUserRecord` shape. */
const pooled = (uid: string, email: string | null, displayName: string | null) =>
  ({ record: { uid, email, displayName }, tenantId: null }) as any

/** A fake Firestore covering exactly what the roster fallback touches. */
const fakeFirestore = (
  rosters: Record<string, { email?: string; displayName?: string }>,
  fail = false,
) => {
  const refs: string[] = []
  return {
    collection: (name: string) => ({
      doc: (orgId: string) => ({
        collection: (sub: string) => ({
          doc: (uid: string) => ({ key: `${name}/${orgId}/${sub}/${uid}`, uid }),
        }),
      }),
    }),
    getAll: async (...docRefs: Array<{ uid: string }>) => {
      if (fail) throw new Error('roster unavailable')
      refs.push(...docRefs.map((ref) => ref.uid))
      return docRefs.map((ref) => {
        const data = rosters[ref.uid]
        return {
          exists: !!data,
          get: (field: string) => (data as any)?.[field],
        }
      })
    },
    refs,
  }
}

describe('resolveUidsToPeople (AGL-938)', () => {
  it('resolves a uid the auth pools know, without touching the roster', async () => {
    const firestore = fakeFirestore({})
    const people = await resolveUidsToPeople(['u1'], {
      orgId: 'org1',
      firestore,
      findUser: async (uid) => pooled(uid, 'zach@aglyn.com', 'Zach Gover'),
    })
    expect(people['u1']).toEqual({
      uid: 'u1',
      email: 'zach@aglyn.com',
      displayName: 'Zach Gover',
      source: 'auth',
    })
    // A pool hit must not cost a roster read.
    expect(firestore.refs).toEqual([])
  })

  it('falls back to the org roster for a uid no auth pool answers', async () => {
    // The SSO shape: the member exists only as a roster doc — exactly what
    // a tenant-listing outage or a deleted auth record leaves behind.
    const firestore = fakeFirestore({
      sso1: { email: 'sso@corp.com', displayName: 'S. S. Olsen' },
    })
    const people = await resolveUidsToPeople(['sso1'], {
      orgId: 'org1',
      firestore,
      findUser: async () => null,
    })
    expect(people['sso1']).toEqual({
      uid: 'sso1',
      email: 'sso@corp.com',
      displayName: 'S. S. Olsen',
      source: 'roster',
    })
  })

  it('marks a uid nobody knows as unresolved instead of omitting it', async () => {
    const people = await resolveUidsToPeople(['ghost', 'system:cron'], {
      orgId: 'org1',
      firestore: fakeFirestore({}),
      findUser: async () => null,
    })
    // Present, explicitly unresolved — the caller renders the uid itself
    // with an unknown hint, and indexing needs no existence check.
    expect(people['ghost']).toEqual({
      uid: 'ghost',
      email: null,
      displayName: null,
      source: null,
    })
    expect(people['system:cron']?.source).toBeNull()
  })

  it('does not resolve an empty roster doc to an empty person', async () => {
    // A member doc that exists but names nobody is a miss, not a person —
    // otherwise the UI shows a blank where the uid at least meant something.
    const people = await resolveUidsToPeople(['u1'], {
      orgId: 'org1',
      firestore: fakeFirestore({ u1: {} }),
      findUser: async () => null,
    })
    expect(people['u1']?.source).toBeNull()
  })

  it('dedupes uids and skips blanks', async () => {
    const findUser = jest.fn(async (uid: string) => pooled(uid, 'a@b.com', null))
    const people = await resolveUidsToPeople(['u1', 'u1', '', null, undefined], {
      findUser,
    })
    expect(findUser).toHaveBeenCalledTimes(1)
    expect(Object.keys(people)).toEqual(['u1'])
  })

  it('degrades to unresolved when both stores throw, never rejecting', async () => {
    // Fail-soft is the contract: a labelling nicety must not 500 the org
    // detail page that asked for it.
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const people = await resolveUidsToPeople(['u1'], {
      orgId: 'org1',
      firestore: fakeFirestore({ u1: { email: 'x@y.com' } }, true),
      findUser: async () => {
        throw new Error('auth outage')
      },
    })
    expect(people['u1']).toEqual({
      uid: 'u1',
      email: null,
      displayName: null,
      source: null,
    })
    error.mockRestore()
  })

  it('leaves pool misses unresolved when no orgId offers a roster', async () => {
    const people = await resolveUidsToPeople(['u1'], {
      findUser: async () => null,
    })
    expect(people['u1']?.source).toBeNull()
  })
})
