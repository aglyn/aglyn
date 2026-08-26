/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
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
 * The published 404 screen is what a missing URL serves (AGL-2342).
 *
 * platform's built-in status screen — 0 `<header>`, 0 `<footer>`, 0 occurrences
 * of the site's nav words — while the host's published *"Not found (404)"*
 * screen sat unserved.
 *
 * ## Both halves, because each alone is satisfiable by the bug
 *
 *  1. an unmatched path is a **404** *and* resolves the host's designed screen.
 *     Asserting the body alone would pass a `200`, which is the easy wrong fix
 *     and strictly worse than today: it tells every crawler that a mistyped URL
 *     is a real page. Asserting the status alone is what shipped.
 *  2. a host with **no** designed 404 screen still gets the platform fallback.
 *     A fix that trades a chrome-less page for a blank one is not a fix.
 *
 * ## What the status assertion is guarding against specifically
 *
 * The loader USED to answer the designated-screen case with ordinary `props`
 * and a `200` carrying `noindex` (AGL-87's trade — "SSG can't emit a real 404
 * status"). `loadPageData` must now return `{ notFound: true }` for an
 * unmatched path even when a designed screen is resolvable, and the case below
 * that proves it deliberately makes one resolvable first.
 */

// Factories, not bare `jest.mock`: the loader's module graph reaches
// `@aglyn/tenant-data-admin` → `undici`, and an auto-mock still evaluates the
// real graph to derive its shape.
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: jest.fn() },
  getPlatformLockdown: jest.fn(async () => null),
  filterEnabledPluginsByReleaseFlags: jest.fn(async () => []),
  getRealmPluginInstalls: jest.fn(async () => []),
}))
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL lockdown, bandwidth-cap and abuse-ceiling modules, reached by file
  // path exactly as `template-screen-routing.spec.ts` reaches them. Stubbing
  // them by hand is how this suite first went green for the wrong reason: a
  // missing `normalizeHostLockdown` threw into the loader's catch, which
  // RETURNS `{ notFound: true }` — so the 404-status assertion passed without
  // the routing code ever running. A partial fake of a module the subject calls
  // manufactures the very verdict the subject is supposed to produce.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/lockdown'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/bandwidth-cap'),
  bandwidthCeilingMonthKey: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  ).bandwidthCeilingMonthKey,
  bandwidthCeilingDegradesHost: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  ).bandwidthCeilingDegradesHost,
  // The REAL collection-route parser, for the same reason: this suite's whole
  // subject is which paths reach which branch.
  parseCollectionRoute: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/collection-entries',
  ).parseCollectionRoute,
  // The REAL link-route derivation (AGL-1998), for the same reason again: the
  // designed 404 carries the site's nav, and a stub would let this suite pass
  // while every link on it resolved somewhere else.
  linkableScreenRoutes: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/screen-route',
  ).linkableScreenRoutes,
  // The REAL layout/screen origin test (AGL-1871). A stub here would be the
  // bug: the whole point of the predicate is that it disagrees with
  // `Boolean(nodes)`, and any hand-written double would have to encode that
  // disagreement itself — i.e. manufacture the verdict it is meant to check.
  hasScreenAuthoredNodes: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/compose-layout-nodes',
  ).hasScreenAuthoredNodes,
  SCREEN_ROOT_PATH: '/',
  COLLECTION_LIST_PAGE_SIZE: 10,
  HostScreenVisibility: { AUTHENTICATED: 'authenticated' },
  liveCustomDomain: jest.fn(() => undefined),
  resolveSiteRedirect: jest.fn(async () => null),
  resolveSitePage: jest.fn(async () => undefined),
  runSitePageEnrichers: jest.fn(async () => ({})),
  resolveEnabledPlugins: jest.fn(() => []),
  resolveHostEnabledPlugins: jest.fn(() => []),
  resolveOrgEntitlements: jest.fn(() => ({ features: {} })),
  resolveBrandingProfile: jest.fn(() => ({})),
  checkEntitlement: jest.fn(() => true),
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
  default: jest.fn(),
  composeNodesWithChrome: jest.fn(async () => ({ root: {} })),
}))
jest.mock('@aglyn/tenant-runtime/get-variables', () => ({
  __esModule: true,
  default: jest.fn(async () => ({})),
}))
jest.mock('@aglyn/tenant-runtime/get-screen', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('@aglyn/tenant-runtime/get-collection-content', () => ({
  __esModule: true,
  default: jest.fn(async () => ({
    collection: null,
    entries: [],
    entry: null,
    error: null,
  })),
}))
jest.mock('@aglyn/tenant-runtime/compose-collection-page', () => ({
  __esModule: true,
  composeCollectionTemplatePage: jest.fn(async () => null),
  composeCollectionFallbackPage: jest.fn(async () => null),
}))
jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  default: jest.fn(async () => new Set<string>()),
  // Faithful to the real module's OTHER export (AGL-1998): a double that
  // omits it makes `loadNotFoundScreen`/`page.tsx` throw on an undefined
  // function, and the surrounding try/catch turns that into a silent null.
  getTemplateScreenIds: jest.fn(async () => new Set<string>()),
  getTemplateScreenRouting: jest.fn(async () => ({
    templateScreenIds: new Set<string>(),
    listRoutes: {} as Record<string, string>,
  })),
}))

import composeScreenNodes from '@aglyn/tenant-runtime/compose-screen-nodes'
import getScreen from '@aglyn/tenant-runtime/get-screen'
import { GET as notFoundScreenRoute } from '../app/api/screen/not-found/route'
import {
  loadNotFoundScreen,
  loadPageData,
  resolveNotFoundScreenId,
} from '../app/[host]/[[...slug]]/load-page-data'
import getHost from '../utils/get-host'

const mockGetHost = getHost as jest.Mock
const mockGetScreen = getScreen as jest.Mock
const mockCompose = composeScreenNodes as unknown as jest.Mock

/** The nav and footer a designed 404 screen carries, as composed nodes. */
const DESIGNED_NODES = {
  root: { type: 'muiBox', nodes: ['nav', 'body', 'foot'] },
  nav: { type: 'muiNavMenu' },
  body: { type: 'muiTypography', props: { text: 'We can’t find that page' } },
  foot: { type: 'muiBox', props: { component: 'footer' } },
}

/**
 * The shape production actually has: the 404 screen is PUBLISHED at the path
 * `404` and no `errorScreens` slot is bound. Measured 2026-08-19 —
 * `errorScreens` was unset on all six hosts, which is why reading only that
 * field meant the designed screen had never once been served.
 */
const HOST_WITH_PUBLISHED_404 = {
  $id: 'host-1',
  subdomain: 'acme',
  screens: { home: '/', about: 'about', notFoundScreen: '404' },
}

/**
 * What `aglyn.com` actually composed on 2026-08-23 (AGL-1871).
 *
 * The *"Not found (404)"* screen was routed at `404`, published, and EMPTY —
 * so the compose answered with 297 nodes of which not one came from the
 * screen: layout chrome, the nav grafted onto it, and a `layoutSlot` holding
 * an empty child list. Ids are the real ones off the served payload, because
 * the shape of the id is the only thing that carries the origin.
 *
 * `Boolean(nodes)` is TRUE here. That is the defect in one line: the boundary
 * took this for a designed page, declined its own fallback, and every
 * unmatched URL on the site served a header and a footer around nothing.
 */
const LAYOUT_CHROME_ONLY_NODES = {
  '_@_': {
    $id: '_@_',
    componentId: 'div',
    nodes: ['layout__52Ef-3t6yd', 'layout__XwUE-u-uqi', 'layout__eGo9QQ-Aj-'],
  },
  'layout__52Ef-3t6yd': { $id: 'layout__52Ef-3t6yd', componentId: 'muiBox' },
  'layout__XwUE-u-uqi': {
    $id: 'layout__XwUE-u-uqi',
    componentId: 'layoutSlot',
    nodes: [],
  },
  'layout__eGo9QQ-Aj-': { $id: 'layout__eGo9QQ-Aj-', componentId: 'muiBox' },
  'cmp__layout__52Ef-3t6yd___R91yATrXH': {
    $id: 'cmp__layout__52Ef-3t6yd___R91yATrXH',
    componentId: 'muiNavMenu',
  },
}

/** A site that has designed no error page at all — the fallback's whole job. */
const HOST_WITHOUT_404 = {
  $id: 'host-2',
  subdomain: 'plain',
  screens: { home: '/', about: 'about' },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetHost.mockResolvedValue({ host: HOST_WITH_PUBLISHED_404, error: null })
  mockGetScreen.mockImplementation(async ({ screenId }: any) => ({
    screen: { $id: screenId, displayName: 'Not found (404)' },
    error: null,
  }))
  mockCompose.mockResolvedValue(DESIGNED_NODES)
})

describe('resolveNotFoundScreenId — precedence (AGL-2342)', () => {
  it('reads the routing map when no slot is bound — the production shape', () => {
    expect(resolveNotFoundScreenId(HOST_WITH_PUBLISHED_404)).toBe(
      'notFoundScreen',
    )
  })

  it('prefers a bound errorScreens slot over the routing map', () => {
    expect(
      resolveNotFoundScreenId({
        ...HOST_WITH_PUBLISHED_404,
        errorScreens: { notFound: 'boundScreen' },
      }),
    ).toBe('boundScreen')
  })

  it('still reads the pre-AGL-131 notFoundScreenId field', () => {
    expect(
      resolveNotFoundScreenId({
        ...HOST_WITHOUT_404,
        notFoundScreenId: 'legacyScreen',
      }),
    ).toBe('legacyScreen')
  })

  it('answers undefined for a host that designated nothing', () => {
    expect(resolveNotFoundScreenId(HOST_WITHOUT_404)).toBeUndefined()
  })

  it('answers undefined rather than throwing on a missing host', () => {
    expect(resolveNotFoundScreenId(null)).toBeUndefined()
  })
})

describe('half 1 — an unmatched path is a 404 AND resolves the screen', () => {
  it('keeps the 404 status even though a designed screen is resolvable', async () => {
    // The screen IS resolvable here on purpose: this is the exact state in
    // which the old code returned `props` and a 200.
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const result: any = await loadPageData('acme', ['no-such-page-xyz'])

    expect(result.notFound).toBe(true)
    expect(result.props).toBeUndefined()
    // …and it reached that verdict by ROUTING, not by throwing. The loader's
    // catch also answers `{ notFound: true }`, so without this the assertion
    // above is satisfied by any broken mock in the file.
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('resolves the host’s published 404 screen, nav and footer included', async () => {
    const props = await loadNotFoundScreen('acme')

    expect(props?.nodes).toEqual(DESIGNED_NODES)
    expect((props?.data.screen?.data as any)?.$id).toBe('notFoundScreen')
    // Not the platform's ~11KB status page: a real composed screen carries
    // the site's own nav and footer, so a visitor who mistypes a URL stays
    // inside the site rather than landing on Aglyn's chrome.
    expect(Object.keys(props?.nodes ?? {})).toEqual(
      expect.arrayContaining(['nav', 'foot']),
    )
    expect(mockCompose).toHaveBeenCalledWith(
      expect.objectContaining({ screenId: 'notFoundScreen' }),
    )
  })

  it('serves that screen from /api/screen/not-found with a 200', async () => {
    const response = await notFoundScreenRoute(
      new Request('https://acme.example/api/screen/not-found?host=acme'),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ nodes: DESIGNED_NODES }),
    )
  })

  it('is not paid for on the happy path — a rendered page composes no 404 screen', async () => {
    const result: any = await loadPageData('acme', ['about'])

    // Assert the page RENDERED first. Without this the "no 404 compose"
    // assertion is satisfied by the loader throwing into its catch before it
    // composes anything at all — a green that measures a broken mock.
    expect(result.props).toBeDefined()
    expect(mockCompose).toHaveBeenCalledWith(
      expect.objectContaining({ screenId: 'about' }),
    )
    expect(mockCompose).not.toHaveBeenCalledWith(
      expect.objectContaining({ screenId: 'notFoundScreen' }),
    )
  })
})

describe('half 2 — a host with no 404 screen keeps the platform fallback', () => {
  beforeEach(() => {
    mockGetHost.mockResolvedValue({ host: HOST_WITHOUT_404, error: null })
  })

  it('answers null rather than inventing a screen', async () => {
    await expect(loadNotFoundScreen('plain')).resolves.toBeNull()
  })

  it('answers 404 from the API, which is what selects the fallback', async () => {
    const response = await notFoundScreenRoute(
      new Request('https://plain.example/api/screen/not-found?host=plain'),
    )

    expect(response.status).toBe(404)
  })

  it('answers null when the designated screen no longer resolves', async () => {
    mockGetHost.mockResolvedValue({
      host: HOST_WITH_PUBLISHED_404,
      error: null,
    })
    mockGetScreen.mockResolvedValue({ screen: null, error: null })

    await expect(loadNotFoundScreen('acme')).resolves.toBeNull()
  })

  it('answers null when the screen composes to nothing', async () => {
    mockGetHost.mockResolvedValue({
      host: HOST_WITH_PUBLISHED_404,
      error: null,
    })
    mockCompose.mockResolvedValue(null)

    await expect(loadNotFoundScreen('acme')).resolves.toBeNull()
  })

  it('answers null when the screen composes to LAYOUT CHROME ONLY (AGL-1871)', async () => {
    mockGetHost.mockResolvedValue({
      host: HOST_WITH_PUBLISHED_404,
      error: null,
    })
    mockCompose.mockResolvedValue(LAYOUT_CHROME_ONLY_NODES)

    // The premise, asserted rather than assumed: the compose DID answer, and
    // it answered with a populated map. A null-ish `nodes` here would make the
    // expectation below pass for the old reason.
    expect(Object.keys(LAYOUT_CHROME_ONLY_NODES).length).toBeGreaterThan(1)
    await expect(loadNotFoundScreen('acme')).resolves.toBeNull()
  })

  it('serves 404 from the API for that screen, so the boundary falls back', async () => {
    mockGetHost.mockResolvedValue({
      host: HOST_WITH_PUBLISHED_404,
      error: null,
    })
    mockCompose.mockResolvedValue(LAYOUT_CHROME_ONLY_NODES)

    const response = await notFoundScreenRoute(
      new Request('https://acme.example/api/screen/not-found?host=acme'),
    )

    expect(response.status).toBe(404)
  })

  it('still serves a screen whose OWN nodes sit inside the layout slot', async () => {
    // The guard must key on the node's ORIGIN, not on the tree being small or
    // the slot being the parent — a real designed 404 composes to chrome plus
    // its own nodes, and this is the case that must survive.
    mockGetHost.mockResolvedValue({
      host: HOST_WITH_PUBLISHED_404,
      error: null,
    })
    mockCompose.mockResolvedValue({
      ...LAYOUT_CHROME_ONLY_NODES,
      'layout__XwUE-u-uqi': {
        $id: 'layout__XwUE-u-uqi',
        componentId: 'layoutSlot',
        nodes: ['QBq3zyK1EV'],
      },
      QBq3zyK1EV: {
        $id: 'QBq3zyK1EV',
        componentId: 'muiTypography',
        parentId: 'layout__XwUE-u-uqi',
        props: { text: 'We can’t find that page' },
      },
    })

    const props = await loadNotFoundScreen('acme')

    expect(props?.nodes).toHaveProperty('QBq3zyK1EV')
  })

  it('answers null when the host itself cannot be resolved', async () => {
    mockGetHost.mockResolvedValue({ host: null, error: 'gone' })

    await expect(loadNotFoundScreen('nobody')).resolves.toBeNull()
  })

  it('answers null rather than throwing when compose blows up', async () => {
    mockGetHost.mockResolvedValue({
      host: HOST_WITH_PUBLISHED_404,
      error: null,
    })
    mockCompose.mockRejectedValue(new Error('compose exploded'))
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    await expect(loadNotFoundScreen('acme')).resolves.toBeNull()

    consoleError.mockRestore()
  })

  it('refuses a request with no host rather than guessing one', async () => {
    const response = await notFoundScreenRoute(
      new Request('https://plain.example/api/screen/not-found'),
    )

    expect(response.status).toBe(400)
  })
})
