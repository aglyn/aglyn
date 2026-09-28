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
 * The email palette is the site's palette (AGL-3370).
 *
 * `@aglyn/shared-util-email` builds a light palette without MUI, because a
 * `type:util` lib cannot import this one. That makes it a copy of the
 * derivation below — the bases' authored colors, MUI's `createPalette`, and
 * `createResponsiveTheme`'s shade passes — and a copy is only trustworthy
 * while something holds it to the original. This spec is that something: it
 * builds both sides from the same inputs and requires every value to match
 * as a string, so a palette change here, or a MUI upgrade that derives a
 * shade differently, reds until the email side follows.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HostThemeSchemeColors } from '@aglyn/shared-data-types'
import {
  buildEmailPalette,
  emailPaletteBaseForHost,
  type EmailPalette,
} from '@aglyn/shared-util-email'
import type { ThemeOptions } from '../../vendor/mui'
import { consoleOptions } from '../console.theme'
import {
  hostBrandKey,
  siteBaseOptions,
  wearsPlatformBrand,
} from '../tenant.theme'
import createResponsiveTheme from './create-responsive-theme'
import { hostThemeToThemeOptions, mergeThemeOptions } from './host-theme'

/**
 * `COLOR_PICKER_TOKEN_PATHS` from `@aglyn/shared-ui-jsx-forms`. That lib
 * imports this one, so it cannot be imported back; the copy is held to the
 * source by the first test instead.
 */
const COLOR_PICKER_TOKEN_PATHS = [
  'primary.main',
  'primary.light',
  'primary.dark',
  'secondary.main',
  'secondary.light',
  'secondary.dark',
  'tertiary.main',
  'tertiary.light',
  'tertiary.dark',
  'surface.main',
  'tint.primary',
  'tint.secondary',
  'tint.tertiary',
  'error.main',
  'warning.main',
  'info.main',
  'success.main',
  'background.default',
  'background.paper',
  'text.primary',
  'text.secondary',
  'text.disabled',
  'divider',
  'grey.300',
  'grey.600',
  'grey.900',
  'common.white',
  'common.black',
]

/** What an email reads beyond the picker: a button's label on its fill. */
const EMAIL_EXTRA_PATHS = ['primary.contrastText', 'secondary.contrastText']

const PLATFORM_HOST = 'aglyn.com'
const CUSTOMER_HOST = 'acme'

function valueAt(palette: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[key]
          : undefined,
      palette,
    )
}

/** Every string leaf of the email palette, as a dot path. */
function leafPaths(node: unknown, prefix = ''): Array<string> {
  if (!node || typeof node !== 'object') return []
  return Object.entries(node as Record<string, unknown>).flatMap(
    ([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key
      if (typeof value === 'string') return [path]
      return leafPaths(value, path)
    },
  )
}

/** The palette the site renders: base, then the host theme merged over it. */
function muiSitePalette(
  host: string | undefined,
  colors?: HostThemeSchemeColors,
): unknown {
  const themeOptions = mergeThemeOptions(
    siteBaseOptions(host, 'light'),
    hostThemeToThemeOptions(
      colors ? { colorSchemes: { light: colors } } : {},
      'light',
    ),
  )
  return createResponsiveTheme({ themeOptions }).palette
}

/** The same, with a white-label brand's `primary` replaced wholesale. */
function muiBrandedPalette(
  base: ThemeOptions,
  primaryColor: string,
): unknown {
  return createResponsiveTheme({
    themeOptions: {
      ...base,
      palette: { ...base.palette, primary: { main: primaryColor } },
    },
  }).palette
}

/**
 * Every token the picker offers resolves, on both sides, to the same string
 * — except the paths named as `unresolved`, which must be absent on BOTH.
 */
function expectParity(
  email: EmailPalette,
  mui: unknown,
  unresolved: ReadonlyArray<string> = [],
) {
  const tokenPaths = [...COLOR_PICKER_TOKEN_PATHS, ...EMAIL_EXTRA_PATHS]
  for (const path of tokenPaths) {
    expect({ path, value: valueAt(email, path) }).toEqual({
      path,
      value: valueAt(mui, path),
    })
  }
  expect(
    tokenPaths.filter((path) => typeof valueAt(mui, path) !== 'string'),
  ).toEqual(unresolved)
  // And nothing else the email palette carries disagrees either.
  for (const path of leafPaths(email)) {
    expect({ path, value: valueAt(email, path) }).toEqual({
      path,
      value: valueAt(mui, path),
    })
  }
}

/**
 * Site customizations worth holding the port to, each for a reason, with the
 * picker tokens the case leaves unresolved on the page itself.
 */
const SITE_CASES: Array<
  [string, HostThemeSchemeColors, ReadonlyArray<string>?]
> = [
  ['primary only', { primary: { main: '#2e7d32' } }],
  [
    'primary and secondary',
    { primary: { main: '#6200ea' }, secondary: { main: '#ff4081' } },
  ],
  // Too light for white ink and too light to be text: contrastText flips to
  // dark ink, and the derived `dark` must walk down to clear AA.
  ['a light primary', { primary: { main: '#ffeb3b' } }],
  // An authored shade passes through byte-identical, even a failing one.
  [
    'an authored dark shade',
    { primary: { main: '#ffeb3b', dark: '#c0b000', light: '#fff59d' } },
  ],
  [
    'text, background, divider and tint',
    {
      text: { primary: '#1b1b1f', secondary: '#44474f' },
      // `paper` left unset falls to MUI's white, not the base's paper — the
      // palette merge is one level deep.
      background: { default: '#fffbfe' },
      divider: '#cac4d0',
      // A partial tint group REPLACES the base's, so the two tints left
      // unset resolve nowhere — on the page as in the email.
      tint: { primary: '#fde2e4' },
    },
    ['tint.secondary', 'tint.tertiary'],
  ],
  // A dark page ground under a light-scheme palette: every derived dark
  // shade is measured against it.
  ['a tinted page ground', { background: { default: '#e0f2f1', paper: '#f1f8e9' } }],
  // `tertiary` and `surface` take createResponsiveTheme's own shade pass,
  // not MUI's, and a pale surface's white contrastText must be walked.
  [
    'tertiary and surface',
    { tertiary: { main: '#00897b' }, surface: { main: '#fff8e1' } },
  ],
  [
    'every status color',
    {
      error: { main: '#b00020' },
      warning: { main: '#ffc107' },
      info: { main: '#29b6f6' },
      success: { main: '#00c853' },
    },
  ],
  [
    'function-notation colors',
    {
      primary: { main: 'hsl(200, 80%, 45%)' },
      secondary: { main: 'rgb(233, 30, 99)' },
    },
  ],
  [
    'an authored contrastText and light shade',
    { secondary: { main: '#f06292', contrastText: '#1a1a1a', light: '#f8bbd0' } },
  ],
]

describe('email palette parity with the MUI theme (AGL-3370)', () => {
  it('copies the color picker token list from its source', () => {
    const source = readFileSync(
      join(
        __dirname,
        '../../../../jsx-forms/src/lib/components/color-picker-tokens.tsx',
      ),
      'utf8',
    )
    const list = source.slice(
      source.indexOf('export const COLOR_PICKER_TOKEN_PATHS'),
      source.indexOf('export function resolvePaletteToken'),
    )
    const paths = [...list.matchAll(/path:\s*'([^']+)'/g)].map(
      (match) => match[1],
    )
    expect(paths).toEqual(COLOR_PICKER_TOKEN_PATHS)
  })

  it('matches the platform base with no site colors', () => {
    expectParity(
      buildEmailPalette({ base: 'platform' }),
      muiSitePalette(PLATFORM_HOST),
    )
  })

  it('matches the tenant base with no site colors', () => {
    expectParity(
      buildEmailPalette({ base: 'tenant' }),
      muiSitePalette(CUSTOMER_HOST),
    )
  })

  describe.each([
    ['platform', PLATFORM_HOST],
    ['tenant', CUSTOMER_HOST],
  ] as const)('on the %s base', (base, host) => {
    // Every row padded to three: a row shorter than the callback's arity
    // makes jest hand the last parameter its `done` callback.
    it.each(
      SITE_CASES.map(
        ([label, colors, unresolved]) =>
          [label, colors, unresolved ?? []] as const,
      ),
    )('matches with %s', (_label, colors, unresolved) => {
      expectParity(
        buildEmailPalette({ base, colors }),
        muiSitePalette(host, colors),
        unresolved,
      )
    })
  })

  it.each(['#ff5722', '#ffeb3b', '#0d47a1', '#00b0ff'])(
    'matches a white-label primary %s over the platform base',
    (primaryColor) => {
      expectParity(
        buildEmailPalette({ base: 'platform', primaryColor }),
        muiBrandedPalette(consoleOptions, primaryColor),
      )
    },
  )

  it('lays a white-label primary over a site’s own colors', () => {
    const colors: HostThemeSchemeColors = {
      primary: { main: '#2e7d32' },
      secondary: { main: '#ff4081' },
    }
    const siteOptions = mergeThemeOptions(
      siteBaseOptions(CUSTOMER_HOST, 'light'),
      hostThemeToThemeOptions({ colorSchemes: { light: colors } }, 'light'),
    )
    expectParity(
      buildEmailPalette({ base: 'tenant', colors, primaryColor: '#6a1b9a' }),
      muiBrandedPalette(siteOptions, '#6a1b9a'),
    )
  })
})

describe('emailPaletteBaseForHost mirrors wearsPlatformBrand (AGL-3370)', () => {
  const hosts: Array<{ cname?: string | null; subdomain?: string | null } | null | undefined> = [
    { cname: 'aglyn.com' },
    { cname: 'aglyn.io' },
    { cname: 'cname--aglyn.com' },
    { cname: ' AGLYN.IO ' },
    { subdomain: 'aglyn.com' },
    { cname: '', subdomain: 'aglyn.io' },
    { cname: 'example.com', subdomain: 'aglyn.com' },
    { cname: 'cname--example.com' },
    { cname: 'shop.aglyn.com' },
    { subdomain: 'acme' },
    { cname: null, subdomain: null },
    {},
    null,
    undefined,
  ]

  it.each(hosts.map((host) => [JSON.stringify(host) ?? 'undefined', host]))(
    'agrees for %s',
    (_label, host) => {
      const expected = wearsPlatformBrand(
        hostBrandKey(host as Parameters<typeof hostBrandKey>[0]),
      )
        ? 'platform'
        : 'tenant'
      expect(emailPaletteBaseForHost(host)).toBe(expected)
    },
  )

  it('covers both answers', () => {
    const bases = new Set(hosts.map((host) => emailPaletteBaseForHost(host)))
    expect([...bases].sort()).toEqual(['platform', 'tenant'])
  })
})
