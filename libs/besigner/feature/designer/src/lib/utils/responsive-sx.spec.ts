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

import { BesignerDeviceFlag } from '@aglyn/besigner'
import {
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
