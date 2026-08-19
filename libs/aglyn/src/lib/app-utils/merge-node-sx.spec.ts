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

import { mergeNodeSx } from './merge-node-sx'
import { SX_SCHEME_DARK_KEY } from './scheme-sx'

describe('mergeNodeSx (AGL-1306)', () => {
  it('replaces exactly the plain property the override names, keeping siblings', () => {
    const base = { backgroundColor: '#101828', paddingTop: 8, color: '#fff' }
    const override = { backgroundColor: '#0b4a6f' }
    expect(mergeNodeSx(base, override)).toEqual({
      backgroundColor: '#0b4a6f',
      paddingTop: 8,
      color: '#fff',
    })
  })

  it('merges a responsive override over a plain base with cascade semantics', () => {
    // A `{ md: … }` override must keep the base below md — NOT clobber the
    // whole property (the mergeSchemeValue house rule).
    const base = { width: '100%', paddingTop: 4 }
    const override = { width: { md: '50%' } }
    expect(mergeNodeSx(base, override)).toEqual({
      width: { xs: '100%', md: '50%' },
      paddingTop: 4,
    })
  })

  it('applies a plain override at every width over a responsive base', () => {
    const base = { width: { xs: '100%', md: '50%' } }
    expect(mergeNodeSx(base, { width: '25%' })).toEqual({ width: '25%' })
  })

  it('partially overriding the @scheme dark slice keeps its sibling entries', () => {
    const base = {
      backgroundColor: '#fff',
      [SX_SCHEME_DARK_KEY]: { backgroundColor: '#101828', color: '#eee' },
    }
    const override = { [SX_SCHEME_DARK_KEY]: { backgroundColor: '#0b4a6f' } }
    expect(mergeNodeSx(base, override)).toEqual({
      backgroundColor: '#fff',
      [SX_SCHEME_DARK_KEY]: { backgroundColor: '#0b4a6f', color: '#eee' },
    })
  })

  it('a base-scope override leaves the base @scheme dark slice in place', () => {
    // The dark slice is a more specific selector of the same stylesheet:
    // overriding the light background must not erase the component's dark
    // treatment — dark keeps rendering the slice unless the instance
    // overrides the slice itself.
    const base = {
      backgroundColor: '#fff',
      [SX_SCHEME_DARK_KEY]: { backgroundColor: '#101828' },
    }
    expect(mergeNodeSx(base, { backgroundColor: '#fce7f3' })).toEqual({
      backgroundColor: '#fce7f3',
      [SX_SCHEME_DARK_KEY]: { backgroundColor: '#101828' },
    })
  })

  it('merges responsive values inside the dark slice with cascade semantics', () => {
    const base = {
      [SX_SCHEME_DARK_KEY]: { color: { xs: '#aaa', lg: '#bbb' } },
    }
    const override = { [SX_SCHEME_DARK_KEY]: { color: { md: '#ccc' } } }
    expect(mergeNodeSx(base, override)).toEqual({
      [SX_SCHEME_DARK_KEY]: { color: { xs: '#aaa', md: '#ccc' } },
    })
  })

  it('merges nested selector records key-by-key instead of replacing them', () => {
    const base = {
      '&:hover': { backgroundColor: '#eee', transform: 'scale(1.02)' },
    }
    const override = { '&:hover': { backgroundColor: '#ddd' } }
    expect(mergeNodeSx(base, override)).toEqual({
      '&:hover': { backgroundColor: '#ddd', transform: 'scale(1.02)' },
    })
  })

  it('returns the base untouched for an absent or empty override', () => {
    const base = { color: '#fff' }
    expect(mergeNodeSx(base, undefined)).toBe(base)
    expect(mergeNodeSx(base, null)).toBe(base)
    expect(mergeNodeSx(base, {})).toBe(base)
  })

  it('returns the override when there is no base', () => {
    const override = { color: '#fff' }
    expect(mergeNodeSx(undefined, override)).toBe(override)
    expect(mergeNodeSx(null, override)).toBe(override)
  })

  it('composes in array form when a side is not a plain record', () => {
    const fn = () => ({ color: '#fff' })
    expect(mergeNodeSx(fn, { paddingTop: 2 })).toEqual([fn, { paddingTop: 2 }])
    expect(mergeNodeSx([{ color: '#fff' }], { paddingTop: 2 })).toEqual([
      { color: '#fff' },
      { paddingTop: 2 },
    ])
  })

  it('never mutates its inputs', () => {
    const base = {
      width: '100%',
      [SX_SCHEME_DARK_KEY]: { color: '#eee' },
      '&:hover': { opacity: 0.9 },
    }
    const override = {
      width: { md: '50%' },
      [SX_SCHEME_DARK_KEY]: { color: '#fff' },
      '&:hover': { opacity: 1 },
    }
    const baseSnapshot = JSON.parse(JSON.stringify(base))
    const overrideSnapshot = JSON.parse(JSON.stringify(override))
    mergeNodeSx(base, override)
    expect(base).toEqual(baseSnapshot)
    expect(override).toEqual(overrideSnapshot)
  })
})

/**
 * One spelling before the key-level merge (AGL-2209).
 *
 * `py` and `paddingTop` are different keys, so a key-level merge cannot
 * make an instance override REPLACE an aliased definition value — before
 * this, the override landed beside the alias and only MUI's iteration
 * order decided which edge moved.
 */
describe('mergeNodeSx alias canonicalization (AGL-2209)', () => {
  it('lets a Padding Top override replace BOTH edges a py painted', () => {
    // The definition is a Blocks preset's node; the override is what the
    // Styles panel writes on one instance.
    const merged = mergeNodeSx({ py: 8 }, { paddingTop: '0px' }) as Record<
      string,
      unknown
    >
    expect(merged['py']).toBeUndefined()
    expect(merged['paddingTop']).toBe('0px')
    // The half that used to survive as the definition's 8 with nothing to
    // explain it: the bottom edge is now the definition's, explicitly.
    expect(merged['paddingBottom']).toBe(8)
  })

  it('lets backgroundColor replace a definition stored as bgcolor', () => {
    const merged = mergeNodeSx(
      { bgcolor: 'primary.main', py: 8 },
      { backgroundColor: '#0b4a6f' },
    ) as Record<string, unknown>
    expect(merged['bgcolor']).toBeUndefined()
    expect(merged['backgroundColor']).toBe('#0b4a6f')
  })

  it('canonicalizes inside the dark scheme slice too', () => {
    const merged = mergeNodeSx(
      { [SX_SCHEME_DARK_KEY]: { bgcolor: '#101828' } },
      { [SX_SCHEME_DARK_KEY]: { backgroundColor: '#000' } },
    ) as Record<string, any>
    expect(merged[SX_SCHEME_DARK_KEY]).toEqual({ backgroundColor: '#000' })
  })

  it('leaves an alias with no counterpart in the override intact-in-meaning', () => {
    const merged = mergeNodeSx({ px: 4 }, { color: 'red' }) as Record<
      string,
      unknown
    >
    expect(merged).toEqual({
      paddingLeft: 4,
      paddingRight: 4,
      color: 'red',
    })
  })

  it('returns the base by identity when neither side has an alias', () => {
    const base = { paddingTop: 2 }
    expect(mergeNodeSx(base, {})).toBe(base)
    expect(mergeNodeSx(base, undefined)).toBe(base)
  })
})
