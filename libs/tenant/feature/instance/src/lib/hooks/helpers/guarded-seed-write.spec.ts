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
   * The copy itself, pinned exactly (AGL-1446).
   *
   * Two faults, both invisible to a `stringContaining` assertion:
   *
   * 1. The subject is INTERPOLATED, and the sentences agreed a verb with it —
   *    "Your SEO settings **has** not been confirmed", "so **it** cannot be
   *    saved", "so **this** SEO settings may be out of date". Every subject
   *    below is plural on purpose; the phrasing is number-neutral now, and an
   *    exact-copy assertion is the only kind that keeps it that way.
   * 2. The unconfirmed refusal named RELOAD and nothing else, and reload is
   *    precisely the remedy that fails in the case where an author is most
   *    stuck: a tab that has gone permanently cache-only (no Firestore
   *    `Listen` channel ever established, every listener served from
   *    IndexedDB) refuses every save forever, across reloads. A new tab fixes
   *    it instantly. See the note on `refusalMessage` for why this is copy
   *    rather than a branch.
   */
  it('reads correctly for a PLURAL subject, and names BOTH remedies (AGL-1446)', () => {
    expect(
      checkSeedFreshness({ subject: 'SEO settings', fromCache: true }).message,
    ).toBe(
      'We could not confirm your SEO settings with the server, so what is on ' +
        'screen may be out of date — saving now could overwrite newer values. ' +
        'Check your connection and reload; if it is refused again, open this ' +
        'page in a new browser tab — reloading cannot restore a connection ' +
        'this tab never opened.',
    )

    expect(
      checkSeedFreshness({ subject: 'SEO settings', unreadable: true }).message,
    ).toBe(
      'Your SEO settings could not be loaded, so there is nothing safe to ' +
        'save — saving now would overwrite the stored copy with blanks. ' +
        'Reload and try again.',
    )

    setStaleSessionCheck(() => true)
    expect(checkSeedFreshness({ subject: 'SEO settings' }).message).toBe(
      'Your session went stale, so your SEO settings may be out of date — ' +
        'saving now could overwrite newer values. Sign in again and reload.',
    )
  })

  /**
   * The remedy that is missing is the one the message has to carry, because
   * the guard cannot tell the two states apart — see `refusalMessage`. A
   * later change that "tightens" this back to reload-only would restore the
   * exact defect AGL-1446 was filed for, so assert the second remedy on its
   * own rather than only inside the exact-copy pin above.
   */
  it('tells an author what to do when RELOADING does not clear it (AGL-1446)', () => {
    const { message } = checkSeedFreshness({
      subject: 'settings',
      fromCache: true,
    })
    expect(message).toEqual(expect.stringMatching(/reload/i))
    expect(message).toEqual(expect.stringMatching(/new browser tab/i))
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
