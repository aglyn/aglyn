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
