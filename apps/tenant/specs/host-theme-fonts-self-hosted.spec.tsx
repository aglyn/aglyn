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
 * A theme's fonts are served by the site, never linked (AGL-3485, AGL-3656).
 *
 * Linking `fonts.googleapis.com` as a stylesheet blocked first paint for
 * ~800 ms on the page Lighthouse measured. The layout inlines the rules and
 * preloads the faces the first screen paints with — once each: rendering a
 * `<link rel="preload">` as well as React's own preload put every body font
 * in the head twice. A render that could not read Google links nothing; the
 * rules still carry each family's sized fallback.
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

const mockPreload = jest.fn()
jest.mock('react-dom', () => ({
  __esModule: true,
  ...jest.requireActual('react-dom'),
  preload: (...args: unknown[]) => mockPreload(...args),
}))

const mockSelfHosted = jest.fn()
jest.mock('@aglyn/tenant-runtime/self-hosted-fonts', () => ({
  __esModule: true,
  selfHostedThemeFonts: (...args: unknown[]) => mockSelfHosted(...args),
}))

const mockProviders = jest.fn()
jest.mock('../app/[host]/host-theme-providers', () => ({
  __esModule: true,
  HostThemeProviders: (props: { children: unknown }) => {
    mockProviders(props)
    return props.children
  },
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
const elements = async (host = 'site1') => {
  mockGetHostCached.mockResolvedValue({
    host: { $id: 'site1', displayName: 'Northwind' },
  })
  const tree = await HostLayout({
    children: null,
    params: Promise.resolve({ host, scheme: 'light' }),
  } as never)
  // The layout returns its providers' element; render the function so the
  // children it was handed are walked.
  if (tree && typeof (tree as any).type === 'function') {
    ;(tree as any).type((tree as any).props)
  }
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

describe('theme fonts on a published page (AGL-3485, AGL-3656)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('inlines the rules and preloads the first screen faces, once each', async () => {
    mockSelfHosted.mockResolvedValue({
      css: "@font-face{font-family:'Inter';src:url(/api/fonts/inter/v18/a.woff2) format('woff2');}",
      preloads: ['/api/fonts/inter/v18/a.woff2'],
    })
    const found = await elements()
    expect(mockSelfHosted).toHaveBeenCalledWith(THEME, {
      hostId: 'site1',
      baseTypography: expect.objectContaining({ h1: { fontWeight: 900 } }),
      baseFonts: [],
    })
    const style = found.find((node) => node.type === 'style')
    expect(style?.props.children).toContain('/api/fonts/inter/v18/a.woff2')
    expect(style?.props.precedence).toBeTruthy()
    expect(mockPreload).toHaveBeenCalledTimes(1)
    expect(mockPreload).toHaveBeenCalledWith('/api/fonts/inter/v18/a.woff2', {
      as: 'font',
      type: 'font/woff2',
      crossOrigin: 'anonymous',
    })
    // No preload element beside React's own, nothing render-blocking, and
    // nothing asked of Google.
    expect(found.some((node) => node.type === 'link' && node.props.rel === 'preload')).toBe(false)
    expect(found.some((node) => node.type === 'link' && node.props.rel === 'stylesheet')).toBe(false)
    expect(JSON.stringify(found.map((node) => node.props?.href))).not.toContain('fonts.g')
  })

  it('links nothing from Google when the server could not read it', async () => {
    mockSelfHosted.mockResolvedValue(null)
    const found = await elements()
    expect(found.some((node) => node.type === 'style')).toBe(false)
    expect(found.some((node) => node.type === 'link' && /fonts\.g/.test(node.props.href ?? ''))).toBe(false)
    expect(mockPreload).not.toHaveBeenCalled()
  })

  it("loads the brand's face on an operator host whose theme names none", async () => {
    mockSelfHosted.mockResolvedValue(null)
    await elements('cname--aglyn.com')
    expect(mockSelfHosted).toHaveBeenCalledWith(
      THEME,
      expect.objectContaining({ baseFonts: [expect.objectContaining({ family: 'Roboto Flex' })] }),
    )
    const stack = mockProviders.mock.calls[0][0].hostTheme.typography.fontFamily
    expect(stack).toMatch(/^"Roboto Flex", "Roboto Flex Fallback",/)
  })
})
