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

// Parity with the MUI theme is held in `shared-ui-theme`'s
// `email-palette-parity.spec.ts`; this file covers what only the email side
// does — resolving a stored color prop into something safe to write.

import {
  buildEmailPalette,
  emailPaletteBaseForHost,
  PLATFORM_EMAIL_PALETTE,
  resolveEmailColor,
} from './email-palette'

const tenant = buildEmailPalette({ base: 'tenant' })

describe('resolveEmailColor (AGL-3370)', () => {
  it('resolves a palette token to its hex', () => {
    expect(resolveEmailColor('primary.main', PLATFORM_EMAIL_PALETTE)).toBe(
      '#00b0ff',
    )
    expect(resolveEmailColor('primary.dark', PLATFORM_EMAIL_PALETTE)).toBe(
      '#0077ad',
    )
    expect(resolveEmailColor('primary.main', tenant)).toBe('#1976d2')
    expect(resolveEmailColor('grey.600', tenant)).toBe('#757575')
    expect(resolveEmailColor('common.white', tenant)).toBe('#ffffff')
    expect(resolveEmailColor('common.black', tenant)).toBe('#000000')
    expect(resolveEmailColor('tint.primary', tenant)).toBe('#e8f1fb')
  })

  it('writes a derived rgb() shade as hex', () => {
    // MUI derives `light` as `rgb(51, 191, 255)`.
    expect(resolveEmailColor('primary.light', PLATFORM_EMAIL_PALETTE)).toBe(
      '#33bfff',
    )
  })

  it('flattens a translucent token over the paper, for Outlook', () => {
    // rgba(0, 0, 0, 0.87) over white.
    expect(resolveEmailColor('text.primary', tenant)).toBe('#212121')
    // rgba(0, 0, 0, 0.12) over white.
    expect(resolveEmailColor('divider', tenant)).toBe('#e0e0e0')
    // `#000000DE` is eight-digit hex, which Outlook also drops.
    expect(resolveEmailColor('warning.contrastText', tenant)).toBe('#212121')
  })

  it('flattens over the site’s own paper', () => {
    const palette = buildEmailPalette({
      base: 'tenant',
      colors: { background: { paper: '#000000' } },
    })
    // rgba(0, 0, 0, 0.87) over black stays black.
    expect(resolveEmailColor('text.primary', palette)).toBe('#000000')
  })

  it('follows a site’s authored colors', () => {
    const palette = buildEmailPalette({
      base: 'tenant',
      colors: { primary: { main: '#2e7d32' }, divider: '#cac4d0' },
    })
    expect(resolveEmailColor('primary.main', palette)).toBe('#2e7d32')
    expect(resolveEmailColor('divider', palette)).toBe('#cac4d0')
  })

  it('passes a literal color through as written', () => {
    for (const literal of [
      '#fff',
      '#FFAB40',
      '#000000DE',
      '#abcd',
      'rgb(0, 0, 0)',
      'rgba(0,0,0,0.5)',
      'rgb(0 0 0 / 50%)',
      'hsl(200, 80%, 45%)',
      'hsla(200deg 80% 45% / 0.5)',
      'transparent',
      'red',
      'RebeccaPurple',
    ]) {
      expect(resolveEmailColor(literal, tenant)).toBe(literal)
      expect(resolveEmailColor(literal, undefined)).toBe(literal)
    }
  })

  it('trims a literal', () => {
    expect(resolveEmailColor('  #fff ', tenant)).toBe('#fff')
  })

  it('drops a token without a palette to resolve it against', () => {
    expect(resolveEmailColor('primary.main', undefined)).toBeUndefined()
  })

  it('drops an unknown token, a group, and a non-color leaf', () => {
    expect(resolveEmailColor('primary.muted', tenant)).toBeUndefined()
    expect(resolveEmailColor('brand.main', tenant)).toBeUndefined()
    expect(resolveEmailColor('primary', tenant)).toBeUndefined()
    expect(resolveEmailColor('grey', tenant)).toBe('grey') // the named color
    expect(resolveEmailColor('mode', tenant)).toBeUndefined()
    expect(resolveEmailColor('constructor', tenant)).toBeUndefined()
    expect(resolveEmailColor('primary.constructor', tenant)).toBeUndefined()
    expect(resolveEmailColor('__proto__', tenant)).toBeUndefined()
  })

  it('drops garbage and empty values', () => {
    for (const value of [
      '',
      '   ',
      undefined,
      null,
      42,
      {},
      ['#fff'],
      'notacolor',
      '#ggg',
      '#12345',
      'rgb(1, 2)',
      'var(--brand)',
      'color-mix(in srgb, red, blue)',
    ]) {
      expect(resolveEmailColor(value, tenant)).toBeUndefined()
    }
  })

  it('refuses anything that could leave the style attribute', () => {
    for (const value of [
      'red;background:url(x)',
      'red; background-image: url(https://evil.test/x.png)',
      '"><script>alert(1)</script>',
      "'><img src=x onerror=alert(1)>",
      '#fff;position:fixed',
      'rgb(0,0,0);x:y',
      'rgb(0,0,url(x))',
      'expression(alert(1))',
      'url(javascript:alert(1))',
      'red\n;x:y',
      'red</style>',
      'primary.main;color:red',
    ]) {
      expect(resolveEmailColor(value, tenant)).toBeUndefined()
    }
  })

  it('refuses an unsafe value a site stored as a theme color', () => {
    const palette = buildEmailPalette({
      base: 'tenant',
      colors: {
        text: { primary: 'red;background:url(x)' },
        divider: '"><script>',
      },
    })
    expect(resolveEmailColor('text.primary', palette)).toBeUndefined()
    expect(resolveEmailColor('divider', palette)).toBeUndefined()
  })
})

describe('buildEmailPalette (AGL-3370)', () => {
  it('re-derives the whole primary from a white-label color', () => {
    const palette = buildEmailPalette({
      base: 'platform',
      primaryColor: '#ff5722',
    })
    expect(resolveEmailColor('primary.main', palette)).toBe('#ff5722')
    // The platform's authored `#0077ad` is gone with the record it lived in.
    expect(resolveEmailColor('primary.dark', palette)).not.toBe('#0077ad')
    expect(resolveEmailColor('secondary.main', palette)).toBe('#e040fb')
  })

  it('ignores a white-label color that is not one', () => {
    for (const primaryColor of ['', 'notacolor', 'red;x:y', null, undefined]) {
      expect(buildEmailPalette({ base: 'platform', primaryColor })).toEqual(
        PLATFORM_EMAIL_PALETTE,
      )
    }
  })

  it('falls back to the base when the site’s colors cannot be derived', () => {
    // MUI's own `createTheme` throws on this, so there is no page to match.
    expect(
      buildEmailPalette({
        base: 'tenant',
        colors: { primary: { main: 'notacolor' } },
      }),
    ).toEqual(tenant)
  })

  it('ignores a site color without a main, as the theme does', () => {
    expect(
      buildEmailPalette({ base: 'tenant', colors: { primary: { dark: '#000' } } }),
    ).toEqual(tenant)
    expect(buildEmailPalette({ base: 'tenant', colors: null })).toEqual(tenant)
  })

  it('does not share state between builds', () => {
    const first = buildEmailPalette({ base: 'tenant' })
    ;(first['primary'] as Record<string, unknown>)['main'] = '#000000'
    expect(resolveEmailColor('primary.main', buildEmailPalette({ base: 'tenant' }))).toBe(
      '#1976d2',
    )
  })
})

describe('emailPaletteBaseForHost (AGL-3370)', () => {
  it('puts the operator’s own hosts on the platform base', () => {
    expect(emailPaletteBaseForHost({ cname: 'aglyn.com' })).toBe('platform')
    expect(emailPaletteBaseForHost({ cname: 'cname--aglyn.io' })).toBe(
      'platform',
    )
  })

  it('puts every customer site on the tenant base', () => {
    expect(emailPaletteBaseForHost({ subdomain: 'acme' })).toBe('tenant')
    expect(emailPaletteBaseForHost({ cname: 'example.com' })).toBe('tenant')
    expect(emailPaletteBaseForHost(null)).toBe('tenant')
    expect(emailPaletteBaseForHost(undefined)).toBe('tenant')
  })
})
