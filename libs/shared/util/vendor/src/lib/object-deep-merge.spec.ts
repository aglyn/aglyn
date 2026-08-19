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
 * Pins `deepmerge-ts`'s contract at the boundary that owns it (AGL-2301).
 *
 * Dependabot #854 took this library across a MAJOR — 7.1.5 to 8.0.0 — as the
 * fix for GHSA-ggr8-5vv4-36mx, and merged with `package.json` and
 * `package-lock.json` as its only changed files. Nothing in THIS library
 * exercised it. The one thing that did was
 * `libs/shared/ui/theme/.../host-theme.spec.ts`, three libraries away, which
 * reaches `objectDeepMergeReplaceArrays` incidentally through
 * `mergeThemeOptions` — so rewriting a theme spec could silently un-verify a
 * vendored merge library, and a bump could land with no signal at all.
 *
 * These assertions are about the VENDOR contract, deliberately duplicating
 * what host-theme happens to cover. The consumer's coverage is not this
 * module's coverage.
 */

import {
  objectDeepMerge,
  objectDeepMergeReplaceArrays,
} from './object-deep-merge'

describe('objectDeepMerge', () => {
  it('merges nested records without dropping either side', () => {
    expect(
      objectDeepMerge({ a: { x: 1 }, b: 2 }, { a: { y: 3 } }),
    ).toEqual({ a: { x: 1, y: 3 }, b: 2 })
  })

  it('CONCATENATES arrays — the accumulating-list contract', () => {
    // The counterpart to the replace behaviour below. If deepmerge-ts ever
    // flips its default, callers collecting lists silently start losing
    // entries, and only this assertion says so.
    expect(
      objectDeepMerge({ variants: ['a', 'b'] }, { variants: ['z'] }),
    ).toEqual({ variants: ['a', 'b', 'z'] })
  })
})

describe('objectDeepMergeReplaceArrays', () => {
  it('REPLACES arrays — the config-override contract', () => {
    // Nobody overriding a setting means "append to the one I'm replacing".
    // This is the behaviour host-theme's component/typography merge depends
    // on, and the one `mergeArrays: false` buys.
    expect(
      objectDeepMergeReplaceArrays(
        { variants: ['a', 'b'] },
        { variants: ['z'] },
      ),
    ).toEqual({ variants: ['z'] })
  })

  it('still deep-merges records, so an override keeps its siblings', () => {
    expect(
      objectDeepMergeReplaceArrays(
        { MuiButton: { defaultProps: { color: 'primary' }, styleOverrides: {} } },
        { MuiButton: { defaultProps: { size: 'small' } } },
      ),
    ).toEqual({
      MuiButton: {
        defaultProps: { color: 'primary', size: 'small' },
        styleOverrides: {},
      },
    })
  })

  it('replaces non-plain values wholesale rather than merging into them', () => {
    // Theme `styleOverrides` are frequently FUNCTIONS of the theme, which JSON
    // cannot express. Merging INTO one would produce an object that is no
    // longer callable; the later operand has to win outright.
    const base = () => ({ color: 'red' })
    const override = () => ({ color: 'blue' })
    const merged = objectDeepMergeReplaceArrays(
      { root: base },
      { root: override },
    ) as { root: () => unknown }
    expect(merged.root).toBe(override)
  })

  it('keeps a base value the override does not mention', () => {
    const styleFn = () => ({ color: 'red' })
    const merged = objectDeepMergeReplaceArrays(
      { MuiButton: { styleOverrides: { root: styleFn } } },
      { MuiButton: { defaultProps: { disableElevation: true } } },
    ) as { MuiButton: { styleOverrides: { root: unknown } } }
    expect(merged.MuiButton.styleOverrides.root).toBe(styleFn)
  })
})

/**
 * The behaviours above are the ones a bump would obviously change. These are
 * the ones a caller gets WRONG (AGL-1866), which is a different list and a
 * more expensive one — a merge that quietly disagrees with what the person
 * writing the override assumed does not throw, it just renders the wrong
 * theme on somebody's published site.
 *
 * Everything here was measured against the library rather than assumed, and
 * three of the five results are not what a reader would guess.
 */
describe('objectDeepMergeReplaceArrays: what a caller has to know', () => {
  it('replaces an array nested deep in the graph, not only at the top', () => {
    // The top-level case is pinned above. This is the one that actually
    // occurs: theme arrays live under `components.MuiX.variants`, never at
    // the root, and a merge that replaced only at depth 0 would pass the
    // assertion above and still concatenate every real override.
    expect(
      objectDeepMergeReplaceArrays(
        { components: { MuiChip: { variants: ['a', 'b'] } } },
        { components: { MuiChip: { variants: ['z'] } } },
      ),
    ).toEqual({ components: { MuiChip: { variants: ['z'] } } })
  })

  it('replaces an array of objects wholesale, not element by element', () => {
    // Index-wise merging would produce `[{props, style}]` hybrids that match
    // neither variant. The whole list is one setting.
    expect(
      objectDeepMergeReplaceArrays(
        { variants: [{ props: { size: 'small' } }, { props: { size: 'big' } }] },
        { variants: [{ style: { color: 'red' } }] },
      ),
    ).toEqual({ variants: [{ style: { color: 'red' } }] })
  })

  it('does NOT read an `undefined` override as a clear — the base survives', () => {
    // Measured, and the opposite of the natural guess. `{ mode: undefined }`
    // does not reset a palette mode; it is skipped entirely and the base
    // value stands. A caller meaning "unset this" has to omit the key from
    // the base, not write `undefined` over it.
    //
    // Asserted on `Object.keys` AND the value on purpose: `toEqual` treats an
    // undefined-valued property as absent, so `toEqual({ a: 1, b: 2 })` alone
    // would pass just as happily against an implementation that produced
    // `{ a: 1, b: undefined }` — which is the exact opposite behaviour.
    const merged = objectDeepMergeReplaceArrays({ a: 1, b: 2 }, { b: undefined })
    expect(Object.keys(merged)).toEqual(['a', 'b'])
    expect(merged.b).toBe(2)
  })

  it('DOES read `null` as a value, so it overrides a whole subtree', () => {
    // The asymmetry with `undefined` above is the trap. These two look
    // interchangeable at a call site and behave oppositely: `null` wins and
    // takes a populated nested object with it.
    const merged = objectDeepMergeReplaceArrays(
      { a: 1, b: { deep: 1 } },
      { b: null },
    )
    expect(Object.keys(merged)).toEqual(['a', 'b'])
    expect(merged.b).toBeNull()
  })

  it('updates a key in place rather than moving it to the end', () => {
    // Load-bearing, because the merged objects are CSS. Style objects are
    // emitted in key order, so shorthand-before-longhand is a cascade the
    // base author relied on: if overriding `background` moved it after
    // `backgroundColor`, the override would win the property and lose the
    // cascade. An implementation that deletes-then-sets does exactly that.
    const merged = objectDeepMergeReplaceArrays(
      { background: 'red', backgroundColor: 'white' },
      { color: 'blue', background: 'green' },
    )
    expect(Object.keys(merged)).toEqual([
      'background',
      'backgroundColor',
      'color',
    ])
    expect(merged.background).toBe('green')
  })

  it('mutates neither operand', () => {
    // `mergeThemeOptions` merges the platform's default theme options into a
    // host's. If the merge wrote through to the first operand, the DEFAULTS
    // would accumulate one tenant's overrides and serve them to the next —
    // a cross-tenant leak that no assertion about the return value can see.
    const base = { a: { x: 1 }, list: [1, 2] }
    const override = { a: { y: 2 }, list: [9] }

    objectDeepMergeReplaceArrays(base, override)

    expect(base).toEqual({ a: { x: 1 }, list: [1, 2] })
    expect(override).toEqual({ a: { y: 2 }, list: [9] })
  })

  it('does not clone the winning array — the result ALIASES it', () => {
    // Documented, not desired. Nested records are rebuilt, so `merged.a` is a
    // fresh object; the winning array is handed straight through. Mutating
    // `merged.list` therefore reaches back into the operand. Pinned because a
    // caller who assumes the result is a private copy has a bug the type
    // system cannot show them.
    const base = { a: { x: 1 }, list: [1, 2] }
    const override = { a: { y: 2 }, list: [9] }
    const merged = objectDeepMergeReplaceArrays(base, override)

    expect(merged.list).toBe(override.list)
    expect(merged.a).not.toBe(base.a)
    expect(merged.a).not.toBe(override.a)
  })

  it('takes more than two operands, later winning over earlier', () => {
    expect(
      objectDeepMergeReplaceArrays({ a: 1 }, { b: 2 }, { a: 3, c: 4 }),
    ).toEqual({ a: 3, b: 2, c: 4 })
  })
})

describe('recursive object graphs (GHSA-ggr8-5vv4-36mx)', () => {
  // deepmerge-ts <8 recursed with no cycle detection, so two records that both
  // point back at themselves through the same key path merged forever and
  // threw `RangeError: Maximum call stack size exceeded`. Host themes are
  // persisted documents; a self-referential one reaching `mergeThemeOptions`
  // is a denial of service on the console's theme build.
  //
  // Asserting "does not throw" rather than a shape: the advisory is about
  // termination, and the fixed library is free to choose how it resolves the
  // cycle. A downgrade or a lockfile `overrides` pinning 7.x fails here.
  it('terminates instead of exhausting the stack', () => {
    const left: Record<string, unknown> = {}
    left.self = left
    const right: Record<string, unknown> = {}
    right.self = right

    expect(() => objectDeepMerge(left, right)).not.toThrow()
    expect(() => objectDeepMergeReplaceArrays(left, right)).not.toThrow()
  })
})
