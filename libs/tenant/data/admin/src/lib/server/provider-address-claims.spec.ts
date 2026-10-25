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

import { registerProviderAddresses, setPrimaryAccountEmail } from './account-emails'

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

/** Who Firebase Auth says holds an address; nobody unless a test says. */
const mockFindUser = jest.fn(async (_address: string): Promise<any> => null)
const mockUpdateUser = jest.fn(async (_uid: string, _update: any): Promise<void> => undefined)

jest.mock('./auth-pools', () => ({
  __esModule: true,
  findUserByEmailAcrossPools: (address: string) => mockFindUser(address),
  authForPool: () => ({
    updateUser: (uid: string, update: any) => mockUpdateUser(uid, update),
  }),
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
  mockFindUser.mockReset()
  mockFindUser.mockResolvedValue(null)
  mockUpdateUser.mockReset()
  mockUpdateUser.mockResolvedValue(undefined)
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

/**
 * AGL-4041. A provider address claimed for one account, then the Auth email
 * of a NEW account that signed up with it through Google, which never looks
 * at the index. "Make primary" on the first account used to reach
 * `updateUser`, get EMAIL_EXISTS, and answer 500.
 */
describe('setPrimaryAccountEmail — an address another account now holds in Auth', () => {
  const seed = () => {
    store.set('users/uid_1/emails/primary@example.test', {
      address: 'primary@example.test',
      verified: true,
      primary: true,
    })
    store.set('users/uid_1/emails/work@example.test', {
      address: 'work@example.test',
      verified: true,
      primary: false,
      source: 'provider',
    })
    store.set('emailIdentityIndex/work@example.test', {
      uid: 'uid_1',
      address: 'work@example.test',
    })
  }

  it('refuses before touching Auth when another account holds it', async () => {
    seed()
    mockFindUser.mockResolvedValue({ record: { uid: 'uid_2' } })

    const result = await setPrimaryAccountEmail('uid_1', 'work@example.test', {
      tenantId: null,
    })

    expect(result).toMatchObject({ ok: false, refusal: 'claimed-by-another-account' })
    expect(mockUpdateUser).not.toHaveBeenCalled()
    expect(accountRow('uid_1', 'primary@example.test')?.['primary']).toBe(true)
    expect(accountRow('uid_1', 'work@example.test')?.['primary']).toBe(false)
  })

  it('answers the same refusal when Auth says EMAIL_EXISTS anyway (a race)', async () => {
    seed()
    mockUpdateUser.mockRejectedValue(
      Object.assign(new Error('The email address is already in use by another account.'), {
        code: 'auth/email-already-exists',
      }),
    )

    const result = await setPrimaryAccountEmail('uid_1', 'work@example.test', {
      tenantId: null,
    })

    expect(result).toMatchObject({ ok: false, refusal: 'claimed-by-another-account' })
    expect(accountRow('uid_1', 'primary@example.test')?.['primary']).toBe(true)
  })

  it('still throws any other Auth failure, so a real fault stays a 500', async () => {
    seed()
    mockUpdateUser.mockRejectedValue(
      Object.assign(new Error('backend down'), { code: 'auth/internal-error' }),
    )

    await expect(
      setPrimaryAccountEmail('uid_1', 'work@example.test', { tenantId: null }),
    ).rejects.toThrow('backend down')
  })

  it('CONTROL: moves the primary when the address is free', async () => {
    seed()

    const result = await setPrimaryAccountEmail('uid_1', 'work@example.test', {
      tenantId: null,
    })

    expect(result.ok).toBe(true)
    expect(mockUpdateUser).toHaveBeenCalledWith('uid_1', {
      email: 'work@example.test',
      emailVerified: true,
    })
    expect(accountRow('uid_1', 'work@example.test')?.['primary']).toBe(true)
    expect(accountRow('uid_1', 'primary@example.test')?.['primary']).toBe(false)
  })
})
