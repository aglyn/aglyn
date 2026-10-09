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
 *
/**
 * @jest-environment node
 */

/**
 * AN ACCOUNT LOCK, WRITTEN ONTO THE LISTS BY EVERY ADDRESS (AGL-3420): every
 * house site for a lock, the platform list too for a ban, and a lift that
 * takes off exactly those.
 */

const calls: string[] = []
let houseHostId: string | null = 'house-main'
let failBanFor: string | null = null
let bannedAddress: string | null = null

jest.mock('./account-addresses', () => ({
  resolveAccountAddresses: async () => ({
    uid: 'u1',
    primary: 'a@x.example',
    addresses: [{ address: 'a@x.example' }, { address: 'b@y.example' }],
    incomplete: false,
  }),
}))
jest.mock('./platform-marketing-consent', () => ({
  platformMarketingHostId: () => houseHostId,
}))
jest.mock('./organizations', () => ({
  getOrgForHost: async () => ({ orgId: 'house', org: { hosts: { 'house-main': true, 'house-docs': true, retired: false } } }),
}))
jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => { throw new Error('use the injected store') } }) },
}))
jest.mock('./email-suppression', () => ({
  emailSuppressionKey: (email: string) => (email.includes('@') ? `key:${email.toLowerCase()}` : null),
  HOST_ACCOUNT_LOCK_SUPPRESSION_REASON: 'account_lock',
  HOST_SUPPRESSIONS_SUBCOLLECTION: 'suppressions',
  isAccountBanSuppression: async (email: string) => email === bannedAddress,
  suppressEmail: async (input: { email: string; reason: string; subjectUid: string }) => {
    if (input.email === failBanFor) throw new Error('write failed')
    calls.push(`ban ${input.email} ${input.reason} ${input.subjectUid}`)
    return { key: 'k', created: true }
  },
  suppressEmailForAccountLock: async (input: { hostId: string; email: string }) => {
    calls.push(`lock ${input.hostId} ${input.email}`)
    return true
  },
  releaseAccountBanSuppressions: async (input: { uid: string }) => {
    calls.push(`unban ${input.uid}`)
    return 2
  },
  releaseAccountLockSuppression: async (input: { hostId: string; email: string }) => {
    calls.push(`unlock ${input.hostId} ${input.email}`)
    return true
  },
}))

import { accountLockStateFor, applyAccountLockToMail, liftAccountLockFromMail } from './account-lock-mail'

beforeEach(() => {
  calls.length = 0
  houseHostId = 'house-main'
  failBanFor = null
  bannedAddress = null
})

it('a lock suppresses every address on every live house site, and files no ban', async () => {
  const report = await applyAccountLockToMail({ uid: 'u1', record: null, ban: false })
  expect(calls.sort()).toEqual([
    'lock house-docs a@x.example',
    'lock house-docs b@y.example',
    'lock house-main a@x.example',
    'lock house-main b@y.example',
  ])
  expect(report).toMatchObject({ addresses: 2, banRows: 0, houseSites: 2, houseRows: 4, failed: 0 })
})

it('a ban also files every address on the platform list, for this account', async () => {
  const report = await applyAccountLockToMail({ uid: 'u1', record: null, ban: true })
  expect(calls.filter((call) => call.startsWith('ban '))).toEqual([
    'ban a@x.example account_ban u1',
    'ban b@y.example account_ban u1',
  ])
  expect(report).toMatchObject({ banRows: 2, houseRows: 4 })
})

it('reports a failed write and carries on with the rest', async () => {
  failBanFor = 'a@x.example'
  const report = await applyAccountLockToMail({ uid: 'u1', record: null, ban: true })
  expect(report).toMatchObject({ banRows: 1, failed: 1, houseRows: 4 })
})

it('a lift releases the account’s ban rows and its house rows', async () => {
  const report = await liftAccountLockFromMail({ uid: 'u1', record: null, releasedByUid: 'staff' })
  expect(calls[0]).toBe('unban u1')
  expect(report).toMatchObject({ banRows: 2, houseRows: 4 })
})

it('an install with no house site still files a ban, and nothing per site', async () => {
  houseHostId = null
  const report = await applyAccountLockToMail({ uid: 'u1', record: null, ban: true })
  expect(report).toMatchObject({ houseSites: 0, houseRows: 0, banRows: 2 })
})

describe('the lock state a house record page shows (AGL-3686)', () => {
  /** A store holding one site row: `hosts/{hostId}/suppressions/{key}`. */
  const storeWith = (rows: Record<string, Record<string, unknown>>) => ({
    collection: () => ({
      doc: (hostId: string) => ({
        collection: () => ({
          doc: (key: string) => ({
            get: async () => {
              const data = rows[`${hostId}/${key}`]
              return { exists: Boolean(data), get: (field: string) => data?.[field] }
            },
          }),
        }),
      }),
    }),
  })

  it('is banned while a live ban row holds the address, whatever the site row says', async () => {
    bannedAddress = 'a@x.example'
    const firestore = storeWith({ 'house-main/key:a@x.example': { reason: 'unsubscribe' } })
    expect(await accountLockStateFor({ hostId: 'house-main', email: 'a@x.example', firestore })).toBe('banned')
  })

  it('is locked on the lock’s own site row, and nothing on any other', async () => {
    const firestore = storeWith({
      'house-docs/key:a@x.example': { reason: 'account_lock' },
      'house-main/key:b@y.example': { reason: 'unsubscribe' },
    })
    expect(await accountLockStateFor({ hostId: 'house-docs', email: 'a@x.example', firestore })).toBe('locked')
    expect(await accountLockStateFor({ hostId: 'house-main', email: 'b@y.example', firestore })).toBeNull()
    expect(await accountLockStateFor({ hostId: 'house-main', email: 'c@z.example', firestore })).toBeNull()
  })

  it('tells no other workspace, banned or not', async () => {
    bannedAddress = 'a@x.example'
    const firestore = storeWith({ 'shop/key:a@x.example': { reason: 'account_lock' } })
    expect(await accountLockStateFor({ hostId: 'shop', email: 'a@x.example', firestore })).toBeNull()
    expect(await accountLockStateFor({ hostId: 'retired', email: 'a@x.example', firestore })).toBeNull()
  })

  it('says nothing when the read fails', async () => {
    const firestore = { collection: () => { throw new Error('down') } }
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await accountLockStateFor({ hostId: 'house-main', email: 'a@x.example', firestore })).toBeNull()
  })
})
