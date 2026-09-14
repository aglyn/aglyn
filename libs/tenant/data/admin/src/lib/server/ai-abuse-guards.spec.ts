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
 * The request-level rungs of the Free taste (AGL-2925), on their own: the
 * address limiter has to key on the hop a caller cannot write, and the
 * account-age rung has to read the record rather than the token. Both are
 * exercised here without a Firestore or an Auth service, which is the
 * point of their signatures.
 */

import {
  accountCreationTimeMs,
  ACCOUNT_AGE_CACHE_MAX_ENTRIES,
  aiFreeMinAccountAgeHours,
  AI_IP_RATE_LIMIT,
  checkAiClientIpRateLimit,
  freeAccountAgeRefusal,
  resetAccountAgeCache,
} from './ai-abuse-guards'

const NOW = new Date('2026-09-14T12:00:00Z')
const hoursAgo = (hours: number) =>
  new Date(NOW.getTime() - hours * 60 * 60 * 1000).toUTCString()

beforeEach(() => {
  resetAccountAgeCache()
  delete process.env.AI_FREE_MIN_ACCOUNT_AGE_HOURS
  delete process.env.VERCEL
  delete process.env.AGLYN_TRUSTED_PROXY_COUNT
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the per-address window', () => {
  it('answers null with no readable address, so nothing keys on a placeholder', () => {
    expect(checkAiClientIpRateLimit({})).toBeNull()
    expect(checkAiClientIpRateLimit(new Headers())).toBeNull()
  })

  it('keys on the TRUSTED hop: an appending proxy leaves the caller’s text on the left', () => {
    // Off a platform edge the trusted hop is the rightmost one. A caller
    // who writes `x-forwarded-for: 1.2.3.4` arrives as `1.2.3.4, <real>`,
    // and the budget has to be the real address's — otherwise one header
    // change per request is one fresh budget per request.
    const ip = `198.51.100.${Math.floor(Math.random() * 200)}`
    for (let i = 0; i < AI_IP_RATE_LIMIT; i += 1) {
      const result = checkAiClientIpRateLimit({
        'x-forwarded-for': `10.0.0.${i}, ${ip}`,
      })
      expect(result?.allowed).toBe(true)
    }
    const refused = checkAiClientIpRateLimit({ 'x-forwarded-for': `10.9.9.9, ${ip}` })
    expect(refused).toMatchObject({ allowed: false, limit: AI_IP_RATE_LIMIT, remaining: 0 })
  })
})

describe('the account-age rung', () => {
  const PRO = { plan: 'pro' as const }
  const FREE = { plan: 'free' as const }

  it('defaults to a day; junk takes the default; zero is honored as off', () => {
    expect(aiFreeMinAccountAgeHours()).toBe(24)
    process.env.AI_FREE_MIN_ACCOUNT_AGE_HOURS = '6'
    expect(aiFreeMinAccountAgeHours()).toBe(6)
    process.env.AI_FREE_MIN_ACCOUNT_AGE_HOURS = '0'
    expect(aiFreeMinAccountAgeHours()).toBe(0)
    for (const junk of ['a day', '', '-4']) {
      process.env.AI_FREE_MIN_ACCOUNT_AGE_HOURS = junk
      expect(aiFreeMinAccountAgeHours()).toBe(24)
    }
  })

  it('reads the creation time off the RECORD, and caches it per instance', async () => {
    const getUser = jest.fn(async () => ({ metadata: { creationTime: hoursAgo(5) } }))
    const first = await accountCreationTimeMs('u1', getUser, NOW.getTime())
    const second = await accountCreationTimeMs('u1', getUser, NOW.getTime() + 60_000)
    expect(first).toBe(NOW.getTime() - 5 * 60 * 60 * 1000)
    expect(second).toBe(first)
    expect(getUser).toHaveBeenCalledTimes(1)
    // Past the TTL it is read again.
    await accountCreationTimeMs('u1', getUser, NOW.getTime() + 6 * 60 * 1000)
    expect(getUser).toHaveBeenCalledTimes(2)
    // A record with no usable creation time is `null`, not `NaN`.
    expect(
      await accountCreationTimeMs(
        'u2',
        async () => ({ metadata: { creationTime: null } }),
        NOW.getTime(),
      ),
    ).toBeNull()
  })

  it('forgets everything rather than growing without bound', async () => {
    const getUser = jest.fn(async () => ({ metadata: { creationTime: hoursAgo(5) } }))
    for (let i = 0; i < ACCOUNT_AGE_CACHE_MAX_ENTRIES; i += 1) {
      await accountCreationTimeMs(`u${i}`, getUser, NOW.getTime())
    }
    expect(getUser).toHaveBeenCalledTimes(ACCOUNT_AGE_CACHE_MAX_ENTRIES)
    // The entry that filled the map is still cached; the next new uid
    // drops the map, and the FIRST uid has to be read again.
    await accountCreationTimeMs('u0', getUser, NOW.getTime())
    expect(getUser).toHaveBeenCalledTimes(ACCOUNT_AGE_CACHE_MAX_ENTRIES)
    await accountCreationTimeMs('one-more', getUser, NOW.getTime())
    await accountCreationTimeMs('u0', getUser, NOW.getTime())
    expect(getUser).toHaveBeenCalledTimes(ACCOUNT_AGE_CACHE_MAX_ENTRIES + 2)
  })

  it('refuses a Free workspace’s young caller with 403, admits at the line, and never reads for paid or staff', async () => {
    const young = jest.fn(async () => ({ metadata: { creationTime: hoursAgo(1) } }))
    const refused = await freeAccountAgeRefusal({ uid: 'u1', org: FREE, staff: false, getUser: young, now: NOW })
    expect(refused?.status).toBe(403)
    await expect(refused?.json()).resolves.toMatchObject({ reason: 'account-age' })

    resetAccountAgeCache()
    const atLine = jest.fn(async () => ({ metadata: { creationTime: hoursAgo(24) } }))
    expect(
      await freeAccountAgeRefusal({ uid: 'u1', org: FREE, staff: false, getUser: atLine, now: NOW }),
    ).toBeNull()

    // Paid: not consulted. Staff: not consulted. A dead subscription IS Free.
    expect(
      await freeAccountAgeRefusal({ uid: 'u1', org: PRO, staff: false, getUser: young, now: NOW }),
    ).toBeNull()
    expect(
      await freeAccountAgeRefusal({ uid: 'u1', org: FREE, staff: true, getUser: young, now: NOW }),
    ).toBeNull()
    expect(young).toHaveBeenCalledTimes(1)
    resetAccountAgeCache()
    expect(
      (
        await freeAccountAgeRefusal({
          uid: 'u1',
          org: { plan: 'pro', subscription: { status: 'canceled' } } as never,
          staff: false,
          getUser: young,
          now: NOW,
        })
      )?.status,
    ).toBe(403)
  })

  it('a record with no creation time counts as brand new, and a failed read is a 503', async () => {
    const blank = async () => ({ metadata: {} })
    expect(
      (await freeAccountAgeRefusal({ uid: 'u1', org: FREE, staff: false, getUser: blank, now: NOW }))?.status,
    ).toBe(403)
    const broken = async () => {
      throw new Error('auth unreachable')
    }
    expect(
      (await freeAccountAgeRefusal({ uid: 'u2', org: FREE, staff: false, getUser: broken, now: NOW }))?.status,
    ).toBe(503)
  })
})
