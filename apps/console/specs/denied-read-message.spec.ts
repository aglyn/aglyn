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
 * What the denied-read log SAYS, on the evidence it actually has (AGL-1179).
 *
 * This is a test about wording, which is unusual and deliberate. The log used
 * to assert "the session is stale: signing out and back in is the first thing
 * to try" on a single collection's denial — a conclusion `session-health`
 * refuses to draw from that much evidence — and it sent two different people
 * to sign out over a URL that simply did not exist (AGL-1149).
 *
 * A wrong diagnosis stated confidently costs more than no diagnosis, so the
 * threshold at which this log is allowed to blame the session is worth pinning
 * exactly as much as the threshold the prompt uses.
 */

import { __resetSessionHealth } from '../utils/session-health'
import { firestoreOneShotRetry } from '../utils/firestore-one-shot-retry'

const denied = () => Object.assign(new Error('nope'), { code: 'permission-denied' })

/** Drive the helper to exhaustion and hand back what it logged. */
async function denyUntilExhausted(collection: string): Promise<string> {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    await expect(
      firestoreOneShotRetry(() => Promise.reject(denied()), collection),
    ).rejects.toBeTruthy()
    return spy.mock.calls.map((call) => String(call[0])).join('\n')
  } finally {
    spy.mockRestore()
  }
}

describe('the denied-read log (AGL-1179)', () => {
  beforeEach(() => {
    __resetSessionHealth()
    jest.useFakeTimers({ doNotFake: ['performance'] })
  })
  afterEach(() => jest.useRealTimers())

  // The helper sleeps between retries; run timers as they are scheduled.
  const flush = async (promise: Promise<string>) => {
    const settled = promise
    for (let i = 0; i < 12; i += 1) {
      await Promise.resolve()
      jest.advanceTimersByTime(500)
    }
    return settled
  }

  it('does NOT blame the session on a single collection', async () => {
    const logged = await flush(denyUntilExhausted('orgs/members'))

    expect(logged).toContain('orgs/members')
    // The specific sentence that caused the misdiagnosis.
    expect(logged).not.toMatch(/signing out and back in is the first thing/i)
    expect(logged).toMatch(/NOT the signature of a bad session/i)
  })

  it('names the missing-document cause, which is the one people miss', async () => {
    const logged = await flush(denyUntilExhausted('orgs/members'))

    // `permission-denied` is a surprising answer to "does this exist", and it
    // is what AGL-1149 tripped over twice.
    expect(logged).toMatch(/document does not exist/i)
    expect(logged).toMatch(/orgSlugs/)
  })

  it('DOES blame the session once denials span two collections', async () => {
    await flush(denyUntilExhausted('orgs/members'))
    const logged = await flush(denyUntilExhausted('hostIndex'))

    // A dead session denies everything — at the threshold, the AGL-1062
    // advice is correct and must survive.
    expect(logged).toMatch(/signing out and back in is the first thing/i)
    expect(logged).toMatch(/2 distinct collections/i)
  })

  it('counts distinct collections, not repeated denials of one', async () => {
    await flush(denyUntilExhausted('orgs/members'))
    const logged = await flush(denyUntilExhausted('orgs/members'))

    // Same key twice is still one collection, so the verdict must not flip.
    expect(logged).not.toMatch(/signing out and back in is the first thing/i)
    expect(logged).toMatch(/1 distinct collection\b/i)
  })
})
