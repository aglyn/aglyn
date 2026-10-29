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

import { DEFAULT_SITE_THEME } from '@aglyn/aglyn/app-utils/default-site'
import type { SiteStarterPayload } from '@aglyn/aglyn/app-utils/site-starter'
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { THEME_FIELD_DELETE } from '@aglyn/aglyn/app-utils/theme-library'
import {
  queueSiteStarterWrites,
  readSiteStarterChoice,
  siteStarterPickRefusal,
  siteStarterWrites,
  type SiteStarterInstall,
} from './provision-starter'

/**
 * AGL-4049 · the documents a site created from a starter is born with.
 *
 * Emulator-free: a recording transaction double, the
 * `host-create-rate-limit.spec.ts` pattern. What is held: the write paths in
 * order, the routing map and the draft's absence from it, the page links
 * turned from slugs back into the new pages' ids, and each theme shape's host
 * fields and library entries.
 */

let mockUid = 0
jest.mock('@aglyn/aglyn/app-utils/create-resource-uid', () => ({
  __esModule: true,
  createResourceUid: () => `uid-${++mockUid}`,
  default: () => `uid-${++mockUid}`,
}))
const mockPresets: Array<{ id: string; name: string; theme: Record<string, unknown> }> = []
jest.mock('@aglyn/aglyn/plugin-manager/plugin-theme-presets', () => ({
  __esModule: true,
  listServerThemePresets: () => mockPresets,
}))

const BOOTSTRAP = {
  id: 'theme-presets.bootstrap',
  name: 'Bootstrap',
  theme: {
    colorSchemes: {
      light: {
        primary: { main: '#0d6efd', dark: '#0a58ca', contrastText: '#ffffff' },
        error: { main: '#dc3545' },
      },
    },
    shape: { borderRadius: 6 },
  },
}

const HOME_NODES = {
  'canvas-root': { componentId: 'box', props: {}, nodes: ['cta', 'lost'] },
  cta: { componentId: 'button', props: { screenSlug: 'about', children: 'About us' } },
  lost: { componentId: 'button', props: { screenSlug: 'nowhere' } },
}
const LAYOUT_NODES = {
  'canvas-root': { componentId: 'box', props: {}, nodes: ['brand', 'slot'] },
  brand: { componentId: 'link', props: { screenSlug: '/', children: '{{host.businessName}}' } },
  slot: { componentId: 'layoutSlot', props: {} },
}

function payload(overrides: Partial<SiteStarterPayload> = {}): SiteStarterPayload {
  return {
    mode: 'base',
    facets: { kind: null, base: 'starter', fonts: null, pages: 3, mode: 'base' },
    theme: { kind: 'builtin', base: 'starter', brand: { light: {} }, fonts: null },
    screens: [
      { displayName: 'Home', slug: '/', seo: { title: 'Home' }, nodes: HOME_NODES },
      {
        displayName: 'About',
        slug: 'about',
        description: 'Who we are',
        nodes: { link: { componentId: 'link', props: { screenSlug: 'plans' } } },
      },
      { displayName: 'Plans', slug: 'plans', published: false, nodes: {} },
    ],
    layout: { displayName: 'Header and footer', nodes: LAYOUT_NODES, props: [] },
    ...overrides,
  }
}

const install = (overrides: Partial<SiteStarterPayload> = {}): SiteStarterInstall => ({
  payload: payload(overrides),
  listing: { listingId: 'listing-1', version: '3', displayName: 'Bakery' },
})

/** A document reference that knows its path. */
function ref(path: string): any {
  return {
    path,
    collection: (sub: string) => ({ doc: (id: string) => ref(`${path}/${sub}/${id}`) }),
  }
}

function queue(writes: ReturnType<typeof siteStarterWrites>) {
  const sets: Array<[string, Record<string, any>]> = []
  const tx = { set: (target: { path: string }, data: Record<string, any>) => void sets.push([target.path, data]) }
  queueSiteStarterWrites(tx as never, ref('hosts/host-1'), 'host-1', writes)
  return sets
}

beforeEach(() => {
  mockUid = 0
  mockPresets.length = 0
})

describe('siteStarterWrites (AGL-4049)', () => {
  it('mints the pages first, then the layout, and routes every published page', () => {
    const writes = siteStarterWrites(install())
    expect(writes.screens.map((page) => [page.id, page.versionId])).toEqual([
      ['uid-1', 'uid-2'],
      ['uid-3', 'uid-4'],
      ['uid-5', 'uid-6'],
    ])
    expect(writes.layout).toMatchObject({ id: 'uid-7', versionId: 'uid-8' })
    expect(writes.routing).toEqual({ 'uid-1': '/', 'uid-3': 'about' })
    expect(writes.homeScreenId).toBe('uid-1')
  })

  it('writes a published page as the default Home is written, and a draft without an address', () => {
    const [home, about, plans] = siteStarterWrites(install()).screens
    expect(home.screen).toMatchObject({
      displayName: 'Home',
      slug: '/',
      versionId: 'uid-2',
      layoutId: 'uid-7',
      seo: { title: 'Home' },
      deletedAt: null,
    })
    expect(home.screen).toHaveProperty('publishedAt')
    expect(about.screen).toMatchObject({ slug: 'about', description: 'Who we are' })
    expect(plans.screen).toMatchObject({ displayName: 'Plans', layoutId: 'uid-7' })
    expect(plans.screen).not.toHaveProperty('slug')
    expect(plans.screen).not.toHaveProperty('publishedAt')
    expect(home.version).toMatchObject({ screenId: 'uid-1', displayName: 'Initial version' })
  })

  it('turns every page link back into the new page id, and drops a slug no page has', () => {
    const writes = siteStarterWrites(install())
    const homeNodes = decodeStoredNodes(writes.screens[0].version['nodes'])
    expect(homeNodes?.['cta'].props).toEqual({ screenId: 'uid-3', children: 'About us' })
    expect(homeNodes?.['lost'].props).toEqual({})
    // A link to a draft names the draft: it is a page of the site, unpublished.
    expect(decodeStoredNodes(writes.screens[1].version['nodes'])?.['link'].props).toEqual({ screenId: 'uid-5' })
    // The brand link in the header goes to the new Home; tokens are copied as published.
    const layoutNodes = decodeStoredNodes(writes.layout.version['nodes'])
    expect(layoutNodes?.['brand'].props).toEqual({ screenId: 'uid-1', children: '{{host.businessName}}' })
    expect(layoutNodes?.['slot']).toEqual(LAYOUT_NODES.slot)
  })

  it('stores nodes msgpack at rest', () => {
    const writes = siteStarterWrites(install())
    expect(Buffer.isBuffer(writes.screens[0].version['nodes'])).toBe(true)
    expect(Buffer.isBuffer(writes.layout.version['nodes'])).toBe(true)
  })

  it('the first page to claim an address keeps it', () => {
    const writes = siteStarterWrites(
      install({
        screens: [
          { displayName: 'Home', slug: '/', nodes: {} },
          { displayName: 'Another home', slug: '/', nodes: {} },
        ],
      }),
    )
    expect(writes.routing).toEqual({ 'uid-1': '/' })
    expect(writes.screens[1].screen).not.toHaveProperty('slug')
  })

  it("carries the layout's properties onto its version, only when it has some", () => {
    expect(siteStarterWrites(install()).layout.version).not.toHaveProperty('props')
    const props = [{ key: 'tagline', type: 'string' }]
    const writes = siteStarterWrites(install({ layout: { displayName: 'Chrome', nodes: LAYOUT_NODES, props } }))
    expect(writes.layout.version['props']).toEqual(props)
    expect(writes.layout.layout).toMatchObject({ displayName: 'Chrome', deletedAt: null })
  })
})

describe('the theme shapes on the new host', () => {
  const noDeletes = (fields: Record<string, unknown>) =>
    expect(Object.values(fields)).not.toContain(THEME_FIELD_DELETE)

  it('the starter base: the theme every site is born with, the brand as its override, no entry', () => {
    const plain = siteStarterWrites(install())
    expect(plain.host).toEqual({ theme: DEFAULT_SITE_THEME })
    expect(plain.themeEntries).toEqual([])

    const branded = siteStarterWrites(
      install({ theme: { kind: 'builtin', base: 'starter', brand: { light: { primary: '#00aa44' } }, fonts: null } }),
    )
    expect(branded.host['theme']).toEqual(DEFAULT_SITE_THEME)
    expect(branded.host['themeOverride']).toMatchObject({ baseSha256: null })
    expect(branded.themeEntries).toEqual([])
    noDeletes(branded.host)
  })

  it('a built-in the deployment has: picked as a preset, with the brand as its override', () => {
    mockPresets.push(BOOTSTRAP)
    const writes = siteStarterWrites(
      install({ theme: { kind: 'builtin', base: 'bootstrap', brand: { light: { primary: '#00aa44' } }, fonts: null } }),
    )
    expect(writes.host['theme']).toEqual(BOOTSTRAP.theme)
    expect(writes.host['themeSelection']).toEqual({
      kind: 'preset',
      id: 'preset--theme-presets.bootstrap',
      name: 'Bootstrap',
    })
    expect(writes.host['themeOverride']).toMatchObject({ baseSha256: null })
    expect(writes.themeEntries).toEqual([])
    noDeletes(writes.host)
  })

  it('a full theme: installed into the library as a marketplace theme is, created in the same queue', () => {
    const theme = { colorSchemes: { light: { primary: { main: '#123456' } } } }
    const writes = siteStarterWrites(install({ theme: { kind: 'full', theme } }))
    expect(writes.host).toMatchObject({
      theme,
      themeSelection: { kind: 'installed', id: 'installed--listing-1', name: 'Bakery theme' },
      themeInstalledFrom: { listingId: 'listing-1', version: '3', artifactType: 'siteStarter' },
    })
    noDeletes(writes.host)
    // An empty host plans only creates.
    expect(writes.themeEntries.map((entry) => entry.op)).toEqual(['create'])

    const sets = queue(writes)
    const entry = sets.find(([path]) => path === 'hosts/host-1/themes/installed--listing-1')
    expect(entry?.[1]).toMatchObject({ kind: 'installed', name: 'Bakery theme', theme })
    expect(entry?.[1]).toHaveProperty('createdAt')
    expect(entry?.[1]).toHaveProperty('updatedAt')
  })
})

describe('queueSiteStarterWrites', () => {
  it('sets every page and version, then the layout and its version with the host id', () => {
    const sets = queue(siteStarterWrites(install()))
    expect(sets.map(([path]) => path)).toEqual([
      'hosts/host-1/screens/uid-1',
      'hosts/host-1/screens/uid-1/versions/uid-2',
      'hosts/host-1/screens/uid-3',
      'hosts/host-1/screens/uid-3/versions/uid-4',
      'hosts/host-1/screens/uid-5',
      'hosts/host-1/screens/uid-5/versions/uid-6',
      'hosts/host-1/layouts/uid-7',
      'hosts/host-1/layouts/uid-7/versions/uid-8',
    ])
    expect(sets[7][1]).toMatchObject({ layoutId: 'uid-7', hostId: 'host-1' })
  })
})

describe('readSiteStarterChoice', () => {
  it('reads a listing id and an optional pinned version', () => {
    expect(readSiteStarterChoice({ listingId: 'fp-starter-default' })).toEqual({ listingId: 'fp-starter-default' })
    expect(readSiteStarterChoice({ listingId: ' abc123 ', version: 4 })).toEqual({ listingId: 'abc123', version: '4' })
    expect(readSiteStarterChoice({ listingId: 'abc123', version: '12' })).toEqual({ listingId: 'abc123', version: '12' })
  })

  it('refuses anything that is not a pick, or could name another document', () => {
    for (const value of [
      'abc',
      [],
      {},
      { listingId: '' },
      { listingId: 7 },
      { listingId: 'a/b' },
      { listingId: '..' },
      { listingId: '__name__' },
      { listingId: 'x'.repeat(129) },
      { listingId: 'abc', version: '0' },
      { listingId: 'abc', version: '1/versions' },
      { listingId: 'abc', version: 1.5 },
    ]) {
      expect(readSiteStarterChoice(value)).toBeNull()
    }
  })
})

describe('siteStarterPickRefusal', () => {
  const allowed = { listingId: 'listing-1', pagesAllowed: 5 }

  it('passes a source refusal on with its status, a 402 with what buying it needs', () => {
    expect(siteStarterPickRefusal({ error: 'Purchase required', status: 402, priceUsd: 29 }, allowed)).toEqual({
      status: 402,
      body: { error: 'Purchase required', code: 'purchase_required', listingId: 'listing-1', priceUsd: 29 },
    })
    expect(siteStarterPickRefusal({ error: 'Starter not found', status: 404 }, allowed)).toEqual({
      status: 404,
      body: { error: 'Starter not found', listingId: 'listing-1' },
    })
  })

  it('refuses an AI starter until the AI start takes one, naming the pick', () => {
    expect(siteStarterPickRefusal(payload({ mode: 'ai', answers: {} }), allowed)).toEqual({
      status: 409,
      body: { error: 'This starter needs the AI start, which is coming soon', listingId: 'listing-1' },
    })
  })

  it("refuses more pages than the plan includes, and passes as many as it includes", () => {
    const six = payload({ screens: Array.from({ length: 6 }, (_, i) => ({ slug: i ? `p${i}` : '/', nodes: {} })) })
    expect(siteStarterPickRefusal(six, allowed)).toEqual({
      status: 403,
      body: {
        error: 'This starter has 6 pages; your plan includes 5. Pick a smaller starter or upgrade in Billing.',
        listingId: 'listing-1',
      },
    })
    expect(siteStarterPickRefusal(payload({ screens: six.screens.slice(0, 5) }), allowed)).toBeNull()
    expect(siteStarterPickRefusal(payload(), allowed)).toBeNull()
  })
})
