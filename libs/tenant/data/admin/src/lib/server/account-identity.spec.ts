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

import {
  resolveUserRecordIdentities,
  syncAuthIdentityFromIdp,
} from './account-identity'

/*
 * AGL-3721. The sign-in sync runs on EVERY SSO sign-in, so the property that
 * matters is that running it can never undo a name or photo somebody set —
 * and that the staff list pays a profile read only for the rows the Auth
 * record leaves blank.
 */

function fakeFirestore(docs: Record<string, Record<string, unknown>>) {
  const getAllCalls: string[][] = []
  const ref = (id: string) => ({
    id,
    get: async () => ({
      id,
      exists: id in docs,
      get: (field: string) => docs[id]?.[field],
      data: () => docs[id],
    }),
  })
  return {
    getAllCalls,
    collection: () => ({ doc: (id: string) => ref(id) }),
    getAll: async (...refs: Array<{ id: string }>) => {
      getAllCalls.push(refs.map((one) => one.id))
      return Promise.all(refs.map((one) => ref(one.id).get()))
    },
  }
}

function fakeAuth(record: { displayName?: string | null; photoURL?: string | null }) {
  const updates: Array<Record<string, unknown>> = []
  return {
    updates,
    getUser: async () => record,
    updateUser: async (_uid: string, fields: Record<string, unknown>) => {
      updates.push(fields)
      return {}
    },
  }
}

const idp = { displayName: 'Zach Gover', photoUrl: 'https://dir.example/z.png' }

describe('syncAuthIdentityFromIdp (AGL-3721)', () => {
  it('fills a blank SSO Auth record from the IdP', async () => {
    const auth = fakeAuth({ displayName: null, photoURL: undefined })
    const result = await syncAuthIdentityFromIdp({
      uid: 'u1',
      tenantId: 'aglyn-org-y5v14',
      idp,
      auth,
      firestore: fakeFirestore({}),
    })
    expect(result.fields.sort()).toEqual(['displayName', 'photoURL'])
    expect(auth.updates).toEqual([
      { displayName: 'Zach Gover', photoURL: 'https://dir.example/z.png' },
    ])
  })

  it('NEVER overwrites a name or photo already on the record', async () => {
    const auth = fakeAuth({ displayName: 'Chosen', photoURL: 'https://mine.example/me.png' })
    const result = await syncAuthIdentityFromIdp({
      uid: 'u1',
      tenantId: 'aglyn-org-y5v14',
      idp,
      auth,
      firestore: fakeFirestore({}),
    })
    expect(result.fields).toEqual([])
    expect(auth.updates).toEqual([])
  })

  it('fills only the blank half', async () => {
    const auth = fakeAuth({ displayName: 'Chosen', photoURL: null })
    await syncAuthIdentityFromIdp({
      uid: 'u1',
      tenantId: null,
      record: { displayName: 'Chosen', photoURL: null as unknown as string },
      idp,
      auth,
      firestore: fakeFirestore({}),
    })
    expect(auth.updates).toEqual([{ photoURL: 'https://dir.example/z.png' }])
  })

  it('does not put back an avatar the person removed (photoUrlErasedAt)', async () => {
    const auth = fakeAuth({})
    await syncAuthIdentityFromIdp({
      uid: 'u1',
      tenantId: 'aglyn-org-y5v14',
      idp,
      auth,
      firestore: fakeFirestore({ u1: { photoUrlErasedAt: 1 } }),
    })
    expect(auth.updates).toEqual([{ displayName: 'Zach Gover' }])
  })

  it('does nothing — not even a read — when the IdP sent nothing', async () => {
    const auth = fakeAuth({})
    const getUser = jest.spyOn(auth, 'getUser')
    const result = await syncAuthIdentityFromIdp({
      uid: 'u1',
      tenantId: null,
      idp: { displayName: null, photoUrl: null },
      auth,
    })
    expect(result.fields).toEqual([])
    expect(getUser).not.toHaveBeenCalled()
  })
})

describe('resolveUserRecordIdentities (AGL-3721)', () => {
  const record = (uid: string, over: Record<string, unknown> = {}) => ({
    record: {
      uid,
      email: `${uid}@example.com`,
      displayName: undefined as string | undefined,
      photoURL: undefined as string | undefined,
      providerData: [] as any[],
      ...over,
    } as any,
  })

  it('reads users/{uid} only for the rows the Auth record leaves blank', async () => {
    const firestore = fakeFirestore({
      sso: { firstName: 'Zach', lastName: 'Gover', photoUrl: 'https://cdn.example/z.png' },
    })
    const identities = await resolveUserRecordIdentities(
      [
        record('google', { displayName: 'Ada', photoURL: 'https://g.example/a.png' }),
        record('sso'),
      ],
      { firestore },
    )
    expect(firestore.getAllCalls).toEqual([['sso']])
    expect(identities.get('sso')).toMatchObject({
      displayName: 'Zach Gover',
      photoUrl: 'https://cdn.example/z.png',
      displayNameSource: 'profile',
    })
    expect(identities.get('google')).toMatchObject({ displayName: 'Ada', displayNameSource: 'auth' })
  })

  it('falls back to the Auth record when the profile read fails', async () => {
    const firestore = {
      collection: () => ({ doc: (id: string) => ({ id }) }),
      getAll: async () => {
        throw new Error('unavailable')
      },
    }
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const identities = await resolveUserRecordIdentities([record('sso')], { firestore })
    expect(identities.get('sso')).toMatchObject({ displayName: null, label: 'sso@example.com' })
    error.mockRestore()
  })
})
