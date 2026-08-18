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

import { backfillMemberIdentity } from './organizations'

/**
 * AGL-1131. This runs on the SSO route's already-a-member branch — the branch
 * every sign-in after the first takes — so the property that matters is that
 * running it forever cannot change anything it did not create.
 */
function fakeDb(member?: Record<string, unknown>) {
  const state: { data: Record<string, unknown> | undefined } = { data: member }
  const writes: Array<Record<string, unknown>> = []
  return {
    writes,
    state,
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: state.data !== undefined,
              get: (field: string) => state.data?.[field],
            }),
            set: async (data: Record<string, unknown>) => {
              writes.push(data)
              state.data = { ...(state.data ?? {}), ...data }
            },
          }),
        }),
      }),
    }),
  } as any
}

describe('backfillMemberIdentity', () => {
  it('fills a blank roster row', async () => {
    // The measured production state: a real owner whose row carried an email
    // and nothing else, so every member surface rendered them nameless.
    const db = fakeDb({ role: 'owner', email: 'zach@aglyn.com' })
    const written = await backfillMemberIdentity(
      'jWmGooWE3L',
      'QQ7fixtureUid0000000000000001',
      { displayName: 'Zach Gover', photoURL: null },
      db,
    )
    expect(written).toEqual(['displayName'])
    expect(db.state.data).toMatchObject({
      role: 'owner',
      displayName: 'Zach Gover',
    })
  })

  it('never touches a name already on the row', async () => {
    const db = fakeDb({ role: 'admin', displayName: 'Z. Gover' })
    expect(
      await backfillMemberIdentity('o1', 'u1', { displayName: 'Zach Gover' }, db),
    ).toEqual([])
    expect(db.writes).toEqual([])
  })

  it('writes nothing at all when there is nothing to add', async () => {
    // The steady state on every subsequent sign-in. A write here would be a
    // pointless Firestore round trip on the auth path.
    const db = fakeDb({ role: 'owner', displayName: 'Zach Gover' })
    expect(await backfillMemberIdentity('o1', 'u1', {}, db)).toEqual([])
    expect(db.writes).toEqual([])
  })

  it('refuses to create a membership that does not exist', async () => {
    // The dangerous case. A row written here would have no role, and a
    // permission check that only asks whether the doc exists would read it
    // as a member — the AGL-1122 bug class.
    const db = fakeDb(undefined)
    expect(
      await backfillMemberIdentity('o1', 'u1', { displayName: 'Mallory' }, db),
    ).toEqual([])
    expect(db.writes).toEqual([])
    expect(db.state.data).toBeUndefined()
  })

  it('never writes the role, host access or invite state', async () => {
    // The reason this exists instead of reusing upsertOrgMember, which
    // requires a role and would re-assert the org's SSO default over it.
    const db = fakeDb({ role: 'admin', allHosts: true, hostAccess: { h1: true } })
    await backfillMemberIdentity(
      'o1',
      'u1',
      { displayName: 'Zach Gover', photoURL: 'https://cdn.example/z.png' },
      db,
    )
    expect(Object.keys(db.writes[0]).sort()).toEqual(['displayName', 'photoURL'])
    expect(db.state.data).toMatchObject({ role: 'admin', allHosts: true })
  })

  it('ignores blank and whitespace-only values', async () => {
    const db = fakeDb({ role: 'viewer' })
    expect(
      await backfillMemberIdentity(
        'o1',
        'u1',
        { displayName: '   ', photoURL: '' },
        db,
      ),
    ).toEqual([])
    expect(db.writes).toEqual([])
  })

  it('backfills the photo independently of the name', async () => {
    const db = fakeDb({ role: 'viewer', displayName: 'Zach Gover' })
    expect(
      await backfillMemberIdentity(
        'o1',
        'u1',
        { displayName: 'Zach Gover', photoURL: 'https://cdn.example/z.png' },
        db,
      ),
    ).toEqual(['photoURL'])
  })
})
