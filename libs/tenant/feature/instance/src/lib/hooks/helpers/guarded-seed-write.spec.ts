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
 * The guard on writes seeded from an unconfirmed read (AGL-1356, AGL-1358).
 *
 * A form seeded from a Firestore LISTENER, saved with a whole-object payload:
 * `merge: true` protects nothing, because every field is in the payload. Under
 * `persistentLocalCache` the seed can be arbitrarily old, so one edit rewrites
 * every other field to whatever the cache last held.
 *
 * `status` cannot catch it — a cached emission resets the hook's retry budget,
 * so a refused listen never reaches `'error'`. `staleSession` cannot either on
 * a listener-only page, which needs two labelled one-shot denials it never
 * issues. `fromCache` is the signal that actually fires.
 *
 * The POSITIVE control below is not a formality: this guard sits in front of
 * the ordinary save every user makes, so a false positive breaks the feature
 * for everyone.
 */

import {
  checkSeedFreshness,
  setStaleSessionCheck,
  writeGuardedBySeed,
} from './guarded-seed-write'

describe('writeGuardedBySeed (AGL-1356)', () => {
  afterEach(() => setStaleSessionCheck(null))

  it('REFUSES the write when the seeding snapshot came from cache', async () => {
    const write = jest.fn().mockResolvedValue(undefined)

    const verdict = await writeGuardedBySeed(
      { subject: 'settings', fromCache: true },
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
      { subject: 'settings', fromCache: false },
      write,
    )

    expect(write).toHaveBeenCalledTimes(1)
    expect(verdict.ok).toBe(true)
    expect(verdict.message).toBeUndefined()
  })

  it('REFUSES when the read failed outright, and says so differently', async () => {
    const write = jest.fn().mockResolvedValue(undefined)

    const verdict = await writeGuardedBySeed(
      { subject: 'settings', unreadable: true, fromCache: false },
      write,
    )

    expect(write).not.toHaveBeenCalled()
    expect(verdict.reason).toBe('unreadable')
  })

  /**
   * The ordering, and why it is this way round (AGL-1066).
   *
   * Once a refused listen can reach `status: 'error'`, BOTH flags are true at
   * once on the common path — the cache is serving the document and the
   * server has stopped answering for it. Taking `unreadable` there tells the
   * user their settings "could not be loaded" and that saving "would
   * overwrite it with blanks", while a populated, plausible form sits in
   * front of them. The refusal is right either way; a refusal whose stated
   * reason is visibly false is one the user works around.
   */
  it('explains a cache-served read as unconfirmed even when it ALSO errored', async () => {
    const write = jest.fn().mockResolvedValue(undefined)

    const verdict = await writeGuardedBySeed(
      { subject: 'settings', unreadable: true, fromCache: true },
      write,
    )

    expect(write).not.toHaveBeenCalled()
    expect(verdict.reason).toBe('unconfirmed')
    // Specifically NOT the blanks explanation, which is the one that is false
    // when there is cached content on screen.
    expect(verdict.message).not.toEqual(expect.stringMatching(/blanks/i))
    expect(verdict.message).toEqual(expect.stringMatching(/out of date/i))
  })

  /**
   * A refusal the user cannot see is the bug this replaces wearing a
   * different hat: they retype the form and it is refused again, silently.
   */
  it('always carries a message explaining what to do', () => {
    for (const options of [
      { subject: 'supplier', fromCache: true },
      { subject: 'supplier', unreadable: true },
    ]) {
      const verdict = checkSeedFreshness(options)
      expect(verdict.ok).toBe(false)
      expect(verdict.message).toEqual(expect.stringContaining('supplier'))
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
      writeGuardedBySeed({ subject: 'settings', fromCache: true }, async () => {
        throw new Error('must not run')
      }),
    ).resolves.toMatchObject({ ok: false })
  })
})

/**
 * The injected third signal (AGL-1358).
 *
 * `session-health` is console state and this library must not import the app,
 * so the console registers its verdict here. What matters is that the seam is
 * a real signal and not decoration: registered and stale must refuse,
 * registered and healthy must save, and UNregistered must save — because the
 * tenant runtime and every unit test run with nothing registered, and a guard
 * that refused by default would break them all.
 */
describe('the injected stale-session check (AGL-1358)', () => {
  afterEach(() => setStaleSessionCheck(null))

  it('refuses on a stale session, even with a confirmed seed', async () => {
    setStaleSessionCheck(() => true)
    const write = jest.fn().mockResolvedValue(undefined)

    const verdict = await writeGuardedBySeed(
      { subject: 'settings', fromCache: false },
      write,
    )

    expect(write).not.toHaveBeenCalled()
    expect(verdict.reason).toBe('stale-session')
  })

  it('saves when the registered check says the session is healthy', async () => {
    setStaleSessionCheck(() => false)
    const write = jest.fn().mockResolvedValue(undefined)

    expect(
      (await writeGuardedBySeed({ subject: 'settings' }, write)).ok,
    ).toBe(true)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('saves when NOTHING is registered', async () => {
    setStaleSessionCheck(null)
    const write = jest.fn().mockResolvedValue(undefined)

    expect(
      (await writeGuardedBySeed({ subject: 'settings' }, write)).ok,
    ).toBe(true)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('honours checkSession: false for a surface that writes anyway', async () => {
    setStaleSessionCheck(() => true)
    const write = jest.fn().mockResolvedValue(undefined)

    expect(
      (
        await writeGuardedBySeed(
          { subject: 'settings', checkSession: false },
          write,
        )
      ).ok,
    ).toBe(true)
    // …but the signals that are facts about THIS read still bite.
    expect(
      checkSeedFreshness({
        subject: 'settings',
        checkSession: false,
        fromCache: true,
      }).reason,
    ).toBe('unconfirmed')
  })
})
