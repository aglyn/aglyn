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
 * The guard on writes seeded from an unconfirmed read (AGL-1356).
 *
 * Manage Account writes `{...fields}` with `merge: true` over a profile
 * seeded from a LISTENER. `merge` protects nothing there — every field is in
 * the payload — and the address block is replaced outright, so one save
 * rewrites everything else to whatever the seed held. Under
 * `persistentLocalCache` that seed can be arbitrarily old.
 *
 * Both guards that used to stand there were unreachable on that page:
 * `status === 'error'` never happens because a cached emission resets the
 * listener's retry budget, and `staleSession` needs two distinct labelled
 * collections denied inside 60s, which a listener-only page can never
 * produce. `fromCache` is the signal that actually fires.
 *
 * The POSITIVE control below is not a formality: this guard sits in front of
 * the ordinary save every user makes, so a false positive breaks profile
 * editing for everyone.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  checkSeedFreshness,
  writeGuardedBySeed,
} from '../utils/guarded-seed-write'
import {
  __resetSessionHealth,
  reportDeniedRead,
} from '../utils/session-health'

describe('writeGuardedBySeed (AGL-1356)', () => {
  beforeEach(() => __resetSessionHealth())
  afterEach(() => __resetSessionHealth())

  it('REFUSES the write when the seeding snapshot came from cache', async () => {
    const write = jest.fn().mockResolvedValue(undefined)

    const verdict = await writeGuardedBySeed(
      { subject: 'profile', fromCache: true },
      write,
    )

    // The whole point: the stored document was never touched.
    expect(write).not.toHaveBeenCalled()
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('unconfirmed')
  })

  /**
   * The ordinary path. A server-confirmed seed must save exactly as before —
   * no extra prompt, no refusal, no ceremony.
   */
  it('RUNS the write when the server has confirmed the seed', async () => {
    const write = jest.fn().mockResolvedValue(undefined)

    const verdict = await writeGuardedBySeed(
      { subject: 'profile', fromCache: false },
      write,
    )

    expect(write).toHaveBeenCalledTimes(1)
    expect(verdict.ok).toBe(true)
    expect(verdict.message).toBeUndefined()
  })

  it('REFUSES when the read failed outright, and says so differently', async () => {
    const write = jest.fn().mockResolvedValue(undefined)

    const verdict = await writeGuardedBySeed(
      { subject: 'profile', unreadable: true, fromCache: false },
      write,
    )

    expect(write).not.toHaveBeenCalled()
    expect(verdict.reason).toBe('unreadable')
  })

  /**
   * `staleSession` is kept as a third signal because it means something the
   * other two do not — the session is dead, not merely unconfirmed — but it
   * must never be the only one. This proves it still works where it CAN be
   * reached, without it being load-bearing where it cannot.
   */
  it('still refuses on a stale session, even with a confirmed seed', async () => {
    reportDeniedRead('orgs/members')
    reportDeniedRead('hostIndex')
    const write = jest.fn().mockResolvedValue(undefined)

    const verdict = await writeGuardedBySeed(
      { subject: 'profile', fromCache: false },
      write,
    )

    expect(write).not.toHaveBeenCalled()
    expect(verdict.reason).toBe('stale-session')
  })

  /**
   * A refusal the user cannot see is the bug this replaces wearing a
   * different hat: they retype the form and it is refused again, silently.
   */
  it('always carries a message explaining what to do', () => {
    for (const options of [
      { subject: 'profile', fromCache: true },
      { subject: 'profile', unreadable: true },
    ]) {
      const verdict = checkSeedFreshness(options)
      expect(verdict.ok).toBe(false)
      expect(verdict.message).toEqual(expect.stringContaining('profile'))
      // Every refusal names a next step rather than only a diagnosis.
      expect(verdict.message).toEqual(expect.stringMatching(/[Rr]eload/))
    }
  })

  /**
   * A refusal must not look like a successful save, and must not look like a
   * thrown error either — the caller reports `message` and leaves the typed
   * values on screen.
   */
  it('does not throw when it refuses', async () => {
    await expect(
      writeGuardedBySeed({ subject: 'profile', fromCache: true }, async () => {
        throw new Error('must not run')
      }),
    ).resolves.toMatchObject({ ok: false })
  })
})

/**
 * The wiring, which is the half that was actually broken (AGL-1356).
 *
 * A guard that behaves correctly in isolation and is not reached by the
 * write it protects is the exact fault this issue was filed for — the page
 * already had two such guards. So assert the profile write is lexically
 * INSIDE the guarded callback, and that the guard is fed the listener's own
 * `fromCache` rather than only the signals that could never fire here.
 */
describe('Manage Account is wired to the guard (AGL-1356)', () => {
  const source = readFileSync(
    join(__dirname, '..', 'app', '(app)', 'manage', 'user', 'page.tsx'),
    'utf8',
  )

  it('reads fromCache off the listener AND feeds it to the guard', () => {
    // Twice, not once: declared in the `useFirestoreDoc` destructure and
    // consumed in the guard's options. One occurrence means it is being
    // read and dropped, which is how the old guards came to be decorative.
    const occurrences = source.split('fromCache: profileFromCache').length - 1
    expect(occurrences).toBe(2)
  })

  it('puts the profile setDoc INSIDE the guarded callback', () => {
    const guardAt = source.indexOf('writeGuardedBySeed(')
    const writeAt = source.indexOf('...fields,')
    const guardEndAt = source.indexOf('if (!verdict.ok)')

    expect(guardAt).toBeGreaterThan(-1)
    expect(writeAt).toBeGreaterThan(-1)
    expect(guardEndAt).toBeGreaterThan(-1)
    // Opened before the write, and still open after it: the write cannot be
    // reached without going through the verdict.
    expect(guardAt).toBeLessThan(writeAt)
    expect(writeAt).toBeLessThan(guardEndAt)
  })

  it('reports the refusal to the user instead of failing silently', () => {
    expect(source).toEqual(
      expect.stringContaining('enqueueSnackbar(verdict.message'),
    )
  })
})
