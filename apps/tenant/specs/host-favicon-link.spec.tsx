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
 * `<link rel="icon">` on a tenant site (AGL-1421).
 *
 * `seo.favicon` had a console card, a stored value on real sites, and no
 * reader on any rendered page — the app emitted no icon link at all, so every
 * browser fell back to the origin's `/favicon.ico`, which is Aglyn's mark.
 * The load-bearing assertion is therefore the same one AGL-1252 makes about
 * the install manifest: two different sites produce two different icons, and
 * a site with nothing configured borrows nobody's.
 *
 * The second half is the AGL-1407 rule — the stored value may be a `media:`
 * reference, a raw firebasestorage URL, an AGL-175 relative CDN path, or an
 * absolute URL somebody typed. All four have to reach the tag as something a
 * browser can fetch, which is exactly what the two console cards got wrong.
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
 * The two children are irrelevant here and both reach for infrastructure this
 * suite has no business standing up — the theme providers pull the MUI/emotion
 * client graph, and the admin bar reads release flags out of Firestore.
 */
jest.mock('../app/[host]/host-theme-providers', () => ({
  __esModule: true,
  HostThemeProviders: ({ children }: { children: unknown }) => children,
}))

jest.mock('../app/[host]/admin-bar/admin-bar-slot', () => ({
  __esModule: true,
  default: () => null,
}))

/**
 * The billing doc, which the layout began reading for the white-label favicon
 * (AGL-2183). Mocked rather than left to the real helper for the reason this
 * file already mocks the theme providers: `getOrgBilling` reaches
 * `next/cache`, which this jsdom suite cannot load at all — the import alone
 * failed every case here with "Class extends value undefined".
 *
 * The DEFAULT is a free org, deliberately. That is the shape every assertion
 * below was written against, and it keeps "a site that configured nothing
 * borrows nobody's icon" meaning what it always meant: on a free plan the
 * platform fallback is the deal, so no link is correct. The white-label case
 * gets its own describe, where the answer is different on purpose.
 */
const mockOrg = jest.fn()
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockOrg(...args),
}))

/**
 * The layout also resolves the site's top-level nav for the error boundaries
 * (AGL-2187), and it reaches `@aglyn/tenant-data-admin` — which pulls the
 * Firebase admin graph and fails this jsdom suite at import time, before a
 * single case runs. Same reason `get-org-billing` above is mocked.
 *
 * An empty list, because the nav is decoration this suite asserts nothing
 * about: the real helper degrades to `[]` on every internal failure, so this
 * is a shape the layout genuinely sees rather than a convenience.
 */
jest.mock('../utils/get-site-nav', () => ({
  __esModule: true,
  default: async () => [],
}))

import HostLayout from '../app/[host]/layout'

const HOST_ID = 'DXnRbPH4CQ'

/** Free plan: platform attribution applies, so the tab may carry our mark. */
const FREE_ORG = { org: { $id: 'org-free', plan: 'free' } }
/** Agency: carries `whiteLabel`, so it may not. */
const AGENCY_ORG = { org: { $id: 'org-agency', plan: 'agency' } }

/**
 * Renders the layout and returns the `href` of the icon link, or `null`.
 *
 * The layout is an async Server Component, so it is awaited to a React element
 * tree and walked rather than mounted — `<link>` here is a hoisted head tag,
 * not something a jsdom container would hold.
 */
const iconHref = async (favicon?: string, hostId = HOST_ID) => {
  mockGetHostCached.mockResolvedValue({
    host: {
      $id: hostId,
      displayName: 'Northwind Coffee',
      ...(favicon === undefined ? {} : { seo: { favicon } }),
    },
  })
  const tree = await HostLayout({
    children: null,
    params: Promise.resolve({ host: hostId }),
  } as never)
  const found: string[] = []
  const walk = (node: any) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    if (node.type === 'link' && node.props?.rel === 'icon') {
      found.push(node.props.href)
    }
    if (node.props?.children) walk(node.props.children)
  }
  walk(tree)
  expect(found.length).toBeLessThanOrEqual(1)
  return found[0] ?? null
}

describe('tenant `<link rel="icon">` (AGL-1421)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOrg.mockResolvedValue(FREE_ORG)
  })

  it('emits the SITE’s own icon, not the platform default', async () => {
    expect(await iconHref('media:org:jWmGooWE3L/19G8Ipyfb1')).toBe(
      '/api/media/cdn/org:jWmGooWE3L:DXnRbPH4CQ/19G8Ipyfb1',
    )
  })

  it('gives two different sites two different icons', async () => {
    const a = await iconHref('media:hostA/iconA', 'hostA')
    const b = await iconHref('media:hostB/iconB', 'hostB')
    expect(a).toBe('/api/media/cdn/hostA/iconA')
    expect(b).toBe('/api/media/cdn/hostB/iconB')
    expect(a).not.toBe(b)
  })

  describe('a site that configured nothing borrows nobody’s icon', () => {
    it('no `seo` at all', async () => {
      expect(await iconHref(undefined)).toBeNull()
    })

    /**
     * Clearing the card stores `''` (the same convention AGL-1337 documents
     * for the social image). An empty `href` is NOT "no icon" — a browser
     * resolves it against the document and requests the PAGE as the icon.
     */
    it('the card was cleared to an empty string', async () => {
      expect(await iconHref('')).toBeNull()
    })
  })

  describe('the legacy stored forms still reach the tag (AGL-1407)', () => {
    it('a raw firebasestorage download URL', async () => {
      const raw =
        'https://firebasestorage.googleapis.com/v0/b/aglyn-main.appspot.com/' +
        'o/orgs%2FjWmGooWE3L%2Fmedia%2F19G8Ipyfb1?alt=media&token=abc'
      expect(await iconHref(raw)).toBe(raw)
    })

    it('the AGL-175 relative CDN path', async () => {
      const path = '/api/media/cdn/org:jWmGooWE3L/19G8Ipyfb1'
      expect(await iconHref(path)).toBe(path)
    })

    it('an absolute URL somebody typed into the card', async () => {
      const typed = 'https://cdn.example.com/favicon.ico'
      expect(await iconHref(typed)).toBe(typed)
    })
  })

  /**
   * A malformed reference must drop the tag rather than emit `media:junk` as
   * an `href` — an unfetchable icon is a console error on every page load, and
   * dropping it falls back to the behaviour every site has today.
   */
  it('drops the tag for a malformed reference', async () => {
    expect(await iconHref('media:junk')).toBeNull()
  })

  /**
   * A white-label site must not borrow OURS either (AGL-2183).
   *
   * "Borrows nobody's icon" above resolves to no `<link>`, which makes the
   * browser fetch the origin's `/favicon.ico` — Aglyn's mark. That is the deal
   * on a free plan and a broken promise on a customer's own domain, and this
   * file's own opening comment says a white-label site is not white-label
   * while our icon is in the tab. These drive the REAL layout, so they pin the
   * behaviour a visitor gets rather than the pure precedence function.
   */
  describe('a white-label site (AGL-2183)', () => {
    it('suppresses the platform fallback with an empty data URL', async () => {
      mockOrg.mockResolvedValue(AGENCY_ORG)
      expect(await iconHref(undefined)).toBe('data:,')
    })

    it('prefers the org’s own mark over suppressing', async () => {
      mockOrg.mockResolvedValue({
        org: {
          ...AGENCY_ORG.org,
          brandingProfile: { faviconUrl: 'https://cdn.example/acme.ico' },
        },
      })
      expect(await iconHref(undefined)).toBe('https://cdn.example/acme.ico')
    })

    it('still lets the SITE’s own icon win over the org’s', async () => {
      mockOrg.mockResolvedValue({
        org: {
          ...AGENCY_ORG.org,
          brandingProfile: { faviconUrl: 'https://cdn.example/acme.ico' },
        },
      })
      expect(await iconHref('https://cdn.example/site.ico')).toBe(
        'https://cdn.example/site.ico',
      )
    })

    it('suppresses when the org could not be read at all', async () => {
      // getOrgBilling fails open with org: null, and an absent org resolves to
      // the FREE plan — so leaning the other way would put our mark back in an
      // Agency site's tab on any transient Firestore error.
      mockOrg.mockResolvedValue({ org: null })
      expect(await iconHref(undefined)).toBe('data:,')
    })
  })
})
