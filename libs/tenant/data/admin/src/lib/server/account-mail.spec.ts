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
 * WHICH ACCOUNTS AUTOMATED PLATFORM MAIL SKIPS (AGL-3418): an active user
 * lock or a disabled Auth record — and nothing else, including an outage.
 */

const locks = new Map<string, { untilMs?: number } | null>()
const disabled = new Set<string>()
let lookupFails = false
const lookups: string[] = []

jest.mock('./lockdown', () => ({
  getUserLockdown: async (uid: string) => locks.get(uid) ?? null,
}))
jest.mock('./auth-pools', () => ({
  findUserByUidAcrossPools: async (uid: string) => {
    lookups.push(uid)
    if (lookupFails) throw new Error('auth unreachable')
    return { record: { uid, disabled: disabled.has(uid) }, tenantId: null }
  },
}))

import { isAccountMailWithheld, withoutMailWithheldAccounts } from './account-mail'

beforeEach(() => {
  locks.clear()
  disabled.clear()
  lookups.length = 0
  lookupFails = false
})

describe('isAccountMailWithheld', () => {
  it('withholds from an actively locked account', async () => {
    locks.set('u', {})
    await expect(isAccountMailWithheld('u')).resolves.toBe(true)
  })

  it('mails an account whose lock has expired', async () => {
    locks.set('u', { untilMs: Date.now() - 1000 })
    await expect(isAccountMailWithheld('u')).resolves.toBe(false)
  })

  it('withholds from a disabled Auth record', async () => {
    disabled.add('u')
    await expect(isAccountMailWithheld('u')).resolves.toBe(true)
  })

  it('takes a known disabled flag without looking the account up', async () => {
    await expect(isAccountMailWithheld('u', { authDisabled: false })).resolves.toBe(false)
    await expect(isAccountMailWithheld('u', { authDisabled: true })).resolves.toBe(true)
    expect(lookups).toEqual([])
  })

  it('reads a failed lookup as not disabled — an outage does not silence mail', async () => {
    lookupFails = true
    await expect(isAccountMailWithheld('u')).resolves.toBe(false)
  })

  it('withholds nothing for a missing uid', async () => {
    await expect(isAccountMailWithheld(null)).resolves.toBe(false)
    await expect(isAccountMailWithheld('')).resolves.toBe(false)
  })
})

describe('withoutMailWithheldAccounts', () => {
  it('drops locked and disabled accounts, keeping the order of the rest', async () => {
    locks.set('b', {})
    disabled.add('d')
    await expect(withoutMailWithheldAccounts(['a', 'b', 'c', 'd'])).resolves.toEqual(['a', 'c'])
  })
})
