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
 * The recipe routes (AGL-2639): the org hub's door to a site's automations.
 *
 * What the install must hold: the document is the action the recipe
 * builds, in the stored shape the site editor writes, stamped with the
 * recipe's id by the server; a second install of the same recipe on the
 * same site is refused by that stamp, naming the action, while a
 * soft-deleted one frees the slot; a site outside the org the caller holds
 * reads as unknown; a site collaborator is refused whatever their site
 * role; the plan gate the site's own menu applies is judged here too. And
 * the status: the stamps read back per site of the org, with the actions
 * that carry no stamp counted rather than ignored.
 *
 * Firestore is an in-memory map keyed by document path, so every
 * assertion reads what LANDED rather than what the handler answered.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import {
  ACTIONS_MAX_PER_HOST,
  crmActionRecipe,
  hostActionDocument,
} from '@aglyn/aglyn/server'

// ---------------------------------------------------------------------------
// In-memory Firestore: documents by path; queries over one collection with
// `where ==`, a field mask, and a transaction that reads then creates.
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function snapshot(path: string, mask?: string[]) {
  const stored = docs.get(path)
  const data =
    stored && mask
      ? Object.fromEntries(Object.entries(stored).filter(([key]) => mask.includes(key)))
      : stored
  return {
    id: path.split('/').pop() as string,
    exists: stored !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
    ref: docRef(path),
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => snapshot(path),
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  const make = (filters: Array<[string, unknown]>, mask?: string[]): any => ({
    path,
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') throw new Error(`fake firestore: unsupported op ${op}`)
      return make([...filters, [field, value]], mask)
    },
    select: (...fields: string[]) => make(filters, fields),
    get: async () => {
      const hits = childPaths(path)
        .filter((key) =>
          filters.every(([field, value]) => docs.get(key)?.[field] === value),
        )
        .map((key) => snapshot(key, mask))
      return { empty: hits.length === 0, size: hits.length, docs: hits }
    },
    doc: (id?: string) => docRef(`${path}/${id ?? `auto-${docs.size}`}`),
  })
  return make([])
}

const fakeFirestore = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (body: (tx: any) => Promise<unknown>) =>
    body({
      get: async (query: any) => query.get(),
      create: (ref: any, value: Record<string, any>) => {
        if (docs.has(ref.path)) throw new Error(`ALREADY_EXISTS: ${ref.path}`)
        docs.set(ref.path, { ...value })
      },
    }),
}

// ---------------------------------------------------------------------------
// The seams
// ---------------------------------------------------------------------------

const ORG = 'org-1'
const OTHER_ORG = 'org-2'
let mockDecoded: Record<string, unknown> = { uid: 'u-1', email: 'ada@acme.test' }
let mockPermissions: Record<string, unknown>
let orgs: Record<string, Record<string, unknown>>
const mockVerifyIdToken = jest.fn(async () => mockDecoded)
const mockResolveOrgPermissions = jest.fn(async () => mockPermissions)
const mockLogHostActivity = jest.fn(async () => undefined)
const mockLogOrgActivity = jest.fn(async () => undefined)

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: (...args: unknown[]) => (mockResolveOrgPermissions as any)(...args),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => (mockVerifyIdToken as any)(...args) }),
      firestore: () => fakeFirestore,
    }),
  },
  getOrgDoc: async (orgId: string) => orgs[orgId] ?? null,
  getOrgForHost: async (hostId: string) => {
    const orgId = docs.get(`hosts/${hostId}`)?.['orgId']
    return orgId && orgs[orgId] ? { orgId, org: orgs[orgId] } : null
  },
  logHostActivity: (...args: unknown[]) => (mockLogHostActivity as any)(...args),
  logOrgActivity: (...args: unknown[]) => (mockLogOrgActivity as any)(...args),
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__serverTimestamp' },
}))

import {
  CRM_RECIPE_INSTALL_ROUTE,
  CRM_RECIPE_STATUS_ROUTE,
  crmRecipeInstallHandler,
  crmRecipeStatusHandler,
} from './recipe-routes'

async function call(
  handler: typeof crmRecipeInstallHandler,
  body: unknown,
  options: { method?: string; token?: string | null } = {},
) {
  const { method = 'POST', token = 'token' } = options
  let status = 0
  let answer: any
  const res = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      answer = value
    },
    setHeader: () => undefined,
    send: () => undefined,
  } as unknown as PluginApiResponse
  const req = {
    method,
    body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    query: {},
  } as unknown as PluginApiRequest
  await handler(req, res)
  return { status, answer }
}

const install = (body: unknown, options?: { method?: string; token?: string | null }) =>
  call(crmRecipeInstallHandler, body, options)
const status = (body: unknown, options?: { method?: string; token?: string | null }) =>
  call(crmRecipeStatusHandler, body, options)

/** The site's actions as they landed, by id. */
const actionsOf = (hostId: string) =>
  Object.fromEntries(
    childPaths(`hosts/${hostId}/actions`).map((path) => [
      path.split('/').pop() as string,
      docs.get(path) as Record<string, any>,
    ]),
  )

const orgWideManager = () => ({
  orgId: ORG,
  role: 'editor',
  isOwner: false,
  permissions: { 'data.manage': true },
  orgWide: true,
  hostRole: 'editor',
})

beforeEach(() => {
  docs.clear()
  mockDecoded = { uid: 'u-1', email: 'ada@acme.test' }
  mockPermissions = orgWideManager()
  orgs = {
    [ORG]: { $id: ORG, plan: 'business' },
    [OTHER_ORG]: { $id: OTHER_ORG, plan: 'business' },
  }
  docs.set('hosts/host-a', {
    orgId: ORG,
    displayName: 'Demo Bakery',
    subdomain: 'demo',
    memberRoles: { 'u-1': 'editor', 'u-viewer': 'viewer' },
  })
  docs.set('hosts/host-b', { orgId: ORG, subdomain: 'second', memberRoles: {} })
  docs.set('hosts/host-x', { orgId: OTHER_ORG, displayName: 'Elsewhere', memberRoles: {} })
  mockLogHostActivity.mockClear()
  mockLogOrgActivity.mockClear()
  mockResolveOrgPermissions.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

const welcome = { orgId: ORG, hostId: 'host-a', recipeId: 'welcomeNewLead' }

describe('crm/recipe-install', () => {
  it('is registered under the names the client posts to', () => {
    expect(CRM_RECIPE_INSTALL_ROUTE).toBe('crm/recipe-install')
    expect(CRM_RECIPE_STATUS_ROUTE).toBe('crm/recipe-status')
  })

  it('writes the action the recipe builds, in the stored shape, stamped by the server, into the site’s actions', async () => {
    const { status: code, answer } = await install(welcome)
    expect(code).toBe(201)
    expect(answer).toEqual({
      ok: true,
      actionId: expect.any(String),
      name: 'Welcome a new lead',
      recipeId: 'welcomeNewLead',
    })
    const landed = actionsOf('host-a')
    expect(Object.keys(landed)).toEqual([answer.actionId])
    expect(landed[answer.actionId]).toEqual({
      ...hostActionDocument(crmActionRecipe('welcomeNewLead')!.build()),
      createdAt: '__serverTimestamp',
      updatedAt: '__serverTimestamp',
      createdBy: 'u-1',
    })
    expect(landed[answer.actionId].recipe).toBe('welcomeNewLead')
    expect(landed[answer.actionId].enabled).toBe(true)
    // The caps are written OUT, as the editor writes them.
    expect(landed[answer.actionId].trigger).toMatchObject({
      event: 'contactCreated',
      oncePerVisitor: false,
      cooldownMinutes: null,
      condition: null,
      combinator: 'and',
    })
    // The site's feed carries the act, and so does the org's — it is the
    // org hub that performed it.
    expect(mockLogHostActivity).toHaveBeenCalledWith(
      'host-a',
      { uid: 'u-1', email: 'ada@acme.test' },
      'Installed recipe',
      { type: 'content', id: answer.actionId, name: 'Welcome a new lead' },
    )
    expect(mockLogOrgActivity).toHaveBeenCalledWith(
      ORG,
      { uid: 'u-1', email: 'ada@acme.test' },
      'Installed the “Welcome a new lead” recipe on Demo Bakery',
      { type: 'host', id: 'host-a', name: 'Demo Bakery' },
    )
  })

  it('refuses a second install of the same recipe on the same site, naming the action it already has', async () => {
    docs.set('hosts/host-a/actions/older', { name: 'Welcome', recipe: 'welcomeNewLead', steps: [] })
    const { status: code, answer } = await install(welcome)
    expect(code).toBe(409)
    expect(answer).toEqual({ error: 'Already installed on this site', actionId: 'older' })
    expect(Object.keys(actionsOf('host-a'))).toEqual(['older'])
    expect(mockLogHostActivity).not.toHaveBeenCalled()
    // A DIFFERENT recipe on the same site is a different install.
    expect((await install({ ...welcome, recipeId: 'followUpWonDeal' })).status).toBe(201)
    // The same recipe on ANOTHER site is not a duplicate either.
    expect((await install({ ...welcome, hostId: 'host-b' })).status).toBe(201)
  })

  it('treats a soft-deleted action as a freed slot: the recipe can be installed again', async () => {
    docs.set('hosts/host-a/actions/gone', {
      name: 'Welcome',
      recipe: 'welcomeNewLead',
      steps: [],
      deletedAt: { seconds: 1 },
    })
    const { status: code } = await install(welcome)
    expect(code).toBe(201)
    expect(Object.keys(actionsOf('host-a'))).toHaveLength(2)
  })

  it('does not read an older action’s silence as the recipe: an unstamped action never blocks an install', async () => {
    docs.set('hosts/host-a/actions/legacy', { name: 'Welcome a new lead', steps: [] })
    expect((await install(welcome)).status).toBe(201)
  })

  it('refuses a site-scoped member whatever their site role, and an org-wide one without data.manage', async () => {
    mockPermissions = { ...orgWideManager(), orgWide: false, hostRole: 'admin' }
    expect((await install(welcome)).status).toBe(403)
    mockPermissions = { ...orgWideManager(), permissions: { 'data.manage': false } }
    expect((await install(welcome)).status).toBe(403)
    // A membership resolved in ANOTHER org is not reach in this one.
    mockPermissions = { ...orgWideManager(), orgId: OTHER_ORG }
    expect((await install(welcome)).status).toBe(403)
    expect(actionsOf('host-a')).toEqual({})
  })

  it('reads a site outside the org as unknown, so a host id typed into the body reaches nothing', async () => {
    const { status: code, answer } = await install({ ...welcome, hostId: 'host-x' })
    expect(code).toBe(404)
    expect(answer.error).toBe('Unknown site')
    expect(actionsOf('host-x')).toEqual({})
    expect((await install({ ...welcome, hostId: 'nope' })).status).toBe(404)
  })

  it('admits staff whatever the roster says', async () => {
    mockDecoded = { ...mockDecoded, staff: true }
    mockPermissions = { ...orgWideManager(), orgWide: false, permissions: {} }
    expect((await install(welcome)).status).toBe(201)
  })

  it('judges the plan gate the site’s own Recipes menu applies', async () => {
    orgs[ORG] = { $id: ORG, plan: 'starter' }
    const { status: code, answer } = await install(welcome)
    expect(code).toBe(403)
    expect(answer.error).toMatch(/plan/)
    expect(actionsOf('host-a')).toEqual({})
  })

  it('holds the per-site cap, counting live actions only', async () => {
    for (let index = 0; index < ACTIONS_MAX_PER_HOST; index += 1) {
      docs.set(`hosts/host-a/actions/a-${index}`, { name: `a${index}`, steps: [] })
    }
    const full = await install(welcome)
    expect(full.status).toBe(403)
    expect(full.answer.error).toMatch(/capped/)
    docs.set('hosts/host-a/actions/a-0', { name: 'a0', steps: [], deletedAt: { seconds: 1 } })
    expect((await install(welcome)).status).toBe(201)
  })

  describe('a recipe that needs a form', () => {
    const tag = { orgId: ORG, hostId: 'host-a', recipeId: 'tagByForm' }

    it('asks for one, and refuses a form the site does not have or has archived', async () => {
      const bare = await install(tag)
      expect(bare.status).toBe(400)
      expect(bare.answer.error).toMatch(/form/i)
      expect((await install({ ...tag, formId: 'nope' })).status).toBe(404)
      docs.set('hosts/host-a/forms/old', { displayName: 'Old', archivedAt: { seconds: 1 } })
      const archived = await install({ ...tag, formId: 'old' })
      expect(archived.status).toBe(400)
      expect(archived.answer.error).toMatch(/archived/)
      expect(actionsOf('host-a')).toEqual({})
    })

    it('keys the action on the form the server read, named after it', async () => {
      docs.set('hosts/host-a/forms/contact', { displayName: '  Contact us ' })
      const { status: code, answer } = await install({ ...tag, formId: 'contact' })
      expect(code).toBe(201)
      expect(answer.name).toBe('Tag Contact us submissions')
      const landed = actionsOf('host-a')[answer.actionId]
      expect(landed.recipe).toBe('tagByForm')
      expect(landed.trigger.conditions).toEqual([
        { field: 'formId', op: 'equals', value: 'contact' },
      ])
      expect(landed.steps).toEqual([{ type: 'addContactTag', tag: 'Contact us' }])
    })
  })

  describe('the site variant', () => {
    it('installs for a member holding a writing role on the host, with no org feed line', async () => {
      const { status: code } = await install({ hostId: 'host-a', recipeId: 'followUpWonDeal' })
      expect(code).toBe(201)
      expect(mockResolveOrgPermissions).not.toHaveBeenCalled()
      expect(mockLogHostActivity).toHaveBeenCalledTimes(1)
      expect(mockLogOrgActivity).not.toHaveBeenCalled()
    })

    it('refuses a viewer, a stranger, and a site that does not exist', async () => {
      mockDecoded = { uid: 'u-viewer' }
      expect((await install({ hostId: 'host-a', recipeId: 'followUpWonDeal' })).status).toBe(403)
      mockDecoded = { uid: 'u-stranger' }
      expect((await install({ hostId: 'host-a', recipeId: 'followUpWonDeal' })).status).toBe(403)
      mockDecoded = { uid: 'u-1' }
      expect((await install({ hostId: 'nope', recipeId: 'followUpWonDeal' })).status).toBe(404)
      expect(actionsOf('host-a')).toEqual({})
    })
  })

  it('answers the shape refusals before reading anything', async () => {
    expect((await install(welcome, { method: 'GET' })).status).toBe(405)
    expect((await install({ orgId: ORG, recipeId: 'welcomeNewLead' })).status).toBe(400)
    const unnamed = await install({ orgId: ORG, hostId: 'host-a' })
    expect(unnamed.status).toBe(400)
    expect(unnamed.answer.error).toBe('Pick a recipe')
    expect((await install({ ...welcome, recipeId: 'retired' })).status).toBe(400)
    expect((await install(welcome, { token: null })).status).toBe(401)
    expect(mockResolveOrgPermissions).not.toHaveBeenCalled()
    expect(actionsOf('host-a')).toEqual({})
  })
})

describe('crm/recipe-status', () => {
  it('reads the stamps back for every site of the org, counting unstamped actions rather than ignoring them', async () => {
    docs.set('hosts/host-a/actions/w', { name: 'W', recipe: 'welcomeNewLead', steps: [] })
    docs.set('hosts/host-a/actions/f', { name: 'F', recipe: 'followUpWonDeal', steps: [] })
    // A second copy of the same stamp is one recipe, not two.
    docs.set('hosts/host-a/actions/f2', { name: 'F2', recipe: 'followUpWonDeal', steps: [] })
    docs.set('hosts/host-a/actions/old', { name: 'Older', steps: [] })
    docs.set('hosts/host-a/actions/blank', { name: 'Blank', recipe: null, steps: [] })
    docs.set('hosts/host-a/actions/gone', {
      name: 'Gone',
      recipe: 'reengageStaleLead',
      steps: [],
      deletedAt: { seconds: 1 },
    })
    docs.set('hosts/host-b/actions/old', { name: 'Older', steps: [] })
    // Another org's site is not swept.
    docs.set('hosts/host-x/actions/w', { name: 'W', recipe: 'welcomeNewLead', steps: [] })
    const { status: code, answer } = await status({ orgId: ORG })
    expect(code).toBe(200)
    expect(answer).toEqual({
      ok: true,
      sites: [
        { hostId: 'host-a', installed: ['welcomeNewLead', 'followUpWonDeal'], unstamped: 1 },
        { hostId: 'host-b', installed: [], unstamped: 1 },
      ],
    })
  })

  it('refuses a site-scoped member and an org-wide one without data.manage', async () => {
    mockPermissions = { ...orgWideManager(), orgWide: false, hostRole: 'admin' }
    expect((await status({ orgId: ORG })).status).toBe(403)
    mockPermissions = { ...orgWideManager(), permissions: {} }
    expect((await status({ orgId: ORG })).status).toBe(403)
  })

  it('answers one site for its own writer, and the shape refusals first', async () => {
    docs.set('hosts/host-a/actions/w', { name: 'W', recipe: 'welcomeNewLead', steps: [] })
    const { status: code, answer } = await status({ hostId: 'host-a' })
    expect(code).toBe(200)
    expect(answer.sites).toEqual([{ hostId: 'host-a', installed: ['welcomeNewLead'], unstamped: 0 }])
    mockDecoded = { uid: 'u-viewer' }
    expect((await status({ hostId: 'host-a' })).status).toBe(403)
    expect((await status({}, {})).status).toBe(400)
    expect((await status({ orgId: ORG }, { method: 'GET' })).status).toBe(405)
    expect((await status({ orgId: ORG }, { token: null })).status).toBe(401)
  })
})
