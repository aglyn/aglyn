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

import { pinRampedTypographySx } from './responsive-typography-sx'

describe('ramped typography sx', () => {
  it('pins a scalar font size into xs so it sorts after the variant ramp', () => {
    // The bug this exists for: `fontSize: '44px'` lands in the base block,
    // and the h2 variant's `@media (min-width:1536px){font-size:2.125rem}`
    // — emitted after it on the same class — wins on a desktop viewport.
    expect(pinRampedTypographySx({ fontSize: '44px' })).toEqual({
      fontSize: { xs: '44px' },
    })
  })

  it('pins a numeric and a theme-path font size the same way', () => {
    expect(pinRampedTypographySx({ fontSize: 72 })).toEqual({
      fontSize: { xs: 72 },
    })
    // The Font Size field's theme mode persists a typography token path;
    // MUI resolves it per breakpoint, so wrapping keeps it working.
    expect(pinRampedTypographySx({ fontSize: 'h4.fontSize' })).toEqual({
      fontSize: { xs: 'h4.fontSize' },
    })
  })

  it("leaves an author's own breakpoint ramp untouched", () => {
    // Already an at-rule, already sorted after the variant, and deliberate.
    const authored = { fontSize: { xs: '28px', md: '44px' } }
    expect(pinRampedTypographySx(authored)).toBe(authored)
  })

  it('leaves a cleared font size scalar so it still means "theme decides"', () => {
    const cleared = { fontSize: undefined, color: '#fff' }
    expect(pinRampedTypographySx(cleared)).toBe(cleared)
  })

  it('does not touch properties the theme does not ramp', () => {
    // letterSpacing/lineHeight/fontWeight never appear inside the ramp's
    // media queries, so they already win from the base block.
    const sx = { lineHeight: 1.05, letterSpacing: '-2px', fontWeight: 900 }
    expect(pinRampedTypographySx(sx)).toBe(sx)
  })

  it('ignores a font size nested under a descendant selector', () => {
    // Not in the contest with THIS element's variant.
    const sx = { '& .price': { fontSize: 12 } }
    expect(pinRampedTypographySx(sx)).toBe(sx)
  })

  it('pins each entry of an sx array', () => {
    expect(
      pinRampedTypographySx([{ color: '#fff' }, { fontSize: '56px' }]),
    ).toEqual([{ color: '#fff' }, { fontSize: { xs: '56px' } }])
  })

  it('pins the result of an sx callback', () => {
    const callback = () => ({ fontSize: '32px' })
    const pinned = pinRampedTypographySx(callback) as () => unknown
    expect(pinned()).toEqual({ fontSize: { xs: '32px' } })
  })

  it('returns non-objects and empty sx by identity', () => {
    expect(pinRampedTypographySx(undefined)).toBeUndefined()
    expect(pinRampedTypographySx('inherit')).toBe('inherit')
    const empty = {}
    expect(pinRampedTypographySx(empty)).toBe(empty)
  })
})
