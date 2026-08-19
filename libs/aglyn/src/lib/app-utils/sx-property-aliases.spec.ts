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

import { unstable_defaultSxConfig as defaultSxConfig } from '@mui/system'
import {
  expandSxAliases,
  hasExpandableSxAlias,
  isAtomicSxValue,
  isSxAliasProperty,
  SX_ALIAS_PROPERTIES,
  SX_PROPERTY_ALIASES,
  sxAliasesFor,
} from '@aglyn/shared-data-enums'

/**
 * The one-spelling table and its expansion (AGL-2207).
 *
 * The table is asserted against MUI's OWN config rather than restated, so
 * an upgrade that adds an alias fails here instead of silently opening a
 * second spelling the styles panel cannot read (AGL-2210).
 */
describe('sx property aliases (AGL-2207)', () => {
  describe('the table matches MUI, not our memory', () => {
    it('names every spacing alias MUI builds a multi-property rule for', () => {
      // MUI's `@mui/system/spacing` builds CSS_PROPERTIES from
      // {m: margin, p: padding} × {t,r,b,l,x,y}, then points
      // padding/marginX/Y at px/py/mx/my. Re-derived here from the same
      // shape rather than copied from the table under test.
      const directions: Record<string, string[]> = {
        '': [''],
        t: ['Top'],
        r: ['Right'],
        b: ['Bottom'],
        l: ['Left'],
        x: ['Left', 'Right'],
        y: ['Top', 'Bottom'],
      }
      const expected = new Set<string>()
      for (const [short, long] of [
        ['p', 'padding'],
        ['m', 'margin'],
      ]) {
        for (const suffix of Object.keys(directions)) {
          expected.add(short + suffix)
        }
        expected.add(`${long}X`)
        expected.add(`${long}Y`)
      }
      // `p`/`m` alone map to the CSS shorthand in MUI; the panel has no
      // shorthand field, so we expand them to the four longhands instead.
      for (const alias of expected) {
        expect(SX_ALIAS_PROPERTIES).toContain(alias)
      }
    })

    it('expands each spacing alias to exactly the sides MUI writes', () => {
      const sides = (alias: string) => {
        const body = alias.replace(/^(padding|margin|p|m)/, '')
        const property = alias.startsWith('m') ? 'margin' : 'padding'
        const map: Record<string, string[]> = {
          '': ['Top', 'Right', 'Bottom', 'Left'],
          t: ['Top'],
          r: ['Right'],
          b: ['Bottom'],
          l: ['Left'],
          x: ['Left', 'Right'],
          y: ['Top', 'Bottom'],
          X: ['Left', 'Right'],
          Y: ['Top', 'Bottom'],
        }
        return map[body].map((side) => property + side)
      }
      for (const alias of SX_ALIAS_PROPERTIES) {
        if (alias === 'bgcolor') continue
        expect([alias, SX_PROPERTY_ALIASES[alias]]).toEqual([
          alias,
          sides(alias),
        ])
      }
    })

    it("takes bgcolor's canonical name from MUI's own cssProperty", () => {
      const config = defaultSxConfig as unknown as Record<
        string,
        { cssProperty?: string }
      >
      expect(config['bgcolor'].cssProperty).toBe('backgroundColor')
      expect(SX_PROPERTY_ALIASES['bgcolor']).toEqual([
        config['bgcolor'].cssProperty,
      ])
    })

    it('leaves logical properties alone — they are not aliases', () => {
      // MUI lists these in its spacing set, but each maps to the SAME-named
      // CSS property. Rewriting `marginInline` to left/right would break RTL.
      for (const name of [
        'padding',
        'margin',
        'paddingInline',
        'paddingInlineStart',
        'paddingBlock',
        'marginInline',
        'marginBlockEnd',
      ]) {
        expect(isSxAliasProperty(name)).toBe(false)
      }
    })

    it('never claims a canonical longhand is itself an alias', () => {
      for (const canonical of Object.values(SX_PROPERTY_ALIASES).flat()) {
        expect(isSxAliasProperty(canonical)).toBe(false)
      }
    })
  })

  describe('sxAliasesFor', () => {
    it('names every spelling that would paint the property', () => {
      expect(sxAliasesFor('paddingTop').sort()).toEqual(['p', 'paddingY', 'pt', 'py'])
      expect(sxAliasesFor('backgroundColor')).toEqual(['bgcolor'])
      expect(sxAliasesFor('color')).toEqual([])
    })
  })

  describe('isAtomicSxValue', () => {
    it('admits a number and a single-token string', () => {
      expect(isAtomicSxValue(2)).toBe(true)
      expect(isAtomicSxValue('2rem')).toBe(true)
      expect(isAtomicSxValue('primary.main')).toBe(true)
    })

    it('refuses a multi-side CSS shorthand value', () => {
      // `p: '10px 20px'` has no per-side longhand; copying it onto
      // paddingTop would produce a declaration CSS drops.
      expect(isAtomicSxValue('10px 20px')).toBe(false)
      expect(isAtomicSxValue('rgba(0,0,0,.5)')).toBe(false)
      expect(isAtomicSxValue('')).toBe(false)
    })

    it('admits a responsive object whose every slice is atomic', () => {
      expect(isAtomicSxValue({ xs: 2, md: 4 })).toBe(true)
      expect(isAtomicSxValue({ xs: 2, md: '1px solid' })).toBe(false)
      expect(isAtomicSxValue({})).toBe(false)
    })
  })

  describe('expandSxAliases', () => {
    it('rewrites bgcolor to backgroundColor', () => {
      expect(expandSxAliases({ bgcolor: 'primary.main' })).toEqual({
        backgroundColor: 'primary.main',
      })
    })

    it('expands a spacing alias to the sides the panel owns', () => {
      expect(expandSxAliases({ py: 4 })).toEqual({
        paddingTop: 4,
        paddingBottom: 4,
      })
      expect(expandSxAliases({ p: 2 })).toEqual({
        paddingTop: 2,
        paddingRight: 2,
        paddingBottom: 2,
        paddingLeft: 2,
      })
      expect(expandSxAliases({ mx: 'auto' })).toEqual({
        marginLeft: 'auto',
        marginRight: 'auto',
      })
    })

    it('expands IN PLACE, so MUI later-key-wins order is preserved', () => {
      // `{p: 2, paddingTop: 8}` renders 8px on top; `{paddingTop: 8, p: 2}`
      // renders 2 spacing units. Both must survive the rewrite, or the
      // expansion is a restyle rather than a renaming.
      expect(expandSxAliases({ p: 2, paddingTop: 8 })).toEqual({
        paddingTop: 8,
        paddingRight: 2,
        paddingBottom: 2,
        paddingLeft: 2,
      })
      expect(Object.keys(expandSxAliases({ paddingTop: 8, p: 2 }))).toEqual([
        'paddingTop',
        'paddingRight',
        'paddingBottom',
        'paddingLeft',
      ])
      expect(expandSxAliases({ paddingTop: 8, p: 2 })['paddingTop']).toBe(2)
    })

    it('carries a responsive object onto each longhand', () => {
      expect(expandSxAliases({ py: { xs: 2, md: 6 } })).toEqual({
        paddingTop: { xs: 2, md: 6 },
        paddingBottom: { xs: 2, md: 6 },
      })
    })

    it('leaves a multi-side shorthand value alone rather than mangling it', () => {
      const sx = { p: '10px 20px' }
      expect(expandSxAliases(sx)).toBe(sx)
    })

    it('returns the input BY IDENTITY when there is no alias', () => {
      const sx = { backgroundColor: '#fff', paddingTop: 2 }
      expect(expandSxAliases(sx)).toBe(sx)
      expect(expandSxAliases(undefined)).toBeUndefined()
      expect(expandSxAliases('nonsense' as any)).toBe('nonsense')
    })

    it('with `only`, rewrites just the aliases the edit collides with', () => {
      // The panel's write seam: editing Background Color must not rewrite
      // the padding key the author never touched.
      expect(
        expandSxAliases(
          { bgcolor: 'primary.main', py: 4 },
          { only: ['backgroundColor'] },
        ),
      ).toEqual({ backgroundColor: 'primary.main', py: 4 })
    })

    it('with `only`, materializes every side of a colliding alias', () => {
      // Editing Padding Top on `py: 4` must also pin paddingBottom, or
      // clearing the alias would lose the bottom edge.
      expect(expandSxAliases({ py: 4 }, { only: ['paddingTop'] })).toEqual({
        paddingTop: 4,
        paddingBottom: 4,
      })
    })

    it('with `deep`, rewrites the scheme slice and nested selectors', () => {
      expect(
        expandSxAliases(
          {
            '@scheme dark': { bgcolor: '#101828' },
            '&:hover': { py: 1 },
          },
          { deep: true },
        ),
      ).toEqual({
        '@scheme dark': { backgroundColor: '#101828' },
        '&:hover': { paddingTop: 1, paddingBottom: 1 },
      })
    })

    it('does not descend without `deep`', () => {
      const sx = { '@scheme dark': { bgcolor: '#101828' } }
      expect(expandSxAliases(sx)).toBe(sx)
    })
  })

  describe('hasExpandableSxAlias', () => {
    it('answers the guard question', () => {
      expect(hasExpandableSxAlias({ py: 4 })).toBe(true)
      expect(hasExpandableSxAlias({ bgcolor: 'rgba(0,0,0,.5)' })).toBe(true)
      expect(hasExpandableSxAlias({ paddingTop: 4 })).toBe(false)
      expect(hasExpandableSxAlias({ p: '10px 20px' })).toBe(false)
      expect(hasExpandableSxAlias(undefined)).toBe(false)
    })
  })
})
