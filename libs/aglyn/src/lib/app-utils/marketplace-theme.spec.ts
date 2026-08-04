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

import type { HostTheme } from '@aglyn/shared-data-types'
import {
  CONTRAST_AA,
  contrastRatio,
  describeTheme,
  describeThemeOverride,
  describeThemePath,
  isOverrideForCurrentTheme,
  parseColor,
  readThemeOverride,
  resolveSiteTheme,
  themeArtifactContent,
  themeOverridePatch,
  themeUpdateConflicts,
  validateThemeForPublish,
} from './marketplace-theme'
import { overrideWriteValue } from './marketplace-overrides'

/** A complete, readable, publishable theme. */
const goodTheme = (): HostTheme => ({
  colorSchemes: {
    light: {
      primary: { main: '#1565c0' },
      background: { default: '#ffffff', paper: '#ffffff' },
      text: { primary: '#111111', secondary: '#4a4a4a' },
    },
    dark: {
      primary: { main: '#90caf9' },
      background: { default: '#121212', paper: '#1e1e1e' },
      text: { primary: '#f5f5f5', secondary: '#c7c7c7' },
    },
  },
  typography: { fontFamily: 'Inter, system-ui, sans-serif' },
  fonts: [{ family: 'Inter', source: 'google', weights: [400, 700] }],
  shape: { borderRadius: 12 },
  spacing: 8,
})

const pathsOf = (issues: Array<{ path: string }>) =>
  issues.map((issue) => issue.path)

describe('parseColor', () => {
  it.each([
    ['#fff', { r: 255, g: 255, b: 255 }],
    ['#FFFFFF', { r: 255, g: 255, b: 255 }],
    ['#000000', { r: 0, g: 0, b: 0 }],
    ['#1565c0', { r: 21, g: 101, b: 192 }],
    ['#1565c0ff', { r: 21, g: 101, b: 192 }],
    ['rgb(21, 101, 192)', { r: 21, g: 101, b: 192 }],
    ['rgba(21, 101, 192, 0.5)', { r: 21, g: 101, b: 192 }],
    ['white', { r: 255, g: 255, b: 255 }],
  ])('parses %s', (input, expected) => {
    expect(parseColor(input)).toEqual(expected)
  })

  it('returns null for anything it cannot reason about, rather than guessing', () => {
    expect(parseColor('color-mix(in srgb, red, blue)')).toBeNull()
    expect(parseColor('var(--brand)')).toBeNull()
    expect(parseColor('rebeccapurple')).toBeNull()
    expect(parseColor('#12')).toBeNull()
    expect(parseColor(undefined)).toBeNull()
    expect(parseColor(42)).toBeNull()
  })
})

describe('contrastRatio', () => {
  it('matches the WCAG anchors', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('is symmetric', () => {
    expect(contrastRatio('#1565c0', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#1565c0') as number,
      10,
    )
  })

  it('is null when either colour is unparseable — not checked, not failed', () => {
    expect(contrastRatio('var(--x)', '#fff')).toBeNull()
    expect(contrastRatio('#fff', undefined)).toBeNull()
  })
})

describe('validateThemeForPublish — completeness', () => {
  it('accepts a complete, readable theme', () => {
    const result = validateThemeForPublish(goodTheme())
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('refuses a theme with nothing in it', () => {
    expect(validateThemeForPublish({}).ok).toBe(false)
    expect(validateThemeForPublish(null).ok).toBe(false)
    expect(validateThemeForPublish(undefined).ok).toBe(false)
  })

  it('refuses a light-only theme — half a theme is not a theme', () => {
    const theme = goodTheme()
    delete theme.colorSchemes?.dark
    const result = validateThemeForPublish(theme)
    expect(result.ok).toBe(false)
    expect(pathsOf(result.errors)).toContain('colorSchemes.dark')
    expect(result.errors[0].message).toMatch(/not one palette with a filter/)
  })

  it('refuses a dark-only theme for the same reason', () => {
    const theme = goodTheme()
    delete theme.colorSchemes?.light
    expect(pathsOf(validateThemeForPublish(theme).errors)).toContain(
      'colorSchemes.light',
    )
  })

  it('treats an empty scheme object as an absent scheme', () => {
    const theme = goodTheme()
    theme.colorSchemes!.dark = {}
    expect(pathsOf(validateThemeForPublish(theme).errors)).toContain(
      'colorSchemes.dark',
    )
  })

  it('refuses a scheme with no primary colour', () => {
    const theme = goodTheme()
    delete theme.colorSchemes?.dark?.primary
    expect(pathsOf(validateThemeForPublish(theme).errors)).toContain(
      'colorSchemes.dark.primary.main',
    )
  })
})

describe('validateThemeForPublish — contrast', () => {
  it('refuses unreadable body text on the background', () => {
    const theme = goodTheme()
    theme.colorSchemes!.light!.text = { primary: '#cccccc' }
    const result = validateThemeForPublish(theme)
    expect(result.ok).toBe(false)
    expect(pathsOf(result.errors)).toContain('colorSchemes.light.text.primary')
    expect(result.errors[0].message).toMatch(new RegExp(`${CONTRAST_AA}:1`))
  })

  it('refuses unreadable body text on PAPER even when the background is fine', () => {
    const theme = goodTheme()
    // Readable on the page, invisible on every card and menu.
    theme.colorSchemes!.light!.background = {
      default: '#ffffff',
      paper: '#222222',
    }
    const result = validateThemeForPublish(theme)
    expect(result.ok).toBe(false)
    expect(pathsOf(result.errors)).toContain(
      'colorSchemes.light.background.paper',
    )
  })

  it('warns but does not refuse on dim secondary text', () => {
    const theme = goodTheme()
    theme.colorSchemes!.light!.text = { primary: '#111111', secondary: '#aaaaaa' }
    const result = validateThemeForPublish(theme)
    expect(result.ok).toBe(true)
    expect(pathsOf(result.warnings)).toContain('colorSchemes.light.text.secondary')
  })

  it('warns when a button label disappears into its own fill', () => {
    const theme = goodTheme()
    theme.colorSchemes!.light!.primary = {
      main: '#1565c0',
      contrastText: '#1e6fd0',
    }
    const result = validateThemeForPublish(theme)
    expect(result.ok).toBe(true)
    expect(pathsOf(result.warnings)).toContain(
      'colorSchemes.light.primary.contrastText',
    )
  })

  it('says nothing about a contrastText the theme never set — MUI derives it', () => {
    const result = validateThemeForPublish(goodTheme())
    expect(pathsOf(result.warnings)).not.toContain(
      'colorSchemes.light.primary.contrastText',
    )
  })

  it('does not refuse a palette it cannot parse', () => {
    const theme = goodTheme()
    theme.colorSchemes!.light!.text = { primary: 'var(--ink)' }
    theme.colorSchemes!.light!.background = {
      default: 'var(--page)',
      paper: 'var(--page)',
    }
    expect(validateThemeForPublish(theme).ok).toBe(true)
  })
})

describe('validateThemeForPublish — fonts are the hard dependency', () => {
  it('warns about a family that is neither declared nor a system font', () => {
    const theme = goodTheme()
    theme.typography = { fontFamily: 'Untitled Sans, sans-serif' }
    const result = validateThemeForPublish(theme)
    expect(result.ok).toBe(true)
    expect(result.warnings[0].message).toMatch(/"Untitled Sans" is used but not/)
  })

  it('says nothing when the family is declared in the theme fonts', () => {
    expect(validateThemeForPublish(goodTheme()).warnings).toEqual([])
  })

  it('says nothing about a system family', () => {
    const theme = goodTheme()
    theme.fonts = []
    theme.typography = { fontFamily: 'Georgia, serif' }
    expect(validateThemeForPublish(theme).warnings).toEqual([])
  })

  it('only judges the FIRST family in a stack — the rest are the fallbacks', () => {
    const theme = goodTheme()
    theme.typography = { fontFamily: 'Inter, "Untitled Sans", sans-serif' }
    expect(validateThemeForPublish(theme).warnings).toEqual([])
  })

  it('checks per-variant families too, and reports each family once', () => {
    const theme = goodTheme()
    theme.typography = {
      fontFamily: 'Inter, sans-serif',
      variants: {
        h1: { fontFamily: 'Display Deck, serif' },
        h2: { fontFamily: 'Display Deck, serif' },
      },
    }
    const result = validateThemeForPublish(theme)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].message).toMatch(/Display Deck/)
  })
})

describe('themeArtifactContent', () => {
  it('carries the design and nothing else', () => {
    const theme = {
      ...goodTheme(),
      // Fields a host document might grow that must never ship in an artifact.
      updatedAt: 'now',
      updatedBy: 'user-1',
    } as HostTheme & Record<string, unknown>
    const content = themeArtifactContent(theme) as Record<string, unknown>
    expect(Object.keys(content).sort()).toEqual([
      'colorSchemes',
      'fonts',
      'shape',
      'spacing',
      'typography',
    ])
    expect(content['updatedAt']).toBeUndefined()
    expect(content['updatedBy']).toBeUndefined()
  })

  it('carries mixins — toolbar height is design, and is easy to drop (AGL-1242)', () => {
    const theme: HostTheme = {
      ...goodTheme(),
      mixins: { toolbar: { minHeight: 72 } },
    }
    expect(themeArtifactContent(theme).mixins).toEqual({
      toolbar: { minHeight: 72 },
    })
  })

  it('carries component overrides', () => {
    const theme: HostTheme = {
      components: { MuiButton: { defaultProps: { disableElevation: true } } },
    }
    expect(themeArtifactContent(theme).components).toEqual({
      MuiButton: { defaultProps: { disableElevation: true } },
    })
  })

  it('drops empty branches so two equivalent themes hash alike', () => {
    expect(themeArtifactContent({ fonts: [] })).toEqual({})
    expect(themeArtifactContent({ components: {} })).toEqual({})
    expect(themeArtifactContent({ colorSchemes: {} })).toEqual({})
    expect(themeArtifactContent({})).toEqual({})
    expect(themeArtifactContent(null)).toEqual({})
  })

  it('keeps spacing: 0, which is a value and not an empty branch', () => {
    expect(themeArtifactContent({ spacing: 0 })).toEqual({ spacing: 0 })
  })
})

describe('describeTheme', () => {
  it('summarises what an install is about to change', () => {
    expect(describeTheme(goodTheme())).toEqual([
      'Light and dark schemes',
      '1 font',
      '12px corners',
      '8px spacing',
    ])
  })

  it('names a partial theme as partial', () => {
    const theme = goodTheme()
    delete theme.colorSchemes?.dark
    expect(describeTheme(theme)[0]).toBe('light scheme only')
  })

  it('counts component styles', () => {
    const theme: HostTheme = {
      components: { MuiButton: { defaultProps: { disableElevation: true } } },
    }
    expect(describeTheme(theme)).toEqual(['1 component style'])
  })

  it('is empty for nothing', () => {
    expect(describeTheme(null)).toEqual([])
    expect(describeTheme({})).toEqual([])
  })
})

/* ---- the override layer applied to themes (AGL-1021) ---- */

/** A host running an installed theme, with the site's own changes on top. */
const hostWith = (patch: unknown, sha = 'sha-v1') => ({
  theme: goodTheme(),
  themeInstalledFrom: { listingId: 'listing-1', version: '1', sha256: sha },
  themeOverride: overrideWriteValue(patch, sha),
})

describe('resolveSiteTheme — theme ⊕ site overrides', () => {
  it('returns the theme untouched when there is no override', () => {
    const host = { theme: goodTheme() }
    expect(resolveSiteTheme(host)).toBe(host.theme)
  })

  it('is undefined for a site with no theme at all', () => {
    expect(resolveSiteTheme({})).toBeUndefined()
    expect(resolveSiteTheme(null)).toBeUndefined()
  })

  it('applies one overridden colour and leaves the rest of the theme alone', () => {
    const host = hostWith({
      colorSchemes: { light: { primary: { main: '#e91e63' } } },
    })
    const resolved = resolveSiteTheme(host) as HostTheme
    expect(resolved.colorSchemes?.light?.primary?.main).toBe('#e91e63')
    expect(resolved.colorSchemes?.light?.background?.default).toBe('#ffffff')
    expect(resolved.colorSchemes?.dark).toEqual(
      goodTheme().colorSchemes?.dark,
    )
    expect(resolved.typography).toEqual(goodTheme().typography)
  })

  it('overrides light and dark independently', () => {
    const host = hostWith({
      colorSchemes: { dark: { primary: { main: '#00e5ff' } } },
    })
    const resolved = resolveSiteTheme(host) as HostTheme
    expect(resolved.colorSchemes?.dark?.primary?.main).toBe('#00e5ff')
    expect(resolved.colorSchemes?.light?.primary?.main).toBe('#1565c0')
  })

  it('ignores a junk override rather than rendering nothing', () => {
    expect(
      resolveSiteTheme({ theme: goodTheme(), themeOverride: 'nonsense' }),
    ).toEqual(goodTheme())
    expect(
      resolveSiteTheme({ theme: goodTheme(), themeOverride: { patch: null } }),
    ).toEqual(goodTheme())
  })
})

describe('the patch survives a theme UPDATE — the point of the layer', () => {
  it('re-applies to a version the site never saw', () => {
    const v1 = goodTheme()
    const customised = goodTheme()
    customised.colorSchemes!.light!.primary = { main: '#e91e63' }
    const patch = themeOverridePatch({ theme: v1 }, customised)

    // v2: the publisher fixes dark contrast and adds a corner radius.
    const v2 = goodTheme()
    v2.colorSchemes!.dark!.text = { primary: '#ffffff', secondary: '#d0d0d0' }
    v2.shape = { borderRadius: 20 }

    const resolved = resolveSiteTheme({
      theme: v2,
      themeInstalledFrom: { listingId: 'l', sha256: 'sha-v2' },
      themeOverride: overrideWriteValue(patch, 'sha-v1'),
    }) as HostTheme
    expect(resolved.colorSchemes?.light?.primary?.main).toBe('#e91e63')
    expect(resolved.colorSchemes?.dark?.text?.primary).toBe('#ffffff')
    expect(resolved.shape?.borderRadius).toBe(20)
  })
})

describe('isOverrideForCurrentTheme — surviving a swap must not be silent', () => {
  it('is true when the patch was authored against the installed theme', () => {
    expect(isOverrideForCurrentTheme(hostWith({ spacing: 4 }))).toBe(true)
  })

  it('is false after a theme swap', () => {
    const host = hostWith({ spacing: 4 }, 'sha-old')
    host.themeInstalledFrom.sha256 = 'sha-new'
    expect(isOverrideForCurrentTheme(host)).toBe(false)
  })

  it('is true when there is nothing to compare — "cannot tell" is not "stale"', () => {
    expect(isOverrideForCurrentTheme({ theme: goodTheme() })).toBe(true)
    expect(
      isOverrideForCurrentTheme({
        theme: goodTheme(),
        themeOverride: overrideWriteValue({ spacing: 4 }, null),
        themeInstalledFrom: { listingId: 'l', sha256: 'x' },
      }),
    ).toBe(true)
  })
})

describe('describeThemeOverride — "what have I changed?"', () => {
  it('is empty when nothing was changed', () => {
    expect(describeThemeOverride({ theme: goodTheme() })).toEqual([])
  })

  it('names each change with its theme value and the site’s', () => {
    const entries = describeThemeOverride(
      hostWith({
        colorSchemes: { dark: { primary: { main: '#00e5ff' } } },
        spacing: 4,
      }),
    )
    expect(entries).toHaveLength(2)
    const colour = entries.find((entry) => entry.scheme === 'dark')
    expect(colour).toMatchObject({
      path: 'colorSchemes.dark.primary.main',
      scheme: 'dark',
      themeValue: '#90caf9',
      overrideValue: '#00e5ff',
    })
    expect(entries.find((entry) => entry.path === 'spacing')).toMatchObject({
      themeValue: 8,
      overrideValue: 4,
    })
  })

  it('reads the STORED patch, so it cannot disagree with what is applied', () => {
    const host = hostWith({ spacing: 4 })
    const entries = describeThemeOverride(host)
    const resolved = resolveSiteTheme(host) as HostTheme
    expect(entries[0].overrideValue).toBe(resolved.spacing)
  })

  it('labels a path for humans, not as a JSON path', () => {
    expect(describeThemePath('colorSchemes.dark.primary.main')).toBe(
      'Colour · dark · primary',
    )
    expect(describeThemePath('shape.borderRadius')).toBe('Shape · corner radius')
    expect(describeThemePath('components.MuiButton.defaultProps.color')).toBe(
      'Component · MuiButton · defaultProps · color',
    )
  })
})

describe('themeOverridePatch', () => {
  it('is undefined when the editor returned the theme unchanged', () => {
    expect(
      themeOverridePatch({ theme: goodTheme() }, goodTheme()),
    ).toBeUndefined()
  })

  it('stops being an override once a value is set back to the theme’s', () => {
    const host = { theme: goodTheme() }
    const edited = goodTheme()
    edited.spacing = 4
    expect(themeOverridePatch(host, edited)).toEqual({ spacing: 4 })
    edited.spacing = 8
    expect(themeOverridePatch(host, edited)).toBeUndefined()
  })
})

describe('themeUpdateConflicts — the only place a conflict can exist', () => {
  const host = hostWith({
    colorSchemes: { light: { primary: { main: '#e91e63' } } },
  })

  it('is empty when the publisher changed everything EXCEPT the overridden path', () => {
    const incoming = goodTheme()
    incoming.spacing = 12
    incoming.colorSchemes!.dark!.primary = { main: '#ffffff' }
    expect(themeUpdateConflicts(host, incoming)).toEqual([])
  })

  it('names only the contested path', () => {
    const incoming = goodTheme()
    incoming.colorSchemes!.light!.primary = { main: '#4caf50' }
    incoming.spacing = 12
    const conflicts = themeUpdateConflicts(host, incoming)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      path: 'colorSchemes.light.primary.main',
      scheme: 'light',
      themeValue: '#4caf50',
      overrideValue: '#e91e63',
    })
  })

  it('is not a conflict when the publisher adopted the site’s value', () => {
    const incoming = goodTheme()
    incoming.colorSchemes!.light!.primary = { main: '#e91e63' }
    expect(themeUpdateConflicts(host, incoming)).toEqual([])
  })

  it('is empty when the site overrode nothing', () => {
    const plain = { theme: goodTheme() }
    const incoming = goodTheme()
    incoming.spacing = 99
    expect(themeUpdateConflicts(plain, incoming)).toEqual([])
  })
})

describe('readThemeOverride', () => {
  it('reads a well-formed override', () => {
    expect(readThemeOverride(hostWith({ spacing: 4 }))).toEqual({
      patch: { spacing: 4 },
      baseSha256: 'sha-v1',
    })
  })

  it('treats junk as no override', () => {
    expect(readThemeOverride({ themeOverride: 'x' } as any)).toBeUndefined()
    expect(readThemeOverride(null)).toBeUndefined()
    expect(readThemeOverride({})).toBeUndefined()
  })
})
