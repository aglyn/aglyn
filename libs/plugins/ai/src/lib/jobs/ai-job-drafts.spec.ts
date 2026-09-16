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
 * Where a generation job's layout or page template lands (AGL-2909), against
 * a Firestore double that honors transactions, projections and `create`'s
 * refusal of a document that exists. The plan arithmetic is the REAL
 * `checkQuota`; only the host index read is stubbed.
 *
 *  - APPLIED TO NOTHING. Writing drafts changes no document that decides
 *    what a site serves: a screen bound to a layout, a collection's entry
 *    template, the store's product template, the host's routing map, built-in
 *    page layout and author page all read back unchanged, and nothing but the
 *    drafts themselves names a draft.
 *  - THE CREATE ROUTE'S DOCUMENT. The fields are the console route's
 *    allow-list, read from the route's own source in both directions, plus
 *    that route's stamps; a layout's first version carries the versions
 *    route's seed keys and nothing else.
 *  - COUNTED LIKE A CREATE, inside the transaction, with the route's
 *    arithmetic — including what its `!=` query does not count.
 *  - ONE DRAFT PER JOB. A second write under the job's id reports the first.
 */

const mockDocs = new Map<string, Record<string, unknown>>()
const mockOwners = new Map<string, string>()

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => mockOwners.get(hostId) ?? null,
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import {
  AI_DRAFT_FIELDS,
  AI_DRAFT_VERSION_FIELDS,
  AI_DRAFT_VERSION_NAME,
  aiDraftAdmissionRefusal,
  aiDraftAllowanceRefusal,
  readAiDraft,
  writeAiDraft,
  type AiDraftInput,
} from './ai-job-drafts'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const NOW = new Date('2026-09-15T20:00:00.000Z')
/** A workspace with no plan resolves as Free: one shared layout, ten templates. */
const FREE_ORG: Partial<AglynOrgBilling> = {}
/** Starter: three shared layouts, fifty templates. */
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

/** The paths the double committed, in the order it committed them. */
let commits: string[] = []

const firestore = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const creates: Array<[string, Record<string, unknown>]> = []
    const result = await fn({
      get: async (target: DocTarget | QueryTarget) =>
        target.kind === 'query' ? target.get() : snapshotOf(target.path),
      create: (ref: DocTarget, data: Record<string, unknown>) => {
        creates.push([ref.path, data])
      },
    })
    for (const [path, data] of creates) {
      if (mockDocs.has(path)) throw new Error(`6 ALREADY_EXISTS: ${path}`)
      mockDocs.set(path, data)
      commits.push(path)
    }
    return result
  },
} as unknown as FirebaseFirestore.Firestore

const LAYOUT_NODES = {
  [CANVAS_ROOT_ELEMENT_ID]: { $id: CANVAS_ROOT_ELEMENT_ID, componentId: 'div', nodes: ['slot'] },
  slot: { $id: 'slot', componentId: 'layoutSlot', pluginId: 'mui', parentId: CANVAS_ROOT_ELEMENT_ID, props: {}, nodes: [] },
} as unknown as NodesMap

const PAGE_NODES = {
  [CANVAS_ROOT_ELEMENT_ID]: { $id: CANVAS_ROOT_ELEMENT_ID, componentId: 'div', nodes: ['title'] },
  title: {
    $id: 'title',
    componentId: 'muiTypography',
    pluginId: 'mui',
    parentId: CANVAS_ROOT_ELEMENT_ID,
    props: { component: 'h1', children: '{{entry.title}}' },
    nodes: [],
  },
} as unknown as NodesMap

function layoutInput(patch: Partial<AiDraftInput> = {}): AiDraftInput {
  return {
    kind: 'layout',
    hostId: 'host-1',
    id: 'job-layout',
    uid: 'uid-1',
    org: STARTER_ORG,
    name: 'Site layout',
    nodes: LAYOUT_NODES,
    now: NOW,
    ...patch,
  }
}

function templateInput(patch: Partial<AiDraftInput> = {}): AiDraftInput {
  return {
    kind: 'template',
    hostId: 'host-1',
    id: 'job-template',
    uid: 'uid-1',
    org: STARTER_ORG,
    name: 'Blog entry template',
    nodes: PAGE_NODES,
    slug: 'blog-entry-template',
    now: NOW,
    ...patch,
  }
}

/** A site with live things bound to other things: every pointer a tenant render follows. */
function seedLiveSite() {
  mockOwners.set('host-1', 'org-1')
  mockDocs.set('hosts/host-1', {
    subdomain: 'acme',
    screens: { 'scr-home': '/', 'scr-post': 'blog-post' },
    builtInPageLayoutId: 'lay-site',
    authorScreenId: 'scr-author',
  })
  mockDocs.set('hosts/host-1/screens/scr-home', { displayName: 'Home', layoutId: 'lay-site', versionId: 'v-home' })
  mockDocs.set('hosts/host-1/screens/scr-home/versions/v-home', { layoutId: 'lay-site' })
  mockDocs.set('hosts/host-1/layouts/lay-site', { displayName: 'Site layout', versionId: 'v-site' })
  mockDocs.set('hosts/host-1/layouts/lay-inner', { displayName: 'Inner', layoutId: 'lay-site' })
  mockDocs.set('hosts/host-1/collections/col-blog', {
    kind: 'content',
    slug: 'blog',
    entryScreenId: 'scr-post',
    listScreenId: 'scr-blog',
  })
  mockDocs.set('hosts/host-1/settings/store', { pdpScreenId: 'scr-product', collectionScreenId: 'scr-shop' })
  mockDocs.set('hosts/host-1/templates/starter-business-home', {
    kind: 'page',
    displayName: 'Business Home',
    source: { type: 'starter' },
  })
}

beforeEach(() => {
  mockDocs.clear()
  mockOwners.clear()
  commits = []
})

describe('writeAiDraft — applied to nothing', () => {
  it('changes no document that decides what the site serves, and nothing but the drafts names a draft', async () => {
    seedLiveSite()
    const before = new Map([...mockDocs].map(([path, data]) => [path, JSON.stringify(data)]))
    const layout = await writeAiDraft(firestore, layoutInput())
    const template = await writeAiDraft(firestore, templateInput())
    if (layout.ok === false || template.ok === false) throw new Error('a draft was refused')

    for (const [path, data] of before) {
      expect([path, JSON.stringify(mockDocs.get(path))]).toEqual([path, data])
    }
    expect([...commits].sort()).toEqual(
      [
        'hosts/host-1/layouts/job-layout',
        `hosts/host-1/layouts/job-layout/versions/${layout.versionId}`,
        'hosts/host-1/templates/job-template',
      ].sort(),
    )
    const drafts = new Set(commits)
    for (const [path, data] of mockDocs) {
      if (drafts.has(path)) continue
      const text = JSON.stringify(data)
      expect([path, text.includes('job-layout') || text.includes('job-template')]).toEqual([path, false])
    }
    // The new layout nests inside nothing, so no chain of layouts reaches it either.
    expect(mockDocs.get('hosts/host-1/layouts/job-layout')).not.toHaveProperty('layoutId')
  })
})

describe('writeAiDraft — the create route’s document', () => {
  it('holds its fields to the console create route’s allow-list, read from the route itself, in both directions', () => {
    const route = readFileSync(join(REPO_ROOT, 'apps/console/app/api/hosts/resources/route.ts'), 'utf8')
      .replace(/\/\/.*$/gm, '')
    const fieldsOf = (resource: string): string[] => {
      const start = route.indexOf(`\n  ${resource}: {`)
      expect([resource, start > -1]).toEqual([resource, true])
      const open = route.indexOf('fields: [', start)
      return [...route.slice(open, route.indexOf(']', open)).matchAll(/'([A-Za-z]+)'/g)].map(
        (match) => match[1],
      )
    }
    expect([...AI_DRAFT_FIELDS.layout]).toEqual(fieldsOf('layout'))
    expect([...AI_DRAFT_FIELDS.template]).toEqual(fieldsOf('template'))

    const versions = readFileSync(join(REPO_ROOT, 'apps/console/app/api/hosts/versions/route.ts'), 'utf8')
      .replace(/\/\/.*$/gm, '')
    const keysAt = versions.indexOf('const VERSION_KEYS = new Set([')
    expect(keysAt).toBeGreaterThan(-1)
    const keys = [...versions.slice(keysAt, versions.indexOf('])', keysAt)).matchAll(/'([A-Za-z]+)'/g)].map(
      (match) => match[1],
    )
    for (const field of AI_DRAFT_VERSION_FIELDS) {
      expect([field, keys.includes(field)]).toEqual([field, true])
    }
  })

  it('writes a layout and its first version as the create and versions routes do, and nothing more', async () => {
    mockOwners.set('host-1', 'org-1')
    mockDocs.set('hosts/host-1', { subdomain: 'acme' })
    const result = await writeAiDraft(firestore, layoutInput({ org: FREE_ORG, id: 'job-1' }))
    if (result.ok === false) throw new Error(result.error)
    expect(result).toEqual({
      ok: true,
      replayed: false,
      id: 'job-1',
      versionId: expect.any(String),
      name: 'Site layout',
      hostSubdomain: 'acme',
    })
    expect(mockDocs.get('hosts/host-1/layouts/job-1')).toEqual({
      displayName: 'Site layout',
      versionId: result.versionId,
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: 'uid-1',
    })
    const version = mockDocs.get(`hosts/host-1/layouts/job-1/versions/${result.versionId}`) ?? {}
    expect(Object.keys(version).sort()).toEqual(
      [...AI_DRAFT_VERSION_FIELDS, 'createdAt', 'updatedAt', 'createdBy'].sort(),
    )
    expect(version).toMatchObject({
      layoutId: 'job-1',
      hostId: 'host-1',
      displayName: AI_DRAFT_VERSION_NAME,
      createdBy: 'uid-1',
    })
    // Stored as msgpack, the form every besigner save writes, and read back whole.
    expect(Buffer.isBuffer(version['nodes'])).toBe(true)
    expect(decodeStoredNodes(version['nodes'])).toEqual(LAYOUT_NODES)
  })

  it('writes a page template as the workspace’s own, with the address Use template offers', async () => {
    mockOwners.set('host-1', 'org-1')
    mockDocs.set('hosts/host-1', { subdomain: 'acme' })
    const result = await writeAiDraft(firestore, templateInput({ org: FREE_ORG, id: 'job-2' }))
    expect(result).toEqual({
      ok: true,
      replayed: false,
      id: 'job-2',
      versionId: null,
      name: 'Blog entry template',
      hostSubdomain: 'acme',
    })
    const template = mockDocs.get('hosts/host-1/templates/job-2') ?? {}
    expect(template).toEqual({
      kind: 'page',
      displayName: 'Blog entry template',
      nodes: expect.any(Buffer),
      slug: 'blog-entry-template',
      source: { type: 'authored' },
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: 'uid-1',
    })
    expect(decodeStoredNodes(template['nodes'])).toEqual(PAGE_NODES)
    // No placeholder is declared, so Use template asks for nothing and every token stays bound.
    expect(template).not.toHaveProperty('placeholders')
    expect(commits).toEqual(['hosts/host-1/templates/job-2'])
  })
})

describe('writeAiDraft — counted like a create', () => {
  it('meets the shared-layout band inside the transaction, counting every layout document as the route does', async () => {
    mockOwners.set('host-1', 'org-1')
    mockDocs.set('hosts/host-1', {})
    // Soft-deleted, and still counted: the route counts the collection, not its live rows.
    mockDocs.set('hosts/host-1/layouts/lay-old', { displayName: 'Old', deletedAt: NOW })
    const refused = await writeAiDraft(firestore, layoutInput({ org: FREE_ORG }))
    expect(refused).toEqual({
      ok: false,
      status: 403,
      error: 'Your plan includes 1 shared layouts — upgrade in Billing for more',
    })
    expect(commits).toEqual([])
    expect(await aiDraftAllowanceRefusal(firestore, { kind: 'layout', hostId: 'host-1', org: FREE_ORG })).toBe(
      'Your plan includes 1 shared layouts — upgrade in Billing for more',
    )
    expect((await writeAiDraft(firestore, layoutInput({ org: STARTER_ORG }))).ok).toBe(true)
  })

  it('counts templates as the route’s != query does: never a starter, never one that records no source', async () => {
    mockOwners.set('host-1', 'org-1')
    mockDocs.set('hosts/host-1', {})
    for (let index = 0; index < 8; index += 1) {
      mockDocs.set(`hosts/host-1/templates/own-${index}`, { displayName: `Own ${index}`, source: { type: 'authored' } })
    }
    mockDocs.set('hosts/host-1/templates/listing', { displayName: 'Listing', source: { type: 'marketplace' } })
    mockDocs.set('hosts/host-1/templates/starter-a', { displayName: 'Starter', source: { type: 'starter' } })
    mockDocs.set('hosts/host-1/templates/legacy', { displayName: 'Legacy' })
    expect(await aiDraftAllowanceRefusal(firestore, { kind: 'template', hostId: 'host-1', org: FREE_ORG })).toBeNull()
    expect((await writeAiDraft(firestore, templateInput({ org: FREE_ORG, id: 'job-a' }))).ok).toBe(true)
    expect(await writeAiDraft(firestore, templateInput({ org: FREE_ORG, id: 'job-b' }))).toEqual({
      ok: false,
      status: 403,
      error: 'Your plan includes 10 templates — upgrade in Billing for more',
    })
  })

  it('names the draft apart from a live sibling, and lets a deleted one’s name go', async () => {
    mockOwners.set('host-1', 'org-1')
    mockDocs.set('hosts/host-1', {})
    mockDocs.set('hosts/host-1/layouts/lay-a', { displayName: 'Site layout' })
    mockDocs.set('hosts/host-1/layouts/lay-b', { displayName: 'Site layout 2', deletedAt: NOW })
    const result = await writeAiDraft(firestore, layoutInput())
    expect(result).toMatchObject({ ok: true, name: 'Site layout 2' })
  })

  it('refuses a site that does not exist', async () => {
    expect(await writeAiDraft(firestore, layoutInput())).toEqual({
      ok: false,
      status: 404,
      error: 'Unknown site',
    })
    expect(commits).toEqual([])
  })
})

describe('writeAiDraft — one draft per job', () => {
  it('reports the draft a job already wrote rather than writing a second', async () => {
    mockOwners.set('host-1', 'org-1')
    mockDocs.set('hosts/host-1', { subdomain: 'acme' })
    const first = await writeAiDraft(firestore, layoutInput())
    if (first.ok === false) throw new Error(first.error)
    const again = await writeAiDraft(firestore, layoutInput({ name: 'Another name' }))
    expect(again).toEqual({ ...first, replayed: true })
    expect(commits).toHaveLength(2)
    expect(await readAiDraft(firestore, { kind: 'layout', hostId: 'host-1', id: 'job-layout' })).toEqual({
      id: 'job-layout',
      versionId: first.versionId,
      name: 'Site layout',
      hostSubdomain: 'acme',
    })
    expect(await readAiDraft(firestore, { kind: 'template', hostId: 'host-1', id: 'job-layout' })).toBeNull()
  })
})

describe('aiDraftAdmissionRefusal', () => {
  it('admits a draft job only for a named site of its own org, with room for the draft', async () => {
    seedLiveSite()
    mockOwners.set('host-2', 'org-2')
    mockDocs.set('hosts/host-2', {})
    const ask = (patch: Partial<Parameters<typeof aiDraftAdmissionRefusal>[1]> = {}) =>
      aiDraftAdmissionRefusal(firestore, {
        orgId: 'org-1',
        hostId: 'host-1',
        kind: 'layout',
        org: STARTER_ORG,
        ...patch,
      })
    expect(await ask({ hostId: null })).toEqual({
      status: 400,
      error: 'Open the site the layout is for before starting the job',
    })
    expect(await ask({ hostId: 'host-2' })).toEqual({ status: 404, error: 'Unknown site' })
    expect(await ask({ hostId: 'host-unindexed' })).toEqual({ status: 404, error: 'Unknown site' })
    // The live site already holds two layouts: Free has room for one.
    expect(await ask({ org: FREE_ORG })).toEqual({
      status: 403,
      error: 'Your plan includes 1 shared layouts — upgrade in Billing for more',
    })
    const ownCheck = jest.fn(async () => ({ status: 404 as const, error: 'That content collection is not on this site' }))
    // The kind's own check answers before the allowance does, and only for the org's own site.
    expect(await ask({ org: FREE_ORG, ownCheck })).toEqual({
      status: 404,
      error: 'That content collection is not on this site',
    })
    expect(ownCheck).toHaveBeenCalledWith('host-1')
    expect(await ask({ kind: 'template' })).toBeNull()
    expect(await ask()).toBeNull()
    expect(commits).toEqual([])
  })
})
