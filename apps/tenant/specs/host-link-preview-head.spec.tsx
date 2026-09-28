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
 * The `[host]` layout's `apple-touch-icon` link and `theme-color` meta
 * (AGL-3382), driven through the REAL layout.
 *
 * The pure precedence is covered in `link-preview-icons.spec.ts`; this suite
 * pins that the layout actually emits it, since the defect was an ABSENCE —
 * no touch-icon link at all — which no assertion about the helpers could see.
 * Mocked exactly as `host-favicon-link.spec.tsx` mocks it, and for the same
 * reasons, except that the theme resolves to the host's own `theme` here so
 * the theme-color tags have something to read.
 */

const mockGetHostCached = jest.fn()
jest.mock('../app/[host]/host-data', () => ({
  __esModule: true,
  getHostCached: (...args: unknown[]) => mockGetHostCached(...args),
}))

jest.mock('@aglyn/aglyn/app-utils/marketplace-theme', () => ({
  __esModule: true,
  resolveSiteTheme: (host: { theme?: unknown } | undefined) => host?.theme,
}))

jest.mock('@aglyn/shared-ui-theme/util/host-theme', () => ({
  __esModule: true,
  getGoogleFontsUrl: () => undefined,
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

import HostLayout from '../app/[host]/[scheme]/layout'

const HOST_ID = 'ZG22ootbN-'

/** Every `<link>` and `<meta>` the layout returns, as plain props. */
const headFor = async (host: Record<string, unknown>) => {
  mockGetHostCached.mockResolvedValue({ host: { $id: HOST_ID, ...host } })
  const tree = await HostLayout({
    children: null,
    params: Promise.resolve({ host: 'ready-to-roll', scheme: 'light' }),
  } as never)
  const links: Array<Record<string, string>> = []
  const metas: Array<Record<string, string>> = []
  const walk = (node: any) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    if (node.type === 'link') links.push(node.props)
    if (node.type === 'meta') metas.push(node.props)
    if (node.props?.children) walk(node.props.children)
  }
  walk(tree)
  return {
    touchIcons: links
      .filter((link) => link.rel === 'apple-touch-icon')
      .map((link) => link.href),
    themeColors: metas
      .filter((meta) => meta.name === 'theme-color')
      .map(({ content, media }) => ({ content, media })),
  }
}

describe('the layout’s apple-touch-icon (AGL-3382)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('links the site’s app icon', async () => {
    const { touchIcons } = await headFor({
      seo: {
        favicon: 'media:org:Ok7uFGMCC-/o0-uaWHCNA',
        appIcon: 'media:org:Ok7uFGMCC-/mKeulwfbL0',
      },
    })
    expect(touchIcons).toEqual([
      `/api/media/cdn/org:Ok7uFGMCC-:${HOST_ID}/mKeulwfbL0`,
    ])
  })

  it('links the favicon when that is all the site has', async () => {
    const { touchIcons } = await headFor({
      seo: { favicon: 'media:org:Ok7uFGMCC-/o0-uaWHCNA' },
    })
    expect(touchIcons).toEqual([
      `/api/media/cdn/org:Ok7uFGMCC-:${HOST_ID}/o0-uaWHCNA`,
    ])
  })

  it('links nothing — and nothing of ours — when the site has neither', async () => {
    const { touchIcons } = await headFor({ seo: { title: 'Plain' } })
    expect(touchIcons).toEqual([])
  })
})

describe('the layout’s theme-color (AGL-3382)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('emits the site’s light primary', async () => {
    const { themeColors } = await headFor({
      theme: { colorSchemes: { light: { primary: { main: '#12437f' } } } },
    })
    expect(themeColors).toEqual([{ content: '#12437f', media: undefined }])
  })

  it('emits a light and a dark tag when the site has a dark scheme', async () => {
    const { themeColors } = await headFor({
      theme: {
        colorSchemes: {
          light: { primary: { main: '#12437f' } },
          dark: { primary: { main: '#8fb4e6' } },
        },
      },
    })
    expect(themeColors).toEqual([
      { content: '#12437f', media: '(prefers-color-scheme: light)' },
      { content: '#8fb4e6', media: '(prefers-color-scheme: dark)' },
    ])
  })

  it('emits none for a site with no theme of its own', async () => {
    const { themeColors } = await headFor({})
    expect(themeColors).toEqual([])
  })
})
