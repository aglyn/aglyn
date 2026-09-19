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
  compileLinearPattern,
  compileLinearTest,
  explainLinearPattern,
  explainLinearTest,
} from './linear-regex'

/**
 * `compileLinearTest` answers what a fresh `RegExp`'s `test` answers, flags
 * included, in time linear in the input (AGL-2893).
 *
 * Asserted against `RegExp` itself, never against a hand-written expectation:
 * a fixed corpus for the cases worth naming, then a seeded random walk over
 * patterns, inputs and flags, which is how the case-folding and multiline
 * cases below were found in the first place.
 */

const chars = (...codes: number[]) => String.fromCharCode(...codes)

/** Characters whose case folding `RegExp` treats specially without `u`. */
const SHARP_S = chars(0xdf)
const MICRO = chars(0xb5)
const CAPITAL_MU = chars(0x39c)
const SMALL_MU = chars(0x3bc)
const CAPITAL_SIGMA = chars(0x3a3)
const SMALL_SIGMA = chars(0x3c3)
const FINAL_SIGMA = chars(0x3c2)
const LONG_S = chars(0x17f)
const KELVIN = chars(0x212a)
const DOTLESS_I = chars(0x131)
const DOTTED_CAPITAL_I = chars(0x130)
const LINE_SEPARATOR = chars(0x2028)

const native = (pattern: string, flags: string, input: string) =>
  new RegExp(pattern, flags).test(input)

describe('compileLinearTest answers as RegExp does (AGL-2893)', () => {
  const CORPUS: Array<[string, string, string[]]> = [
    ['^build', 'i', ['Build once', 'rebuild', 'BUILD']],
    ['ONCE$', 'i', ['Build once', 'once more']],
    ['^b.*e$', 'i', ['Build once', 'Build once\n']],
    ['^once$', 'm', ['Build\nonce', 'Build\r\nonce\r\n', `a${LINE_SEPARATOR}once`]],
    ['d.o', '', ['Build once', 'Build\nonce']],
    ['d.o', 's', ['Build\nonce', `d${LINE_SEPARATOR}o`]],
    ['uild', 'y', ['Build', 'uild']],
    ['uild', 'gd', ['Build']],
    ['(^a)?$', '', ['xy', 'a', '']],
    ['$', '', ['anything']],
    ['^a|$', '', ['xy']],
    ['k', 'i', ['K', KELVIN]],
    [KELVIN, 'i', ['k', 'K', KELVIN]],
    [SMALL_SIGMA, 'i', [CAPITAL_SIGMA, FINAL_SIGMA, 's']],
    [`[${FINAL_SIGMA}]`, 'i', [SMALL_SIGMA, CAPITAL_SIGMA]],
    [MICRO, 'i', [CAPITAL_MU, SMALL_MU]],
    [`[${SMALL_MU}]`, 'i', [MICRO]],
    ['s', 'i', [LONG_S, 'S']],
    [LONG_S, 'i', ['s', 'S']],
    ['i', 'i', [DOTLESS_I, DOTTED_CAPITAL_I, 'I']],
    [SHARP_S, 'i', ['SS', SHARP_S]],
    ['[a-z]+', 'i', ['ABC', '123']],
    ['[^a]', 'i', ['A', 'b']],
    ['^[A-Z][a-z]+$', 'im', ['x\nHello', 'hello']],
    ['\\w+@\\w+\\.com', 'i', ['Mail ME@EXAMPLE.COM']],
    ['\\bonce\\b', '', ['Build once', 'Build onces', 'once']],
    ['\\Bild', 'i', ['BUILD', 'ild']],
    ['^\\b', 'm', ['\n', ' x', 'x']],
    [`\\b${SHARP_S}`, 'i', [SHARP_S, `a${SHARP_S}`]],
  ]

  it.each(CORPUS)('%s /%s', (pattern, flags, inputs) => {
    const compiled = compileLinearTest(pattern, flags)
    expect(compiled).not.toBeNull()
    for (const input of inputs) {
      expect([input, compiled?.test(input)]).toEqual([
        input,
        native(pattern, flags, input),
      ])
    }
  })

  it('agrees with RegExp across a seeded walk of patterns, inputs and flags', () => {
    // mulberry32: deterministic, so a failure reproduces from the seed.
    let seed = 0x2893
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]
    const ATOMS = [
      'a', 'b', 'A', '.', '\\w', '\\d', '\\s', '[ab]', '[^a]', '[A-Z]', 'x',
      '\\n', ' ', SHARP_S, MICRO, SMALL_SIGMA, FINAL_SIGMA, LONG_S, KELVIN,
      DOTLESS_I, '\\b', '\\B',
    ]
    const QUANTIFIERS = ['', '', '', '*', '+', '?', '{2}', '{1,3}', '*?', '+?']
    const pattern = (depth = 0): string => {
      let source = ''
      for (let count = 1 + Math.floor(random() * 4); count > 0; count--) {
        const roll = random()
        if (roll < 0.6 || depth > 2) source += pick(ATOMS)
        else if (roll < 0.8) source += `(${pattern(depth + 1)})`
        else source += `(?:${pattern(depth + 1)}|${pattern(depth + 1)})`
        source += pick(QUANTIFIERS)
      }
      if (random() < 0.25) source = `^${source}`
      if (random() < 0.25) source = `${source}$`
      return source
    }
    const INPUT_CHARS = [
      'a', 'b', 'A', 'B', 'x', '\n', ' ', '1', 'S', 's', 'K', 'k', 'I', 'i',
      SHARP_S, MICRO, CAPITAL_MU, SMALL_MU, CAPITAL_SIGMA, SMALL_SIGMA,
      FINAL_SIGMA, LONG_S, KELVIN, DOTLESS_I, DOTTED_CAPITAL_I, '\r',
      LINE_SEPARATOR,
    ]
    const input = () => {
      let text = ''
      for (let count = Math.floor(random() * 12); count > 0; count--) {
        text += pick(INPUT_CHARS)
      }
      return text
    }
    const FLAGS = ['', 'i', 'm', 's', 'y', 'g', 'im', 'is', 'ms', 'iy', 'imsy']

    const mismatches: string[] = []
    let compared = 0
    for (let round = 0; round < 3000; round++) {
      const source = pattern()
      const flags = pick(FLAGS)
      try {
        new RegExp(source, flags)
      } catch {
        continue
      }
      const compiled = compileLinearTest(source, flags)
      if (!compiled) continue
      for (let sample = 0; sample < 4; sample++) {
        const text = input()
        compared++
        if (compiled.test(text) !== native(source, flags, text)) {
          mismatches.push(`/${source}/${flags} on ${JSON.stringify(text)}`)
        }
      }
    }
    expect(compared).toBeGreaterThan(5000)
    expect(mismatches).toEqual([])
  })

  it.each([
    ['u', 'the u flag is not supported'],
    ['v', 'the v flag is not supported'],
    ['gg', 'the g flag is repeated'],
    ['x', '"x" is not a pattern flag'],
  ])('refuses the flags %j', (flags, reason) => {
    expect(compileLinearTest('a', flags)).toBeNull()
    expect(explainLinearTest('a', flags)).toBe(reason)
  })

  it.each(['^(a+)+$', '^(a|a)*$', '^a*a*a*a*a*a*a*a*$', '(x+x+)+y'])(
    'answers %s in time linear in the input',
    (pattern) => {
      const compiled = compileLinearTest(pattern, 'i')
      const started = Date.now()
      expect(compiled?.test(`${'a'.repeat(10_000)}!`)).toBe(false)
      // Seconds for a backtracker at 30 characters; milliseconds here at
      // ten thousand. Generous for a loaded CI box.
      expect(Date.now() - started).toBeLessThan(1000)
    },
  )
})

describe('compileLinearPattern keeps the answer redirect rules have always had', () => {
  it('stops at the first offset nothing can start from', () => {
    // `RegExp` matches an empty alternative at the end of any path, so a rule
    // written `/old|` would redirect every page; redirects never have, and a
    // live rule must not start to.
    expect(native('^/old|$', '', '/other')).toBe(true)
    expect(compileLinearPattern('^/old|$')?.exec('/other')).toBeNull()
    expect(compileLinearTest('^/old|$')?.test('/other')).toBe(true)
  })

  it('takes no flags', () => {
    expect(compileLinearPattern('^/Old$')?.exec('/old')).toBeNull()
  })

  it('still refuses a word boundary, which only the test dialect reads', () => {
    expect(compileLinearPattern('^/\\bold$')).toBeNull()
    expect(explainLinearPattern('^/\\bold$')).toBe('word boundaries are not supported')
    expect(compileLinearTest('^/\\bold$')?.test('/old')).toBe(true)
  })
})
