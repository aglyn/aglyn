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

import {
  clampRemoteConfigDescription,
  fitsRemoteConfigDescription,
  RELEASE_FLAGS,
  releaseFlagParameterDescription,
  REMOTE_CONFIG_DESCRIPTION_MAX_BYTES,
} from './release-flags'

/**
 * The description a release flag's Remote Config parameter is published with
 * (AGL-3048).
 *
 * Remote Config refuses a whole publish over one description past its limit,
 * and the staff flags route sent the registry description as it stood — 347
 * characters for `release_edit_bar`, 1,041 for `release_assist`. Publishing
 * either from the flags page answered 500. These hold every registered flag
 * publishable and pin the rule that picks the text.
 */

const bytes = (text: string) => Buffer.byteLength(text, 'utf8')

/** A high surrogate with no low one after it, or a low one with none before. */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/** Within the limit however "characters" is counted. */
const expectPublishable = (text: string) => {
  expect(bytes(text)).toBeLessThanOrEqual(256)
  expect([...text].length).toBeLessThanOrEqual(256)
  expect(text.length).toBeLessThanOrEqual(256)
}

describe('release flag parameter descriptions (AGL-3048)', () => {
  it('holds the limit Remote Config states', () => {
    expect(REMOTE_CONFIG_DESCRIPTION_MAX_BYTES).toBe(256)
  })

  describe('every registered flag publishes', () => {
    it.each(RELEASE_FLAGS.map((flag) => [flag.key, flag] as const))(
      '%s',
      (_key, flag) => {
        for (const live of [undefined, null, '', 'The live description.']) {
          expectPublishable(
            releaseFlagParameterDescription(flag.description, live),
          )
        }
      },
    )
  })

  describe('which text is sent', () => {
    const fits = 'Bookings & scheduling for host sites.'
    const tooLong = `${'Staff-facing context. '.repeat(15)}The end.`
    const live = 'What the Firebase console already shows.'

    it('sends a registry description that fits, over any live one', () => {
      expect(releaseFlagParameterDescription(fits, live)).toBe(fits)
      expect(releaseFlagParameterDescription(fits, undefined)).toBe(fits)
    })

    it('keeps the live description when the registry one does not fit', () => {
      expect(fitsRemoteConfigDescription(tooLong)).toBe(false)
      expect(releaseFlagParameterDescription(tooLong, live)).toBe(live)
    })

    it('clamps the registry description when there is nothing live to keep', () => {
      expect(releaseFlagParameterDescription(tooLong, undefined)).toBe(
        clampRemoteConfigDescription(tooLong),
      )
      expect(releaseFlagParameterDescription(tooLong, null)).toBe(
        clampRemoteConfigDescription(tooLong),
      )
    })

    it('clamps rather than keep a live description that is blank or too long', () => {
      expect(releaseFlagParameterDescription(tooLong, '   ')).toBe(
        clampRemoteConfigDescription(tooLong),
      )
      expect(releaseFlagParameterDescription(tooLong, tooLong)).toBe(
        clampRemoteConfigDescription(tooLong),
      )
    })
  })

  describe('the clamp', () => {
    it('returns text that fits unchanged, up to exactly the limit', () => {
      const exact = 'a'.repeat(256)
      expect(clampRemoteConfigDescription(exact)).toBe(exact)
      expect(clampRemoteConfigDescription(`${exact}a`)).not.toBe(`${exact}a`)
    })

    it('cuts at a word boundary and marks the cut', () => {
      const text = 'The quick brown fox jumps over the lazy dog. '.repeat(10)
      const clamped = clampRemoteConfigDescription(text)
      expectPublishable(clamped)
      expect(clamped.endsWith('…')).toBe(true)
      const kept = clamped.slice(0, -1)
      expect(text.startsWith(kept)).toBe(true)
      // The original goes on with a space, so no word was cut in half…
      expect(text.charAt(kept.length)).toMatch(/\s/)
      // …and nothing is left dangling in front of the ellipsis.
      expect(kept).not.toMatch(/[\s.,;:(–—-]$/)
      // The fifth sentence ends at 225 characters; the sixth is cut after
      // "jumps", the last whole word the 253-byte budget holds.
      expect(kept.endsWith('The quick brown fox jumps')).toBe(true)
    })

    it('counts bytes, so typographic punctuation cannot carry text past the limit', () => {
      // 256 characters, 272 bytes: each em dash is three.
      const text = 'An em dash — costs three bytes. '.repeat(8)
      expect([...text].length).toBe(256)
      expect(bytes(text)).toBeGreaterThan(256)
      expect(fitsRemoteConfigDescription(text)).toBe(false)
      expectPublishable(clampRemoteConfigDescription(text))
    })

    it('never splits a character', () => {
      const flags = '\u{1F6A9}'.repeat(100)
      const clamped = clampRemoteConfigDescription(flags)
      expectPublishable(clamped)
      expect(LONE_SURROGATE.test(clamped)).toBe(false)
      expect([...clamped.slice(0, -1)].every((c) => c === '\u{1F6A9}')).toBe(
        true,
      )
    })

    it('cuts a single word longer than the budget hard, rather than to nothing', () => {
      expect(clampRemoteConfigDescription('x'.repeat(400))).toBe(
        `${'x'.repeat(253)}…`,
      )
    })
  })
})
