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
 * `crm/contact-remove` — a holder lets contacts go, and a person's "no"
 * stays (AGL-3338).
 *
 * Over a Firestore that takes transactions (`test-firestore-queries`), with
 * the REAL removal (`removeContactKeepingRefusals`), so what is asserted is
 * what landed in the contact and the retained store, not what a double said.
 * What is pinned:
 *
 *  1. THE GATE. POST only; a body with no scope or ids; no token; a viewer.
 *  2. THE REFUSAL SURVIVES. A detach leaves the leaving site's refusal on
 *     the document and drops its grant; the last holder's delete keeps every
 *     refusal in the retained store under each address, with no address.
 *  3. WHO MAY. A site collaborator deletes a person only their sites hold,
 *     and detaches nobody; a plan without the CRM deletes but does not
 *     detach; a row the site does not list is refused by name.
 *  4. THE ORGANIZATION LEVEL lets go through the row's primary holder.
 */

const verifyIdToken = jest.fn()
const getOrgForHost = jest.fn()
const getOrgDoc = jest.fn()
const resolveOrgMembership = jest.fn()
const memberHasOrgPermission = jest.fn()
const resolveOrgPermissions = jest.fn()
const restampCrmListFieldsOf = jest.fn()

let mockFirestore: ReturnType<typeof queryFakeFirestore>

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  emitHostEvent: jest.fn(),
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  __esModule: true,
  resolveOrgPermissions: (...args: unknown[]) => resolveOrgPermissions(...args),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  // The REAL removal: the detach, the delete and the retained store are what is under test.
  removeContactKeepingRefusals: jest.requireActual(
    '@aglyn/tenant-data-admin/server/retained-refusals',
  ).removeContactKeepingRefusals,
  // The list-fields restamp (AGL-3321) is `crm-records`' own spec's; here a spy.
  restampCrmListFieldsOf: (...args: unknown[]) => restampCrmListFieldsOf(...args),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (token: string) => verifyIdToken(token) }),
      firestore: () => mockFirestore,
    }),
  },
  getOrgForHost: (...args: unknown[]) => getOrgForHost(...args),
  getOrgDoc: (...args: unknown[]) => getOrgDoc(...args),
  resolveOrgMembership: (...args: unknown[]) => resolveOrgMembership(...args),
  memberHasOrgPermission: (...args: unknown[]) => memberHasOrgPermission(...args),
  notifyUsers: jest.fn(),
  recomputeCrmNextTaskAt: jest.fn(),
  crmNextActivityLinksOf: jest.fn(),
}))

import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { queryFakeFirestore } from '@aglyn/tenant-data-admin/server/test-firestore-queries'
import {
  CONTACT_REMOVE_SCOPED_REFUSAL,
  crmContactRemoveHandler,
} from './contact-remove'

const ORG_ID = 'org-1'
const HOST = 'host-1'
const OTHER_HOST = 'host-2'
const CONTACTS = `orgs/${ORG_ID}/contacts`
const RETAINED = `orgs/${ORG_ID}/retainedRefusals`

let caller: Record<string, unknown>
let org: Record<string, unknown>
let members: Record<string, Record<string, unknown>>

async function post(
  body: Record<string, unknown>,
  options: { token?: string | null; method?: string } = {},
) {
  const token = options.token === undefined ? 'good' : options.token
  let status = 0
  let payload: any
  const headers: Record<string, unknown> = {}
  const res: any = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      payload = value
    },
    setHeader: (name: string, value: unknown) => {
      headers[name] = value
    },
    send: () => undefined,
    end: () => undefined,
    redirect: () => undefined,
  }
  await crmContactRemoveHandler(
    {
      method: options.method ?? 'POST',
      query: {},
      body,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      cookies: {},
      socket: {},
    } as any,
    res,
  )
  return { status, payload, headers }
}

const refusal = (atMs: number) => ({ marketingConsent: false, marketingConsentAtMs: atMs })
const grant = (atMs: number) => ({ marketingConsent: true, marketingConsentAtMs: atMs })

/** Ada, held by this site alone, who refused its mail. */
const soleHeld = () => ({
  email: 'ada@example.com',
  alternateEmails: ['ada@work.example'],
  visibleTo: [`host:${HOST}`],
  capturedByHostIds: [HOST],
  facets: { [HOST]: { notes: 'mine' } },
  marketingConsentByHost: { [HOST]: refusal(10) },
})

/** Bea, held by both sites: she refused this one and opted into the other. */
const shared = () => ({
  email: 'bea@example.com',
  visibleTo: [`host:${HOST}`, `host:${OTHER_HOST}`],
  capturedByHostIds: [HOST, OTHER_HOST],
  facets: { [HOST]: { notes: 'mine' }, [OTHER_HOST]: { notes: 'theirs' } },
  marketingConsentByHost: { [HOST]: refusal(10), [OTHER_HOST]: grant(20) },
})

const contact = (id: string) => mockFirestore.read(`${CONTACTS}/${id}`) as Record<string, any> | undefined
const retainedFor = (email: string) =>
  mockFirestore.read(`${RETAINED}/${personKey(email)}`) as Record<string, any> | undefined

beforeEach(() => {
  jest.clearAllMocks()
  mockFirestore = queryFakeFirestore({
    [`${CONTACTS}/ada`]: soleHeld(),
    [`${CONTACTS}/bea`]: shared(),
  })
  caller = { uid: 'editor-uid' }
  org = { plan: 'starter' }
  members = {
    'editor-uid': { role: 'editor', allHosts: true, scopeTokens: ['org'] },
    'scoped-uid': {
      role: 'editor',
      allHosts: false,
      hostAccess: { [HOST]: 'editor' },
      scopeTokens: ['org', `host:${HOST}`],
    },
    'viewer-uid': { role: 'viewer', allHosts: true, scopeTokens: ['org'] },
  }
  verifyIdToken.mockImplementation(async (token: string) => {
    if (token !== 'good') throw new Error('bad token')
    return caller
  })
  getOrgForHost.mockImplementation(async (hostId: string) =>
    [HOST, OTHER_HOST].includes(hostId) ? { orgId: ORG_ID, org } : null,
  )
  getOrgDoc.mockImplementation(async (orgId: string) => (orgId === ORG_ID ? org : null))
  resolveOrgMembership.mockImplementation(async (uid: string) =>
    members[uid] ? { orgId: ORG_ID, member: { $id: uid, ...members[uid] } } : null,
  )
  memberHasOrgPermission.mockImplementation(
    async (_orgId: string, member: { role?: string }) => member?.role !== 'viewer',
  )
  resolveOrgPermissions.mockImplementation(async (uid: string) =>
    members[uid]
      ? { orgId: ORG_ID, orgWide: members[uid]['allHosts'] === true, role: members[uid]['role'] }
      : null,
  )
  restampCrmListFieldsOf.mockResolvedValue({ restamped: 0, current: 0, missing: 0 })
})

describe('the gate', () => {
  it('is POST only', async () => {
    const { status, headers } = await post({}, { method: 'GET' })
    expect(status).toBe(405)
    expect(headers['Allow']).toBe('POST')
  })

  it('refuses a body with no scope, or no ids, or too many', async () => {
    expect((await post({ contactIds: ['ada'] })).status).toBe(400)
    expect((await post({ hostId: HOST, contactIds: [] })).status).toBe(400)
    expect((await post({ hostId: HOST, contactIds: ['a/b'] })).status).toBe(400)
    expect(
      (await post({ hostId: HOST, contactIds: Array.from({ length: 201 }, (_, i) => `c${i}`) }))
        .status,
    ).toBe(400)
  })

  it('refuses no token and a viewer, and removes nothing', async () => {
    expect((await post({ hostId: HOST, contactIds: ['ada'] }, { token: null })).status).toBe(401)
    caller = { uid: 'viewer-uid' }
    expect((await post({ hostId: HOST, contactIds: ['ada'] })).status).toBe(403)
    expect(contact('ada')).toBeDefined()
  })
})

describe('a refusal survives the removal', () => {
  it('detaches a shared contact, leaving the refusal and the other site’s grant', async () => {
    const { status, payload } = await post({ hostId: HOST, contactIds: ['bea'] })
    expect(status).toBe(200)
    expect(payload.results).toEqual([{ contactId: 'bea', ok: true, removed: 'detached' }])
    const after = contact('bea')!
    expect(after['visibleTo']).toEqual([`host:${OTHER_HOST}`])
    expect(after['capturedByHostIds']).toEqual([OTHER_HOST])
    expect(after['facets']).toEqual({ [OTHER_HOST]: { notes: 'theirs' } })
    expect(after['marketingConsentByHost']).toEqual({ [HOST]: refusal(10), [OTHER_HOST]: grant(20) })
    expect(mockFirestore.docs(RETAINED)).toEqual({})
    expect(restampCrmListFieldsOf).toHaveBeenCalledWith(
      [expect.objectContaining({ path: `${CONTACTS}/bea` })],
      'contacts',
    )
  })

  it('drops the leaving site’s grant on a detach', async () => {
    mockFirestore.seed(`${CONTACTS}/bea`, {
      ...shared(),
      marketingConsentByHost: { [HOST]: grant(5), [OTHER_HOST]: grant(20) },
    })
    await post({ hostId: HOST, contactIds: ['bea'] })
    expect(contact('bea')!['marketingConsentByHost']).toEqual({ [OTHER_HOST]: grant(20) })
  })

  it('deletes the last holder’s contact and keeps the refusal under each address, with no address', async () => {
    const { payload } = await post({ hostId: HOST, contactIds: ['ada'] })
    expect(payload.results).toEqual([{ contactId: 'ada', ok: true, removed: 'deleted' }])
    expect(contact('ada')).toBeUndefined()
    for (const email of ['ada@example.com', 'ada@work.example']) {
      const kept = retainedFor(email)
      expect(kept?.['marketingConsentByHost']).toEqual({
        [HOST]: { ...refusal(10), retainedAtMs: expect.any(Number), retainedFromContactId: 'ada' },
      })
      expect(JSON.stringify(kept)).not.toContain('example')
    }
  })

  it('keeps nothing for a contact that refused nothing', async () => {
    mockFirestore.seed(`${CONTACTS}/ada`, { ...soleHeld(), marketingConsentByHost: { [HOST]: grant(1) } })
    await post({ hostId: HOST, contactIds: ['ada'] })
    expect(contact('ada')).toBeUndefined()
    expect(mockFirestore.docs(RETAINED)).toEqual({})
  })

  it('answers each contact on its own, a missing one included', async () => {
    const { payload } = await post({ hostId: HOST, contactIds: ['ada', 'gone', 'bea'] })
    expect(payload.results).toEqual([
      { contactId: 'ada', ok: true, removed: 'deleted' },
      { contactId: 'gone', ok: false, error: 'That contact no longer exists.' },
      { contactId: 'bea', ok: true, removed: 'detached' },
    ])
  })
})

describe('who may let a contact go', () => {
  it('lets a site collaborator delete a person only their sites hold', async () => {
    caller = { uid: 'scoped-uid' }
    const { payload } = await post({ hostId: HOST, contactIds: ['ada'] })
    expect(payload.results[0]).toEqual({ contactId: 'ada', ok: true, removed: 'deleted' })
    expect(retainedFor('ada@example.com')).toBeDefined()
  })

  it('refuses a site collaborator a person another site also holds, and writes nothing', async () => {
    caller = { uid: 'scoped-uid' }
    const { payload } = await post({ hostId: HOST, contactIds: ['bea'] })
    expect(payload.results[0]).toEqual({
      contactId: 'bea',
      ok: false,
      error: CONTACT_REMOVE_SCOPED_REFUSAL,
    })
    expect(contact('bea')).toEqual(shared())
  })

  it('refuses a site collaborator a site their access does not reach', async () => {
    caller = { uid: 'scoped-uid' }
    expect((await post({ hostId: OTHER_HOST, contactIds: ['bea'] })).status).toBe(403)
  })

  it('deletes on a plan without the CRM, but does not detach', async () => {
    org = { plan: 'free' }
    const { payload } = await post({ hostId: HOST, contactIds: ['ada', 'bea'] })
    expect(payload.results[0]).toEqual({ contactId: 'ada', ok: true, removed: 'deleted' })
    expect(payload.results[1]).toMatchObject({ contactId: 'bea', ok: false })
    expect(contact('bea')).toEqual(shared())
  })

  it('refuses a row this site does not list', async () => {
    const { payload } = await post({ hostId: OTHER_HOST, contactIds: ['ada'] })
    expect(payload.results[0]).toEqual({
      contactId: 'ada',
      ok: false,
      error: 'That contact is not visible to this site.',
    })
    expect(contact('ada')).toBeDefined()
  })
})

describe('at the organization level', () => {
  it('lets go through the row’s primary holder', async () => {
    const { status, payload } = await post({ orgId: ORG_ID, contactIds: ['bea'] })
    expect(status).toBe(200)
    expect(payload.results[0]).toEqual({ contactId: 'bea', ok: true, removed: 'detached' })
    expect(contact('bea')!['visibleTo']).toEqual([`host:${OTHER_HOST}`])
    expect(contact('bea')!['marketingConsentByHost'][HOST]).toEqual(refusal(10))
  })

  it('refuses a row no site holds', async () => {
    mockFirestore.seed(`${CONTACTS}/nobody`, { email: 'n@example.com', visibleTo: ['org'] })
    const { payload } = await post({ orgId: ORG_ID, contactIds: ['nobody'] })
    expect(payload.results[0]).toMatchObject({ contactId: 'nobody', ok: false })
    expect(contact('nobody')).toBeDefined()
  })
})
