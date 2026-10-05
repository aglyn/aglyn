/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * AGL-3533: a site package is planned before it is written, written by the
 * decisions the person made, and undone on request.
 *
 * `site-export-round-trip.spec.ts` holds what a restore WRITES, field by
 * field, through both directions. This suite holds what the package adds on
 * top: a plan that writes nothing and tells new from identical from changed;
 * a kept copy that lands under a new id with every reference to it moved; a
 * replaced page that keeps the version it had; caps that count only what an
 * import adds; a selective export with what it needs; and an undo that puts
 * the site back. One stateful fake Firestore, so a later request reads what
 * an earlier one left.
 */

const mockVerifyIdToken = jest.fn()
const mockServerTimestamp = Symbol('serverTimestamp')
const mockDelete = Symbol('delete')

type Doc = Record<string, any>

const store = new Map<string, Map<string, Doc>>()
const writes: Array<{ path: string; data: Doc }> = []
const deletes: string[] = []

const seed = (collectionPath: string, id: string, data: Doc) => {
  if (!store.has(collectionPath)) store.set(collectionPath, new Map())
  store.get(collectionPath)!.set(id, data)
}
const read = (path: string): Doc | undefined => {
  const cut = path.lastIndexOf('/')
  return store.get(path.slice(0, cut))?.get(path.slice(cut + 1))
}

/** The server timestamp a write lands with: now, as the Admin SDK would stamp it. */
const stamped = (value: unknown): unknown => {
  if (value === mockServerTimestamp) return Timestamp.now()
  if (Array.isArray(value)) return value.map(stamped)
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, stamped(entry)]))
  }
  return value
}

const mergeInto = (existing: Doc, data: Doc): Doc => {
  const out: Doc = { ...existing }
  for (const [key, value] of Object.entries(data)) {
    if (value === mockDelete) delete out[key]
    else if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && out[key] && typeof out[key] === 'object') {
      out[key] = mergeInto(out[key], value)
    } else out[key] = value
  }
  return out
}

const commitSet = (path: string, data: Doc, merge: boolean) => {
  writes.push({ path, data })
  const cut = path.lastIndexOf('/')
  const value = stamped(data) as Doc
  seed(path.slice(0, cut), path.slice(cut + 1), merge ? mergeInto(read(path) ?? {}, value) : value)
}

function collectionRef(path: string, filters: Array<[string, unknown]> = []): any {
  const docs = () =>
    [...(store.get(path) ?? new Map()).entries()].filter(([, data]) =>
      filters.every(([field, value]) => data?.[field] === value),
    )
  const ref: any = {
    path,
    limit: () => ref,
    where: (field: string, _op: string, value: unknown) => collectionRef(path, [...filters, [field, value]]),
    select: () => ref,
    count: () => ({ get: async () => ({ data: () => ({ count: docs().length }) }) }),
    get: async () => ({ docs: docs().map(([id, data]) => snapshotOf(path, id, data)) }),
    doc: (id: string) => docRef(path, id),
    add: async () => undefined,
  }
  return ref
}

const snapshotOf = (path: string, id: string, data: Doc | undefined) => ({
  id,
  exists: data !== undefined,
  ref: docRef(path, id),
  data: () => data,
  get: (field: string) => (data ?? {})[field],
})

function docRef(collectionPath: string, id: string): any {
  return {
    id,
    path: `${collectionPath}/${id}`,
    get: async () => snapshotOf(collectionPath, id, store.get(collectionPath)?.get(id)),
    collection: (name: string) => collectionRef(`${collectionPath}/${id}/${name}`),
  }
}

const mockFirestore = {
  collection: (name: string) => collectionRef(name),
  batch: () => {
    const queued: Array<() => void> = []
    return {
      set: (ref: any, data: Doc, options?: { merge?: boolean }) => {
        queued.push(() => commitSet(ref.path, data, Boolean(options?.merge)))
      },
      delete: (ref: any) => {
        queued.push(() => {
          deletes.push(ref.path)
          const cut = ref.path.lastIndexOf('/')
          store.get(ref.path.slice(0, cut))?.delete(ref.path.slice(cut + 1))
        })
      },
      commit: async () => {
        for (const run of queued) run()
      },
    }
  },
  runTransaction: async (body: (tx: any) => Promise<any>) => {
    const queued: Array<() => void> = []
    const result = await body({
      get: async (ref: any) => ref.get(),
      set: (ref: any, data: Doc, options?: { merge?: boolean }) => {
        queued.push(() => commitSet(ref.path, data, Boolean(options?.merge)))
      },
    })
    for (const run of queued) run()
    return result
  },
}

let mockOrg: Doc = { plan: 'enterprise' }

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => mockFirestore,
    }),
    firestore: {
      FieldValue: { serverTimestamp: () => mockServerTimestamp, delete: () => mockDelete },
    },
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: mockOrg }),
  isImpersonationSession: () => false,
  lockdownRefusal: async () => null,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  scopedToHost: (ref: any) => ref,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/collection-kind'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/scope-tokens'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/name-search'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/artifact-list-keys'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/binding-tokens'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/screen-route'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/stored-nodes'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/site-interactions'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/collection-entries'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/content-authors'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/platform-brand'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: Object.fromEntries(new URL(request.url).searchParams),
    body: request.method === 'GET' ? undefined : await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

import { Timestamp } from 'firebase-admin/firestore'
import { GET as EXPORT_GET } from '../app/api/hosts/export/route'
import { POST as IMPORT_POST } from '../app/api/hosts/import/route'
import { registerPluginServerDeclarations } from '../constants/plugins.declarations.server.generated'
import { SITE_EXPORT_FORMAT } from '../app/api/_lib/site-export'
import { decodeStoredNodes, PLAN_ENTITLEMENTS } from '@aglyn/aglyn/server'

const HOST = {
  memberRoles: { 'user-1': 'admin' },
  orgId: 'org-1',
  subdomain: 'acme',
  displayName: 'Acme',
  theme: { primary: '#123456' },
  screens: { 'page-home': '/', 'page-about': '/about' },
}

const NODES = (text: string, extra: Doc = {}) => ({
  root: { $id: 'root', componentId: 'div', nodes: ['text'] },
  text: { $id: 'text', componentId: 'typography', nodes: [], props: { children: text, ...extra } },
})

const resetSite = () => {
  store.clear()
  writes.length = 0
  deletes.length = 0
  seed('hosts', 'host-1', { ...HOST })
  seed('hosts/host-1/layouts', 'layout-chrome', { displayName: 'Chrome', versionId: 'layout-v1' })
  seed('hosts/host-1/layouts/layout-chrome/versions', 'layout-v1', { nodes: NODES('Header'), rootId: 'root' })
  seed('hosts/host-1/screens', 'page-home', {
    displayName: 'Home',
    slug: '',
    kind: 'page',
    layoutId: 'layout-chrome',
    versionId: 'home-v1',
  })
  seed('hosts/host-1/screens/page-home/versions', 'home-v1', {
    nodes: NODES('Welcome', { href: 'screen:page-about' }),
    rootId: 'root',
    screenId: 'page-home',
  })
  seed('hosts/host-1/screens', 'page-about', {
    displayName: 'About',
    slug: 'about',
    kind: 'page',
    versionId: 'about-v1',
  })
  seed('hosts/host-1/screens/page-about/versions', 'about-v1', {
    nodes: NODES('About us'),
    rootId: 'root',
    screenId: 'page-about',
  })
}

const call = async (body: Doc) => {
  const response = await IMPORT_POST(
    new Request('https://app.aglyn.com/api/hosts/import', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ hostId: 'host-1', ...body }),
    }),
  )
  return { status: response.status, body: await response.json() }
}

const exportSite = async (query = '') => {
  const response = await EXPORT_GET(
    new Request(`https://app.aglyn.com/api/hosts/export?hostId=host-1${query}`, {
      headers: { authorization: 'Bearer tok' },
    }),
  )
  expect(response.status).toBe(200)
  return JSON.parse(await response.text())
}

const planItem = (plan: any, key: string) => plan.items.find((one: any) => one.key === key)
const siteWrites = () => writes.filter((one) => !one.path.includes('/packageImports/'))

beforeAll(async () => {
  await registerPluginServerDeclarations()
})

beforeEach(() => {
  jest.clearAllMocks()
  mockOrg = { plan: 'enterprise' }
  resetSite()
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email: 'admin@example.com', email_verified: true })
})

describe('the export', () => {
  it('writes an aglyn-package v2 with each item hashed and its dependencies listed', async () => {
    const pkg = await exportSite()
    expect(pkg.manifest).toMatchObject({ format: 'aglyn-package', version: 2, source: 'Acme' })
    const home = pkg.manifest.items.find((one: any) => one.$id === 'page-home')
    expect(home).toMatchObject({ kind: 'page', name: 'Home' })
    expect(home.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(home.deps).toEqual(
      expect.arrayContaining([
        { kind: 'layout', id: 'layout-chrome' },
        { kind: 'page', id: 'page-about' },
      ]),
    )
    expect(pkg.items['page/page-home'].route).toBe('/')
    expect(pkg.items['settings/settings']).toEqual({ displayName: 'Acme' })
    expect(pkg.items['theme/theme']).toEqual({ theme: { primary: '#123456' } })
  })

  it('carries a chosen item alone, or with what it needs', async () => {
    const alone = await exportSite('&items=page/page-home')
    expect(alone.manifest.items.map((one: any) => one.$id)).toEqual(['page-home'])
    const withDeps = await exportSite('&items=page/page-home&dependencies=1')
    expect(withDeps.manifest.items.map((one: any) => one.$id).sort()).toEqual(['layout-chrome', 'page-about', 'page-home'])
  })

  it('lists the manifest alone for the picker', async () => {
    const list = await exportSite('&list=1')
    expect(list.items).toBeUndefined()
    expect(list.manifest.items.length).toBeGreaterThan(0)
    expect(list.kinds).toEqual(expect.arrayContaining([{ kind: 'page', label: 'Pages' }]))
  })
})

describe('the plan writes nothing and tells new from identical from changed', () => {
  it('sees a site’s own export as identical, item for item', async () => {
    const pkg = await exportSite()
    const { status, body } = await call({ action: 'plan', package: pkg })
    expect(status).toBe(200)
    expect(body.plan.counts).toEqual({ new: 0, identical: pkg.manifest.items.length, differs: 0, missingDependency: 0 })
    expect(writes).toEqual([])
  })

  it('sees an edit made since as differs, proposing skip until the person chooses', async () => {
    const pkg = await exportSite()
    seed('hosts/host-1/screens', 'page-about', { ...read('hosts/host-1/screens/page-about'), displayName: 'About us' })
    const { body } = await call({ action: 'plan', package: pkg })
    expect(planItem(body.plan, 'page/page-about')).toMatchObject({
      status: 'differs',
      proposed: 'skip',
      needsChoice: true,
      choices: ['replace', 'keepBoth', 'skip'],
    })
    expect(planItem(body.plan, 'page/page-home').status).toBe('identical')
  })

  it('reports an item that needs what neither the file nor the site holds', async () => {
    const pkg = await exportSite('&items=page/page-home')
    store.get('hosts/host-1/layouts')!.delete('layout-chrome')
    const { body } = await call({ action: 'plan', package: pkg })
    expect(planItem(body.plan, 'page/page-home')).toMatchObject({
      status: 'missingDependency',
      missing: [{ kind: 'layout', id: 'layout-chrome' }],
    })
  })

  it('reads a v1 backup, converted in memory', async () => {
    const legacy = {
      format: SITE_EXPORT_FORMAT,
      version: 1,
      host: { displayName: 'Acme', screens: { 'page-new': '/new' } },
      screens: [{ $id: 'page-new', displayName: 'New', slug: 'new', kind: 'page' }],
    }
    const { body } = await call({ action: 'plan', bundle: legacy })
    expect(body.format).toBe(1)
    expect(planItem(body.plan, 'page/page-new')).toMatchObject({ status: 'new', proposed: 'create' })
    expect(planItem(body.plan, 'settings/settings').status).toBe('identical')
  })
})

describe('compare answers both sides of an item, writing nothing (AGL-3534)', () => {
  it('gives the file’s item and the site item it matched, each as an import would write it', async () => {
    const pkg = await exportSite('&items=page/page-about')
    pkg.items['page/page-about'].version.nodes.text.props.children = 'About us, rewritten'
    const { status, body } = await call({ action: 'compare', package: pkg, keys: ['page/page-about', 'page/nowhere'] })
    expect(status).toBe(200)
    expect(body.items).toHaveLength(1)
    const [about] = body.items
    expect(about).toMatchObject({ key: 'page/page-about', kind: 'page', id: 'page-about', existing: { id: 'page-about' } })
    expect(about.incoming.version.nodes.text.props.children).toBe('About us, rewritten')
    expect(about.existing.content.version.nodes.text.props.children).toBe('About us')
    expect(about.existing.content.route).toBe('/about')
    expect(writes).toEqual([])
  })

  it('asks for at least one item and at most ten', async () => {
    const pkg = await exportSite('&items=page/page-about')
    expect((await call({ action: 'compare', package: pkg, keys: [] })).status).toBe(400)
    const many = Array.from({ length: 11 }, (_unused, n) => `page/p-${n}`)
    expect((await call({ action: 'compare', package: pkg, keys: many })).status).toBe(400)
  })
})

describe('applying decisions', () => {
  it('keeps both: a copy under a new id and slug, routed beside the original, references moved', async () => {
    const pkg = await exportSite()
    pkg.items['page/page-about'].displayName = 'About (new)'
    const { status, body } = await call({
      action: 'apply',
      package: pkg,
      decisions: { 'page/page-about': 'keepBoth', 'page/page-home': 'replace' },
    })
    expect(status).toBe(200)
    expect(body.counts).toMatchObject({ keepBoth: 1, replace: 1 })
    const copyId = Object.keys(read('hosts/host-1')!.screens).find((id) => !['page-home', 'page-about'].includes(id))!
    expect(read(`hosts/host-1/screens/${copyId}`)).toMatchObject({ displayName: 'About (new)', slug: 'about-copy' })
    expect(read('hosts/host-1')!.screens[copyId]).toBe('/about-copy')
    // The original stays as it was.
    expect(read('hosts/host-1/screens/page-about')).toMatchObject({ displayName: 'About', slug: 'about' })
    // The replaced home page links to the copy now — the file's About.
    const home = read('hosts/host-1/screens/page-home')!
    const version = read(`hosts/host-1/screens/page-home/versions/${home['versionId']}`)!
    expect(decodeStoredNodes(version['nodes'])).toMatchObject({ text: { props: { href: `screen:${copyId}` } } })
  })

  it('replaces a page as a new version, keeping the one it had', async () => {
    const pkg = await exportSite('&items=page/page-about')
    pkg.items['page/page-about'].version.nodes.text.props.children = 'About us, rewritten'
    const { status } = await call({ action: 'apply', package: pkg, decisions: { 'page/page-about': 'replace' } })
    expect(status).toBe(200)
    const about = read('hosts/host-1/screens/page-about')!
    expect(about['versionId']).not.toBe('about-v1')
    expect(read('hosts/host-1/screens/page-about/versions/about-v1')).toBeDefined()
    expect(
      decodeStoredNodes(read(`hosts/host-1/screens/page-about/versions/${about['versionId']}`)!['nodes']),
    ).toMatchObject({ text: { props: { children: 'About us, rewritten' } } })
  })

  it('skips what the person skipped, and writes nothing for an identical file', async () => {
    const pkg = await exportSite()
    const { body } = await call({ action: 'apply', package: pkg })
    expect(body.written).toBe(0)
    expect(siteWrites().filter((one) => one.path !== 'hosts/host-1')).toEqual([])
  })

  it('refuses a decision an item may not take', async () => {
    const pkg = await exportSite()
    const { status, body } = await call({ action: 'apply', package: pkg, decisions: { 'settings/settings': 'keepBoth' } })
    expect(status).toBe(400)
    expect(body.problems[0]).toContain('settings/settings cannot be "keepBoth"')
  })

  it('maps a missing dependency onto an item the site holds', async () => {
    const pkg = await exportSite('&items=page/page-about')
    pkg.items['page/page-about'].layoutId = 'layout-elsewhere'
    pkg.items['page/page-about'].displayName = 'About, laid out'
    const { body } = await call({
      action: 'apply',
      package: pkg,
      decisions: { 'page/page-about': 'replace' },
      dependencyChoices: { 'layout/layout-elsewhere': { mapTo: 'layout-chrome' } },
    })
    expect(body.warnings.map((one: any) => one.code)).toEqual(['mappedReference'])
    expect(read('hosts/host-1/screens/page-about')!['layoutId']).toBe('layout-chrome')
  })

  it('merges settings key by key the way the person chose', async () => {
    const pkg = await exportSite('&items=settings/settings')
    pkg.items['settings/settings'] = { displayName: 'Acme Two', locale: 'fr' }
    seed('hosts', 'host-1', { ...read('hosts/host-1'), locale: 'en' })
    const { status } = await call({
      action: 'apply',
      package: pkg,
      decisions: { 'settings/settings': 'merge' },
      mergeChoices: { 'settings/settings': { displayName: 'package' } },
    })
    expect(status).toBe(200)
    expect(read('hosts/host-1')).toMatchObject({ displayName: 'Acme Two', locale: 'en' })
  })

  it('stamps the importing admin as the approver of an off-site redirect', async () => {
    const pkg = await exportSite('&items=settings/settings')
    pkg.manifest.items.push({ kind: 'redirect', $id: 'redirect-1', contentHash: 'sha256:x', deps: [] })
    pkg.items['redirect/redirect-1'] = {
      source: '/out',
      destination: 'https://elsewhere.example/',
      statusCode: 302,
      externalDestinationApprovedBy: 'someone-else',
    }
    const { status } = await call({ action: 'apply', package: pkg })
    expect(status).toBe(200)
    expect(read('hosts/host-1/redirects/redirect-1')).toMatchObject({
      destination: 'https://elsewhere.example/',
      externalDestinationApprovedBy: 'user-1',
    })
  })
})

describe('caps count only what an import adds', () => {
  const fillTo = (count: number) => {
    for (let n = 0; n < count; n += 1) seed('hosts/host-1/screens', `held-${n}`, { displayName: `Held ${n}`, kind: 'page' })
    seed('hosts', 'host-1', {
      ...read('hosts/host-1'),
      screens: {
        ...read('hosts/host-1')!.screens,
        ...Object.fromEntries(Array.from({ length: count }, (_unused, n) => [`held-${n}`, `/held-${n}`])),
      },
    })
  }

  it('lets a replace land on a site at its cap, and refuses a kept copy that would add a page', async () => {
    mockOrg = { plan: 'pro' }
    fillTo(PLAN_ENTITLEMENTS.pro.screensPerHost - 2)
    const pkg = await exportSite('&items=page/page-about')
    pkg.items['page/page-about'].displayName = 'About, again'

    // The proposed decisions skip the changed page, which adds nothing; a copy
    // would add one past the cap, and the plan says so before anything is written.
    expect((await call({ action: 'plan', package: pkg })).body.capRefusal).toBeNull()
    const plan = await call({ action: 'plan', package: pkg, decisions: { 'page/page-about': 'keepBoth' } })
    expect(plan.body.capRefusal).toContain(`of ${PLAN_ENTITLEMENTS.pro.screensPerHost}`)

    const copy = await call({ action: 'apply', package: pkg, decisions: { 'page/page-about': 'keepBoth' } })
    expect(copy.status).toBe(403)
    expect(copy.body.error).toContain(`of ${PLAN_ENTITLEMENTS.pro.screensPerHost}`)

    const replace = await call({ action: 'apply', package: pkg, decisions: { 'page/page-about': 'replace' } })
    expect(replace.status).toBe(200)
  })
})

describe('undo', () => {
  it('puts a replaced page back and removes the version the import added', async () => {
    const pkg = await exportSite('&items=page/page-about')
    pkg.items['page/page-about'].displayName = 'About, replaced'
    pkg.items['page/page-about'].version.nodes.text.props.children = 'Replaced'
    const applied = await call({ action: 'apply', package: pkg, decisions: { 'page/page-about': 'replace' } })
    const newVersion = read('hosts/host-1/screens/page-about')!['versionId']
    expect(newVersion).not.toBe('about-v1')

    const plan = await call({ action: 'undoPlan', importId: applied.body.importId })
    expect(plan.body.counts).toEqual({ restore: 1, delete: 0, conflict: 0 })

    const undone = await call({ action: 'undo', importId: applied.body.importId })
    expect(undone.status).toBe(200)
    expect(read('hosts/host-1/screens/page-about')).toMatchObject({ displayName: 'About', versionId: 'about-v1' })
    expect(read(`hosts/host-1/screens/page-about/versions/${newVersion}`)).toBeUndefined()

    const again = await call({ action: 'undo', importId: applied.body.importId })
    expect(again.status).toBe(409)
  })

  it('deletes what an import created, and its address', async () => {
    const legacy = {
      format: SITE_EXPORT_FORMAT,
      version: 1,
      host: { screens: { 'page-new': '/new' } },
      screens: [{ $id: 'page-new', displayName: 'New', slug: 'new', kind: 'page', versionId: 'new-v1', version: { $id: 'new-v1', nodes: NODES('New') } }],
    }
    const applied = await call({ action: 'apply', bundle: legacy, mode: 'restore' })
    expect(read('hosts/host-1/screens/page-new')).toBeDefined()
    expect(read('hosts/host-1')!.screens['page-new']).toBe('/new')

    await call({ action: 'undo', importId: applied.body.importId })
    expect(read('hosts/host-1/screens/page-new')).toBeUndefined()
    expect(read('hosts/host-1/screens/page-new/versions/new-v1')).toBeUndefined()
    expect(read('hosts/host-1')!.screens['page-new']).toBeUndefined()
  })

  it('leaves an item edited since as a conflict unless the person says revert', async () => {
    const pkg = await exportSite('&items=page/page-about')
    pkg.items['page/page-about'].displayName = 'About, replaced'
    const applied = await call({ action: 'apply', package: pkg, decisions: { 'page/page-about': 'replace' } })
    seed('hosts/host-1/screens', 'page-about', {
      ...read('hosts/host-1/screens/page-about'),
      displayName: 'Edited after',
      updatedAt: Timestamp.fromMillis(Date.now() + 60_000),
    })

    const plan = await call({ action: 'undoPlan', importId: applied.body.importId })
    expect(plan.body.conflicts).toEqual([expect.objectContaining({ key: 'page/page-about', step: 'restore' })])

    const kept = await call({ action: 'undo', importId: applied.body.importId })
    expect(kept.body).toMatchObject({ reverted: 0, kept: 1 })
    expect(read('hosts/host-1/screens/page-about')!['displayName']).toBe('Edited after')

    const reverted = await call({ action: 'undo', importId: applied.body.importId, decisions: { 'page/page-about': 'revert' } })
    expect(reverted.body).toMatchObject({ reverted: 1, kept: 0 })
    expect(read('hosts/host-1/screens/page-about')!['displayName']).toBe('About')
  })
})
