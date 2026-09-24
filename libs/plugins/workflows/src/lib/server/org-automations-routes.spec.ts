/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from there, and behind the license header the suite would run on jsdom.
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
 * The two doors onto `orgs/{orgId}/automations` (AGL-3302), and who may walk
 * through each.
 *
 * The collection is closed to client writes, so these ARE the boundary: the
 * organization's door (`automations/manage`) admits org-wide owners, admins
 * and editors of an organization whose Automation plugin is on, and refuses a
 * site collaborator whatever their role; the site's door
 * (`automations/pause`) admits that site's admins and editors and org-wide
 * editors, and changes only the named site's entry. Each refusal is pinned
 * beside the case it must not refuse, so a door that refused everybody would
 * fail here as loudly as one that admitted everybody.
 */

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
  },
}))

import type { PluginApiResponse } from '@aglyn/aglyn/server'
import { ORG_AUTOMATIONS_MAX } from '../model/org-automations'
import {
  createOrgAutomationPauseHandler,
  createOrgAutomationsManageHandler,
  type OrgAutomationRouteDeps,
  orgAutomationsManageSubject,
} from './org-automations-routes'

const ORG_ID = 'org-1'
const OTHER_ORG = 'org-2'
const SITE = 'site-a'
const SIBLING = 'site-b'
const FOREIGN_SITE = 'site-elsewhere'

/** Every document, by full path. */
let store: Map<string, Record<string, any>>
let activity: Array<{ scope: 'org' | 'host'; id: string; action: string; target: any }>
let nextId = 0

/** Who each bearer token is. */
const TOKENS: Record<string, string> = {
  owner: 'uid-owner',
  admin: 'uid-admin',
  editor: 'uid-editor',
  viewer: 'uid-viewer',
  collaborator: 'uid-collab',
  siteEditor: 'uid-site-editor',
  siteViewer: 'uid-site-viewer',
  outsider: 'uid-outsider',
}

/** Org memberships, by uid. */
const MEMBERS: Record<string, Record<string, unknown>> = {
  'uid-owner': { role: 'owner', allHosts: true },
  'uid-admin': { role: 'admin', allHosts: true },
  'uid-editor': { role: 'editor', allHosts: true },
  'uid-viewer': { role: 'viewer', allHosts: true },
  // A site collaborator: an EDITOR by role, scoped to site A only.
  'uid-collab': { role: 'editor', allHosts: false, hostAccess: { [SITE]: 'editor' } },
  'uid-site-editor': { role: 'viewer', allHosts: false, hostAccess: { [SITE]: 'editor' } },
  'uid-site-viewer': { role: 'viewer', allHosts: false, hostAccess: { [SITE]: 'viewer' } },
}

const isPlain = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Applies an update the way Firestore resolves its sentinels. */
function applyUpdate(previous: Record<string, any>, patch: Record<string, any>) {
  const next = { ...previous }
  for (const [key, value] of Object.entries(patch)) {
    if (isPlain(value) && '__arrayUnion' in value) {
      const list = Array.isArray(next[key]) ? [...next[key]] : []
      for (const one of value.__arrayUnion) if (!list.includes(one)) list.push(one)
      next[key] = list
    } else if (isPlain(value) && '__arrayRemove' in value) {
      next[key] = (Array.isArray(next[key]) ? next[key] : []).filter(
        (one: unknown) => !value.__arrayRemove.includes(one),
      )
    } else {
      next[key] = value
    }
  }
  return next
}

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    id: path.split('/').pop() ?? '',
    exists: data !== undefined,
    data: () => (data ? { ...data } : undefined),
    get: (field: string) => data?.[field],
  }
}

function docRef(path: string): any {
  return {
    path,
    id: path.split('/').pop() ?? '',
    get: async () => snapshotOf(path),
    create: async (data: Record<string, any>) => {
      if (store.has(path)) throw new Error(`already exists: ${path}`)
      store.set(path, data)
    },
  }
}

function collectionRef(path: string): any {
  const query = (filters: Array<[string, unknown]>): any => ({
    where: (field: string, _op: string, value: unknown) =>
      query([...filters, [field, value]]),
    count: () => ({
      get: async () => ({
        data: () => ({
          count: [...store.entries()].filter(
            ([key, row]) =>
              key.startsWith(`${path}/`) &&
              !key.slice(path.length + 1).includes('/') &&
              filters.every(([field, value]) => row[field] === value),
          ).length,
        }),
      }),
    }),
  })
  return { ...query([]), doc: (id: string) => docRef(`${path}/${id}`) }
}

const firestore: any = {
  collection: (name: string) => ({
    ...collectionRef(name),
    doc: (id: string) => ({
      ...docRef(`${name}/${id}`),
      collection: (child: string) => collectionRef(`${name}/${id}/${child}`),
    }),
  }),
  getAll: async (...refs: any[]) => refs.map((ref) => snapshotOf(ref.path)),
  runTransaction: async (body: (transaction: any) => Promise<any>) => {
    const writes: Array<() => void> = []
    const outcome = await body({
      get: async (ref: any) => snapshotOf(ref.path),
      update: (ref: any, patch: Record<string, any>) => {
        writes.push(() => store.set(ref.path, applyUpdate(store.get(ref.path) ?? {}, patch)))
      },
    })
    for (const write of writes) write()
    return outcome
  },
}

/** The org document `getOrgDoc` answers, swapped per case. */
let orgDoc: Record<string, unknown> | null

const deps: Partial<OrgAutomationRouteDeps> = {
  firestore: () => firestore,
  verifyIdToken: async (token) => {
    const uid = TOKENS[token]
    if (!uid) throw new Error('bad token')
    return { uid, email: `${uid}@example.com` }
  },
  resolveOrgMembership: async (uid, orgId) =>
    orgId === ORG_ID && MEMBERS[uid] ? { orgId, member: { $id: uid, ...MEMBERS[uid] } as never } : null,
  getOrgDoc: async (orgId) => (orgId === ORG_ID ? orgDoc : null),
  resolveOrgIdForHost: async (hostId) =>
    hostId === FOREIGN_SITE ? OTHER_ORG : [SITE, SIBLING].includes(hostId) ? ORG_ID : null,
  logOrgActivity: async (orgId, _actor, action, target) => {
    activity.push({ scope: 'org', id: orgId, action, target })
  },
  logHostActivity: async (hostId, _actor, action, target) => {
    activity.push({ scope: 'host', id: hostId, action, target })
  },
  newId: () => `auto-${++nextId}`,
}

const manage = createOrgAutomationsManageHandler(deps)
const pause = createOrgAutomationPauseHandler(deps)

function makeResponse() {
  const result = { status: 0, body: undefined as any }
  const res: PluginApiResponse = {
    status(code) {
      result.status = code
      return res
    },
    json(body) {
      result.body = body
    },
    send(body) {
      result.body = body
    },
    setHeader() {
      /* unused */
    },
    redirect() {
      /* unused */
    },
    end() {
      /* unused */
    },
  }
  return { res, result }
}

async function call(
  handler: typeof manage,
  body: Record<string, unknown>,
  token: string | null = 'owner',
  method = 'POST',
) {
  const { res, result } = makeResponse()
  await handler(
    {
      method,
      query: {},
      body,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      cookies: {},
      socket: {},
    },
    res,
  )
  return result
}

const automationPath = (id: string) => `orgs/${ORG_ID}/automations/${id}`

/** What the editor sends for a one-step automation. */
function automation(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Welcome every lead',
    trigger: { event: 'formSubmission' },
    steps: [{ type: 'sendEmail', subject: 'Welcome', body: 'Thanks' }],
    visibleTo: ['org'],
    ...overrides,
  }
}

function seedAutomation(id: string, overrides: Record<string, unknown> = {}) {
  store.set(automationPath(id), {
    name: 'Seeded',
    trigger: { event: 'formSubmission', conditions: null, combinator: null },
    steps: [{ type: 'sendEmail', subject: 'Hi', body: 'x' }],
    enabled: true,
    visibleTo: ['org'],
    pausedHostIds: [],
    deletedAt: null,
    ...overrides,
  })
}

beforeEach(() => {
  store = new Map()
  activity = []
  nextId = 0
  orgDoc = { plan: 'pro', enabledPlugins: ['workflows'] }
  store.set(`hostIndex/${SITE}`, { orgId: ORG_ID })
  store.set(`hostIndex/${SIBLING}`, { orgId: ORG_ID })
  store.set(`hostIndex/${FOREIGN_SITE}`, { orgId: OTHER_ORG })
  store.set(`hosts/${SITE}`, {
    memberRoles: {
      'uid-owner': 'admin',
      'uid-admin': 'admin',
      'uid-editor': 'editor',
      'uid-viewer': 'viewer',
      'uid-collab': 'editor',
      'uid-site-editor': 'editor',
      'uid-site-viewer': 'viewer',
    },
  })
  store.set(`hosts/${SIBLING}`, {
    memberRoles: { 'uid-owner': 'admin', 'uid-editor': 'editor' },
  })
})

describe('automations/manage — who may write the organization’s automations', () => {
  it('CONTROL: an owner creates one, stored in its full shape and logged', async () => {
    const result = await call(manage, { orgId: ORG_ID, action: 'create', automation: automation() })

    expect(result).toEqual({ status: 200, body: { automationId: 'auto-1' } })
    expect(store.get(automationPath('auto-1'))).toEqual({
      name: 'Welcome every lead',
      trigger: { event: 'formSubmission', conditions: null, combinator: null },
      steps: [{ type: 'sendEmail', subject: 'Welcome', body: 'Thanks' }],
      enabled: true,
      visibleTo: ['org'],
      pausedHostIds: [],
      deletedAt: null,
      createdAt: { __serverTimestamp: true },
      createdBy: 'uid-owner',
      updatedAt: { __serverTimestamp: true },
      updatedBy: 'uid-owner',
    })
    expect(activity).toEqual([
      {
        scope: 'org',
        id: ORG_ID,
        action: 'Created an org automation',
        target: { type: 'workflows:automation', id: 'auto-1', name: 'Welcome every lead' },
      },
    ])
  })

  it.each(['owner', 'admin', 'editor'])('admits an org-wide %s', async (token) => {
    const result = await call(manage, { orgId: ORG_ID, action: 'create', automation: automation() }, token)
    expect(result.status).toBe(200)
  })

  it.each([
    ['an org-wide viewer', 'viewer'],
    ['a site collaborator, editor on their site', 'collaborator'],
    ['somebody outside the organization', 'outsider'],
  ])('refuses %s', async (_label, token) => {
    const result = await call(manage, { orgId: ORG_ID, action: 'create', automation: automation() }, token)
    expect(result.status).toBe(403)
    expect(store.has(automationPath('auto-1'))).toBe(false)
  })

  it('refuses without a verified caller', async () => {
    expect((await call(manage, { orgId: ORG_ID, action: 'create' }, null)).status).toBe(401)
    expect((await call(manage, { orgId: ORG_ID, action: 'create' }, 'forged')).status).toBe(401)
  })

  it('answers only a POST naming a real org and a known action', async () => {
    expect((await call(manage, {}, 'owner', 'GET')).status).toBe(405)
    expect((await call(manage, { orgId: 'a/b', action: 'create' })).status).toBe(400)
    expect((await call(manage, { orgId: ORG_ID, action: 'explode' })).status).toBe(400)
    expect((await call(manage, { orgId: ORG_ID, action: 'update' })).status).toBe(400)
  })

  it('answers as if nothing were there when the organization has Automation off', async () => {
    orgDoc = { plan: 'pro', enabledPlugins: ['forms'] }
    const result = await call(manage, { orgId: ORG_ID, action: 'create', automation: automation() })
    expect(result.status).toBe(404)
  })

  it('needs the actions plan to create or switch on, never to stop', async () => {
    orgDoc = { plan: 'free', enabledPlugins: ['workflows'] }
    seedAutomation('existing')

    expect(
      (await call(manage, { orgId: ORG_ID, action: 'create', automation: automation() })).status,
    ).toBe(403)
    expect(
      (await call(manage, { orgId: ORG_ID, action: 'setEnabled', automationId: 'existing', enabled: true }))
        .status,
    ).toBe(403)
    expect(
      (await call(manage, { orgId: ORG_ID, action: 'setEnabled', automationId: 'existing', enabled: false }))
        .status,
    ).toBe(200)
    expect(store.get(automationPath('existing'))?.['enabled']).toBe(false)
    expect(
      (await call(manage, { orgId: ORG_ID, action: 'delete', automationId: 'existing' })).status,
    ).toBe(200)
  })
})

describe('automations/manage — what it will store', () => {
  it('refuses a trigger or a step outside the org vocabulary, saying which', async () => {
    const pageView = await call(manage, {
      orgId: ORG_ID,
      action: 'create',
      automation: automation({ trigger: { event: 'pageView' } }),
    })
    expect(pageView.status).toBe(400)

    const webhook = await call(manage, {
      orgId: ORG_ID,
      action: 'create',
      automation: automation({ steps: [{ type: 'webhookPost', webhookId: 'hook-1' }] }),
    })
    expect(webhook).toEqual({
      status: 400,
      body: { error: expect.stringMatching(/^Step 1: .*belongs to one site/) },
    })
    expect(store.has(automationPath('auto-1'))).toBe(false)
  })

  it('refuses a placement naming a site of another organization', async () => {
    const result = await call(manage, {
      orgId: ORG_ID,
      action: 'create',
      automation: automation({ visibleTo: [`host:${SITE}`, `host:${FOREIGN_SITE}`] }),
    })
    expect(result).toEqual({
      status: 400,
      body: { error: 'A site you chose is not in this organization' },
    })

    const own = await call(manage, {
      orgId: ORG_ID,
      action: 'create',
      automation: automation({ visibleTo: [`host:${SITE}`, `host:${SIBLING}`] }),
    })
    expect(own.status).toBe(200)
  })

  it('holds the organization to its cap, counting live automations only', async () => {
    for (let index = 0; index < ORG_AUTOMATIONS_MAX; index += 1) {
      seedAutomation(`live-${index}`)
    }
    const full = await call(manage, { orgId: ORG_ID, action: 'create', automation: automation() })
    expect(full.status).toBe(409)

    // A deleted one frees its place.
    store.set(automationPath('live-0'), {
      ...store.get(automationPath('live-0')),
      deletedAt: 'then',
    })
    const room = await call(manage, { orgId: ORG_ID, action: 'create', automation: automation() })
    expect(room.status).toBe(200)
  })

  it('edits one, dropping the pause of a site it no longer runs on', async () => {
    seedAutomation('a1', { pausedHostIds: [SITE, SIBLING] })

    const result = await call(manage, {
      orgId: ORG_ID,
      action: 'update',
      automationId: 'a1',
      automation: automation({ name: 'Renamed', visibleTo: [`host:${SITE}`] }),
    })

    expect(result).toEqual({ status: 200, body: { automationId: 'a1' } })
    expect(store.get(automationPath('a1'))).toMatchObject({
      name: 'Renamed',
      visibleTo: [`host:${SITE}`],
      pausedHostIds: [SITE],
      updatedBy: 'uid-owner',
    })
  })

  it('will not edit a deleted or missing one', async () => {
    seedAutomation('gone', { deletedAt: 'then' })
    for (const automationId of ['gone', 'never']) {
      const result = await call(manage, {
        orgId: ORG_ID,
        action: 'update',
        automationId,
        automation: automation(),
      })
      expect(result.status).toBe(404)
    }
  })

  it('deletes softly — stamped and switched off — and once', async () => {
    seedAutomation('a1', { name: 'Old welcome' })

    const first = await call(manage, { orgId: ORG_ID, action: 'delete', automationId: 'a1' })
    const again = await call(manage, { orgId: ORG_ID, action: 'delete', automationId: 'a1' })

    expect(first.status).toBe(200)
    expect(again.status).toBe(200)
    expect(store.get(automationPath('a1'))).toMatchObject({
      deletedAt: { __serverTimestamp: true },
      deletedBy: 'uid-owner',
      enabled: false,
    })
    expect(activity.map((row) => row.action)).toEqual(['Deleted an org automation'])
    expect(
      (await call(manage, { orgId: ORG_ID, action: 'delete', automationId: 'never' })).status,
    ).toBe(404)
  })
})

describe('the subject the organization door names', () => {
  it('names the org a POST body carries, and nothing else', async () => {
    const post = (body: unknown) =>
      new Request('https://console.test/api/automations/manage', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    expect(await orgAutomationsManageSubject(post({ orgId: ORG_ID }))).toEqual({ orgId: ORG_ID })
    expect(await orgAutomationsManageSubject(post({ orgId: 'a/b' }))).toBeNull()
    expect(await orgAutomationsManageSubject(post({}))).toBeNull()
    expect(
      await orgAutomationsManageSubject(
        new Request('https://console.test/api/automations/manage'),
      ),
    ).toBeNull()
  })
})

describe('automations/pause — the host level control', () => {
  it('CONTROL: the site’s own editor pauses it on their site, and only there', async () => {
    seedAutomation('a1', { pausedHostIds: [SIBLING] })

    const result = await call(
      pause,
      { hostId: SITE, automationId: 'a1', paused: true },
      'siteEditor',
    )

    expect(result).toEqual({
      status: 200,
      body: { automationId: 'a1', hostId: SITE, paused: true },
    })
    expect(store.get(automationPath('a1'))?.['pausedHostIds']).toEqual([SIBLING, SITE])
    // The automation itself is untouched.
    expect(store.get(automationPath('a1'))?.['enabled']).toBe(true)
    expect(activity).toEqual([
      {
        scope: 'host',
        id: SITE,
        action: 'Paused an org automation on this site',
        target: { type: 'workflow', id: 'a1', name: 'Seeded' },
      },
    ])
  })

  it('resumes by removing this site alone', async () => {
    seedAutomation('a1', { pausedHostIds: [SITE, SIBLING] })

    const result = await call(
      pause,
      { hostId: SITE, automationId: 'a1', paused: false },
      'siteEditor',
    )

    expect(result.status).toBe(200)
    expect(store.get(automationPath('a1'))?.['pausedHostIds']).toEqual([SIBLING])
  })

  it('admits an org-wide editor on any of the organization’s sites', async () => {
    seedAutomation('a1')
    // Not in site B's role map at all: the membership answers.
    const result = await call(
      pause,
      { hostId: SIBLING, automationId: 'a1', paused: true },
      'admin',
    )
    expect(result.status).toBe(200)
  })

  it.each([
    ['the site’s viewer', SITE, 'siteViewer'],
    ['an org-wide viewer', SITE, 'viewer'],
    ['a collaborator on ANOTHER site', SIBLING, 'collaborator'],
    ['somebody outside the organization', SITE, 'outsider'],
  ])('refuses %s', async (_label, hostId, token) => {
    seedAutomation('a1')
    const result = await call(pause, { hostId, automationId: 'a1', paused: true }, token)
    expect(result.status).toBe(403)
    expect(store.get(automationPath('a1'))?.['pausedHostIds']).toEqual([])
  })

  it('will not pause an automation on a site it does not run on', async () => {
    seedAutomation('a1', { visibleTo: [`host:${SIBLING}`] })
    const result = await call(
      pause,
      { hostId: SITE, automationId: 'a1', paused: true },
      'siteEditor',
    )
    expect(result.status).toBe(404)
    expect(store.get(automationPath('a1'))?.['pausedHostIds']).toEqual([])
  })

  it('will not act for a site in another organization, or mismatched', async () => {
    seedAutomation('a1')
    const mismatched = await call(
      pause,
      { hostId: SITE, orgId: OTHER_ORG, automationId: 'a1', paused: true },
      'owner',
    )
    expect(mismatched.status).toBe(400)
  })

  it('answers only a well-formed request', async () => {
    expect((await call(pause, {}, 'owner', 'GET')).status).toBe(405)
    expect((await call(pause, { hostId: 'a/b', automationId: 'a1', paused: true })).status).toBe(400)
    expect((await call(pause, { hostId: SITE, automationId: '', paused: true })).status).toBe(400)
    expect((await call(pause, { hostId: SITE, automationId: 'a1', paused: 'yes' })).status).toBe(400)
    expect((await call(pause, { hostId: SITE, automationId: 'a1', paused: true }, null)).status).toBe(401)
  })
})
