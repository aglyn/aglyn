/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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
 * A page job's screen draft (AGL-2907), against a Firestore double that
 * honors transactions, projections, `create`'s refusal of a document that
 * exists and `update`'s dotted paths. The screen count is core's REAL
 * `billableScreenIds` and the route lookup core's REAL
 * `findScreenIdByRoutePath`; only the host index read is stubbed.
 *
 *  - SERVES NOTHING UNTIL A MEMBER PUBLISHES IT. The draft's writes are the
 *    screen and its first version, and nothing else: the host document and
 *    its routing map read back unchanged, so no address resolves to the
 *    draft. Applying the member's publish, as `publishScreenRoute` writes it,
 *    is what makes its address resolve.
 *  - COUNTED LIKE A CREATE, with the route's arithmetic: an unrouted screen
 *    spends the allowance too.
 *  - A PASS ADDS TO WHAT IS STORED, stamped for the besigner's save guard,
 *    and the listing fills only what a member left empty.
 */

const mockDocs = new Map<string, Record<string, unknown>>()
const mockOwners = new Map<string, string>()

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => mockOwners.get(hostId) ?? null,
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findScreenIdByRoutePath } from '@aglyn/aglyn/app-utils/screen-route'
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import {
  AI_DRAFT_FIELDS,
  AI_DRAFT_SCREEN_VERSION_FIELDS,
  AI_DRAFT_VERSION_NAME,
  aiDraftAdmissionRefusal,
  aiDraftAllowanceRefusal,
  aiDraftScreenSlug,
  readAiDraft,
  readAiDraftNodes,
  updateAiDraftNodes,
  writeAiDraft,
  writeAiDraftScreenSeo,
  type AiDraftInput,
} from './ai-job-drafts'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const NOW = new Date('2026-09-15T22:00:00.000Z')
const LATER = new Date('2026-09-15T22:01:00.000Z')
/** A workspace with no plan resolves as Free. */
const FREE_ORG: Partial<AglynOrgBilling> = {}
const STARTER_ORG: Partial<AglynOrgBilling> = { plan: 'starter', billingStatus: 'active' }

function valueAt(data: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      data,
    )
}

function snapshotOf(path: string) {
  const data = mockDocs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ? valueAt(data, field) : undefined),
  }
}

type DocTarget = { kind: 'doc'; path: string }
type QueryTarget = { kind: 'query'; get: () => Promise<{ docs: Array<ReturnType<typeof snapshotOf>> }> }

function docRef(path: string): Record<string, unknown> {
  return {
    kind: 'doc',
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshotOf(path),
  }
}

function collectionRef(path: string): Record<string, unknown> {
  const query: QueryTarget = {
    kind: 'query',
    get: async () => ({
      docs: [...mockDocs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .sort()
        .map(snapshotOf),
    }),
  }
  return { path, doc: (id: string) => docRef(`${path}/${id}`), select: () => query, get: query.get }
}

function setAt(data: Record<string, unknown>, dotted: string, value: unknown) {
  const keys = dotted.split('.')
  let cursor = data
  for (const key of keys.slice(0, -1)) {
    cursor[key] = { ...((cursor[key] as Record<string, unknown>) ?? {}) }
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[keys[keys.length - 1]] = value
}

/** The paths the double committed, in the order it committed them. */
let commits: string[] = []

const firestore = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const writes: Array<() => void> = []
    const result = await fn({
      get: async (target: DocTarget | QueryTarget) =>
        target.kind === 'query' ? target.get() : snapshotOf(target.path),
      create: (ref: DocTarget, data: Record<string, unknown>) =>
        writes.push(() => {
          if (mockDocs.has(ref.path)) throw new Error(`6 ALREADY_EXISTS: ${ref.path}`)
          mockDocs.set(ref.path, data)
          commits.push(ref.path)
        }),
      update: (ref: DocTarget, patch: Record<string, unknown>) =>
        writes.push(() => {
          const current = mockDocs.get(ref.path)
          if (!current) throw new Error(`5 NOT_FOUND: ${ref.path}`)
          const next = { ...current }
          for (const [key, value] of Object.entries(patch)) setAt(next, key, value)
          mockDocs.set(ref.path, next)
          commits.push(ref.path)
        }),
    })
    for (const write of writes) write()
    return result
  },
} as unknown as FirebaseFirestore.Firestore

const NODES = {
  [CANVAS_ROOT_ELEMENT_ID]: { $id: CANVAS_ROOT_ELEMENT_ID, componentId: 'div', parentId: null, nodes: ['s1'] },
  s1: { $id: 's1', componentId: 'section', parentId: CANVAS_ROOT_ELEMENT_ID, props: { element: 'section' }, nodes: [] },
} as unknown as NodesMap

function screenInput(patch: Partial<AiDraftInput> = {}): AiDraftInput {
  return {
    kind: 'screen',
    hostId: 'host-1',
    id: 'job-page',
    uid: 'uid-1',
    org: STARTER_ORG,
    name: 'Pricing',
    nodes: NODES,
    slug: 'pricing',
    layoutId: 'lay-site',
    now: NOW,
    ...patch,
  }
}

/** A live site: a routing map, pages published at their addresses, and every pointer a tenant render follows. */
function seedLiveSite() {
  mockOwners.set('host-1', 'org-1')
  mockDocs.set('hosts/host-1', {
    subdomain: 'acme',
    screens: { 'scr-home': '/', 'scr-about': 'about', 'scr-post': 'blog-post' },
    builtInPageLayoutId: 'lay-site',
    authorScreenId: 'scr-author',
  })
  mockDocs.set('hosts/host-1/screens/scr-home', { displayName: 'Home', slug: '/', versionId: 'v-home', publishedAt: NOW })
  mockDocs.set('hosts/host-1/screens/scr-home/versions/v-home', { screenId: 'scr-home', layoutId: 'lay-site' })
  mockDocs.set('hosts/host-1/screens/scr-about', { displayName: 'About', slug: 'about', versionId: 'v-about', publishedAt: NOW })
  mockDocs.set('hosts/host-1/layouts/lay-site', { displayName: 'Site layout', versionId: 'v-site' })
  mockDocs.set('hosts/host-1/collections/col-blog', { kind: 'content', slug: 'blog', entryScreenId: 'scr-post', listScreenId: 'scr-blog' })
  mockDocs.set('hosts/host-1/settings/store', { pdpScreenId: 'scr-product', collectionScreenId: 'scr-shop' })
}

const routingMap = () => mockDocs.get('hosts/host-1')?.['screens'] as Record<string, string>

beforeEach(() => {
  mockDocs.clear()
  mockOwners.clear()
  commits = []
})

describe('the screen draft’s document', () => {
  it('seeds its first version with the versions route’s keys only, read from the route', () => {
    const versions = readFileSync(join(REPO_ROOT, 'apps/console/app/api/hosts/versions/route.ts'), 'utf8').replace(/\/\/.*$/gm, '')
    const at = versions.indexOf('const VERSION_KEYS = new Set([')
    expect(at).toBeGreaterThan(-1)
    const keys = [...versions.slice(at, versions.indexOf('])', at)).matchAll(/'([A-Za-z]+)'/g)].map((match) => match[1])
    for (const field of AI_DRAFT_SCREEN_VERSION_FIELDS) {
      expect([field, keys.includes(field)]).toEqual([field, true])
    }
  })

  it('writes the screen and its first version as the create and versions routes do, and nothing more', async () => {
    seedLiveSite()
    const result = await writeAiDraft(firestore, screenInput())
    if (result.ok === false) throw new Error(result.error)
    expect(result).toEqual({ ok: true, replayed: false, id: 'job-page', versionId: expect.any(String), name: 'Pricing', hostSubdomain: 'acme' })
    expect(mockDocs.get('hosts/host-1/screens/job-page')).toEqual({
      displayName: 'Pricing',
      slug: 'pricing',
      versionId: result.versionId,
      nameLower: 'pricing',
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: 'uid-1',
    })
    const screen = mockDocs.get('hosts/host-1/screens/job-page') ?? {}
    const stamps = new Set(['nameLower', 'createdAt', 'updatedAt', 'createdBy'])
    for (const key of Object.keys(screen)) {
      expect([key, AI_DRAFT_FIELDS.screen.includes(key) || stamps.has(key)]).toEqual([key, true])
    }
    const version = mockDocs.get(`hosts/host-1/screens/job-page/versions/${result.versionId}`) ?? {}
    expect(Object.keys(version).sort()).toEqual([...AI_DRAFT_SCREEN_VERSION_FIELDS, 'createdAt', 'updatedAt', 'createdBy'].sort())
    expect(version).toMatchObject({ screenId: 'job-page', hostId: 'host-1', displayName: AI_DRAFT_VERSION_NAME, layoutId: 'lay-site' })
    expect(Buffer.isBuffer(version['nodes'])).toBe(true)
    expect(decodeStoredNodes(version['nodes'])).toEqual(NODES)
  })

  it('binds no layout the plan did not name', async () => {
    seedLiveSite()
    const result = await writeAiDraft(firestore, screenInput({ layoutId: null }))
    if (result.ok === false) throw new Error(result.error)
    expect(mockDocs.get(`hosts/host-1/screens/job-page/versions/${result.versionId}`)).not.toHaveProperty('layoutId')
  })
})

describe('the screen draft serves nothing until a member publishes it', () => {
  it('changes no document that decides what the site serves, and no address resolves to it', async () => {
    seedLiveSite()
    const before = new Map([...mockDocs].map(([path, data]) => [path, JSON.stringify(data)]))
    const result = await writeAiDraft(firestore, screenInput({ slug: 'about', name: 'About' }))
    if (result.ok === false) throw new Error(result.error)

    expect([...commits].sort()).toEqual(
      ['hosts/host-1/screens/job-page', `hosts/host-1/screens/job-page/versions/${result.versionId}`].sort(),
    )
    for (const [path, data] of before) {
      expect([path, JSON.stringify(mockDocs.get(path))]).toEqual([path, data])
    }
    for (const [path, data] of mockDocs) {
      if (path.startsWith('hosts/host-1/screens/job-page')) continue
      expect([path, JSON.stringify(data).includes('job-page')]).toEqual([path, false])
    }
    const screen = mockDocs.get('hosts/host-1/screens/job-page') ?? {}
    expect(screen).not.toHaveProperty('publishedAt')
    expect(screen).not.toHaveProperty('publishSchedule')
    expect(screen).not.toHaveProperty('kind')
    // Named apart from the live About page, at an address no live page holds.
    expect(screen).toMatchObject({ displayName: 'About 2', slug: 'about-2' })
    for (const path of ['/', 'about', 'about-2', 'blog-post', 'pricing']) {
      expect([path, findScreenIdByRoutePath(routingMap(), path)]).not.toEqual([path, 'job-page'])
    }
  })

  it('resolves its address only once the member’s publish writes the routing map, as publishScreenRoute does', async () => {
    seedLiveSite()
    const result = await writeAiDraft(firestore, screenInput())
    if (result.ok === false) throw new Error(result.error)
    const slug = String(mockDocs.get('hosts/host-1/screens/job-page')?.['slug'])
    expect(findScreenIdByRoutePath(routingMap(), slug)).not.toBe('job-page')

    // The one door that publishes a screen writes its routing-map entry; read
    // from its own source, so this spec applies the same write it makes.
    const publisher = readFileSync(join(REPO_ROOT, 'apps/console/constants/screen-publishing.ts'), 'utf8')
    const publish = publisher.slice(publisher.indexOf('export async function publishScreenRoute('), publisher.indexOf('export async function syncScreenRouteEntries('))
    expect(publish).toContain('[`screens.${screenId}`]: path')
    expect(publish).toContain('{ slug, publishedAt: Timestamp.now() }')

    mockDocs.set('hosts/host-1', { ...mockDocs.get('hosts/host-1'), screens: { ...routingMap(), 'job-page': slug } })
    expect(findScreenIdByRoutePath(routingMap(), slug)).toBe('job-page')
  })
})

describe('the screen draft is counted like a create', () => {
  it('counts an unrouted screen against the allowance, as the route does, inside the transaction', async () => {
    seedLiveSite()
    // Two routed pages and three unrouted drafts: five, Free's allowance.
    for (let index = 0; index < 3; index += 1) {
      mockDocs.set(`hosts/host-1/screens/draft-${index}`, { displayName: `Draft ${index}` })
    }
    const refusal = 'Your plan includes 5 screens — upgrade in Billing for more'
    expect(await writeAiDraft(firestore, screenInput({ org: FREE_ORG }))).toEqual({ ok: false, status: 403, error: refusal })
    expect(commits).toEqual([])
    expect(await aiDraftAllowanceRefusal(firestore, { kind: 'screen', hostId: 'host-1', org: FREE_ORG })).toBe(refusal)
    // An email design is not a page, and a deleted draft frees its slot.
    mockDocs.set('hosts/host-1/screens/draft-0', { displayName: 'Draft 0', deletedAt: NOW })
    mockDocs.set('hosts/host-1/screens/email-1', { displayName: 'Welcome', kind: 'email' })
    expect(await aiDraftAllowanceRefusal(firestore, { kind: 'screen', hostId: 'host-1', org: FREE_ORG })).toBeNull()
    expect((await writeAiDraft(firestore, screenInput({ org: FREE_ORG }))).ok).toBe(true)
  })

  it('reports the draft a job already wrote rather than writing a second', async () => {
    seedLiveSite()
    const first = await writeAiDraft(firestore, screenInput())
    if (first.ok === false) throw new Error(first.error)
    const again = await writeAiDraft(firestore, screenInput({ name: 'Another', slug: 'another' }))
    expect(again).toEqual({ ...first, replayed: true })
    expect([...mockDocs.keys()].filter((key) => key.startsWith('hosts/host-1/screens/job-page/versions/'))).toHaveLength(1)
    expect(await readAiDraft(firestore, { kind: 'screen', hostId: 'host-1', id: 'job-page' })).toMatchObject({ id: 'job-page', name: 'Pricing' })
  })

  it('names the site’s page in the admission sentence', async () => {
    mockOwners.set('host-1', 'org-1')
    expect(
      await aiDraftAdmissionRefusal(firestore, { orgId: 'org-1', hostId: null, kind: 'screen', noun: 'page', org: STARTER_ORG }),
    ).toEqual({ status: 400, error: 'Open the site the page is for before starting the job' })
  })
})

describe('aiDraftScreenSlug', () => {
  const rows = [
    { slug: 'pricing', deleted: false },
    { slug: 'old-offer', deleted: true },
  ]

  it('takes the address asked for, else one from the name, never one a live screen or a routed path holds', () => {
    expect(aiDraftScreenSlug('services', 'Services', rows, { 'scr-a': 'about' })).toBe('services')
    expect(aiDraftScreenSlug('pricing', 'Pricing', rows, {})).toBe('pricing-2')
    expect(aiDraftScreenSlug('about', 'About', rows, { 'scr-a': 'about' })).toBe('about-2')
    // A deleted screen's address is free again.
    expect(aiDraftScreenSlug('old-offer', 'Old offer', rows, {})).toBe('old-offer')
    expect(aiDraftScreenSlug('', 'Spring Offer', rows, {})).toBe('spring-offer')
    expect(aiDraftScreenSlug(null, '', rows, {})).toBe('page')
  })

  it('asks for the root only while no screen holds it', () => {
    expect(aiDraftScreenSlug('/', 'Home', rows, {})).toBe('/')
    expect(aiDraftScreenSlug('/', 'Home', rows, { 'scr-home': '/' })).toBe('home')
  })
})

describe('a later pass, and the listing', () => {
  it('adds to the version as it is stored now, stamps it, and changes nothing a second time', async () => {
    seedLiveSite()
    await writeAiDraft(firestore, screenInput())
    const added = await updateAiDraftNodes(firestore, {
      kind: 'screen',
      hostId: 'host-1',
      id: 'job-page',
      now: LATER,
      update: (nodes) => {
        const root = (nodes as Record<string, { nodes: string[] }>)[CANVAS_ROOT_ELEMENT_ID]
        return {
          ...nodes,
          [CANVAS_ROOT_ELEMENT_ID]: { ...root, nodes: [...root.nodes, 's2'] },
          s2: { $id: 's2', componentId: 'section', parentId: CANVAS_ROOT_ELEMENT_ID, props: { element: 'section' }, nodes: [] },
        } as unknown as NodesMap
      },
    })
    expect(added).toEqual({ ok: true, changed: true })
    const stored = await readAiDraftNodes(firestore, { kind: 'screen', hostId: 'host-1', id: 'job-page' })
    expect((stored?.nodes as unknown as Record<string, { nodes: string[] }>)[CANVAS_ROOT_ELEMENT_ID].nodes).toEqual(['s1', 's2'])
    expect(mockDocs.get(`hosts/host-1/screens/job-page/versions/${stored?.versionId}`)?.['updatedAt']).toBe(LATER)
    expect(await updateAiDraftNodes(firestore, { kind: 'screen', hostId: 'host-1', id: 'job-page', now: LATER, update: () => null })).toEqual({ ok: true, changed: false })
  })

  it('adds nothing to a draft a member deleted', async () => {
    seedLiveSite()
    await writeAiDraft(firestore, screenInput())
    mockDocs.set('hosts/host-1/screens/job-page', { ...mockDocs.get('hosts/host-1/screens/job-page'), deletedAt: LATER })
    commits = []
    expect(await updateAiDraftNodes(firestore, { kind: 'screen', hostId: 'host-1', id: 'job-page', now: LATER, update: (nodes) => nodes })).toEqual({
      ok: false,
      status: 404,
      error: 'The draft is no longer on the site',
    })
    await writeAiDraftScreenSeo(firestore, { hostId: 'host-1', id: 'job-page', seo: { title: 'A title' }, now: LATER })
    expect(commits).toEqual([])
    expect((await readAiDraft(firestore, { kind: 'screen', hostId: 'host-1', id: 'job-page' }))?.deleted).toBe(true)
  })

  it('fills the search title and description a member left empty, and keeps what they typed', async () => {
    seedLiveSite()
    await writeAiDraft(firestore, screenInput())
    mockDocs.set('hosts/host-1/screens/job-page', { ...mockDocs.get('hosts/host-1/screens/job-page'), seo: { title: 'A title a member typed' } })
    await writeAiDraftScreenSeo(firestore, {
      hostId: 'host-1',
      id: 'job-page',
      seo: { title: 'Generated title', description: 'Generated description.' },
      now: LATER,
    })
    expect(mockDocs.get('hosts/host-1/screens/job-page')?.['seo']).toEqual({
      title: 'A title a member typed',
      description: 'Generated description.',
    })
    expect(await readAiDraft(firestore, { kind: 'screen', hostId: 'host-1', id: 'job-page' })).toMatchObject({
      seo: { title: 'A title a member typed', description: 'Generated description.' },
    })
  })
})
