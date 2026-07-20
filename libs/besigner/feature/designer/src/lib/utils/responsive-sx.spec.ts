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

import { SX_SCHEME_DARK_KEY } from '@aglyn/aglyn-node-renderer'
import { BesignerDeviceFlag } from '@aglyn/besigner'
import {
  canvasSchemeToSxScheme,
  deviceFlagToBreakpoint,
  readSxValue,
  sxHasBreakpointOverrides,
  writeSxValue,
} from './responsive-sx'

describe('deviceFlagToBreakpoint', () => {
  it('maps device flags to breakpoints, fluid to null', () => {
    expect(deviceFlagToBreakpoint(BesignerDeviceFlag.RESPONSIVE)).toBeNull()
    expect(deviceFlagToBreakpoint(BesignerDeviceFlag.SCALE)).toBeNull()
    expect(deviceFlagToBreakpoint(undefined)).toBeNull()
    expect(deviceFlagToBreakpoint(BesignerDeviceFlag.XS)).toBe('xs')
    expect(deviceFlagToBreakpoint(BesignerDeviceFlag.SM)).toBe('sm')
    expect(deviceFlagToBreakpoint(BesignerDeviceFlag.XL)).toBe('xl')
  })
})

describe('writeSxValue / readSxValue', () => {
  it('writes plain base values without promoting to objects', () => {
    const sx = writeSxValue({}, 'paddingTop', '8px', null)
    expect(sx['paddingTop']).toBe('8px')
    expect(readSxValue(sx, 'paddingTop', null)).toBe('8px')
  })

  it('promotes to responsive form when a breakpoint diverges', () => {
    let sx: Record<string, any> = { paddingTop: '8px' }
    sx = writeSxValue(sx, 'paddingTop', '16px', 'sm')
    expect(sx['paddingTop']).toEqual({ xs: '8px', sm: '16px' })
    expect(readSxValue(sx, 'paddingTop', null)).toBe('8px')
    expect(readSxValue(sx, 'paddingTop', 'sm')).toBe('16px')
    // md inherits sm (mobile-first cascade)
    expect(readSxValue(sx, 'paddingTop', 'md')).toBe('16px')
  })

  it('collapses back to a plain value when only xs remains', () => {
    let sx: Record<string, any> = { color: { xs: 'red', md: 'blue' } }
    sx = writeSxValue(sx, 'color', undefined, 'md')
    expect(sx['color']).toBe('red')
  })

  it('clears the property when the last slice is removed', () => {
    let sx: Record<string, any> = { gap: '4px' }
    sx = writeSxValue(sx, 'gap', undefined, null)
    expect('gap' in sx).toBe(false)
  })

  it('base writes preserve breakpoint overrides', () => {
    let sx: Record<string, any> = { m: { xs: 1, lg: 4 } }
    sx = writeSxValue(sx, 'm', 2, null)
    expect(sx['m']).toEqual({ xs: 2, lg: 4 })
  })

  it('treats non-breakpoint objects as opaque base values', () => {
    const shadow = { boxShadow: 3 }
    const sx = { '&:hover': shadow }
    expect(readSxValue(sx, '&:hover', 'md')).toBe(shadow)
  })
})

describe('sxHasBreakpointOverrides', () => {
  it('detects overrides beyond the base', () => {
    expect(sxHasBreakpointOverrides({ p: 1 }, 'p')).toBe(false)
    expect(sxHasBreakpointOverrides({ p: { xs: 1 } }, 'p')).toBe(false)
    expect(sxHasBreakpointOverrides({ p: { xs: 1, md: 2 } }, 'p')).toBe(true)
  })
})

// Scheme dimension (AGL-588): scheme OUTER, breakpoints INNER — the
// '@scheme dark' slice holds ordinary properties whose values may be
// responsive objects. Light IS the base; only dark gets a slice.
describe('scheme-scoped sx (AGL-588)', () => {
  it('maps the canvas scheme to an sx scope — light is the base', () => {
    expect(canvasSchemeToSxScheme('dark')).toBe('dark')
    expect(canvasSchemeToSxScheme('light')).toBeNull()
    expect(canvasSchemeToSxScheme(undefined)).toBeNull()
  })

  it('dark writes land in the dark slice, leaving the base untouched', () => {
    let sx: Record<string, any> = { color: '#111' }
    sx = writeSxValue(sx, 'color', '#eee', null, 'dark')
    expect(sx['color']).toBe('#111')
    expect(sx[SX_SCHEME_DARK_KEY]).toEqual({ color: '#eee' })
  })

  it('base (light) writes never touch the dark slice', () => {
    let sx: Record<string, any> = {
      color: '#111',
      [SX_SCHEME_DARK_KEY]: { color: '#eee' },
    }
    sx = writeSxValue(sx, 'color', '#222', null)
    sx = writeSxValue(sx, 'backgroundColor', '#fafafa', null, 'light')
    expect(sx['color']).toBe('#222')
    expect(sx['backgroundColor']).toBe('#fafafa')
    expect(sx[SX_SCHEME_DARK_KEY]).toEqual({ color: '#eee' })
  })

  it('dark reads resolve the slice and fall back to the base', () => {
    const sx = {
      color: '#111',
      backgroundColor: '#fff',
      [SX_SCHEME_DARK_KEY]: { color: '#eee' },
    }
    expect(readSxValue(sx, 'color', null, 'dark')).toBe('#eee')
    // No dark override — what renders in dark is the base value.
    expect(readSxValue(sx, 'backgroundColor', null, 'dark')).toBe('#fff')
    // Base reads never see the slice.
    expect(readSxValue(sx, 'color', null)).toBe('#111')
    expect(readSxValue(sx, 'color', null, 'light')).toBe('#111')
  })

  it('composes scheme with breakpoints — responsive objects inside the slice', () => {
    let sx: Record<string, any> = { color: '#111' }
    sx = writeSxValue(sx, 'color', '#ddd', null, 'dark')
    sx = writeSxValue(sx, 'color', '#eee', 'md', 'dark')
    expect(sx[SX_SCHEME_DARK_KEY]).toEqual({
      color: { xs: '#ddd', md: '#eee' },
    })
    expect(readSxValue(sx, 'color', null, 'dark')).toBe('#ddd')
    expect(readSxValue(sx, 'color', 'sm', 'dark')).toBe('#ddd')
    expect(readSxValue(sx, 'color', 'md', 'dark')).toBe('#eee')
    // The dark slice's mobile-first cascade applies within the slice.
    expect(readSxValue(sx, 'color', 'xl', 'dark')).toBe('#eee')
    // The base keeps its own value at every breakpoint.
    expect(readSxValue(sx, 'color', 'md')).toBe('#111')
  })

  it('falls back to the base per breakpoint when the slice has no value there', () => {
    const sx = {
      color: { xs: '#111', md: '#222' },
      [SX_SCHEME_DARK_KEY]: { color: { md: '#eee' } },
    }
    // xs: no dark override resolves — the base shows through.
    expect(readSxValue(sx, 'color', null, 'dark')).toBe('#111')
    expect(readSxValue(sx, 'color', 'md', 'dark')).toBe('#eee')
  })

  it('clearing the last dark override removes the slice entirely', () => {
    let sx: Record<string, any> = {
      color: '#111',
      [SX_SCHEME_DARK_KEY]: { color: '#eee' },
    }
    sx = writeSxValue(sx, 'color', undefined, null, 'dark')
    expect(SX_SCHEME_DARK_KEY in sx).toBe(false)
    expect(sx['color']).toBe('#111')
  })

  it('single-xs slices collapse to plain values inside the dark slice too', () => {
    let sx: Record<string, any> = {}
    sx = writeSxValue(sx, 'color', '#ddd', 'md', 'dark')
    sx = writeSxValue(sx, 'color', undefined, 'md', 'dark')
    expect(SX_SCHEME_DARK_KEY in sx).toBe(false)
    sx = writeSxValue(sx, 'color', '#ccc', null, 'dark')
    expect(sx[SX_SCHEME_DARK_KEY]).toEqual({ color: '#ccc' })
  })
})
