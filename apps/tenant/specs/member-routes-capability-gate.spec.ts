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
 * The member routes are gated by the per-site user-accounts capability
 * (AGL-2486), driven through the REAL loader.
 *
 * Before this, `path === 'signin' | 'signup' | 'recover'` returned a
 * membership page unconditionally — no plugin check, no entitlement, no
 * flag — so every published site on the platform served a sign-in form,
 * `aglyn.com/signin` included, while the real console sign-in lives on
 * `app.aglyn.com`. That is not untidy, it is credential confusion: a
 * sign-in-shaped page on a brand's own domain that is not that brand's
 * sign-in.
 *
 * So the assertion that matters is not "the page is unlinked" but "the
 * address does not exist": `notFound: true`, which `page.tsx` turns into a
 * real `notFound()` and the `[host]/not-found` boundary answers with a 404
 * STATUS. A `props` result carrying `noindex` would be a soft 404 — the
 * exact trade AGL-2342 refused — so these tests check the shape, not the
 * robots directive.
 */

const mockFilter = jest.fn(async (ids: readonly string[]) => [...ids])

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: jest.fn() },
  getPlatformLockdown: jest.fn(async () => null),
  getDomainLockdown: jest.fn(async () => null),
  // Faithful double (the release flag defaults ON): identity, so a plugin
  // that survives the HOST resolver survives this too. A double returning
  // `[]` — as some sibling specs use — would make every case here pass for
  // the wrong reason, since an empty set contains no `accounts` either.
  filterEnabledPluginsByReleaseFlags: (ids: readonly string[]) =>
    mockFilter(ids),
  getRealmPluginInstalls: jest.fn(async () => []),
}))
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: jest.fn(),
  CNAME_HOST_PREFIX: 'cname--',
}))
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ org: { $id: 'org-1' } })),
}))
jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: jest.fn(async () => undefined) },
}))
jest.mock('../utils/render-timings', () => ({
  __esModule: true,
  startRenderTimer: () => ({ mark: () => undefined, report: () => undefined }),
}))
jest.mock('@aglyn/tenant-runtime/compose-screen-nodes', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ root: {} })),
  composeNodesWithChrome: jest.fn(async () => ({ root: {} })),
}))
jest.mock('@aglyn/tenant-runtime/get-variables', () => ({
  __esModule: true,
  default: jest.fn(async () => ({})),
}))
jest.mock('@aglyn/tenant-runtime/get-screen', () => ({
  __esModule: true,
  default: jest.fn(async () => ({
    screen: { $id: 'auth-screen', versionId: 'v1' },
    error: null,
  })),
}))
jest.mock('@aglyn/tenant-runtime/get-collection-content', () => ({
  __esModule: true,
  default: jest.fn(async () => ({
    collection: null,
    entries: [],
    entry: null,
  })),
}))
jest.mock('@aglyn/tenant-runtime/compose-collection-page', () => ({
  __esModule: true,
  composeCollectionTemplatePage: jest.fn(async () => null),
  composeCollectionFallbackPage: jest.fn(async () => null),
}))
// The author page (AGL-2518), mocked for the reason its collection siblings
// above are: this suite's subject is which branch a path reaches, and the real
// module reaches Firestore through `next/cache`, which does not load here.
// Resolving to an unknown author is what makes the loader fall past it.
jest.mock('@aglyn/tenant-runtime/get-author-content', () => ({
  __esModule: true,
  default: jest.fn(async () => ({
    slug: '',
    author: null,
    name: '',
    known: false,
    entries: [],
    categories: [],
    page: 1,
    perPage: 10,
    totalEntries: 0,
    totalPages: 1,
  })),
}))
jest.mock('@aglyn/tenant-runtime/compose-author-page', () => ({
  __esModule: true,
  composeAuthorTemplatePage: jest.fn(async () => null),
  composeAuthorFallbackPage: jest.fn(async () => null),
}))
jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  default: jest.fn(async () => new Set<string>()),
  getTemplateScreenIds: jest.fn(async () => new Set<string>()),
  getTemplateScreenRouting: jest.fn(async () => ({
    templateScreenIds: new Set<string>(),
    listRoutes: {} as Record<string, string>,
  })),
}))

import { ACCOUNTS_PLUGIN_ID } from '@aglyn/aglyn'
import { loadPageData } from '../app/[host]/[[...slug]]/load-page-data'
import getHost from '../utils/get-host'

const mockGetHost = getHost as jest.Mock

/** A marketing site: no members, no opt-in. The `aglyn.com` shape. */
const MARKETING_HOST = {
  $id: 'host-marketing',
  subdomain: 'acme',
  screens: { home: '/' },
}

/** A site that has switched user accounts ON. */
const MEMBERS_HOST = {
  ...MARKETING_HOST,
  $id: 'host-members',
  enabledPlugins: [ACCOUNTS_PLUGIN_ID],
}

const MEMBER_ROUTES = ['signin', 'signup', 'recover'] as const

beforeEach(() => {
  jest.clearAllMocks()
  mockFilter.mockImplementation(async (ids: readonly string[]) => [...ids])
  mockGetHost.mockResolvedValue({ host: { ...MARKETING_HOST }, error: null })
})

describe('member routes are off until a site turns them on (AGL-2486)', () => {
  it.each(MEMBER_ROUTES)(
    '/%s is a REAL 404 on a site that never opted in',
    async (route) => {
      const result: any = await loadPageData('acme', [route])
      expect(result.notFound).toBe(true)
      // Not a shell, not a noindex 200. Nothing that looks like a sign-in
      // page may survive the gate.
      expect(result.props).toBeUndefined()
    },
  )

  it.each(MEMBER_ROUTES)(
    '/%s serves the membership page once the site opts in',
    async (route) => {
      mockGetHost.mockResolvedValue({ host: { ...MEMBERS_HOST }, error: null })
      const result: any = await loadPageData('acme', [route])
      expect(result.notFound).toBeUndefined()
      expect(result.props.membershipPage).toBe(route)
    },
  )

  it('an empty deny-list is not consent — still 404', async () => {
    // What a host doc looks like after an admin toggles some OTHER plugin
    // off and back on. It must not be mistaken for opting into member pages.
    mockGetHost.mockResolvedValue({
      host: { ...MARKETING_HOST, disabledPlugins: [] },
      error: null,
    })
    const result: any = await loadPageData('acme', ['signin'])
    expect(result.notFound).toBe(true)
  })

  it('a DESIGNATED auth screen does not smuggle the route back in', async () => {
    // The second way in (AGL-553): `authScreens` renders a besigner-built
    // page at the same address. It is reached from inside the same branch,
    // so a gate placed after the designation lookup would let the prettier
    // sign-in page through while 404ing the plain one.
    mockGetHost.mockResolvedValue({
      host: {
        ...MARKETING_HOST,
        authScreens: { signinScreenId: 'auth-screen' },
      },
      error: null,
    })
    const result: any = await loadPageData('acme', ['signin'])
    expect(result.notFound).toBe(true)
  })

  it('a designated auth screen DOES render once the site opts in', async () => {
    mockGetHost.mockResolvedValue({
      host: {
        ...MEMBERS_HOST,
        authScreens: { signinScreenId: 'auth-screen' },
      },
      error: null,
    })
    const result: any = await loadPageData('acme', ['signin'])
    expect(result.props.membershipPage).toBe('signin')
    expect(result.props.nodes).toBeTruthy()
  })

  it('the site-wide kill switch still wins over a site opt-in', async () => {
    // `release_member_accounts` off platform-wide must close the routes even
    // on a site that asked for them — otherwise the flag is decoration.
    mockGetHost.mockResolvedValue({ host: { ...MEMBERS_HOST }, error: null })
    mockFilter.mockImplementation(async (ids: readonly string[]) =>
      ids.filter((id) => id !== ACCOUNTS_PLUGIN_ID),
    )
    const result: any = await loadPageData('acme', ['signin'])
    expect(result.notFound).toBe(true)
  })

  it('CONTROL — an ordinary page is untouched by the gate', async () => {
    // The regression fence: this change must be invisible to every site
    // that has nothing to do with member accounts.
    const result: any = await loadPageData('acme', [])
    expect(result.notFound).toBeUndefined()
    expect(result.props).toBeDefined()
  })
})
