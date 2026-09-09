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
 * WHAT THE LAYOUT READS OFF THE REQUEST, AND IN WHICH ORDER.
 *
 * The scheme a tenant page paints is decided before its first render, from two
 * request fields that answer two different questions:
 *
 *  - `theme-color-mode`, the cookie the switcher writes, is the visitor's own
 *    STATED choice.
 *  - `Sec-CH-Prefers-Color-Scheme`, the client hint the middleware asks for, is
 *    their DEVICE's preference — the half no server can otherwise know, since
 *    `prefers-color-scheme` is a media feature.
 *
 * They stay two values all the way down rather than being collapsed into one
 * seed here, and that is what makes a stated preference outrank the device:
 * the provider consults the device only where the cookie named no scheme, and
 * the switcher can still tell "Light" from "Device default that happens to be
 * light". Folding the hint into the cookie's slot would compile, render the
 * right colors, and quietly re-label every visitor's stored choice.
 *
 * This suite owns the READING. What the pair renders to — the markup, the
 * palette, and the per-site dark opt-out that outranks both — belongs to
 * `host-theme-provider-ssr.spec.tsx`, which renders them with no browser
 * present at all.
 */

const mockGetHostCached = jest.fn()
jest.mock('../app/[host]/host-data', () => ({
  __esModule: true,
  getHostCached: (...args: unknown[]) => mockGetHostCached(...args),
}))

jest.mock('@aglyn/aglyn/app-utils/marketplace-theme', () => ({
  __esModule: true,
  resolveSiteTheme: () => undefined,
}))

jest.mock('@aglyn/shared-ui-theme/util/host-theme', () => ({
  __esModule: true,
  getGoogleFontsUrl: () => undefined,
}))

/**
 * Stands in for the providers so the props the layout resolved are readable,
 * and so this suite does not stand up the MUI/emotion client graph to inspect
 * two strings. It renders nothing: the layout's children are irrelevant here.
 */
const mockThemeProviderProps = jest.fn()
jest.mock('../app/[host]/host-theme-providers', () => ({
  __esModule: true,
  HostThemeProviders: (props: Record<string, unknown>) => {
    mockThemeProviderProps(props)
    return null
  },
}))

jest.mock('../app/[host]/admin-bar/admin-bar-slot', () => ({
  __esModule: true,
  default: () => null,
}))

/** Reaches `next/cache`, which this jsdom suite cannot load at all. */
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  default: async () => ({ org: { $id: 'org-free', plan: 'free' } }),
}))

/** Reaches the Firebase admin graph, which fails this suite at import time. */
jest.mock('../utils/get-site-nav', () => ({
  __esModule: true,
  default: async () => [],
}))

let mockRequestCookie: string | undefined
let mockRequestHeaders: Headers

/**
 * Both APIs throw outside a request scope, which a direct call to the layout
 * function is. The mock is what gives each case a request to have arrived on.
 */
jest.mock('next/headers', () => ({
  __esModule: true,
  cookies: async () => ({
    get: (name: string) =>
      name === 'theme-color-mode' && mockRequestCookie !== undefined
        ? { name, value: mockRequestCookie }
        : undefined,
  }),
  headers: async () => mockRequestHeaders,
}))

import { renderToStaticMarkup } from 'react-dom/server'
import HostLayout from '../app/[host]/layout'

/**
 * Renders the layout for a request carrying the given cookie and hint, and
 * returns the two modes it resolved.
 *
 * The tree is rendered rather than walked because `HostThemeProviders` is a
 * component: its props exist only once something renders it, and asserting on
 * an element's `props` object instead would pass just as happily against a
 * layout that had stopped rendering it at all.
 */
async function resolvedModes(request: { cookie?: string; hint?: string }) {
  mockRequestCookie = request.cookie
  mockRequestHeaders = new Headers(
    request.hint === undefined
      ? {}
      : { 'sec-ch-prefers-color-scheme': request.hint },
  )
  mockThemeProviderProps.mockClear()
  mockGetHostCached.mockResolvedValue({
    host: { $id: 'DXnRbPH4CQ', displayName: 'Northwind Coffee' },
  })
  const tree = await HostLayout({
    children: null,
    params: Promise.resolve({ host: 'DXnRbPH4CQ' }),
  } as never)
  renderToStaticMarkup(tree as never)
  expect(mockThemeProviderProps).toHaveBeenCalledTimes(1)
  const props = mockThemeProviderProps.mock.calls[0][0]
  return {
    chosen: props.initialThemeMode,
    device: props.initialDeviceMode,
  }
}

describe('the device preference the client hint carries', () => {
  it('CONTROL — a request that says nothing resolves neither', async () => {
    // Light is what both `null`s render to, so every case below needs this
    // one beside it: without it a suite asserting "dark" could be passing on
    // a layout that reads nothing and a provider that guesses.
    expect(await resolvedModes({})).toEqual({ chosen: null, device: null })
  })

  it('a dark device with no stored choice resolves dark', async () => {
    expect(await resolvedModes({ hint: 'dark' })).toEqual({
      chosen: null,
      device: 'dark',
    })
  })

  it('a light device resolves light rather than nothing', async () => {
    expect(await resolvedModes({ hint: 'light' })).toEqual({
      chosen: null,
      device: 'light',
    })
  })

  it('reads the quoted structured-field spelling', async () => {
    expect(await resolvedModes({ hint: '"dark"' })).toEqual({
      chosen: null,
      device: 'dark',
    })
  })

  it('a stored "Device default" is the same request as no cookie', async () => {
    // The switcher writes `system` for Device default, and that is precisely
    // the visitor this hint exists for.
    expect(await resolvedModes({ cookie: 'system', hint: 'dark' })).toEqual({
      chosen: null,
      device: 'dark',
    })
  })
})

describe('a stated choice is kept apart from the device that contradicts it', () => {
  it('a light cookie survives a dark device', async () => {
    expect(await resolvedModes({ cookie: 'light', hint: 'dark' })).toEqual({
      chosen: 'light',
      device: 'dark',
    })
  })

  it('a dark cookie survives a light device', async () => {
    expect(await resolvedModes({ cookie: 'dark', hint: 'light' })).toEqual({
      chosen: 'dark',
      device: 'light',
    })
  })
})
