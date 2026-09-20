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
 * `duplicateResource` (AGL-2936), one kind at a time: the copy is complete
 * and a draft, its name and slug are unique among the live siblings, the
 * band refuses it exactly as a create would, both feeds get a row, and one
 * attempt key makes one copy.
 *
 * The Firestore double is an in-memory map with just enough of the Admin
 * surface the module touches — `select`, `orderBy().limit()`, and a
 * `runTransaction` whose `get` and `create` land on the same map — so every
 * assertion below is about the DOCUMENTS the module wrote, not about which
 * stub it called.
 */

// A module, not a script — without this the const declarations below collide
// with the sibling activity spec's identical globals under `tsc`.
export {}

import {
  billableScreenIds,
  decodeStoredNodes,
  NON_PAGE_SCREEN_MAX_PER_HOST,
  nonPageScreenIds,
} from '@aglyn/aglyn/server'

interface Doc {
  [key: string]: unknown
}

const store = new Map<string, Doc>()

const dig = (row: Doc | undefined, field: string): unknown =>
  field.split('.').reduce<unknown>(
    (value, part) =>
      value && typeof value === 'object' ? (value as Doc)[part] : undefined,
    row,
  )

const mockSnapshot = (path: string) => ({
  id: path.split('/').pop(),
  exists: store.has(path),
  data: () => store.get(path),
  get: (field: string) => dig(store.get(path), field),
})

const mockQuery = (prefix: string, order?: { field: string; desc: boolean }, max?: number) => ({
  select: () => mockQuery(prefix, order, max),
  orderBy: (field: string, direction?: string) =>
    mockQuery(prefix, { field, desc: direction === 'desc' }, max),
  limit: (count: number) => mockQuery(prefix, order, count),
  get: async () => {
    let paths = [...store.keys()].filter(
      (path) => path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes('/'),
    )
    if (order) {
      paths = paths
        .filter((path) => dig(store.get(path), order.field) !== undefined)
        .sort((a, b) => {
          const left = Number(dig(store.get(a), order.field))
          const right = Number(dig(store.get(b), order.field))
          return order.desc ? right - left : left - right
        })
    }
    if (max !== undefined) paths = paths.slice(0, max)
    const docs = paths.map(mockSnapshot)
    return { docs, size: docs.length, empty: docs.length === 0 }
  },
})

const mockMakeDoc = (path: string): any => ({
  path,
  id: path.split('/').pop(),
  collection: (name: string) => mockMakeCollection(`${path}/${name}`),
  get: async () => mockSnapshot(path),
  create: async (data: Doc) => {
    if (store.has(path)) {
      const error = new Error('ALREADY_EXISTS') as Error & { code: number }
      error.code = 6
      throw error
    }
    store.set(path, data)
  },
  set: async (data: Doc, options?: { merge?: boolean }) => {
    store.set(path, options?.merge ? { ...(store.get(path) ?? {}), ...data } : data)
  },
  delete: async () => {
    store.delete(path)
  },
})

let mockAutoId = 0
const mockMakeCollection = (prefix: string): any => ({
  ...mockQuery(prefix),
  doc: (id: string) => mockMakeDoc(`${prefix}/${id}`),
  add: async (data: Doc) => {
    const path = `${prefix}/auto-${(mockAutoId += 1)}`
    store.set(path, data)
    return mockMakeDoc(path)
  },
})

const mockFirestore = () => ({
  collection: (name: string) => mockMakeCollection(name),
  runTransaction: async (body: (tx: unknown) => Promise<unknown>) =>
    body({
      get: async (target: { get: () => Promise<unknown> }) => target.get(),
      create: (ref: { path: string }, data: Doc) => {
        if (store.has(ref.path)) throw new Error(`exists: ${ref.path}`)
        store.set(ref.path, data)
      },
    }),
})

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => mockFirestore() }) },
}))
jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__server_timestamp__' },
  Timestamp: { now: () => '__now__' },
}))
jest.mock('./host-memberships', () => ({
  __esModule: true,
  deleteMemberHostProjections: async () => undefined,
  syncHostProjectionForMembers: async () => undefined,
  syncMemberHostProjections: async () => undefined,
}))
jest.mock('./auth-pools', () => ({
  __esModule: true,
  findUserByUidAcrossPools: async () => null,
}))
jest.mock('./update-existing', () => ({
  __esModule: true,
  updateExisting: async () => undefined,
}))
jest.mock('./workspace-domains', () => ({
  __esModule: true,
  attachWorkspaceDomain: async () => undefined,
}))

const { duplicateResource } = require('./duplicate-resource') as typeof import('./duplicate-resource')

const ORG = 'org-1'
const HOST = 'host-1'
const PERSON = { uid: 'uid-1', email: 'ada@example.test' }
/** A Pro workspace: every kind here is included, with finite bands. */
const PRO = { plan: 'pro' }
/** A workspace whose page band is spent by its one routed screen. */
const ONE_SCREEN = { plan: 'pro', entitlements: { screensPerHost: 1 } }
/** A workspace with none of the paid features. */
const FREE = { plan: 'free' }

/** The direct children of a collection — a version under a screen is not a screen. */
const rowsIn = (prefix: string) =>
  [...store.entries()]
    .filter(
      ([path]) =>
        path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes('/'),
    )
    .map(([path, row]) => ({ path, ...row }))
const hostRows = () => rowsIn(`hosts/${HOST}/activity`)
const orgRows = () => rowsIn(`orgs/${ORG}/activity`)

const seedHost = (extra: Doc = {}) =>
  store.set(`hosts/${HOST}`, { orgId: ORG, screens: {}, ...extra })

const TREE = { root: { $id: 'root', componentId: 'div', nodes: [] } }

const seedScreen = (id: string, doc: Doc, versions: Array<[string, Doc]> = []) => {
  store.set(`hosts/${HOST}/screens/${id}`, doc)
  for (const [versionId, version] of versions) {
    store.set(`hosts/${HOST}/screens/${id}/versions/${versionId}`, version)
  }
}

const run = (kind: Parameters<typeof duplicateResource>[0], extra: Doc = {}) =>
  duplicateResource(kind, {
    orgId: ORG,
    hostId: HOST,
    sourceId: 'src',
    uid: PERSON.uid,
    email: PERSON.email,
    org: PRO,
    ...extra,
  } as never)

beforeEach(() => {
  store.clear()
  mockAutoId = 0
  seedHost()
})

describe('a screen', () => {
  beforeEach(() => {
    seedScreen(
      'src',
      {
        displayName: 'Home',
        slug: 'home',
        description: 'The front door',
        seo: { title: 'Home' },
        kind: 'page',
        layoutId: 'marketingBase',
        versionId: 'v1',
        publishedAt: '__then__',
      },
      [
        ['v1', { screenId: 'src', nodes: TREE, rootId: 'root', updatedAt: 1 }],
        ['v2', { screenId: 'src', nodes: { ...TREE, extra: {} }, rootId: 'root', updatedAt: 2 }],
      ],
    )
    store.set(`hosts/${HOST}`, { orgId: ORG, screens: { src: '/' } })
  })

  it('copies the fields, the slug as -copy, and the newest version as a draft', async () => {
    const result = await run('screen')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const copy = store.get(`hosts/${HOST}/screens/${result.id}`)
    expect(copy).toMatchObject({
      displayName: 'Copy of Home',
      nameLower: 'copy of home',
      slug: 'home-copy',
      description: 'The front door',
      seo: { title: 'Home' },
      kind: 'page',
      // The shared layout rides along (AGL-3120), so the copy renders inside
      // the same header and footer as the page it was made from.
      layoutId: 'marketingBase',
      versionId: result.versionId,
      createdBy: PERSON.uid,
    })
    // A draft: nothing the create path would have published rides along.
    expect(copy).not.toHaveProperty('publishedAt')
    expect((store.get(`hosts/${HOST}`) as Doc)['screens']).toEqual({ src: '/' })

    const version = store.get(
      `hosts/${HOST}/screens/${result.id}/versions/${result.versionId}`,
    ) as Doc
    expect(version).toMatchObject({
      screenId: result.id,
      hostId: HOST,
      displayName: 'Duplicated from Home v2',
      createdBy: PERSON.uid,
    })
    // The NEWEST version, packed at rest.
    expect(decodeStoredNodes(version['nodes'])).toEqual({ ...TREE, extra: {} })
    expect(result.name).toBe('Copy of Home')
  })

  it('invents no layout for a source that binds none (AGL-3120)', async () => {
    seedScreen(
      'bare',
      { displayName: 'Bare', slug: 'bare', kind: 'page', versionId: 'b1' },
      [['b1', { screenId: 'bare', nodes: TREE, rootId: 'root', updatedAt: 1 }]],
    )
    const result = await run('screen', { sourceId: 'bare' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(store.get(`hosts/${HOST}/screens/${result.id}`)).not.toHaveProperty(
      'layoutId',
    )
  })

  it('numbers a name a live sibling holds and steps the slug', async () => {
    seedScreen('other', { displayName: 'Copy of Home', slug: 'home-copy', kind: 'page' })
    seedScreen('gone', { displayName: 'Copy of Home 2', slug: 'home-copy-2', kind: 'page', deletedAt: 1 })
    const result = await run('screen')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const copy = store.get(`hosts/${HOST}/screens/${result.id}`)
    // The deleted sibling's name and slug are free.
    expect(copy).toMatchObject({ displayName: 'Copy of Home 2', slug: 'home-copy-2' })
  })

  it('takes the name the person typed', async () => {
    const result = await run('screen', { name: '  Landing B  ' })
    expect(result.ok && result.name).toBe('Landing B')
  })

  it('is refused by the screen band with the create sentence', async () => {
    const result = await run('screen', { org: ONE_SCREEN })
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'Your plan includes 1 screens — upgrade in Billing for more',
    })
    expect(rowsIn(`hosts/${HOST}/screens`)).toHaveLength(1)
    expect(hostRows()).toHaveLength(0)
  })

  it('refuses an email design and an error screen, which are not pages', async () => {
    seedScreen('mail', { displayName: 'Welcome', kind: 'email' })
    seedScreen('oops', { displayName: 'Not found', kind: 'error' })
    for (const sourceId of ['mail', 'oops']) {
      expect(await run('screen', { sourceId })).toEqual({
        ok: false,
        status: 400,
        error: 'Only a page or a collection entry template can be duplicated as a screen',
      })
    }
    expect(rowsIn(`hosts/${HOST}/screens`)).toHaveLength(3)
    expect(hostRows()).toHaveLength(0)
  })

  it('answers 404 for a missing or deleted source', async () => {
    expect(await run('screen', { sourceId: 'nope' })).toMatchObject({ ok: false, status: 404 })
    seedScreen('dead', { displayName: 'Old', kind: 'page', deletedAt: 1 })
    expect(await run('screen', { sourceId: 'dead' })).toMatchObject({ ok: false, status: 404 })
  })

  it('writes one row in each feed, coded, naming the copy and the source', async () => {
    const result = await run('screen')
    if (!result.ok) throw new Error('refused')
    for (const rows of [hostRows(), orgRows()]) {
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        actorId: PERSON.uid,
        actorEmail: PERSON.email,
        action: 'screen.duplicated',
        target: {
          type: 'screen',
          id: result.id,
          name: 'Copy of Home · from Home',
          versionId: result.versionId,
        },
      })
    }
  })

  it('one attempt key makes one copy, and replays the first answer', async () => {
    const first = await run('screen', { attemptKey: 'attempt-1' })
    const again = await run('screen', { attemptKey: 'attempt-1' })
    expect(first.ok).toBe(true)
    expect(again).toEqual(first)
    expect(rowsIn(`hosts/${HOST}/screens`)).toHaveLength(2)
    expect(hostRows()).toHaveLength(1)
    // A different key is a different attempt.
    const third = await run('screen', { attemptKey: 'attempt-2' })
    expect(third.ok && third.id).not.toBe(first.ok && first.id)
  })

  it('a refusal releases the key, so the same attempt can be retried', async () => {
    const refused = await run('screen', { org: ONE_SCREEN, attemptKey: 'k' })
    expect(refused.ok).toBe(false)
    const retried = await run('screen', { attemptKey: 'k' })
    expect(retried.ok).toBe(true)
  })
})

/** The refusal every non-page screen copy meets at the flat ceiling. */
const NON_PAGE_CEILING_REFUSAL = {
  ok: false,
  status: 403,
  error:
    `This site is at its limit of ${NON_PAGE_SCREEN_MAX_PER_HOST} email and ` +
    'template screens — delete some to make room',
}

/** `count` live email designs, the commonest non-page screen. */
const seedEmailDesigns = (count: number) => {
  for (let index = 0; index < count; index += 1) {
    seedScreen(`mail-${index}`, { displayName: `Mail ${index}`, kind: 'email' })
  }
}

/** The stored screens as the two counts read them. */
const screenCounts = () => {
  const rows = rowsIn(`hosts/${HOST}/screens`).map((row) => ({
    id: row.path.split('/').pop() as string,
    kind: row['kind'],
    deletedAt: row['deletedAt'],
  }))
  const routing = (store.get(`hosts/${HOST}`) as Doc)['screens'] as never
  return {
    pages: [...billableScreenIds(rows, routing)].sort(),
    nonPages: nonPageScreenIds(rows, routing).size,
  }
}

describe('a collection entry template', () => {
  const ENTRY = 'Blog — Entry Template'

  beforeEach(() => {
    seedScreen(
      'src',
      {
        displayName: ENTRY,
        slug: 'blog-post',
        description: 'One post',
        seo: { title: '{{entry.title}}' },
        kind: 'template',
        layoutId: 'marketingBase',
        versionId: 'v1',
        publishedAt: '__then__',
      },
      [
        ['v1', { screenId: 'src', nodes: TREE, rootId: 'root', updatedAt: 1 }],
        ['v2', { screenId: 'src', nodes: { ...TREE, extra: {} }, rootId: 'root', updatedAt: 2 }],
      ],
    )
    // Routed on purpose — publishing is how the compose pipeline picks a
    // template up — and the collection it renders points at it.
    seedHost({ screens: { src: 'blog-post' } })
    store.set(`hosts/${HOST}/collections/blog`, {
      displayName: 'Blog',
      slug: 'blog',
      entryScreenId: 'src',
    })
  })

  it('copies it as a template with the newest version as its first, unrouted, unpublished and used by nothing', async () => {
    const result = await run('screen')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const copy = store.get(`hosts/${HOST}/screens/${result.id}`)
    expect(copy).toMatchObject({
      displayName: `Copy of ${ENTRY}`,
      nameLower: 'copy of blog — entry template',
      slug: 'blog-post-copy',
      description: 'One post',
      seo: { title: '{{entry.title}}' },
      kind: 'template',
      layoutId: 'marketingBase',
      versionId: result.versionId,
      createdBy: PERSON.uid,
    })
    expect(copy).not.toHaveProperty('publishedAt')
    expect((store.get(`hosts/${HOST}`) as Doc)['screens']).toEqual({ src: 'blog-post' })
    // No collection renders through the copy until somebody picks it.
    expect(rowsIn(`hosts/${HOST}/collections`)).toEqual([
      {
        path: `hosts/${HOST}/collections/blog`,
        displayName: 'Blog',
        slug: 'blog',
        entryScreenId: 'src',
      },
    ])

    const version = store.get(
      `hosts/${HOST}/screens/${result.id}/versions/${result.versionId}`,
    ) as Doc
    expect(version).toMatchObject({
      screenId: result.id,
      hostId: HOST,
      displayName: `Duplicated from ${ENTRY} v2`,
    })
    expect(decodeStoredNodes(version['nodes'])).toEqual({ ...TREE, extra: {} })
    expect(hostRows()[0]).toMatchObject({
      action: 'screen.duplicated',
      target: { type: 'screen', id: result.id, name: `Copy of ${ENTRY} · from ${ENTRY}` },
    })
  })

  it('is not a page: a spent page band does not stop it, and it spends none of it', async () => {
    seedScreen('home', { displayName: 'Home', slug: 'home', kind: 'page' })
    seedHost({ screens: { src: 'blog-post', home: '/' } })
    // Home spends the band of one, so a page copy is refused…
    expect(await run('screen', { sourceId: 'home', org: ONE_SCREEN })).toMatchObject({
      ok: false,
      status: 403,
    })
    expect(screenCounts()).toEqual({ pages: ['home'], nonPages: 1 })
    // …and the template copy is made, counted where a template counts.
    const result = await run('screen', { org: ONE_SCREEN })
    expect(result.ok).toBe(true)
    expect(screenCounts()).toEqual({ pages: ['home'], nonPages: 2 })
  })

  it('meets the flat ceiling on non-page screens, refused with the email design sentence', async () => {
    // The source and the designs leave room for exactly one more.
    seedEmailDesigns(NON_PAGE_SCREEN_MAX_PER_HOST - 2)
    expect((await run('screen')).ok).toBe(true)
    expect(screenCounts().nonPages).toBe(NON_PAGE_SCREEN_MAX_PER_HOST)

    expect(await run('screen')).toEqual(NON_PAGE_CEILING_REFUSAL)
    expect(rowsIn(`hosts/${HOST}/screens`)).toHaveLength(NON_PAGE_SCREEN_MAX_PER_HOST)
    expect(hostRows()).toHaveLength(1)
  })
})

describe('an email design', () => {
  it('is refused at the flat ceiling on non-page screens, which counts templates too', async () => {
    seedScreen('src', { displayName: 'Welcome', kind: 'email' })
    seedScreen('post', { displayName: 'Post', kind: 'template' })
    seedEmailDesigns(NON_PAGE_SCREEN_MAX_PER_HOST - 2)
    expect(await run('emailDesign')).toEqual(NON_PAGE_CEILING_REFUSAL)
    expect(hostRows()).toHaveLength(0)
  })

  it('copies only an email screen, without a slug, onto the non-page ceiling', async () => {
    seedScreen('src', { displayName: 'Welcome', kind: 'email', versionId: 'v1' }, [
      ['v1', { screenId: 'src', nodes: TREE, updatedAt: 1 }],
    ])
    seedScreen('page', { displayName: 'Home', kind: 'page' })
    expect(await run('emailDesign', { sourceId: 'page' })).toMatchObject({ ok: false, status: 400 })
    // A spent page band does not stop a design: it is not a page.
    const result = await run('emailDesign', { org: ONE_SCREEN })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(store.get(`hosts/${HOST}/screens/${result.id}`)).toMatchObject({
      displayName: 'Copy of Welcome',
      kind: 'email',
      versionId: result.versionId,
    })
    expect(store.get(`hosts/${HOST}/screens/${result.id}`)).not.toHaveProperty('slug')
    expect(hostRows()[0]).toMatchObject({ action: 'emailDesign.duplicated' })
  })
})

describe('a component', () => {
  beforeEach(() => {
    store.set(`hosts/${HOST}/components/src`, {
      displayName: 'Hero',
      description: 'Big',
      icon: { name: 'star' },
      rootId: 'root',
      nodes: TREE,
      props: [{ name: 'title', kind: 'text' }],
      versionId: 'v1',
    })
    store.set(`hosts/${HOST}/components/src/versions/v1`, {
      componentId: 'src',
      nodes: TREE,
      rootId: 'root',
      props: [{ name: 'title', kind: 'text' }],
      updatedAt: 1,
    })
  })

  it('copies the definition, its properties and the version, with no instances', async () => {
    const result = await run('component')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const copy = store.get(`hosts/${HOST}/components/${result.id}`) as Doc
    expect(copy).toMatchObject({
      displayName: 'Copy of Hero',
      description: 'Big',
      icon: { name: 'star' },
      rootId: 'root',
      props: [{ name: 'title', kind: 'text' }],
      versionId: result.versionId,
    })
    expect(decodeStoredNodes(copy['nodes'])).toEqual(TREE)
    const version = store.get(
      `hosts/${HOST}/components/${result.id}/versions/${result.versionId}`,
    ) as Doc
    expect(version).toMatchObject({ componentId: result.id, props: [{ name: 'title', kind: 'text' }] })
    expect(orgRows()[0]).toMatchObject({ action: 'component.duplicated', target: { type: 'component' } })
  })

  it('needs the reusable components entitlement', async () => {
    const result = await run('component', { org: FREE })
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'This feature is not included in your plan — see Billing',
    })
  })
})

describe('a layout', () => {
  it('copies the description and the version; no screen binds to the copy', async () => {
    store.set(`hosts/${HOST}/layouts/src`, { displayName: 'Shell', description: 'd', versionId: 'v1' })
    store.set(`hosts/${HOST}/layouts/src/versions/v1`, {
      layoutId: 'src',
      nodes: TREE,
      props: [],
      updatedAt: 1,
    })
    const result = await run('layout')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(store.get(`hosts/${HOST}/layouts/${result.id}`)).toMatchObject({
      displayName: 'Copy of Shell',
      description: 'd',
      versionId: result.versionId,
    })
    expect(
      store.get(`hosts/${HOST}/layouts/${result.id}/versions/${result.versionId}`),
    ).toMatchObject({ layoutId: result.id, props: [] })
    expect(hostRows()[0]).toMatchObject({ action: 'layout.duplicated', target: { type: 'layout' } })
  })
})

describe('a template', () => {
  it('copies the tree and fields, and is the customer\'s own whatever the source was', async () => {
    store.set(`hosts/${HOST}/templates/src`, {
      kind: 'page',
      displayName: 'Landing',
      placeholders: [{ id: 'p' }],
      nodes: TREE,
      rootId: 'root',
      props: [],
      slug: 'landing',
      seo: { title: 'L' },
      source: { type: 'marketplace', listingId: 'l1' },
    })
    const result = await run('template')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const copy = store.get(`hosts/${HOST}/templates/${result.id}`) as Doc
    expect(copy).toMatchObject({
      kind: 'page',
      displayName: 'Copy of Landing',
      placeholders: [{ id: 'p' }],
      slug: 'landing',
      seo: { title: 'L' },
      source: { type: 'authored' },
    })
    expect(decodeStoredNodes(copy['nodes'])).toEqual(TREE)
    expect(result.versionId).toBeNull()
  })

  it('counts against the template band, starters excluded', async () => {
    store.set(`hosts/${HOST}/templates/src`, { kind: 'page', displayName: 'A', nodes: TREE })
    for (let index = 0; index < 60; index += 1) {
      store.set(`hosts/${HOST}/templates/starter-${index}`, {
        displayName: `S${index}`,
        source: { type: 'starter' },
      })
    }
    // Starters do not count, so a band of fifty still has room.
    const FIFTY = { plan: 'pro', entitlements: { templatesPerHost: 50 } }
    expect((await run('template', { org: FIFTY })).ok).toBe(true)
    for (let index = 0; index < 60; index += 1) {
      store.set(`hosts/${HOST}/templates/mine-${index}`, {
        displayName: `M${index}`,
        source: { type: 'authored' },
      })
    }
    expect(await run('template', { org: FIFTY })).toMatchObject({
      ok: false,
      status: 403,
      error: expect.stringContaining('templates'),
    })
  })
})

describe('a form', () => {
  it('copies the design, fields and routing with a fresh slug; submissions stay behind', async () => {
    store.set(`hosts/${HOST}/forms/src`, {
      displayName: 'Contact',
      slug: 'contact',
      fields: [{ name: 'email', type: 'email' }],
      consentFieldName: 'consent',
      routing: { datasetId: 'ds' },
      rootId: 'root',
      nodes: TREE,
      versionId: 'v1',
      stats: { submissions: 12 },
    })
    store.set(`hosts/${HOST}/forms/src/versions/v1`, { formId: 'src', nodes: TREE, updatedAt: 1 })
    const result = await run('form')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const copy = store.get(`hosts/${HOST}/forms/${result.id}`) as Doc
    expect(copy).toMatchObject({
      displayName: 'Copy of Contact',
      slug: 'contact-copy',
      fields: [{ name: 'email', type: 'email' }],
      consentFieldName: 'consent',
      routing: { datasetId: 'ds' },
      versionId: result.versionId,
    })
    expect(copy).not.toHaveProperty('stats')
    expect(store.get(`hosts/${HOST}/forms/${result.id}/versions/${result.versionId}`)).toMatchObject({
      formId: result.id,
    })
    expect(hostRows()[0]).toMatchObject({ action: 'form.duplicated', target: { type: 'content' } })
  })
})

describe('a workflow', () => {
  it('copies the steps and return value with the trigger cleared', async () => {
    store.set(`hosts/${HOST}/workflows/src`, {
      name: 'Nightly',
      steps: [{ functionName: 'f', args: [], resultName: 'r' }],
      returnValue: 'r',
      trigger: { event: 'form.submitted' },
    })
    const result = await run('workflow')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(store.get(`hosts/${HOST}/workflows/${result.id}`)).toMatchObject({
      name: 'Copy of Nightly',
      steps: [{ functionName: 'f', args: [], resultName: 'r' }],
      returnValue: 'r',
      trigger: null,
    })
    expect(result.versionId).toBeNull()
    expect(hostRows()[0]).toMatchObject({
      action: 'workflow.duplicated',
      target: { type: 'workflow', name: 'Copy of Nightly · from Nightly' },
    })
  })

  it('needs the workflows entitlement', async () => {
    store.set(`hosts/${HOST}/workflows/src`, { name: 'N', steps: [] })
    expect(await run('workflow', { org: FREE })).toMatchObject({ ok: false, status: 403 })
  })
})
