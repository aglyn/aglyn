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
 * @jest-environment node
 */

/**
 * WHAT AN ACCOUNT LOCK AND A BAN DO TO THE SUPPRESSION LISTS (AGL-3420).
 *
 *  - A ban's platform row outlives every other writer: a later bounce does
 *    not rewrite it, a staff release does not lift it, and only lifting the
 *    ban does — restoring whatever suppression it was filed over.
 *  - The preflight's ban list sees live ban rows and nothing else.
 *  - A lock's per-site row is written only where none stood, and lifted only
 *    while it is still that account's lock row.
 */

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    delete: () => ({ __delete: true }),
  },
  Timestamp: class {},
}))

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => { throw new Error('use the injected store') } }) },
}))

jest.mock('@aglyn/aglyn/plugin-manager/plugin-record-email-state', () => ({
  stampRecordEmailState: async () => undefined,
}))

import {
  accountBannedRecipients,
  emailSuppressionKey,
  forgetAccountBans,
  HOST_ACCOUNT_LOCK_SUPPRESSION_REASON,
  isAccountBanSuppression,
  releaseAccountBanSuppressions,
  releaseAccountLockSuppression,
  releaseEmail,
  suppressEmail,
  suppressEmailForAccountLock,
} from './email-suppression'

/** Documents by full path; a query filters one collection by equality. */
const rows = new Map<string, Record<string, any>>()

const isDelete = (value: unknown) => Boolean((value as any)?.__delete)

function docRef(path: string): any {
  const ref = {
    path,
    get: async () => {
      const data = rows.get(path)
      return {
        id: path.slice(path.lastIndexOf('/') + 1),
        exists: data !== undefined,
        ref,
        get: (field: string) => data?.[field],
        data: () => data,
      }
    },
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      const next: Record<string, any> = options?.merge ? { ...(rows.get(path) ?? {}) } : {}
      for (const [key, field] of Object.entries(value)) {
        if (isDelete(field)) delete next[key]
        else next[key] = field
      }
      rows.set(path, next)
    },
    delete: async () => {
      rows.delete(path)
    },
    collection: (sub: string) => collectionRef(`${path}/${sub}`),
  }
  return ref
}

function collectionRef(path: string): any {
  const filters: Array<[string, unknown]> = []
  const api: any = {
    doc: (id: string) => docRef(`${path}/${id}`),
    where: (field: string, _op: string, value: unknown) => {
      filters.push([field, value])
      return api
    },
    get: async () => {
      const docs = []
      for (const [key, data] of rows) {
        if (!key.startsWith(`${path}/`) || key.slice(path.length + 1).includes('/')) continue
        if (filters.every(([field, value]) => data[field] === value)) {
          docs.push(await docRef(key).get())
        }
      }
      return { docs }
    },
  }
  return api
}

const store = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (body: (transaction: any) => Promise<unknown>) => {
    const writes: Array<() => Promise<void>> = []
    const transaction = {
      get: (ref: any) => ref.get(),
      set: (ref: any, value: Record<string, any>, options?: { merge?: boolean }) => {
        writes.push(() => ref.set(value, options))
      },
      delete: (ref: any) => {
        writes.push(() => ref.delete())
      },
    }
    const result = await body(transaction)
    for (const write of writes) await write()
    return result
  },
}

const platformRow = (email: string) => rows.get(`emailSuppressions/${emailSuppressionKey(email)}`)
const siteRow = (hostId: string, email: string) =>
  rows.get(`hosts/${hostId}/suppressions/${emailSuppressionKey(email)}`)

beforeEach(() => {
  rows.clear()
  forgetAccountBans()
})

describe('a ban on the platform list', () => {
  it('is not rewritten by a later bounce, and no staff release lifts it', async () => {
    await suppressEmail({ email: 'x@bad.example', reason: 'account_ban', subjectUid: 'u1', firestore: store })
    await suppressEmail({ email: 'x@bad.example', reason: 'bounce', firestore: store })
    expect(platformRow('x@bad.example')).toMatchObject({ reason: 'account_ban', subjectUid: 'u1' })
    expect(await releaseEmail({ email: 'x@bad.example', releasedByUid: 'staff', firestore: store })).toBe(false)
    expect(platformRow('x@bad.example')?.['releasedAt']).toBeFalsy()
    expect(await isAccountBanSuppression('x@bad.example', store)).toBe(true)
  })

  it('is lifted only by lifting the ban, and restores what it was filed over', async () => {
    await suppressEmail({ email: 'complained@bad.example', reason: 'complaint', firestore: store })
    await suppressEmail({ email: 'complained@bad.example', reason: 'account_ban', subjectUid: 'u1', firestore: store })
    await suppressEmail({ email: 'fresh@bad.example', reason: 'account_ban', subjectUid: 'u1', firestore: store })
    await suppressEmail({ email: 'other@bad.example', reason: 'account_ban', subjectUid: 'u2', firestore: store })

    expect(await releaseAccountBanSuppressions({ uid: 'u1', releasedByUid: 'staff', firestore: store })).toBe(2)

    // The complaint stands again, unreleased; the ban-only row is released.
    expect(platformRow('complained@bad.example')).toMatchObject({ reason: 'complaint' })
    expect(platformRow('complained@bad.example')?.['releasedAt']).toBeFalsy()
    expect(platformRow('complained@bad.example')?.['subjectUid']).toBeUndefined()
    expect(platformRow('fresh@bad.example')).toMatchObject({ released: true, releasedVia: 'ban-lifted' })
    // Another account's ban is untouched.
    expect(platformRow('other@bad.example')).toMatchObject({ reason: 'account_ban' })
    expect(platformRow('other@bad.example')?.['releasedAt']).toBeFalsy()
  })

  it('is what the preflight reads as banned — live ban rows only', async () => {
    await suppressEmail({ email: 'banned@bad.example', reason: 'account_ban', subjectUid: 'u1', firestore: store })
    await suppressEmail({ email: 'bounced@ok.example', reason: 'bounce', firestore: store })
    await suppressEmail({ email: 'lifted@bad.example', reason: 'account_ban', subjectUid: 'u2', firestore: store })
    await releaseAccountBanSuppressions({ uid: 'u2', firestore: store })

    const banned = await accountBannedRecipients(
      ['Banned@Bad.example', 'bounced@ok.example', 'lifted@bad.example', 'clean@ok.example'],
      store,
    )
    expect([...banned]).toEqual(['banned@bad.example'])
  })
})

describe("a lock's row on the house sites", () => {
  it('is written only where no row stood', async () => {
    await docRef(`hosts/house/suppressions/${emailSuppressionKey('left@x.example')}`).set({
      email: 'left@x.example',
      reason: 'unsubscribe',
    })
    expect(await suppressEmailForAccountLock({ hostId: 'house', email: 'left@x.example', uid: 'u1', firestore: store })).toBe(false)
    expect(siteRow('house', 'left@x.example')).toMatchObject({ reason: 'unsubscribe' })

    expect(await suppressEmailForAccountLock({ hostId: 'house', email: 'new@x.example', uid: 'u1', firestore: store })).toBe(true)
    expect(siteRow('house', 'new@x.example')).toMatchObject({
      reason: HOST_ACCOUNT_LOCK_SUPPRESSION_REASON,
      subjectUid: 'u1',
      email: 'new@x.example',
    })
  })

  it('is lifted only while it is still this account’s lock row', async () => {
    await suppressEmailForAccountLock({ hostId: 'house', email: 'new@x.example', uid: 'u1', firestore: store })
    await docRef(`hosts/house/suppressions/${emailSuppressionKey('left@x.example')}`).set({ reason: 'unsubscribe' })

    expect(await releaseAccountLockSuppression({ hostId: 'house', email: 'new@x.example', uid: 'u2', firestore: store })).toBe(false)
    expect(await releaseAccountLockSuppression({ hostId: 'house', email: 'left@x.example', uid: 'u1', firestore: store })).toBe(false)
    expect(siteRow('house', 'left@x.example')).toMatchObject({ reason: 'unsubscribe' })

    expect(await releaseAccountLockSuppression({ hostId: 'house', email: 'new@x.example', uid: 'u1', firestore: store })).toBe(true)
    expect(siteRow('house', 'new@x.example')).toBeUndefined()
  })
})
