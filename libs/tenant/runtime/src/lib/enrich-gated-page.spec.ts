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
 * The enricher slice for a page whose nodes are withheld until a gate opens
 * (AGL-2510) — a password-protected screen and a members-only one.
 *
 * The path assertion is the load-bearing one. Both callers are POST endpoints
 * a visitor controls, so the path comes from the host's own routing map; a
 * path taken from the request body would let anyone choose which overlays and
 * path-scoped automations a gated page runs.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  getHostDocAdmin: jest.fn(),
  getOrgForHost: jest.fn(async () => ({ orgId: 'org-1', org: { $id: 'org-1' } })),
}))
// The entry-link reads (AGL-3118): their own suite covers what they read.
jest.mock('./entry-link-routes', () => ({
  __esModule: true,
  resolveEntryLinkRoutes: jest.fn(async () => ({})),
}))
jest.mock('./template-screens', () => ({
  __esModule: true,
  getTemplateScreenRouting: jest.fn(async () => ({
    templateScreenIds: new Set<string>(),
    listRoutes: {},
    collectionListings: { blog: 'blog' },
  })),
}))

import {
  registerSitePageEnricher,
  setRegisteringPluginId,
  type SitePageContext,
} from '@aglyn/aglyn/server'
import { getHostDocAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { enrichGatedScreenPage } from './enrich-gated-page'
import { resolveEntryLinkRoutes } from './entry-link-routes'
import { getTemplateScreenRouting } from './template-screens'

const mockHostDoc = getHostDocAdmin as unknown as jest.Mock
const mockOrgForHost = getOrgForHost as unknown as jest.Mock
const mockEntryRoutes = resolveEntryLinkRoutes as unknown as jest.Mock
const mockRouting = getTemplateScreenRouting as unknown as jest.Mock

const SLICE = { clientAutomations: [{ id: 'a1' }] }
const NODES = { root: { pluginId: 'mui' } }

const seen: SitePageContext[] = []

setRegisteringPluginId('marketing')
registerSitePageEnricher(async (context) => {
  seen.push(context)
  return SLICE
})
setRegisteringPluginId(undefined)

beforeEach(() => {
  jest.clearAllMocks()
  seen.length = 0
  mockHostDoc.mockResolvedValue({
    $id: 'host-1',
    screens: { home: '/', 'members-only': 'members/vault' },
  })
  mockOrgForHost.mockResolvedValue({ orgId: 'org-1', org: { $id: 'org-1' } })
})

describe('enrichGatedScreenPage (AGL-2510)', () => {
  it('returns the enricher slice for the gated tree', async () => {
    const props = await enrichGatedScreenPage({
      hostId: 'host-1',
      screenId: 'members-only',
      screen: { $id: 'members-only' },
      nodes: NODES,
    })

    expect(props).toEqual(SLICE)
    expect(seen[0].nodes).toEqual(NODES)
    expect(seen[0].screenId).toBe('members-only')
  })

  it('takes the path from the host’s routing map', async () => {
    await enrichGatedScreenPage({
      hostId: 'host-1',
      screenId: 'members-only',
      screen: {},
      nodes: NODES,
    })

    expect(seen[0].path).toBe('members/vault')
    expect(seen[0].slugSegments).toEqual(['members', 'vault'])
  })

  it('falls back to the site root for a screen the map does not name', async () => {
    await enrichGatedScreenPage({
      hostId: 'host-1',
      screenId: 'never-routed',
      screen: {},
      nodes: NODES,
    })

    expect(seen[0].path).toBe('/')
  })

  it('fails open — a read that throws costs behavior, never the content', async () => {
    mockHostDoc.mockRejectedValue(new Error('firestore down'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const props = await enrichGatedScreenPage({
      hostId: 'host-1',
      screenId: 'members-only',
      screen: {},
      nodes: NODES,
    })

    expect(props).toEqual({})
    spy.mockRestore()
  })

  /**
   * Both gated routes read the site document to compose the tree, so its host
   * variables fill in (AGL-2883), and hand that copy on rather than paying for
   * the same document twice.
   */
  it('works from the site document its caller already read', async () => {
    const host = { $id: 'host-1', screens: { 'members-only': 'club/lounge' } }

    await enrichGatedScreenPage({
      hostId: 'host-1',
      screenId: 'members-only',
      screen: {},
      nodes: NODES,
      host,
    })

    expect(mockHostDoc).not.toHaveBeenCalled()
    expect(seen[0].host).toBe(host)
    expect(seen[0].path).toBe('club/lounge')
  })
})

/**
 * The page's routing map was built before the gate opened, from no tree at
 * all, so the entries a gated page links to have to arrive with its nodes
 * (AGL-3118) — and a tree that links none must cost nothing.
 */
describe('the entry links of a gated tree (AGL-3118)', () => {
  const LINKED = {
    root: { props: {} },
    cta: { props: { href: 'entry:blog/e1', children: 'Members post' } },
    md: { props: { content: 'See [the draft](entry:blog/e2).' } },
  }

  it('carries where each linked entry is served, beside the slice', async () => {
    mockEntryRoutes.mockResolvedValueOnce({ 'entry:blog/e1': 'blog/members' })

    const props = await enrichGatedScreenPage({
      hostId: 'host-1',
      screenId: 'members-only',
      screen: {},
      nodes: LINKED,
    })

    expect(mockEntryRoutes).toHaveBeenCalledWith({
      hostId: 'host-1',
      refs: ['entry:blog/e1', 'entry:blog/e2'],
      collectionSlugs: { blog: 'blog' },
    })
    expect(props).toEqual({
      ...SLICE,
      entryRoutes: { 'entry:blog/e1': 'blog/members' },
    })
  })

  it('reads nothing for a tree that links no entry', async () => {
    const props = await enrichGatedScreenPage({
      hostId: 'host-1',
      screenId: 'members-only',
      screen: {},
      nodes: NODES,
    })

    expect(mockRouting).not.toHaveBeenCalled()
    expect(mockEntryRoutes).not.toHaveBeenCalled()
    expect(props).toEqual(SLICE)
  })

  it('adds nothing when none of the linked entries is live', async () => {
    const props = await enrichGatedScreenPage({
      hostId: 'host-1',
      screenId: 'members-only',
      screen: {},
      nodes: LINKED,
    })

    expect(mockEntryRoutes).toHaveBeenCalled()
    expect(props).toEqual(SLICE)
  })
})
