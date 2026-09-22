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
 *
 * @jest-environment node
 */

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { delete: () => 'DELETE_FIELD', serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))
jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => fakeFirestore() }) },
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore() }) },
}))

import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { stampRecordEmailState, stampRecordEmailStateForHost } from './record-email-state'

/**
 * The verdict on an address, on every record that carries it (AGL-3245):
 * the contact through the address index, a lead under each site the
 * organization owns — the stronger verdict kept, nothing written when the
 * record already holds it, and nothing thrown when a read fails.
 */

type Data = Record<string, unknown>
const docs = new Map<string, Data>()
const writes: string[] = []
let failHosts = false

function snapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.slice(path.lastIndexOf('/') + 1),
    ref: docRef(path),
    exists: data !== undefined,
    data: () => (data ? { ...data } : undefined),
    get: (field: string) => data?.[field],
  }
}
function docRef(path: string): any {
  return {
    id: path.slice(path.lastIndexOf('/') + 1),
    path,
    get: async () => snapshot(path),
    set: async (data: Data) => {
      docs.set(path, { ...(docs.get(path) ?? {}), ...data })
      writes.push(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}
function collectionRef(path: string): any {
  const rows = () => [...docs.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
  const query = (filter: (data: Data) => boolean): any => ({
    select: () => query(filter),
    limit: () => query(filter),
    where: (field: string, _op: string, value: unknown) => query((data) => filter(data) && data[field] === value),
    get: async () => {
      if (path === 'hosts' && failHosts) throw new Error('UNAVAILABLE')
      const found = rows()
        .filter((key) => filter(docs.get(key) ?? {}))
        .map(snapshot)
      return { docs: found, empty: !found.length, size: found.length }
    },
  })
  return { id: path.slice(path.lastIndexOf('/') + 1), path, doc: (id: string) => docRef(`${path}/${id}`), ...query(() => true) }
}
function fakeFirestore(): any {
  return { collection: (name: string) => collectionRef(name) }
}

const ORG = 'org-1'
const EMAIL = 'morgan@kcorp.example'
const KEY = personKey(EMAIL) as string
const AT = 1_790_000_000_000
const BLOCKED = {
  status: 'blocked' as const,
  atMs: AT,
  source: 'outreach' as const,
  detail: '  550   (the address:blocked) ',
  enrollmentId: 'seq-1_c-1',
}

beforeEach(() => {
  docs.clear()
  writes.length = 0
  failHosts = false
  docs.set('hosts/site-a', { orgId: ORG })
  docs.set('hosts/site-b', { orgId: ORG })
  docs.set('hosts/site-elsewhere', { orgId: 'org-2' })
  docs.set(`orgs/${ORG}/contacts/c-1`, { email: EMAIL, name: 'Morgan' })
  docs.set(`hosts/site-a/leads/${KEY}`, { email: EMAIL })
  docs.set(`hosts/site-elsewhere/leads/${KEY}`, { email: EMAIL })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('stampRecordEmailState (AGL-3245)', () => {
  it('stamps the contact and every lead the organization’s sites hold, and no other organization’s', async () => {
    const result = await stampRecordEmailState({ orgId: ORG, email: ' Morgan@KCorp.Example ', state: BLOCKED, firestore: fakeFirestore() })
    expect(result).toEqual({ contacts: 1, leads: 1 })
    const expected = { status: 'blocked', atMs: AT, source: 'outreach', detail: '550 (the address:blocked)', enrollmentId: 'seq-1_c-1' }
    expect(docs.get(`orgs/${ORG}/contacts/c-1`)?.['emailState']).toEqual(expected)
    expect(docs.get(`hosts/site-a/leads/${KEY}`)?.['emailState']).toEqual(expected)
    expect(docs.get(`hosts/site-elsewhere/leads/${KEY}`)?.['emailState']).toBeUndefined()
    // No lead was minted under a site that had none.
    expect(docs.has(`hosts/site-b/leads/${KEY}`)).toBe(false)
  })

  it('keeps the stronger verdict, and writes nothing when the record already holds it', async () => {
    docs.set(`orgs/${ORG}/contacts/c-1`, {
      email: EMAIL,
      emailState: { status: 'do_not_contact', atMs: 1, source: 'member', detail: 'Asked' },
    })
    const firestore = fakeFirestore()
    expect(await stampRecordEmailState({ orgId: ORG, email: EMAIL, state: { ...BLOCKED, status: 'bounced' }, firestore })).toEqual({
      contacts: 0,
      leads: 1,
    })
    expect(docs.get(`orgs/${ORG}/contacts/c-1`)?.['emailState']).toMatchObject({ status: 'do_not_contact' })
    writes.length = 0
    expect(await stampRecordEmailState({ orgId: ORG, email: EMAIL, state: { ...BLOCKED, status: 'bounced' }, firestore })).toEqual({
      contacts: 0,
      leads: 0,
    })
    expect(writes).toEqual([])
    // A forced write lands whatever stands: a release.
    await stampRecordEmailState({ orgId: ORG, email: EMAIL, state: { status: 'ok', atMs: AT, source: 'member', detail: null }, force: true, firestore })
    expect(docs.get(`orgs/${ORG}/contacts/c-1`)?.['emailState']).toMatchObject({ status: 'ok' })
  })

  it('stamps nothing for a value that is not an address, and never throws when a read fails', async () => {
    expect(await stampRecordEmailState({ orgId: ORG, email: 'nobody', state: BLOCKED, firestore: fakeFirestore() })).toEqual({ contacts: 0, leads: 0 })
    failHosts = true
    expect(await stampRecordEmailState({ orgId: ORG, email: EMAIL, state: BLOCKED, firestore: fakeFirestore() })).toEqual({ contacts: 1, leads: 0 })
  })

  it('reads the organization off the site when only the site is known', async () => {
    expect(
      await stampRecordEmailStateForHost({
        hostId: 'site-b',
        email: EMAIL,
        state: { status: 'unsubscribed', atMs: AT, source: 'campaign', detail: null },
        firestore: fakeFirestore(),
      }),
    ).toEqual({ contacts: 1, leads: 1 })
    expect(docs.get(`hosts/site-a/leads/${KEY}`)?.['emailState']).toMatchObject({ status: 'unsubscribed', source: 'campaign' })
    expect(await stampRecordEmailStateForHost({ hostId: 'site-unknown', email: EMAIL, state: BLOCKED, firestore: fakeFirestore() })).toEqual({
      contacts: 0,
      leads: 0,
    })
  })
})
