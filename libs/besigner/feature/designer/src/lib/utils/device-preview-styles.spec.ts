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

import { VISIBILITY_BAND_MEDIA } from '@aglyn/aglyn'
import { BesignerDeviceFlag } from '@aglyn/besigner'
import { createTheme } from '@aglyn/shared-ui-theme'
import {
  createDevicePinnedTheme,
  DEVICE_PREVIEW_XS_WIDTH,
  devicePreviewWidth,
  evaluateWidthMediaQuery,
  pinBreakpointsToWidth,
  resolveSxForDeviceWidth,
} from './device-preview-styles'

describe('devicePreviewWidth', () => {
  const values = { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 }

  it('maps device flags to simulated viewport widths', () => {
    expect(devicePreviewWidth(BesignerDeviceFlag.XS, values)).toBe(
      DEVICE_PREVIEW_XS_WIDTH,
    )
    expect(devicePreviewWidth(BesignerDeviceFlag.SM, values)).toBe(600)
    expect(devicePreviewWidth(BesignerDeviceFlag.MD, values)).toBe(900)
    expect(devicePreviewWidth(BesignerDeviceFlag.LG, values)).toBe(1200)
    expect(devicePreviewWidth(BesignerDeviceFlag.XL, values)).toBe(1536)
  })

  it('returns null for fluid/scale (no pinning) and undefined', () => {
    expect(devicePreviewWidth(BesignerDeviceFlag.RESPONSIVE, values)).toBeNull()
    expect(devicePreviewWidth(BesignerDeviceFlag.SCALE, values)).toBeNull()
    expect(devicePreviewWidth(undefined, values)).toBeNull()
  })
})

describe('evaluateWidthMediaQuery', () => {
  it('evaluates the visibility band queries at each device width', () => {
    const { mobile, tablet, desktop } = VISIBILITY_BAND_MEDIA
    // Phone artboard (390) — only the mobile band matches.
    expect(evaluateWidthMediaQuery(mobile, 390)).toBe(true)
    expect(evaluateWidthMediaQuery(tablet, 390)).toBe(false)
    expect(evaluateWidthMediaQuery(desktop, 390)).toBe(false)
    // Tablet (600) — the range query with `and` matches.
    expect(evaluateWidthMediaQuery(mobile, 600)).toBe(false)
    expect(evaluateWidthMediaQuery(tablet, 600)).toBe(true)
    expect(evaluateWidthMediaQuery(desktop, 600)).toBe(false)
    // Laptop and up (900/1200/1536) — desktop band only.
    for (const width of [900, 1200, 1536]) {
      expect(evaluateWidthMediaQuery(mobile, width)).toBe(false)
      expect(evaluateWidthMediaQuery(tablet, width)).toBe(false)
      expect(evaluateWidthMediaQuery(desktop, width)).toBe(true)
    }
  })

  it('supports media types and comma-separated OR clauses', () => {
    expect(
      evaluateWidthMediaQuery('@media screen and (max-width:599.95px)', 390),
    ).toBe(true)
    expect(
      evaluateWidthMediaQuery('@media only screen and (min-width:900px)', 390),
    ).toBe(false)
    expect(
      evaluateWidthMediaQuery(
        '@media (max-width:500px), (min-width:1200px)',
        1300,
      ),
    ).toBe(true)
    expect(
      evaluateWidthMediaQuery(
        '@media (max-width:500px), (min-width:1200px)',
        800,
      ),
    ).toBe(false)
  })

  it('returns null for anything beyond px width conditions', () => {
    expect(
      evaluateWidthMediaQuery('@media (prefers-color-scheme: dark)', 390),
    ).toBeNull()
    expect(evaluateWidthMediaQuery('@media (hover: hover)', 390)).toBeNull()
    expect(evaluateWidthMediaQuery('@media (max-width:40em)', 390)).toBeNull()
    expect(evaluateWidthMediaQuery('@media print', 390)).toBeNull()
    expect(
      evaluateWidthMediaQuery(
        '@media (max-width:599px) and (orientation: portrait)',
        390,
      ),
    ).toBeNull()
    // One unparseable OR clause poisons the whole query.
    expect(
      evaluateWidthMediaQuery('@media (max-width:599px), print', 390),
    ).toBeNull()
  })
})

describe('resolveSxForDeviceWidth', () => {
  const bandSx = {
    color: 'red',
    [VISIBILITY_BAND_MEDIA.mobile]: { display: 'none' },
    [VISIBILITY_BAND_MEDIA.desktop]: { letterSpacing: 2 },
  }

  it('inlines the matching band and drops off-device slices', () => {
    expect(resolveSxForDeviceWidth(bandSx, 390)).toEqual({
      color: 'red',
      display: 'none',
    })
    expect(resolveSxForDeviceWidth(bandSx, 1200)).toEqual({
      color: 'red',
      letterSpacing: 2,
    })
    expect(resolveSxForDeviceWidth(bandSx, 600)).toEqual({ color: 'red' })
  })

  it('lets a matching slice override earlier base declarations', () => {
    const sx = {
      display: 'flex',
      [VISIBILITY_BAND_MEDIA.mobile]: { display: 'none' },
    }
    expect(resolveSxForDeviceWidth(sx, 390)).toEqual({ display: 'none' })
  })

  it('lets base declarations authored after the slice keep winning', () => {
    // CSS cascade: equal specificity, later in the sheet wins — an sx
    // authored with the media key first behaves the same when inlined.
    const sx = {
      [VISIBILITY_BAND_MEDIA.mobile]: { display: 'none' },
      display: 'flex',
    }
    expect(resolveSxForDeviceWidth(sx, 390)).toEqual({ display: 'flex' })
  })

  it('merges nested-selector collisions instead of clobbering', () => {
    const sx = {
      '& .chip': { color: 'blue', opacity: 0.5 },
      [VISIBILITY_BAND_MEDIA.mobile]: { '& .chip': { color: 'green' } },
    }
    expect(resolveSxForDeviceWidth(sx, 390)).toEqual({
      '& .chip': { color: 'green', opacity: 0.5 },
    })
  })

  it('leaves non-width media queries for the live viewport', () => {
    const sx = {
      '@media (prefers-color-scheme: dark)': { color: 'white' },
      [VISIBILITY_BAND_MEDIA.mobile]: { display: 'none' },
    }
    expect(resolveSxForDeviceWidth(sx, 900)).toEqual({
      '@media (prefers-color-scheme: dark)': { color: 'white' },
    })
  })

  it('recurses into nested selectors', () => {
    const sx = {
      '& .row': {
        gap: 1,
        [VISIBILITY_BAND_MEDIA.tablet]: { gap: 3 },
      },
    }
    expect(resolveSxForDeviceWidth(sx, 700)).toEqual({
      '& .row': { gap: 3 },
    })
  })

  it('maps sx arrays per entry and wraps theme callbacks', () => {
    const resolved = resolveSxForDeviceWidth(
      [bandSx, null, false, () => bandSx],
      390,
    ) as unknown[]
    expect(resolved[0]).toEqual({ color: 'red', display: 'none' })
    expect(resolved[1]).toBeNull()
    expect(resolved[2]).toBe(false)
    expect((resolved[3] as () => unknown)()).toEqual({
      color: 'red',
      display: 'none',
    })
  })

  it('keeps responsive breakpoint objects untouched (theme handles them)', () => {
    const sx = { display: { xs: 'none', md: 'flex' } }
    expect(resolveSxForDeviceWidth(sx, 390)).toEqual(sx)
  })
})

describe('pinBreakpointsToWidth', () => {
  const real = createTheme().breakpoints
  const isAlways = (query: string) =>
    /^@media \(min-width:\d+(\.\d+)?px\)$/.test(query) &&
    parseFloat(query.replace('@media (min-width:', '')) < 100
  const isNever = (query: string) =>
    parseFloat(query.replace('@media (min-width:', '')) >= 100000

  it('forces up/down/between/only/not for a tablet width', () => {
    const pinned = pinBreakpointsToWidth(real, 600)
    expect(isAlways(pinned.up('xs'))).toBe(true)
    expect(isAlways(pinned.up('sm'))).toBe(true)
    expect(isNever(pinned.up('md'))).toBe(true)
    expect(isNever(pinned.down('sm'))).toBe(true)
    expect(isAlways(pinned.down('md'))).toBe(true)
    expect(isAlways(pinned.between('sm', 'md'))).toBe(true)
    expect(isNever(pinned.between('md', 'lg'))).toBe(true)
    expect(isAlways(pinned.only('sm'))).toBe(true)
    expect(isNever(pinned.only('md'))).toBe(true)
    expect(isNever(pinned.not('sm'))).toBe(true)
    expect(isAlways(pinned.not('lg'))).toBe(true)
  })

  it('supports numeric keys like the real helpers', () => {
    const pinned = pinBreakpointsToWidth(real, 900)
    expect(isAlways(pinned.up(750))).toBe(true)
    expect(isNever(pinned.up(1000))).toBe(true)
  })

  it('emits a distinct query per helper/key so slices never collide', () => {
    const pinned = pinBreakpointsToWidth(real, 900)
    const queries = [
      pinned.up('xs'),
      pinned.up('sm'),
      pinned.up('md'),
      pinned.down('lg'),
      pinned.down('xl'),
      pinned.between('xs', 'md'),
      pinned.only('sm'),
      pinned.not('xl'),
    ]
    expect(new Set(queries).size).toBe(queries.length)
  })

  it('rebuilds internal_mediaKeys so the style engine seeds cascade order', () => {
    const pinned = pinBreakpointsToWidth(real, 900)
    const mediaKeys = (pinned as { internal_mediaKeys?: string[] })
      .internal_mediaKeys
    expect(mediaKeys).toEqual(real.keys.map((key) => pinned.up(key)))
    expect(mediaKeys).toHaveLength(real.keys.length)
  })

  it('keeps real pixel values for components that read them directly', () => {
    const pinned = pinBreakpointsToWidth(real, 390)
    expect(pinned.values).toEqual(real.values)
    expect(pinned.keys).toEqual(real.keys)
  })
})

describe('createDevicePinnedTheme', () => {
  it('clones the theme with pinned breakpoints and a rebuilt toolbar mixin', () => {
    const theme = createTheme()
    const pinnedPhone = createDevicePinnedTheme(theme, 390)
    const pinnedDesktop = createDevicePinnedTheme(theme, 1200)
    // Untouched slices carry over by reference.
    expect(pinnedPhone.palette).toBe(theme.palette)
    expect(pinnedPhone.typography).toBe(theme.typography)
    // The dense-desktop toolbar rule lives under a never-matching query
    // on a phone and an always-matching one on desktop.
    const phoneKeys = Object.keys(pinnedPhone.mixins.toolbar)
    const desktopKeys = Object.keys(pinnedDesktop.mixins.toolbar)
    expect(phoneKeys.some((key) => key.includes('100001'))).toBe(true)
    expect(
      desktopKeys.some((key) => /min-width:0\.001px/.test(key)),
    ).toBe(true)
  })
})
