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
 * Where a generation job's layout, page template (AGL-2909), form
 * (AGL-2913) or reusable component (AGL-2908) lands, against a Firestore
 * double that honors transactions, projections and `create`'s refusal of a
 * document that exists. The plan arithmetic is the REAL `checkQuota` and
 * `checkEntitlement`; only the host index read is stubbed.
 *
 *  - APPLIED TO NOTHING. Writing drafts changes no document that decides
 *    what a site serves: a screen bound to a layout, a collection's entry
 *    template, the store's product template, the host's routing map, built-in
 *    page layout, author page and a component a page places all read back
 *    unchanged, and nothing but the drafts themselves names a draft.
 *  - THE CREATE ROUTE'S DOCUMENT. The fields are the console route's
 *    allow-list, read from the route's own source in both directions, plus
 *    that route's stamps; a layout's first version carries the versions
 *    route's seed keys and nothing else; a component's collection, its plan
 *    feature and the route's refusal are read from the route as well.
 *  - COUNTED LIKE A CREATE, inside the transaction, with the route's
 *    arithmetic — including what its `!=` query does not count, and a
 *    component's feature, which the route asks where it counts nothing.
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
import type { ReusableComponentProp } from '@aglyn/aglyn/foundation/definitions/platform.types'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import {
  AI_DRAFT_BANDS,
  AI_DRAFT_ENTITLEMENT_REFUSAL,
  AI_DRAFT_FIELDS,
  AI_DRAFT_VERSION_FIELDS,
  AI_DRAFT_VERSION_NAME,
  aiDraftAdmissionRefusal,
  aiDraftAllowanceRefusal,
  aiPlanCapabilitiesFrom,
  readAiDraft,
  readAiPlanCapabilities,
  writeAiDraft,
  type AiDraftInput,
  type AiDraftKind,
} from './ai-job-drafts'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const NOW = new Date('2026-09-15T20:00:00.000Z')
/** A workspace with no plan resolves as Free: one shared layout, ten templates, no reusable components. */
const FREE_ORG: Partial<AglynOrgBilling> = {}
/** Starter: three shared layouts, fifty templates, reusable components. */
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

/** A generated form's design, canvas-shaped as the Forms page's Create stores one. */
const FORM_NODES = {
  [CANVAS_ROOT_ELEMENT_ID]: { $id: CANVAS_ROOT_ELEMENT_ID, componentId: 'div', nodes: ['quote'] },
  quote: {
    $id: 'quote',
    componentId: 'form',
    pluginId: 'forms',
    parentId: CANVAS_ROOT_ELEMENT_ID,
    props: { formId: 'job-form', formName: 'Quote request' },
    nodes: ['email'],
  },
  email: {
    $id: 'email',
    componentId: 'formField',
    pluginId: 'forms',
    parentId: 'quote',
    props: { fieldName: 'email', label: 'Email', fieldType: 'email' },
    nodes: [],
  },
} as unknown as NodesMap

function formInput(patch: Partial<AiDraftInput> = {}): AiDraftInput {
  return {
    kind: 'form',
    hostId: 'host-1',
    id: 'job-form',
    uid: 'uid-1',
    org: STARTER_ORG,
    name: 'Quote request',
    nodes: FORM_NODES,
    form: {
      rootId: CANVAS_ROOT_ELEMENT_ID,
      formNodeId: 'quote',
      fields: [{ fieldName: 'email', label: 'Email', fieldType: 'email' }],
      consentFieldName: 'marketingConsent',
      routing: { lead: true },
    },
    now: NOW,
    ...patch,
  }
}

const COMPONENT_NODES = {
  [CANVAS_ROOT_ELEMENT_ID]: { $id: CANVAS_ROOT_ELEMENT_ID, componentId: 'div', nodes: ['quote'] },
  quote: {
    $id: 'quote',
    componentId: 'muiTypography',
    pluginId: 'mui',
    parentId: CANVAS_ROOT_ELEMENT_ID,
    props: { variant: 'body1', children: '{{prop.quote}}' },
    nodes: [],
  },
} as unknown as NodesMap

const COMPONENT_PROPS: ReusableComponentProp[] = [
  { name: 'quote', type: 'richText', label: 'Quote', defaultValue: '[What the customer said]' },
]

function componentInput(patch: Partial<AiDraftInput> = {}): AiDraftInput {
  return {
    kind: 'component',
    hostId: 'host-1',
    id: 'job-component',
    uid: 'uid-1',
    org: STARTER_ORG,
    name: 'Testimonial card',
    nodes: COMPONENT_NODES,
    rootId: CANVAS_ROOT_ELEMENT_ID,
    props: COMPONENT_PROPS,
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
  mockDocs.set('hosts/host-1/screens/scr-home/versions/v-home', {
    layoutId: 'lay-site',
    nodes: { card: { componentId: 'reusableInstance', props: { refId: 'cmp-card' } } },
  })
  mockDocs.set('hosts/host-1/layouts/lay-site', { displayName: 'Site layout', versionId: 'v-site' })
  mockDocs.set('hosts/host-1/layouts/lay-inner', { displayName: 'Inner', layoutId: 'lay-site' })
  mockDocs.set('hosts/host-1/components/cmp-card', { displayName: 'Card', rootId: 'card-root', versionId: 'v-card' })
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
    const form = await writeAiDraft(firestore, formInput())
    const component = await writeAiDraft(firestore, componentInput())
    if (layout.ok === false || template.ok === false || form.ok === false || component.ok === false) {
      throw new Error('a draft was refused')
    }

    for (const [path, data] of before) {
      expect([path, JSON.stringify(mockDocs.get(path))]).toEqual([path, data])
    }
    expect([...commits].sort()).toEqual(
      [
        'hosts/host-1/layouts/job-layout',
        `hosts/host-1/layouts/job-layout/versions/${layout.versionId}`,
        'hosts/host-1/templates/job-template',
        'hosts/host-1/forms/job-form',
        'hosts/host-1/components/job-component',
      ].sort(),
    )
    const drafts = new Set(commits)
    for (const [path, data] of mockDocs) {
      if (drafts.has(path)) continue
      const text = JSON.stringify(data)
      expect([
        path,
        text.includes('job-layout') ||
          text.includes('job-template') ||
          text.includes('job-form') ||
          text.includes('job-component'),
      ]).toEqual([path, false])
    }
    // A form is promoted by setting its version pointer; the draft has none.
    expect(mockDocs.get('hosts/host-1/forms/job-form')).not.toHaveProperty('versionId')
    // A component renders only where an instance places it, and the live page places another.
    expect(mockDocs.get('hosts/host-1/components/job-component')).not.toHaveProperty('versionId')
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
    expect([...AI_DRAFT_FIELDS.form]).toEqual(fieldsOf('form'))
    expect([...AI_DRAFT_FIELDS.component]).toEqual(fieldsOf('reusableComponent'))
    // A page job's screen (AGL-2907); `ai-job-drafts-screen.spec.ts` holds the rest of its band.
    expect([...AI_DRAFT_FIELDS.screen]).toEqual(fieldsOf('screen'))

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

  it('counts each kind in the collection, on the counter and behind the feature the route declares', () => {
    const route = readFileSync(join(REPO_ROOT, 'apps/console/app/api/hosts/resources/route.ts'), 'utf8')
      .replace(/\/\/.*$/gm, '')
    // Each kind's entry in the route's own table, under the name the route gives it.
    const RESOURCE_OF: Record<AiDraftKind, string> = {
      layout: 'layout',
      template: 'template',
      form: 'form',
      component: 'reusableComponent',
      screen: 'screen',
    }
    for (const kind of Object.keys(RESOURCE_OF) as AiDraftKind[]) {
      const start = route.indexOf(`\n  ${RESOURCE_OF[kind]}: {`)
      expect([kind, start > -1]).toEqual([kind, true])
      const entry = route.slice(start, route.indexOf('fields: [', start))
      const declared = (key: string) => new RegExp(`${key}: '([A-Za-z]+)'`).exec(entry)?.[1]
      expect([kind, declared('collection'), declared('quotaKey'), declared('entitlement')]).toEqual([
        kind,
        AI_DRAFT_BANDS[kind].collection,
        AI_DRAFT_BANDS[kind].quotaKey,
        AI_DRAFT_BANDS[kind].entitlement,
      ])
    }
    // A plan without the feature is refused in the route's own words.
    expect(route).toContain(AI_DRAFT_ENTITLEMENT_REFUSAL)
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

describe('writeAiDraft — a form', () => {
  it('writes the document the Forms page’s Create sends, with its declaration and no version', async () => {
    mockOwners.set('host-1', 'org-1')
    mockDocs.set('hosts/host-1', { subdomain: 'acme' })
    const result = await writeAiDraft(firestore, formInput())
    expect(result).toEqual({
      ok: true,
      replayed: false,
      id: 'job-form',
      versionId: null,
      name: 'Quote request',
      hostSubdomain: 'acme',
    })
    const form = mockDocs.get('hosts/host-1/forms/job-form') ?? {}
    expect(form).toEqual({
      displayName: 'Quote request',
      slug: 'quote-request',
      fields: [{ fieldName: 'email', label: 'Email', fieldType: 'email' }],
      consentFieldName: 'marketingConsent',
      routing: { lead: true },
      rootId: CANVAS_ROOT_ELEMENT_ID,
      nodes: expect.any(Buffer),
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: 'uid-1',
    })
    expect(decodeStoredNodes(form['nodes'])).toEqual(FORM_NODES)
    expect(commits).toEqual(['hosts/host-1/forms/job-form'])
    expect(await readAiDraft(firestore, { kind: 'form', hostId: 'host-1', id: 'job-form' })).toEqual({
      id: 'job-form',
      versionId: null,
      name: 'Quote request',
      hostSubdomain: 'acme',
    })
  })

  it('names the form apart from a sibling, and captions its form node and slug with that name', async () => {
    mockOwners.set('host-1', 'org-1')
    mockDocs.set('hosts/host-1', {})
    mockDocs.set('hosts/host-1/forms/frm-a', { displayName: 'Quote request' })
    const result = await writeAiDraft(firestore, formInput({ form: { ...formInput().form!, routing: null, consentFieldName: null } }))
    expect(result).toMatchObject({ ok: true, name: 'Quote request 2' })
    const form = mockDocs.get('hosts/host-1/forms/job-form') ?? {}
    expect(form['slug']).toBe('quote-request-2')
    expect(form).not.toHaveProperty('routing')
    expect(form).not.toHaveProperty('consentFieldName')
    expect(decodeStoredNodes<Record<string, any>>(form['nodes'])?.['quote'].props.formName).toBe('Quote request 2')
  })

  it('meets the forms band as the route does: the plan’s feature first, then every form document', async () => {
    mockOwners.set('host-1', 'org-1')
    mockDocs.set('hosts/host-1', {})
    expect(await writeAiDraft(firestore, formInput({ org: FREE_ORG }))).toEqual({
      ok: false,
      status: 403,
      error: AI_DRAFT_ENTITLEMENT_REFUSAL,
    })
    // A retired form keeps its slot: the route counts every form document.
    mockDocs.set('hosts/host-1/forms/frm-retired', { displayName: 'Old', archivedAt: 5 })
    const capped = { ...STARTER_ORG, entitlements: { formsPerHost: 1 } } as unknown as Partial<AglynOrgBilling>
    expect(await writeAiDraft(firestore, formInput({ org: capped }))).toEqual({
      ok: false,
      status: 403,
      error: 'Your plan includes 1 forms — upgrade in Billing for more',
    })
    expect(await aiDraftAllowanceRefusal(firestore, { kind: 'form', hostId: 'host-1', org: capped })).toBe(
      'Your plan includes 1 forms — upgrade in Billing for more',
    )
    expect(commits).toEqual([])
    expect((await writeAiDraft(firestore, formInput({ org: STARTER_ORG }))).ok).toBe(true)
  })

  it('refuses to write a form that carries no declaration', async () => {
    await expect(writeAiDraft(firestore, formInput({ form: undefined }))).rejects.toThrow('declaration')
  })
})

describe('writeAiDraft — a reusable component', () => {
  it('writes its tree and the properties it binds, as Use template writes one, and no version', async () => {
    mockOwners.set('host-1', 'org-1')
    mockDocs.set('hosts/host-1', { subdomain: 'acme' })
    const result = await writeAiDraft(firestore, componentInput({ id: 'job-3' }))
    expect(result).toEqual({
      ok: true,
      replayed: false,
      id: 'job-3',
      versionId: null,
      name: 'Testimonial card',
      hostSubdomain: 'acme',
    })
    const component = mockDocs.get('hosts/host-1/components/job-3') ?? {}
    expect(component).toEqual({
      displayName: 'Testimonial card',
      rootId: CANVAS_ROOT_ELEMENT_ID,
      nodes: expect.any(Buffer),
      props: COMPONENT_PROPS,
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: 'uid-1',
    })
    for (const key of Object.keys(component)) {
      expect([key, [...AI_DRAFT_FIELDS.component, 'createdAt', 'updatedAt', 'createdBy'].includes(key)]).toEqual([
        key,
        true,
      ])
    }
    expect(decodeStoredNodes(component['nodes'])).toEqual(COMPONENT_NODES)
    // Its first version is minted when a member opens it, as for every component made outside the besigner.
    expect(commits).toEqual(['hosts/host-1/components/job-3'])
  })

  it('names the component apart from a live sibling', async () => {
    mockOwners.set('host-1', 'org-1')
    mockDocs.set('hosts/host-1', {})
    mockDocs.set('hosts/host-1/components/cmp-a', { displayName: 'Testimonial card' })
    expect(await writeAiDraft(firestore, componentInput())).toMatchObject({
      ok: true,
      name: 'Testimonial card 2',
    })
  })

  it('admits one only on a plan with reusable components, whatever the site already holds, counting nothing', async () => {
    mockOwners.set('host-1', 'org-1')
    mockDocs.set('hosts/host-1', {})
    for (let index = 0; index < 60; index += 1) {
      mockDocs.set(`hosts/host-1/components/cmp-${index}`, { displayName: `Component ${index}` })
    }
    expect(await writeAiDraft(firestore, componentInput({ org: FREE_ORG }))).toEqual({
      ok: false,
      status: 403,
      error: AI_DRAFT_ENTITLEMENT_REFUSAL,
    })
    expect(commits).toEqual([])
    expect(
      await aiDraftAllowanceRefusal(firestore, { kind: 'component', hostId: 'host-1', org: FREE_ORG }),
    ).toBe(AI_DRAFT_ENTITLEMENT_REFUSAL)
    expect(
      await aiDraftAllowanceRefusal(firestore, { kind: 'component', hostId: 'host-1', org: STARTER_ORG }),
    ).toBeNull()
    expect((await writeAiDraft(firestore, componentInput({ org: STARTER_ORG }))).ok).toBe(true)
  })

  it('refuses one whose root its node map does not hold, before anything is written', async () => {
    mockOwners.set('host-1', 'org-1')
    mockDocs.set('hosts/host-1', {})
    await expect(writeAiDraft(firestore, componentInput({ rootId: 'nowhere' }))).rejects.toThrow(
      'a component draft needs a root its node map holds',
    )
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

    const component = await writeAiDraft(firestore, componentInput())
    if (component.ok === false) throw new Error(component.error)
    expect(await writeAiDraft(firestore, componentInput({ name: 'Another name' }))).toEqual({
      ...component,
      replayed: true,
    })
    expect(await readAiDraft(firestore, { kind: 'component', hostId: 'host-1', id: 'job-component' })).toEqual({
      id: 'job-component',
      versionId: null,
      name: 'Testimonial card',
      hostSubdomain: 'acme',
    })
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
    expect(await ask({ kind: 'component', org: FREE_ORG })).toEqual({
      status: 403,
      error: AI_DRAFT_ENTITLEMENT_REFUSAL,
    })
    expect(await ask({ kind: 'component', hostId: null })).toEqual({
      status: 400,
      error: 'Open the site the component is for before starting the job',
    })
    expect(await ask({ kind: 'component' })).toBeNull()
    expect(commits).toEqual([])
  })
})

describe('readAiPlanCapabilities — what a plan may create on the site (AGL-3030)', () => {
  /** The double, recording which of a site's collections a read asked for. */
  function recording(): { handle: FirebaseFirestore.Firestore; read: string[] } {
    const read: string[] = []
    const handle = {
      collection: (name: string) => {
        const ref = firestore.collection(name) as unknown as {
          doc: (id: string) => { collection: (sub: string) => unknown }
        }
        return {
          ...ref,
          doc: (id: string) => {
            const doc = ref.doc(id)
            return {
              ...doc,
              collection: (sub: string) => {
                read.push(sub)
                return doc.collection(sub)
              },
            }
          },
        }
      },
    }
    return { handle: handle as unknown as FirebaseFirestore.Firestore, read }
  }

  it('tells a Free workspace it keeps no reusable components, saved forms or datasets, and what room its site has', async () => {
    seedLiveSite()
    const { handle, read } = recording()
    const capabilities = await readAiPlanCapabilities(handle, { hostId: 'host-1', org: FREE_ORG })
    expect(capabilities.reusableComponents).toBe(false)
    expect(capabilities.create.component).toEqual({
      allowed: false,
      left: 0,
      reason: "this workspace's plan does not include reusable components",
    })
    expect(capabilities.create.form).toEqual({
      allowed: false,
      left: 0,
      reason: "this workspace's plan does not include saved forms",
    })
    // The live site holds two layouts against the one the Free plan includes,
    // and its starter template counts against nothing.
    expect(capabilities.create.layout).toEqual({
      allowed: false,
      left: 0,
      reason: 'this site already holds the 1 shared layout its plan includes',
    })
    expect(capabilities.create.template).toEqual({ allowed: true, left: 10, reason: null })
    expect(capabilities.create.dataset).toEqual({
      allowed: false,
      left: 0,
      reason: "this workspace's plan does not include datasets",
    })
    expect(capabilities.create['theme-change']).toEqual({ allowed: true, left: null, reason: null })
    // Only the kinds a Free plan counts are read; a component or a form is refused on the feature.
    expect(read.sort()).toEqual(['layouts', 'templates'])
    expect(commits).toEqual([])
  })

  it('counts a Starter site against its own allowances, in the draft writer’s arithmetic', async () => {
    seedLiveSite()
    const { handle, read } = recording()
    const capabilities = await readAiPlanCapabilities(handle, { hostId: 'host-1', org: STARTER_ORG })
    expect(capabilities.reusableComponents).toBe(true)
    expect(capabilities.create.component).toEqual({ allowed: true, left: null, reason: null })
    expect(capabilities.create.layout).toEqual({ allowed: true, left: 1, reason: null })
    expect(capabilities.create.template).toEqual({ allowed: true, left: 50, reason: null })
    expect(capabilities.create.form).toMatchObject({ allowed: true })
    expect(read.sort()).toEqual(['forms', 'layouts', 'templates'])
    // The last layout it has room for is one the writer admits; one more is not.
    expect(await aiDraftAllowanceRefusal(firestore, { kind: 'layout', hostId: 'host-1', org: STARTER_ORG })).toBeNull()
    mockDocs.set('hosts/host-1/layouts/lay-third', { displayName: 'Third' })
    const full = aiPlanCapabilitiesFrom(STARTER_ORG, {
      layout: ['lay-site', 'lay-inner', 'lay-third'].map((id) => ({ id, kind: undefined, sourceType: undefined, deletedAt: undefined })),
    })
    expect(full.create.layout).toEqual({
      allowed: false,
      left: 0,
      reason: 'this site already holds the 3 shared layouts its plan includes',
    })
    expect(await aiDraftAllowanceRefusal(firestore, { kind: 'layout', hostId: 'host-1', org: STARTER_ORG })).toBe(
      'Your plan includes 3 shared layouts — upgrade in Billing for more',
    )
  })
})
