/**
 * @jest-environment node
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
 * AGL-4049 · `claimHostForOrg` creates a site from a picked starter, and
 * every other create writes exactly what it wrote before.
 *
 * The default and the guided-start creates are pinned BYTE FOR BYTE: every
 * `tx.set` the claim transaction makes, its path, its data with key order,
 * and its options, serialized and compared whole. The expected writes are the
 * documents `defaultSiteWrites` builds and the host document the create has
 * always written, so a starter branch that leaked one field, reordered one
 * key, or minted one id more into the default path fails here. (This spec
 * was run green against `provision-host.ts` as it stood before the starter
 * branch, then against the branch.)
 *
 * A picked starter writes its pages, its layout and its theme in the same
 * transaction, routes every published page and names its Home the
 * placeholder.
 */

import { DEFAULT_SITE_THEME, defaultSiteSeo } from '@aglyn/aglyn/app-utils/default-site'

let mockUid = 0
const mockNextUid = () => `uid-${++mockUid}`
const mockRegisterOrgHost = jest.fn(async () => undefined)

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    firestore: { FieldValue: { serverTimestamp: () => 'ts', delete: () => 'delete' } },
  },
  registerOrgHost: () => mockRegisterOrgHost(),
}))
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ACCOUNTS_PLUGIN_ID: 'accounts',
  checkQuota: () => ({ allowed: true, limit: 25, remaining: 25 }),
  createResourceUid: () => mockNextUid(),
  suggestSubdomains: () => [],
}))
jest.mock('@aglyn/aglyn/app-utils/create-resource-uid', () => ({
  __esModule: true,
  createResourceUid: () => mockNextUid(),
  default: () => mockNextUid(),
}))

const {
  claimHostForOrg,
  defaultSiteWrites,
  NEW_SITE_ENABLED_PLUGINS,
} = require('../utils/server/provision-host') as typeof import('../utils/server/provision-host')

type Write = [string, unknown] | [string, unknown, unknown]

/** A document reference that knows its path, nesting as Firestore's do. */
function ref(path: string): Record<string, unknown> {
  return {
    path,
    id: path.split('/').pop(),
    collection: (sub: string) => ({ doc: (id: string) => ref(`${path}/${sub}/${id}`) }),
  }
}

/** A Firestore whose create transaction records every `set`, in order. */
function recordingFirestore(writes: Write[]) {
  return {
    collection: (name: string) => ({
      doc: (id: string) => ref(`${name}/${id}`),
      where: () => ({
        count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
        // The in-transaction subdomain re-read: a query, so no `path`.
        limit: () => ({}),
      }),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        get: async (target: { path?: string }) =>
          target?.path
            ? { get: () => undefined, data: () => ({ plan: 'business' }) }
            : { docs: [] },
        set: (target: { path: string }, data: unknown, options?: unknown) => {
          writes.push(options === undefined ? [target.path, data] : [target.path, data, options])
        },
      }),
  }
}

async function claim(starter: unknown): Promise<{ writes: Write[]; hostId: string }> {
  const writes: Write[] = []
  mockUid = 0
  const result = await claimHostForOrg({
    firestore: recordingFirestore(writes) as never,
    orgId: 'org-1',
    displayName: 'Royal Styles',
    subdomain: 'royal-styles',
    ...(starter === undefined ? {} : { starter: starter as never }),
  })
  expect(result).toEqual({ allowed: true, hostId: 'uid-1' })
  return { writes, hostId: 'uid-1' }
}

/** The host document a create has always written, key order included. */
function defaultHostDoc(routed: boolean, homeId: string) {
  return {
    displayName: 'Royal Styles',
    subdomain: 'royal-styles',
    orgId: 'org-1',
    screens: routed ? { [homeId]: '/' } : {},
    ...(routed ? { defaultHomeScreenId: homeId } : {}),
    theme: DEFAULT_SITE_THEME,
    seo: defaultSiteSeo('Royal Styles'),
    enabledPlugins: [...NEW_SITE_ENABLED_PLUGINS],
    suspended: false,
    createdAt: 'ts',
    updatedAt: 'ts',
  }
}

const ORG_CLAIM: Write = [
  'orgs/org-1',
  { hosts: { 'uid-1': true }, updatedAt: 'ts' },
  { merge: true },
]

/** The default site's documents with the ids the claim minted after the host's. */
function expectedDefaultWrites(): Write[] {
  mockUid = 1
  const home = defaultSiteWrites('Royal Styles')
  expect(home.screenId).toBe('uid-2')
  return [
    ['hosts/uid-1', defaultHostDoc(true, home.screenId)],
    [`hosts/uid-1/screens/${home.screenId}`, home.screen],
    [`hosts/uid-1/screens/${home.screenId}/versions/${home.versionId}`, home.version],
    [`hosts/uid-1/layouts/${home.layoutId}`, home.layout],
    [
      `hosts/uid-1/layouts/${home.layoutId}/versions/${home.layoutVersionId}`,
      { ...home.layoutVersion, hostId: 'uid-1' },
    ],
    ORG_CLAIM,
  ]
}

const bytes = (writes: Write[]) => JSON.stringify(writes)

describe('claimHostForOrg: the default and guided creates are unchanged, byte for byte', () => {
  it('with no `starter`, writes the default site exactly as before', async () => {
    const { writes } = await claim(undefined)
    expect(bytes(writes)).toBe(bytes(expectedDefaultWrites()))
  })

  it('with `starter: true`, the same bytes', async () => {
    const { writes } = await claim(true)
    expect(bytes(writes)).toBe(bytes(expectedDefaultWrites()))
  })

  it('with `starter: false` (the guided start), the host and the claim and nothing else', async () => {
    const { writes } = await claim(false)
    expect(bytes(writes)).toBe(bytes([['hosts/uid-1', defaultHostDoc(false, '')], ORG_CLAIM]))
  })
})

describe('claimHostForOrg: Start in preview (AGL-4086)', () => {
  it('writes `preview: true` on a site born in preview, beside its identity', async () => {
    const writes: Write[] = []
    mockUid = 0
    await claimHostForOrg({
      firestore: recordingFirestore(writes) as never,
      orgId: 'org-1',
      displayName: 'Royal Styles',
      subdomain: 'royal-styles',
      preview: true,
    })
    const host = writes.find(([path]) => path === 'hosts/uid-1')?.[1] as Record<string, unknown>
    expect(host['preview']).toBe(true)
    // Nothing else about the site changes: it is the default site, in preview.
    const { preview, ...rest } = host
    expect(preview).toBe(true)
    mockUid = 1
    expect(rest).toEqual(defaultHostDoc(true, defaultSiteWrites('Royal Styles').screenId))
  })

  it('writes no `preview` key at all for a public site', async () => {
    const { writes } = await claim(undefined)
    const host = writes.find(([path]) => path === 'hosts/uid-1')?.[1] as Record<string, unknown>
    expect('preview' in host).toBe(false)
  })
})

describe('claimHostForOrg: a picked starter (AGL-4049)', () => {
  const layoutNodes = {
    'canvas-root': { componentId: 'box', props: {}, nodes: ['brand', 'slot'] },
    brand: { componentId: 'link', props: { screenSlug: '/', children: '{{host.businessName}}' } },
    slot: { componentId: 'layoutSlot', props: {} },
  }
  const install = (theme: unknown) => ({
    payload: {
      mode: 'base',
      facets: { kind: null, base: 'starter', fonts: null, pages: 3, mode: 'base' },
      theme,
      screens: [
        { displayName: 'Home', slug: '/', seo: { title: 'Home' }, nodes: { a: { componentId: 'text', props: {} } } },
        { displayName: 'About', slug: 'about', nodes: { b: { componentId: 'link', props: { screenSlug: '/' } } } },
        { displayName: 'Draft', slug: 'draft', published: false, nodes: {} },
      ],
      layout: { displayName: 'Header and footer', nodes: layoutNodes, props: [] },
    },
    listing: { listingId: 'listing-1', version: 'latest', displayName: 'Starter' },
  })

  it('writes every page, the layout and the host in the one transaction, routing the published pages', async () => {
    const { writes } = await claim(
      install({ kind: 'builtin', base: 'starter', brand: { light: { primary: '#00aa44' } }, fonts: null }),
    )
    // Ids: the host, three pages and their versions, the layout and its version.
    expect(writes.map(([path]) => path)).toEqual([
      'hosts/uid-1',
      'hosts/uid-1/screens/uid-2',
      'hosts/uid-1/screens/uid-2/versions/uid-3',
      'hosts/uid-1/screens/uid-4',
      'hosts/uid-1/screens/uid-4/versions/uid-5',
      'hosts/uid-1/screens/uid-6',
      'hosts/uid-1/screens/uid-6/versions/uid-7',
      'hosts/uid-1/layouts/uid-8',
      'hosts/uid-1/layouts/uid-8/versions/uid-9',
      'orgs/org-1',
    ])
    const host = writes[0][1] as Record<string, unknown>
    expect(host['screens']).toEqual({ 'uid-2': '/', 'uid-4': 'about' })
    expect(host['defaultHomeScreenId']).toBe('uid-2')
    expect(host['theme']).toEqual(DEFAULT_SITE_THEME)
    expect(host['themeOverride']).toMatchObject({ baseSha256: null })
    expect(host['seo']).toEqual(defaultSiteSeo('Royal Styles'))
    expect(host).toMatchObject({
      displayName: 'Royal Styles',
      subdomain: 'royal-styles',
      orgId: 'org-1',
      enabledPlugins: [...NEW_SITE_ENABLED_PLUGINS],
      suspended: false,
    })
    // Every page sits in the starter's layout; the draft is neither routed nor published.
    for (const [path, data] of writes.slice(1, 7)) {
      if (!path.includes('/versions/')) expect(data).toMatchObject({ layoutId: 'uid-8' })
    }
    expect(writes[5][1]).not.toHaveProperty('publishedAt')
    expect(writes[5][1]).not.toHaveProperty('slug')
    expect(writes[1][1]).toHaveProperty('publishedAt')
    expect(writes[8][1]).toMatchObject({ layoutId: 'uid-8', hostId: 'uid-1' })
  })

  it('files a full theme in the library in the same transaction', async () => {
    const { writes } = await claim(
      install({ kind: 'full', theme: { colorSchemes: { light: { primary: { main: '#123456' } } } } }),
    )
    expect(writes.map(([path]) => path)).toContain('hosts/uid-1/themes/installed--listing-1')
    const host = writes[0][1] as Record<string, unknown>
    expect(host['themeSelection']).toEqual({
      kind: 'installed',
      id: 'installed--listing-1',
      name: 'Starter theme',
    })
    expect(host['themeInstalledFrom']).toEqual({
      listingId: 'listing-1',
      version: 'latest',
      artifactType: 'siteStarter',
    })
    expect(writes[writes.length - 1]).toEqual(ORG_CLAIM)
  })
})
