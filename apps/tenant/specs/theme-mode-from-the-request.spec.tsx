/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and `NextRequest`/`NextResponse` need real web globals.
 *
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
 * WHAT THE REQUEST DECIDES ABOUT THE DOCUMENT, ACROSS BOTH HALVES OF THE SEAM.
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
 * The layout used to read both itself. It cannot: `cookies()` and `headers()`
 * are dynamic APIs, and the catch-all page beneath declares `revalidate`, so
 * the first regeneration threw `DYNAMIC_SERVER_USAGE` and every tenant page
 * answered 500 (AGL-2708). The reading moved to the middleware, which runs
 * ahead of the cache, and the answer is spent as a path segment the layout
 * takes as `params.scheme`.
 *
 * That splits one decision across two files, and either half alone can be
 * green while the site is wrong: a middleware that resolves the scheme
 * perfectly and a layout that ignores the segment renders light for everyone,
 * and so does a layout that reads the segment faithfully under a middleware
 * that dropped the cookie. So every case below drives the REAL middleware with
 * a real request, takes the scheme out of the rewrite it composed, and hands
 * that to the REAL layout — the whole path from request field to the mode the
 * provider is rendered with.
 *
 * What this suite no longer asserts, because the design no longer contains it:
 * the server does not keep "chose light" apart from "device is light". Only
 * the RESOLVED scheme rides the path, since encoding both inputs would be four
 * cached documents per page to record which radio a closed menu should show.
 * The distinction survives on the client, where `useThemeModeState` reads the
 * cookie itself at hydration. What the pair renders to — the markup, the
 * palette, and the per-site dark opt-out that outranks both — belongs to
 * `libs/shared/ui/theme/.../host-theme-provider-ssr.spec.tsx`, which renders
 * the provider with both props and no browser present at all.
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

/** Reaches `next/cache`, which this suite cannot load at all. */
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  default: async () => ({ org: { $id: 'org-free', plan: 'free' } }),
}))

/** Reaches the Firebase admin graph, which fails this suite at import time. */
jest.mock('../utils/get-site-nav', () => ({
  __esModule: true,
  default: async () => [],
}))

/**
 * THE OUTAGE, WIRED AS A TRIPWIRE.
 *
 * Both dynamic APIs throw here, the way Next throws them when it renders this
 * segment in a static context — which is the context the catch-all's
 * `revalidate` puts it in, and the exact failure that took every tenant page
 * to a 500. Mocked for the whole file rather than one case, so the layout
 * cannot quietly start reading the request again in any code path this suite
 * exercises: the cases below stop being about the scheme and start failing
 * outright.
 */
jest.mock('next/headers', () => {
  // Next recognizes its own bail-out by the `digest`, not by the class, and
  // the framework's own error is not importable from a spec — so the shape
  // that matters is reproduced rather than the constructor.
  const dynamicServerUsage = () => {
    const error = Object.assign(
      new Error('Route couldn’t be rendered statically'),
      { digest: 'DYNAMIC_SERVER_USAGE' },
    )
    throw error
  }
  return {
    __esModule: true,
    cookies: dynamicServerUsage,
    headers: dynamicServerUsage,
  }
})

import { COLOR_SCHEME_HINT_HEADER } from '@aglyn/shared-ui-theme/util/color-scheme-hint'
import { THEME_MODE_COOKIE } from '@aglyn/shared-ui-theme/util/theme-mode-cookie'
import { NextRequest } from 'next/server'
import { renderToStaticMarkup } from 'react-dom/server'
import HostLayout from '../app/[host]/[scheme]/layout'
import { middleware } from '../middleware'

const TENANT_DEMO_HOST = 'localhost:4500'

const originalFetch = global.fetch

beforeAll(() => {
  // `hostVerdict` fetches the lockdown verdict before the rewrite; an
  // unlocked answer keeps every case below on the ordinary page path.
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        locked: false,
        attribution: true,
        overQuota: false,
        contained: false,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof global.fetch
})
afterAll(() => {
  global.fetch = originalFetch
  // `process.env` is shared by every suite in a jest WORKER, so a demo host
  // left behind here would resolve some other spec's tenant host.
  delete process.env.AGLYN_TENANT_DEMO
})

beforeEach(() => {
  jest.restoreAllMocks()
  jest.spyOn(console, 'debug').mockImplementation(() => undefined)
})

/**
 * The scheme segment the middleware spends for a request carrying the given
 * cookie and hint.
 *
 * `hostVerdict` memoizes per isolate for 30 seconds, so each case passes a
 * DISTINCT tenant host — otherwise the second case reads the first case's
 * answer and the suite passes on a middleware that only ever fetched once.
 */
async function schemeSegmentFor(request: {
  host: string
  cookie?: string
  hint?: string
}): Promise<string> {
  process.env.AGLYN_TENANT_DEMO = request.host
  const headers = new Headers({ host: TENANT_DEMO_HOST })
  if (request.cookie !== undefined) {
    headers.set('cookie', `${THEME_MODE_COOKIE}=${request.cookie}`)
  }
  if (request.hint !== undefined) {
    headers.set(COLOR_SCHEME_HINT_HEADER, request.hint)
  }
  const response = (await middleware(
    new NextRequest(
      new Request(`http://${TENANT_DEMO_HOST}/some/page`, { headers }),
    ),
    {} as never,
  )) as Response | null
  const rewrite = response?.headers.get('x-middleware-rewrite')
  // A premise guard, not a formality: a locked, redirected or unmatched
  // response carries no rewrite, and reading a segment out of `null` would
  // hand every case below the same `undefined` and let them agree on it.
  expect(rewrite).toContain(`/${request.host}/`)
  return new URL(rewrite as string).pathname.split('/')[2]
}

/**
 * The scheme the DOCUMENT is built from, for a request carrying the given
 * cookie and hint.
 *
 * The layout is rendered rather than walked because `HostThemeProviders` is a
 * component: its props exist only once something renders it, and asserting on
 * an element's `props` object instead would pass just as happily against a
 * layout that had stopped rendering it at all.
 */
async function documentSchemeFor(request: {
  host: string
  cookie?: string
  hint?: string
}) {
  const scheme = await schemeSegmentFor(request)
  mockThemeProviderProps.mockClear()
  mockGetHostCached.mockResolvedValue({
    host: { $id: 'DXnRbPH4CQ', displayName: 'Northwind Coffee' },
  })
  const tree = await HostLayout({
    children: null,
    params: Promise.resolve({ host: 'DXnRbPH4CQ', scheme }),
  } as never)
  renderToStaticMarkup(tree as never)
  expect(mockThemeProviderProps).toHaveBeenCalledTimes(1)
  return {
    segment: scheme,
    mode: mockThemeProviderProps.mock.calls[0][0].initialDeviceMode,
  }
}

describe('the device preference the client hint carries', () => {
  it('CONTROL — a request that says nothing renders the light document', async () => {
    // Light is what a request with neither field resolves to, so every case
    // below needs this one beside it: without it a suite asserting "dark"
    // could be passing on a middleware that always says dark, or on a layout
    // that ignores the segment and a provider that guesses.
    expect(await documentSchemeFor({ host: 'req-none' })).toEqual({
      segment: 'light',
      mode: 'light',
    })
  })

  it('a dark device with no stored choice renders the dark document', async () => {
    expect(
      await documentSchemeFor({ host: 'req-hint-dark', hint: 'dark' }),
    ).toEqual({ segment: 'dark', mode: 'dark' })
  })

  it('a light device renders light through the same path, not by falling back', async () => {
    // Same answer as the CONTROL, reached the other way. Asserting the segment
    // as well as the mode is what tells the two apart: a middleware that had
    // stopped reading the hint would still say `light` here.
    expect(
      await documentSchemeFor({ host: 'req-hint-light', hint: 'light' }),
    ).toEqual({ segment: 'light', mode: 'light' })
  })

  it('reads the quoted structured-field spelling', async () => {
    expect(
      await documentSchemeFor({ host: 'req-hint-quoted', hint: '"dark"' }),
    ).toEqual({ segment: 'dark', mode: 'dark' })
  })

  it('a stored "Device default" is the same request as no cookie', async () => {
    // The switcher writes `system` for Device default, and that is precisely
    // the visitor this hint exists for. `system` is not a scheme: read as one
    // it would outrank the device and put every such visitor on light.
    expect(
      await documentSchemeFor({
        host: 'req-system-cookie',
        cookie: 'system',
        hint: 'dark',
      }),
    ).toEqual({ segment: 'dark', mode: 'dark' })
  })
})

describe('a stated choice outranks the device that contradicts it', () => {
  it('a light cookie survives a dark device', async () => {
    expect(
      await documentSchemeFor({
        host: 'req-light-over-dark',
        cookie: 'light',
        hint: 'dark',
      }),
    ).toEqual({ segment: 'light', mode: 'light' })
  })

  it('a dark cookie survives a light device', async () => {
    expect(
      await documentSchemeFor({
        host: 'req-dark-over-light',
        cookie: 'dark',
        hint: 'light',
      }),
    ).toEqual({ segment: 'dark', mode: 'dark' })
  })

  it('a dark cookie decides it on a browser that sends no hint at all', async () => {
    // Firefox and Safari implement neither the hint nor the negotiation, so
    // their visitors reach the middleware with the cookie and nothing else.
    // The stored choice is the only field that can answer for them on the
    // first render, and this is the case that says it does.
    expect(
      await documentSchemeFor({ host: 'req-cookie-only', cookie: 'dark' }),
    ).toEqual({ segment: 'dark', mode: 'dark' })
  })
})

describe('the render never reads the request itself (AGL-2708)', () => {
  it('builds the document with both dynamic APIs throwing', async () => {
    // `next/headers` is mocked to throw for this whole file, so this case is
    // the statement of what every case above also proves: the layout resolves
    // the scheme from its route param, and a static render of this segment —
    // the one an ISR regeneration performs — reaches the provider instead of
    // `DYNAMIC_SERVER_USAGE`.
    const { cookies, headers } = jest.requireMock('next/headers') as {
      cookies: () => unknown
      headers: () => unknown
    }
    expect(() => cookies()).toThrow()
    expect(() => headers()).toThrow()
    expect(
      await documentSchemeFor({ host: 'req-static-render', hint: 'dark' }),
    ).toEqual({ segment: 'dark', mode: 'dark' })
  })
})
