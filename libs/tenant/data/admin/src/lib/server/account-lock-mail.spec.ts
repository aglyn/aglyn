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
jest.mock('./email-suppression', () => ({
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

import { applyAccountLockToMail, liftAccountLockFromMail } from './account-lock-mail'

beforeEach(() => {
  calls.length = 0
  houseHostId = 'house-main'
  failBanFor = null
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
