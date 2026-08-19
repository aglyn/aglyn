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
  applyCustomCssEdits,
  canonicalCssPartial,
  customCssDeclarations,
  parseCssDeclarations,
  serializeCssDeclarations,
} from './custom-css-form.component'

describe('parseCssDeclarations', () => {
  it('parses kebab-case declarations into camelCase JSS', () => {
    expect(
      parseCssDeclarations('border-radius: 8px; background-color: #fff;'),
    ).toEqual({ borderRadius: '8px', backgroundColor: '#fff' })
  })

  it('ignores malformed fragments', () => {
    expect(parseCssDeclarations('nonsense;; color: red')).toEqual({
      color: 'red',
    })
  })
})

describe('serializeCssDeclarations', () => {
  it('emits scalar values at the requested breakpoint, skipping objects', () => {
    const sx = {
      color: { xs: 'red', md: 'blue' },
      padding: '8px',
      '&:hover': { opacity: 0.5 },
    }
    expect(serializeCssDeclarations(sx, 'md')).toBe(
      'color: blue;\npadding: 8px;',
    )
    expect(serializeCssDeclarations(sx, null)).toBe(
      'color: red;\npadding: 8px;',
    )
  })
})

/**
 * The Custom CSS form speaks the Styles panel's spelling (AGL-2390).
 *
 * AGL-2207 made the panel's named fields read and clear MUI's system-prop
 * aliases, and AGL-2208/2210 stopped in-repo sources seeding new ones. This
 * form was the seam neither covered: it listed the RAW keys and wrote
 * through `writeSxValue` with no expansion at all, so on one node the
 * Colors group said `backgroundColor` while the Builder said `bgcolor`, and
 * a `backgroundColor` typed here landed BESIDE the `bgcolor` already there.
 */
describe('customCssDeclarations (AGL-2390)', () => {
  it('names an aliased declaration the way every other control names it', () => {
    expect(
      customCssDeclarations({ bgcolor: 'primary.main', py: 4 }, null),
    ).toEqual([
      { property: 'backgroundColor', value: 'primary.main' },
      { property: 'paddingTop', value: '4' },
      { property: 'paddingBottom', value: '4' },
    ])
  })

  it('resolves an aliased responsive value at the active breakpoint', () => {
    expect(customCssDeclarations({ px: { xs: 1, md: 6 } }, 'md')).toEqual([
      { property: 'paddingLeft', value: '6' },
      { property: 'paddingRight', value: '6' },
    ])
  })

  it('leaves a value the expansion cannot carry per-side alone', () => {
    // `p: '10px 20px'` is the CSS shorthand's own per-side syntax; copied
    // onto `paddingTop` it would become a declaration CSS drops.
    expect(customCssDeclarations({ p: '10px 20px' }, null)).toEqual([
      { property: 'p', value: '10px 20px' },
    ])
  })

  it('serializes the canonical name, so the CSS tab shows real CSS', () => {
    // `bgcolor` is not a CSS property at all — the CSS tab was emitting a
    // declaration no browser would accept if it were pasted anywhere else.
    expect(serializeCssDeclarations({ bgcolor: '#fff' }, null)).toBe(
      'background-color: #fff;',
    )
  })
})

describe('canonicalCssPartial (AGL-2390)', () => {
  it('resolves an alias the author types into the panel spelling', () => {
    expect(canonicalCssPartial('bgcolor', '#fff')).toEqual({
      backgroundColor: '#fff',
    })
    expect(canonicalCssPartial('py', '8px')).toEqual({
      paddingTop: '8px',
      paddingBottom: '8px',
    })
  })

  it('passes a canonical property straight through', () => {
    expect(canonicalCssPartial('backgroundColor', '#fff')).toEqual({
      backgroundColor: '#fff',
    })
    // …and does not read a property that merely LOOKS like one.
    expect(canonicalCssPartial('padding', '10px 20px')).toEqual({
      padding: '10px 20px',
    })
  })

  it('keeps a multi-token value under the name the author gave it', () => {
    expect(canonicalCssPartial('p', '10px 20px')).toEqual({
      p: '10px 20px',
    })
  })

  it('expands a CLEAR, so every longhand the alias painted goes', () => {
    // Asserted on the KEYS: `toEqual` reads an undefined-valued property as
    // absent, so a naive `{p: undefined}` would satisfy the object form and
    // this check would pass with the expansion deleted.
    expect(Object.keys(canonicalCssPartial('p', undefined))).toEqual([
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
    ])
    expect(Object.keys(canonicalCssPartial('bgcolor', undefined))).toEqual([
      'backgroundColor',
    ])
  })
})

describe('applyCustomCssEdits (AGL-2390)', () => {
  it('replaces the alias it collides with instead of landing beside it', () => {
    // The drift itself: two spellings of one declaration in one record,
    // where only MUI's key order decides which colour paints.
    expect(
      applyCustomCssEdits({ bgcolor: 'primary.main' }, { backgroundColor: '#fff' }, null),
    ).toEqual({ backgroundColor: '#fff' })
  })

  it('clears a declaration the alias underneath was painting', () => {
    // AGL-2207's sharper half: deleting the row used to remove a key that
    // was never the one painting, and the value came straight back.
    expect(
      applyCustomCssEdits({ py: 4 }, { paddingTop: undefined }, null),
    ).toEqual({ paddingBottom: 4 })
    expect(
      applyCustomCssEdits({ bgcolor: 'primary.main' }, { backgroundColor: '' }, null),
    ).toEqual({})
  })

  it('writes the longhands when the author names an alias', () => {
    expect(applyCustomCssEdits({}, { py: '8px' }, null)).toEqual({
      paddingTop: '8px',
      paddingBottom: '8px',
    })
  })

  it('scopes to the active breakpoint over an aliased base', () => {
    expect(
      applyCustomCssEdits({ bgcolor: 'red' }, { backgroundColor: 'blue' }, 'md'),
    ).toEqual({ backgroundColor: { xs: 'red', md: 'blue' } })
  })

  it('applies a whole CSS-tab draft in one pass, clears included', () => {
    // What Apply CSS does: the rows the draft no longer names clear, the
    // rest write, and both halves resolve their spelling the same way.
    expect(
      applyCustomCssEdits(
        { py: 4, bgcolor: 'primary.main', borderRadius: '8px' },
        {
          paddingTop: undefined,
          paddingBottom: '12px',
          backgroundColor: '#fff',
          borderRadius: undefined,
        },
        null,
      ),
    ).toEqual({ paddingBottom: '12px', backgroundColor: '#fff' })
  })

  it('leaves everything it was not asked about byte-identical', () => {
    const sx = { color: 'red', '&:hover': { opacity: 0.5 }, m: 2 }
    expect(applyCustomCssEdits(sx, { color: 'blue' }, null)).toEqual({
      color: 'blue',
      '&:hover': { opacity: 0.5 },
      m: 2,
    })
  })
})
