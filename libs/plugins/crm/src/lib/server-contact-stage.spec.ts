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
 * `crm/contact-stage` — a contact's lifecycle stage, moved from the console
 * (AGL-2605).
 *
 * The route exists for its EVENT: `contactStageChanged` can only come from
 * the path that performed the write. What is pinned here:
 *
 *  1. THE GATE. A method other than POST, a body missing an id or naming a
 *     stage the list does not have, a missing or unverifiable token, and a
 *     caller with no admin or editor role on the site are each refused
 *     before any contact is read.
 *  2. THE PLAN (AGL-2787). A lifecycle stage is the CRM suite's, included
 *     from Starter. A Free workspace is refused once the caller is known to
 *     be a site editor, and before the contact is read, written or announced.
 *  3. THE WRITE. A move is one dotted `update()` into THIS site's facet,
 *     then `contactStageChanged` with the stage it replaced; a stage set to
 *     what it already is writes and announces nothing.
 *
 * The Admin SDK, the org resolver and the event emitter are doubled.
 * `@aglyn/aglyn/server` is the REAL module, so the stage list, the facet
 * path and the visibility check are the ones the route ships with.
 */

import { resolvePluginApiRoute } from '@aglyn/aglyn/server'

const HOST = 'host-1'

/** The signed-in caller, as the token double answers for the token `good`. */
let mockDecoded: Record<string, unknown> = { uid: 'user-1' }
/** `hosts/{hostId}` documents, as the site role check reads them. */
let mockHosts: Record<string, Record<string, unknown>> = {}
/** The org every known site resolves to, or none. */
let mockOrg: Record<string, unknown> | null = { plan: 'starter' }
/** `orgs/org-1/contacts`, by id. */
let mockContacts: Record<string, Record<string, unknown>> = {}
const mockVerifyIdToken = jest.fn(async (token: string) => {
  if (token !== 'good') throw new Error('bad token')
  return mockDecoded
})
/** Every resolution of the contacts collection, which precedes any contact read. */
const mockContactsCollection = jest.fn()
const mockUpdate = jest.fn()
const mockEmit = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    delete: () => ({ __delete: true }),
  },
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  captureHostContact: jest.fn(),
  emitHostEvent: (...args: unknown[]) => mockEmit(...args),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (token: string) => mockVerifyIdToken(token) }),
      // `hosts/{hostId}` — the one document the role check reads.
      firestore: () => ({
        collection: () => ({
          doc: (id: string) => ({
            get: async () => ({
              exists: id in mockHosts,
              get: (field: string) => mockHosts[id]?.[field],
            }),
          }),
        }),
      }),
    }),
  },
  getOrgForHost: async (hostId: string) =>
    hostId in mockHosts && mockOrg ? { orgId: 'org-1', org: mockOrg } : null,
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  orgDataCollectionForHost: async (hostId: string, name: string) => {
    mockContactsCollection(hostId, name)
    return {
      doc: (id: string) => ({
        get: async () => ({
          exists: id in mockContacts,
          get: (field: string) => mockContacts[id]?.[field],
          data: () => mockContacts[id],
          ref: { update: (patch: Record<string, unknown>) => mockUpdate(id, patch) },
        }),
      }),
    }
  },
}))

import { registerCrmConsoleApi } from './server'

async function post(
  body: Record<string, unknown>,
  headers: Record<string, string> = { authorization: 'Bearer good' },
  method = 'POST',
) {
  registerCrmConsoleApi()
  const handler = resolvePluginApiRoute('crm/contact-stage')
  expect(handler).toBeDefined()
  let status = 0
  let payload: any
  const answeredHeaders: Record<string, unknown> = {}
  const res: any = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      payload = value
    },
    send: () => undefined,
    setHeader: (name: string, value: unknown) => {
      answeredHeaders[name] = value
    },
    redirect: () => undefined,
    end: () => undefined,
  }
  await handler?.(
    { method, query: {}, body, headers, cookies: {}, socket: {} },
    res,
  )
  return { status, payload, headers: answeredHeaders }
}

/** The seeded contact, moved from `lead` to `customer`. */
const MOVE = { hostId: HOST, contactId: 'con-1', lifecycleStage: 'customer' }

beforeEach(() => {
  jest.clearAllMocks()
  mockDecoded = { uid: 'user-1' }
  mockHosts = { [HOST]: { memberRoles: { 'user-1': 'editor', 'user-2': 'viewer' } } }
  mockOrg = { plan: 'starter' }
  mockContacts = {
    'con-1': {
      email: 'ada@example.test',
      visibleTo: [`host:${HOST}`],
      facets: {
        [HOST]: { sources: { form: true }, interactions: [], lifecycleStage: 'lead' },
        // Another site's reading of the same person.
        'host-2': { sources: {}, interactions: [], lifecycleStage: 'subscriber' },
      },
    },
  }
})

describe('the gate', () => {
  it('refuses any method but POST, before reading a token', async () => {
    const { status, headers } = await post(MOVE, { authorization: 'Bearer good' }, 'GET')
    expect(status).toBe(405)
    expect(headers['Allow']).toBe('POST')
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
  })

  it('refuses a body missing an id, or a stage the list does not have, before reading a token', async () => {
    const noHost = await post({ contactId: 'con-1', lifecycleStage: 'customer' })
    expect(noHost.status).toBe(400)
    expect(noHost.payload).toEqual({ error: 'Missing hostId or contactId' })
    expect((await post({ hostId: HOST, lifecycleStage: 'customer' })).status).toBe(400)
    const unknownStage = await post({ ...MOVE, lifecycleStage: 'vip' })
    expect(unknownStage.status).toBe(400)
    expect(unknownStage.payload).toEqual({ error: 'Pick a lifecycle stage' })
    expect((await post({ hostId: HOST, contactId: 'con-1' })).status).toBe(400)
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
  })

  it('refuses a caller with no token, and one whose token does not verify', async () => {
    expect((await post(MOVE, {})).status).toBe(401)
    expect((await post(MOVE, { authorization: 'Bearer forged' })).status).toBe(401)
    expect(mockContactsCollection).not.toHaveBeenCalled()
  })

  it('refuses a viewer and a caller with no role on the site, reading no contact', async () => {
    mockDecoded = { uid: 'user-2' }
    const viewer = await post(MOVE)
    expect(viewer.status).toBe(403)
    expect(viewer.payload).toEqual({ error: 'Not a site admin or editor' })
    mockDecoded = { uid: 'stranger' }
    expect((await post(MOVE)).status).toBe(403)
    expect(mockContactsCollection).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('answers 404 for a site that does not exist, and for one that belongs to no org', async () => {
    expect((await post({ ...MOVE, hostId: 'nowhere' })).status).toBe(404)
    mockOrg = null
    const orphan = await post(MOVE)
    expect(orphan.status).toBe(404)
    expect(orphan.payload).toEqual({ error: 'Unknown site' })
    expect(mockContactsCollection).not.toHaveBeenCalled()
  })
})

/**
 * THE PLAN (AGL-2787). A lifecycle stage is the CRM suite's, included from
 * Starter. The route asks once it knows the caller edits the site, and
 * before it reads, writes or announces anything about the contact.
 */
describe('the plan (AGL-2787)', () => {
  it('refuses a Free workspace before the contact is read, written or announced', async () => {
    mockOrg = { plan: 'free' }
    const { status, payload } = await post(MOVE)
    expect(status).toBe(403)
    expect(payload).toMatchObject({ reason: 'plan_required', code: 'crm' })
    expect(payload.error).toMatch(/part of the CRM suite/)
    expect(payload.error).toMatch(/Included from Starter/)
    expect(mockContactsCollection).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('tells a viewer on a Free workspace about the role, not the plan', async () => {
    mockOrg = { plan: 'free' }
    mockDecoded = { uid: 'user-2' }
    const { status, payload } = await post(MOVE)
    expect(status).toBe(403)
    expect(payload).toEqual({ error: 'Not a site admin or editor' })
  })

  it('admits Starter, the lowest plan that carries the suite', async () => {
    mockOrg = { plan: 'starter' }
    const { status, payload } = await post(MOVE)
    expect(status).toBe(200)
    expect(payload.changed).toBe(true)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })

  it('refuses a Free workspace a CLEARED stage too — clearing is setting it to none', async () => {
    mockOrg = { plan: 'free' }
    const { status, payload } = await post({ ...MOVE, lifecycleStage: null })
    expect(status).toBe(403)
    expect(payload).toMatchObject({ reason: 'plan_required', code: 'crm' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

/**
 * A CLEARED STAGE (AGL-2804). The record page's "Not placed yet" was a
 * client-direct facet write; a facet is the server's to write now, so the
 * clear comes through the route that owns the stage. There is no event for
 * "no stage", so a clear announces nothing.
 */
describe('a cleared stage', () => {
  it("removes the stage from this site's facet on an explicit null, and announces nothing", async () => {
    const { status, payload } = await post({ ...MOVE, lifecycleStage: null })
    expect(status).toBe(200)
    expect(payload).toEqual({
      ok: true,
      changed: true,
      lifecycleStage: '',
      previousStage: 'lead',
    })
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith('con-1', {
      'facets.host-1.lifecycleStage': { __delete: true },
      updatedAt: { __serverTimestamp: true },
    })
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('writes nothing for a clear of a contact this site never placed', async () => {
    mockContacts['con-2'] = {
      email: 'bea@example.test',
      visibleTo: [`host:${HOST}`],
      facets: { [HOST]: { sources: {}, interactions: [] } },
    }
    const { status, payload } = await post({
      hostId: HOST,
      contactId: 'con-2',
      lifecycleStage: null,
    })
    expect(status).toBe(200)
    expect(payload).toEqual({ ok: true, changed: false, lifecycleStage: '', previousStage: '' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('still refuses an empty string, which names no stage and asks for no clear', async () => {
    const { status, payload } = await post({ ...MOVE, lifecycleStage: '' })
    expect(status).toBe(400)
    expect(payload).toEqual({ error: 'Pick a lifecycle stage' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

describe('the write', () => {
  it("moves the stage in this site's facet by dotted path, then announces the stage it replaced", async () => {
    const { status, payload } = await post(MOVE)
    expect(status).toBe(200)
    expect(payload).toEqual({
      ok: true,
      changed: true,
      lifecycleStage: 'customer',
      previousStage: 'lead',
    })
    expect(mockContactsCollection).toHaveBeenCalledWith(HOST, 'contacts')
    // One path into this site's facet: another site's reading of the person
    // is not in the patch, and neither is a top-level stage.
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith('con-1', {
      'facets.host-1.lifecycleStage': 'customer',
      updatedAt: { __serverTimestamp: true },
    })
    expect(mockEmit).toHaveBeenCalledTimes(1)
    expect(mockEmit).toHaveBeenCalledWith(HOST, 'contactStageChanged', {
      contactId: 'con-1',
      email: 'ada@example.test',
      lifecycleStage: 'customer',
      previousStage: 'lead',
    })
    // The event reports a write that has already landed.
    expect(mockUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mockEmit.mock.invocationCallOrder[0],
    )
  })

  it('writes and announces nothing for a stage set to what it already is', async () => {
    const { status, payload } = await post({ ...MOVE, lifecycleStage: 'lead' })
    expect(status).toBe(200)
    expect(payload).toEqual({
      ok: true,
      changed: false,
      lifecycleStage: 'lead',
      previousStage: 'lead',
    })
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('answers a contact this site cannot see as unknown, writing nothing', async () => {
    mockContacts['con-1']['visibleTo'] = ['host:host-2']
    const hidden = await post(MOVE)
    expect(hidden.status).toBe(404)
    expect(hidden.payload).toEqual({ error: 'Unknown contact' })
    expect((await post({ ...MOVE, contactId: 'con-nope' })).status).toBe(404)
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })
})
