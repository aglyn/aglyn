/**
 * @jest-environment node
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

import type { DecodedIdToken } from 'firebase-admin/auth'
import { OUTREACH_USE_PERMISSION } from '../constants/bundle-common'
import type { OutreachRouteGateDeps } from './route-gate'
import {
  createOutreachSettingsRoute,
  OUTREACH_SETTINGS_ACTIVITY,
  type OutreachSettingsRouteDeps,
} from './settings-routes'

/**
 * The compliance settings route (AGL-2980), and the gate every settings,
 * sequence and enrollment route climbs, against an in-memory document store.
 * Only the edges are stubbed: the token verifier, the permission resolver,
 * the lockdown verdict and the activity log.
 */

// ── In-memory documents ─────────────────────────────────────────────────────

type Docs = Map<string, Record<string, unknown>>

function fakeFirestore(docs: Docs) {
  const snapshot = (path: string) => {
    const data = docs.get(path)
    return {
      id: path.slice(path.lastIndexOf('/') + 1),
      exists: data !== undefined,
      data: () => (data === undefined ? undefined : structuredClone(data)),
    }
  }
  const doc = (path: string): any => ({
    id: path.slice(path.lastIndexOf('/') + 1),
    path,
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => snapshot(path),
    set: async (data: Record<string, unknown>) => void docs.set(path, structuredClone(data)),
  })
  const collection = (path: string): any => ({
    path,
    doc: (id: string) => doc(`${path}/${id}`),
  })
  return {
    collection,
    runTransaction: async (run: (transaction: any) => Promise<unknown>) => {
      const writes: Array<() => void> = []
      const result = await run({
        get: async (ref: { path: string }) => snapshot(ref.path),
        set: (ref: { path: string }, data: Record<string, unknown>) =>
          writes.push(() => docs.set(ref.path, structuredClone(data))),
      })
      for (const write of writes) write()
      return result
    },
  } as unknown as FirebaseFirestore.Firestore
}

// ── The platform's edges ────────────────────────────────────────────────────

const ORG = 'org-outreach'
const OWNER = 'uid-owner'

interface Member {
  role: string | null
  orgWide: boolean
  permissions: Record<string, boolean>
}

let members: Record<string, Member>
let orgDoc: Record<string, unknown> | null
let lockdown: Response | null

const gate: OutreachRouteGateDeps = {
  verifyIdToken: async (token) => {
    if (token === 'refused') throw Object.assign(new Error('refused'), { code: 'auth/argument-error' })
    const [uid, verified] = token.split(':')
    return { uid, email: `${uid}@example.com`, email_verified: verified !== 'unverified' } as unknown as DecodedIdToken
  },
  resolveOrgPermissions: async (uid, context) => {
    const member = members[uid]
    return member
      ? { orgId: context.orgId, isOwner: member.role === 'owner', ...member }
      : { orgId: context.orgId, role: null, isOwner: false, orgWide: false, permissions: {} }
  },
  readOrg: async () => orgDoc,
  lockdownRefusal: async () => lockdown,
}

let docs: Docs
let activity: Array<{ orgId: string; action: string; target: unknown; actor: unknown }>

const deps = (): OutreachSettingsRouteDeps => ({
  firestore: () => fakeFirestore(docs),
  gate,
  now: () => 1_750_000_000_000,
  logOrgActivity: async (orgId, actor, action, target) => {
    activity.push({ orgId, actor, action, target })
  },
})

const SETTINGS_PATH = `orgs/${ORG}/outreachSettings/compliance`

async function call(
  method: 'GET' | 'POST' | 'DELETE',
  options: { token?: string | null; orgId?: string | null; body?: Record<string, unknown> } = {},
) {
  const token = options.token === undefined ? OWNER : options.token
  const orgId = options.orgId === undefined ? ORG : options.orgId
  const url = new URL('https://console.example.com/api/outreach/settings')
  if (method === 'GET' && orgId) url.searchParams.set('orgId', orgId)
  const request = new Request(url, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    ...(method === 'POST' ? { body: JSON.stringify({ ...(orgId ? { orgId } : {}), ...options.body }) } : {}),
  })
  const response = await createOutreachSettingsRoute(deps())(request, { params: {} })
  return { status: response.status, body: (await response.json()) as Record<string, any>, headers: response.headers }
}

beforeEach(() => {
  docs = new Map()
  activity = []
  lockdown = null
  orgDoc = { plan: 'pro', entitlements: { features: { outreach: true } } }
  members = {
    [OWNER]: { role: 'owner', orgWide: true, permissions: { [OUTREACH_USE_PERMISSION]: true } },
    'uid-editor': { role: 'editor', orgWide: true, permissions: { [OUTREACH_USE_PERMISSION]: false } },
    'uid-collaborator': { role: 'editor', orgWide: false, permissions: { [OUTREACH_USE_PERMISSION]: true } },
  }
})

describe('the Outreach route gate (AGL-2980)', () => {
  it('refuses a request with no session, and one whose token is refused', async () => {
    expect((await call('GET', { token: null })).body).toMatchObject({ reason: 'unauthenticated' })
    const refused = await call('GET', { token: 'refused' })
    expect(refused.status).toBe(401)
    expect(refused.body.reason).toBe('unauthenticated')
  })

  it('refuses an account whose address is unverified', async () => {
    members['uid-new'] = members[OWNER]
    const { status, body } = await call('GET', { token: 'uid-new:unverified' })
    expect(status).toBe(403)
    expect(body.reason).toBe('email-unverified')
  })

  it('refuses a request that names no organization, or not a plain id', async () => {
    expect((await call('GET', { orgId: null })).body.reason).toBe('org-required')
    expect((await call('GET', { orgId: 'orgs/../x' })).body.reason).toBe('org-required')
  })

  it('refuses an outsider, a site collaborator and a member without outreach.use', async () => {
    expect((await call('GET', { token: 'uid-stranger' })).body.reason).toBe('not-a-member')
    expect((await call('GET', { token: 'uid-collaborator' })).body.reason).toBe('not-org-wide')
    const editor = await call('GET', { token: 'uid-editor' })
    expect(editor.status).toBe(403)
    expect(editor.body).toMatchObject({ reason: 'permission', error: 'Your role does not include Use Outreach.' })
  })

  it('refuses an organization without the entitlement — no plan carries it', async () => {
    orgDoc = { plan: 'enterprise' }
    const { status, body } = await call('GET')
    expect(status).toBe(403)
    expect(body.reason).toBe('entitlement')
  })

  it('answers a lockdown with its own refusal', async () => {
    lockdown = Response.json({ error: 'Locked' }, { status: 423 })
    expect((await call('GET')).status).toBe(423)
  })
})

describe('outreach/settings (AGL-2980)', () => {
  it('answers the defaults for an organization that never saved them', async () => {
    const { status, body } = await call('GET')
    expect(status).toBe(200)
    expect(body).toEqual({
      ok: true,
      settings: {
        legalName: '',
        brandName: '',
        postalAddress: '',
        allowedCountries: ['US'],
        updatedAtMs: 0,
        updatedByUid: null,
      },
    })
  })

  it('stores a save settled, stamps who made it, and writes one activity line', async () => {
    const { status, body } = await call('POST', {
      body: {
        legalName: ' Example Co LLC ',
        brandName: 'Example Co',
        postalAddress: '100 Example St\nSpringfield, IL 62701',
        allowedCountries: ['us'],
      },
    })
    expect(status).toBe(200)
    expect(body.changed).toBe(true)
    expect(docs.get(SETTINGS_PATH)).toEqual({
      legalName: 'Example Co LLC',
      brandName: 'Example Co',
      postalAddress: '100 Example St\nSpringfield, IL 62701',
      allowedCountries: ['US'],
      updatedAtMs: 1_750_000_000_000,
      updatedByUid: OWNER,
    })
    expect(activity).toEqual([
      {
        orgId: ORG,
        actor: { uid: OWNER, email: `${OWNER}@example.com` },
        action: OUTREACH_SETTINGS_ACTIVITY,
        target: { type: 'org', id: ORG },
      },
    ])
    // Read back through the route.
    expect((await call('GET')).body.settings.legalName).toBe('Example Co LLC')
  })

  it('writes nothing and logs nothing when a save changes nothing', async () => {
    const save = {
      legalName: 'Example Co LLC',
      brandName: '',
      postalAddress: '100 Example St',
      allowedCountries: ['US'],
    }
    await call('POST', { body: save })
    activity = []
    const stamped = docs.get(SETTINGS_PATH)
    const { body } = await call('POST', { body: { ...save, legalName: '  Example Co   LLC' } })
    expect(body.changed).toBe(false)
    expect(docs.get(SETTINGS_PATH)).toEqual(stamped)
    expect(activity).toEqual([])
  })

  it('refuses an invalid save with every field-level reason, and stores nothing', async () => {
    const { status, body } = await call('POST', {
      body: { legalName: 'Example Co LLC', postalAddress: '', allowedCountries: [] },
    })
    expect(status).toBe(400)
    expect(body.reason).toBe('invalid-settings')
    expect(body.issues).toEqual([
      { field: 'allowedCountries', message: 'Choose at least one country Outreach may send to.' },
    ])
    expect(docs.has(SETTINGS_PATH)).toBe(false)
  })

  it('climbs the gate before it validates or writes', async () => {
    const { status } = await call('POST', { token: 'uid-editor', body: { allowedCountries: ['US'] } })
    expect(status).toBe(403)
    expect(docs.size).toBe(0)
  })

  it('answers any other method with 405 and the methods it takes', async () => {
    const { status, headers } = await call('DELETE')
    expect(status).toBe(405)
    expect(headers.get('Allow')).toBe('GET, POST')
  })
})
