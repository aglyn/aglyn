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
 * A theme's Google fonts are served by the site, not linked (AGL-3485).
 *
 * Linking `fonts.googleapis.com` as a stylesheet blocked first paint for
 * ~800 ms on the page Lighthouse measured. The layout now inlines the rules
 * and preloads the faces the first screen paints with, and links Google's
 * stylesheet only when the server could not read it — so a failed fetch
 * costs speed, never the typeface.
 */

const mockGetHostCached = jest.fn()
jest.mock('../app/[host]/host-data', () => ({
  __esModule: true,
  getHostCached: (...args: unknown[]) => mockGetHostCached(...args),
}))

const THEME = { fonts: [{ family: 'Inter', weights: [400, 700] }] }
jest.mock('@aglyn/aglyn/app-utils/site-theme', () => ({
  __esModule: true,
  resolveSiteTheme: () => THEME,
}))

jest.mock('@aglyn/shared-ui-theme/util/host-theme', () => ({
  __esModule: true,
  getGoogleFontsUrl: () =>
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap',
}))

const mockSelfHosted = jest.fn()
jest.mock('@aglyn/tenant-runtime/self-hosted-fonts', () => ({
  __esModule: true,
  selfHostedThemeFonts: (...args: unknown[]) => mockSelfHosted(...args),
}))

jest.mock('../app/[host]/host-theme-providers', () => ({
  __esModule: true,
  HostThemeProviders: ({ children }: { children: unknown }) => children,
}))
jest.mock('../app/[host]/admin-bar/admin-bar-slot', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  default: async () => ({ org: { $id: 'org-free', plan: 'free' } }),
}))
jest.mock('../utils/get-site-nav', () => ({
  __esModule: true,
  default: async () => [],
}))
jest.mock('next/headers', () => ({
  __esModule: true,
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}))

import HostLayout from '../app/[host]/[scheme]/layout'

/** Every element of the layout's tree, flattened. */
const elements = async () => {
  mockGetHostCached.mockResolvedValue({
    host: { $id: 'site1', displayName: 'Northwind' },
  })
  const tree = await HostLayout({
    children: null,
    params: Promise.resolve({ host: 'site1', scheme: 'light' }),
  } as never)
  const found: any[] = []
  const walk = (node: any) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    found.push(node)
    if (node.props?.children) walk(node.props.children)
  }
  walk(tree)
  return found
}

describe('theme fonts on a published page (AGL-3485)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('inlines the rules and preloads the first screen faces', async () => {
    mockSelfHosted.mockResolvedValue({
      css: "@font-face{font-family:'Inter';src:url(/api/fonts/inter/v18/a.woff2) format('woff2');}",
      preloads: ['/api/fonts/inter/v18/a.woff2'],
    })
    const found = await elements()
    expect(mockSelfHosted).toHaveBeenCalledWith(THEME)
    const style = found.find((node) => node.type === 'style')
    expect(style?.props.children).toContain('/api/fonts/inter/v18/a.woff2')
    expect(style?.props.precedence).toBeTruthy()
    const preload = found.find(
      (node) => node.type === 'link' && node.props.rel === 'preload',
    )
    expect(preload?.props).toMatchObject({
      as: 'font',
      type: 'font/woff2',
      href: '/api/fonts/inter/v18/a.woff2',
      crossOrigin: 'anonymous',
    })
    // Nothing render-blocking, and nothing asked of Google.
    expect(
      found.some(
        (node) => node.type === 'link' && node.props.rel === 'stylesheet',
      ),
    ).toBe(false)
    expect(JSON.stringify(found.map((node) => node.props?.href))).not.toContain(
      'fonts.g',
    )
  })

  it("links Google's stylesheet when the server could not read it", async () => {
    mockSelfHosted.mockResolvedValue(null)
    const found = await elements()
    expect(found.some((node) => node.type === 'style')).toBe(false)
    expect(
      found.find(
        (node) => node.type === 'link' && node.props.rel === 'stylesheet',
      )?.props.href,
    ).toContain('fonts.googleapis.com')
  })
})
