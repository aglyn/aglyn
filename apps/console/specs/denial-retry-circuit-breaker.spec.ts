/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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

import firestoreOneShotRetry from '../utils/firestore-one-shot-retry'
import {
  __resetSessionHealth,
  getSessionHealth,
  reportDeniedRead,
} from '../utils/session-health'

const denied = () =>
  Object.assign(new Error('denied'), { code: 'permission-denied' })

/**
 * AGL-1440: a dead session denies every collection, and every caller used to
 * retry six times anyway — so the cost of a dead session was SIX wasted reads
 * per attempted read, not one. Measured 2026-08-26: 49,842 denied aggregation
 * queries in a day, 42,148 of them inside a single hour.
 *
 * The breaker spends the evidence `session-health` already gathers, so these
 * assert the two halves that matter: it must not fire before the verdict
 * stands (or it breaks the post-sign-in race the retry exists for), and it
 * must fire once it does.
 */
describe('one-shot retry circuit breaker (AGL-1440)', () => {
  beforeEach(() => {
    __resetSessionHealth()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it('still spends the full backoff while no verdict stands', async () => {
    // The race this retry exists for: `useUser()` reports a signed-in user a
    // beat before Firestore has attached the ID token. Breaking early here
    // would reintroduce AGL-216.
    let attempts = 0
    const run = jest.fn(async () => {
      attempts += 1
      if (attempts < 3) throw denied()
      return 'ok'
    })
    await expect(firestoreOneShotRetry(run, 'users')).resolves.toBe('ok')
    expect(attempts).toBe(3)
  })

  it('spends ONE attempt once the session is already known dead', async () => {
    // Two distinct collections denied inside the window is the verdict the
    // user-facing prompt already trusts.
    reportDeniedRead('users')
    reportDeniedRead('hosts')
    expect(getSessionHealth().staleSession).toBe(true)

    let attempts = 0
    const run = jest.fn(async () => {
      attempts += 1
      throw denied()
    })
    await expect(firestoreOneShotRetry(run, 'layouts')).rejects.toThrow()
    // Six before the breaker; one after. This is the 6x the burst was made of.
    expect(attempts).toBe(1)
  })

  it('records the collection it refused to retry', async () => {
    reportDeniedRead('users')
    reportDeniedRead('hosts')
    await expect(
      firestoreOneShotRetry(async () => {
        throw denied()
      }, 'hosts/DXnRbPH4CQ/layouts'),
    ).rejects.toThrow()
    // Otherwise the banner under-reports exactly the reads the breaker stopped.
    expect(getSessionHealth().deniedCollections).toContain(
      'hosts/DXnRbPH4CQ/layouts',
    )
  })

  it('re-arms the backoff after one read gets through', async () => {
    reportDeniedRead('users')
    reportDeniedRead('hosts')
    // A successful read clears the evidence, so the next denial is treated as
    // a fresh race rather than a continuation of a session already given up on.
    await firestoreOneShotRetry(async () => 'ok', 'users')
    expect(getSessionHealth().staleSession).toBe(false)

    let attempts = 0
    await expect(
      firestoreOneShotRetry(async () => {
        attempts += 1
        throw denied()
      }, 'users'),
    ).rejects.toThrow()
    expect(attempts).toBeGreaterThan(1)
    // Explicit: this one deliberately spends the whole backoff
    // (MAX_RETRIES x RETRY_DELAY_MS), which sits close enough to jest's 5s
    // default to flake under parallel load.
  }, 15_000)
})
