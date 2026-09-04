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
 * PROVIDER-SUPPLIED ADDRESSES AND THE UNIQUENESS INDEX.
 *
 * `emailIdentityIndex` is what stops two accounts holding one address, and
 * nothing ever claimed an entry for a `providerData` email — so a federated
 * address was verified by its provider, usable to sign in, and entirely
 * outside the guard. One address could be one account's primary and another
 * account's Google address with nothing recording the clash.
 *
 * ## What these assert, and why it is the holder rather than the refusal
 *
 * A spec that only checked "the second account did not win" would still pass
 * if the entry had been overwritten and then restored, or if the code under
 * test never ran at all. So every conflict case asserts WHO OWNS THE ENTRY
 * afterwards — the original holder, unchanged, including its `claimedAt`.
 *
 * ⛔ Every address below is synthetic.
 */

import { registerProviderAddresses } from './account-emails'

const store = new Map<string, Record<string, any>>()

function applyWrite(
  target: Record<string, any>,
  update: Record<string, any>,
): Record<string, any> {
  const next = { ...target }
  for (const [key, value] of Object.entries(update)) {
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as any).isEqual === 'function'
    ) {
      next[key] = { serverTimestamp: true }
      continue
    }
    next[key] = value
  }
  return next
}

const docRef = (path: string): any => ({
  path,
  id: path.split('/').pop(),
  get: async () => ({
    exists: store.has(path),
    id: path.split('/').pop(),
    data: () => store.get(path),
    get: (field: string) => store.get(path)?.[field],
  }),
  set: async (update: Record<string, any>) => {
    store.set(path, applyWrite(store.get(path) ?? {}, update))
  },
  delete: async () => void store.delete(path),
  collection: (name: string) => collectionRef(`${path}/${name}`),
})

const collectionRef = (prefix: string): any => ({
  doc: (id: string) => docRef(`${prefix}/${id}`),
  get: async () => {
    const entries = [...store.entries()].filter(([path]) => {
      const rest = path.slice(prefix.length + 1)
      return path.startsWith(`${prefix}/`) && !rest.includes('/')
    })
    return {
      empty: entries.length === 0,
      size: entries.length,
      docs: entries.map(([path, data]) => ({
        id: path.split('/').pop(),
        ref: docRef(path),
        data: () => data,
        get: (field: string) => data[field],
      })),
    }
  },
})

const fakeFirestore = {
  collection: (name: string) => collectionRef(name),
  batch: () => {
    const queued: Array<() => Promise<void>> = []
    return {
      set: (ref: any, update: Record<string, any>) =>
        queued.push(() => ref.set(update)),
      commit: async () => {
        for (const run of queued) await run()
      },
    }
  },
  runTransaction: async (body: (transaction: any) => Promise<any>) =>
    body({
      get: async (ref: any) => ref.get(),
      set: async (ref: any, update: Record<string, any>) => ref.set(update),
    }),
}

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => fakeFirestore }) },
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore }) },
}))

jest.mock('./auth-pools', () => ({
  __esModule: true,
  findUserByEmailAcrossPools: async () => null,
  authForPool: () => ({ updateUser: async () => undefined }),
}))

jest.mock('./sso-domain-policy', () => ({
  __esModule: true,
  ssoDomainEnforcementEnabled: () => false,
  ssoRequiredDomains: () => [],
}))

const indexEntry = (address: string) =>
  store.get(`emailIdentityIndex/${address}`)
const accountRow = (uid: string, address: string) =>
  store.get(`users/${uid}/emails/${address}`)

beforeEach(() => {
  store.clear()
})

describe('registerProviderAddresses', () => {
  it('claims an unheld provider address and records it on the account', async () => {
    const result = await registerProviderAddresses('uid_1', {
      email: 'primary@example.test',
      providerData: [
        { providerId: 'google.com', email: 'work@example.test' },
      ],
    })

    expect(result.claimed).toEqual(['work@example.test'])
    expect(result.conflicted).toEqual([])
    expect(indexEntry('work@example.test')?.uid).toBe('uid_1')
    expect(accountRow('uid_1', 'work@example.test')).toMatchObject({
      address: 'work@example.test',
      verified: true,
      primary: false,
      source: 'provider',
      indexConflict: false,
    })
  })

  it('LEAVES THE ORIGINAL HOLDER IN PLACE when another account holds it', async () => {
    // The live shape, synthetically: `shared@` is already claimed by another
    // account, and a second account signs in carrying it via Google.
    store.set('emailIdentityIndex/shared@example.test', {
      uid: 'uid_first',
      address: 'shared@example.test',
      claimedAt: 'originally',
    })

    const result = await registerProviderAddresses('uid_second', {
      email: 'other@example.test',
      providerData: [
        { providerId: 'google.com', email: 'shared@example.test' },
      ],
    })

    /*
     * THE ASSERTION THAT MATTERS: the holder, not the refusal.
     *
     * Checking only that `uid_second` failed to claim would pass just as
     * happily if the entry had been overwritten and put back, or if nothing
     * ran. The entry must be untouched — the SAME uid and the SAME
     * `claimedAt`, which a rewrite would have replaced with a server
     * timestamp sentinel.
     */
    expect(indexEntry('shared@example.test')).toEqual({
      uid: 'uid_first',
      address: 'shared@example.test',
      claimedAt: 'originally',
    })
    expect(result.conflicted).toEqual(['shared@example.test'])
    expect(result.claimed).toEqual([])
  })

  it('records a refused claim UNVERIFIED, so it grants nothing', async () => {
    store.set('emailIdentityIndex/shared@example.test', {
      uid: 'uid_first',
      address: 'shared@example.test',
    })

    await registerProviderAddresses('uid_second', {
      email: 'other@example.test',
      providerData: [
        { providerId: 'google.com', email: 'shared@example.test' },
      ],
    })

    const row = accountRow('uid_second', 'shared@example.test')
    // Visible on the account — silently skipping is what produced the live
    // collision — but NOT verified: `verifiedAccountEmails` feeds invitation
    // matching, and a contested address verified on both accounts would make
    // one invitation match two people.
    expect(row).toMatchObject({ indexConflict: true, verified: false })
    expect(typeof row?.indexConflictAtMs).toBe('number')
  })

  it('never reassigns, merges or disables anything', async () => {
    store.set('emailIdentityIndex/shared@example.test', {
      uid: 'uid_first',
      address: 'shared@example.test',
    })
    store.set('users/uid_first/emails/shared@example.test', {
      address: 'shared@example.test',
      verified: true,
      primary: true,
    })

    await registerProviderAddresses('uid_second', {
      email: 'other@example.test',
      providerData: [
        { providerId: 'google.com', email: 'shared@example.test' },
      ],
    })

    // The first account is exactly as it was. Two real people may be behind
    // these accounts and reassigning an identity is not a decision code makes.
    expect(accountRow('uid_first', 'shared@example.test')).toEqual({
      address: 'shared@example.test',
      verified: true,
      primary: true,
    })
  })

  it('CONTROL: ignores the primary and non-federated providers', async () => {
    const result = await registerProviderAddresses('uid_1', {
      email: 'primary@example.test',
      providerData: [
        // The primary is seeded by `listAccountEmails` on the Auth record's
        // authority; re-claiming it here would race that seed.
        { providerId: 'google.com', email: 'primary@example.test' },
        // A password provider's address IS the primary, and its verification
        // state lives on the Auth record rather than the provider entry.
        { providerId: 'password', email: 'primary@example.test' },
        { providerId: 'phone', email: null },
      ],
    })

    expect(result.claimed).toEqual([])
    expect(result.conflicted).toEqual([])
    expect(store.size).toBe(0)
  })

  it('a write failure never throws — sign-in must not depend on this', async () => {
    const failing = jest
      .spyOn(fakeFirestore, 'runTransaction')
      .mockRejectedValue(new Error('firestore down'))

    // A person locked out because a bookkeeping write failed is worse than
    // the collision it was preventing.
    await expect(
      registerProviderAddresses('uid_1', {
        email: 'primary@example.test',
        providerData: [
          { providerId: 'google.com', email: 'work@example.test' },
        ],
      }),
    ).resolves.toEqual({ claimed: [], conflicted: [] })

    failing.mockRestore()
  })
})
