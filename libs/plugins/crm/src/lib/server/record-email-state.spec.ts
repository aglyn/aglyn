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

/**
 * The verdict on an address, on every record that carries it (AGL-3245):
 * the contact through the address index, a lead under each site the
 * organization owns — the stronger verdict kept, nothing written when the
 * record already holds it, the organization read off a site when only the
 * site is known, and nothing thrown when a read fails.
 */

type Data = Record<string, unknown>
const mockDocs = new Map<string, Data>()
const mockWrites: string[] = []
let mockFailHosts = false

function snapshot(path: string) {
  const data = mockDocs.get(path)
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
      mockDocs.set(path, { ...(mockDocs.get(path) ?? {}), ...data })
      mockWrites.push(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}
function collectionRef(path: string): any {
  const rows = () =>
    [...mockDocs.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
  const query = (filter: (data: Data) => boolean): any => ({
    select: () => query(filter),
    limit: () => query(filter),
    where: (field: string, _op: string, value: unknown) => query((data) => filter(data) && data[field] === value),
    get: async () => {
      if (path === 'hosts' && mockFailHosts) throw new Error('UNAVAILABLE')
      const found = rows()
        .filter((key) => filter(mockDocs.get(key) ?? {}))
        .map(snapshot)
      return { docs: found, empty: !found.length, size: found.length }
    },
  })
  return { id: path.slice(path.lastIndexOf('/') + 1), path, doc: (id: string) => docRef(`${path}/${id}`), ...query(() => true) }
}
const mockFirestore: any = { collection: (name: string) => collectionRef(name) }

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  // The real index lookup, against the double: it is what finds the contact.
  ...jest.requireActual('@aglyn/tenant-data-admin/server/contact-email-index'),
  firebaseAdmin: { app: () => ({ firestore: () => mockFirestore }) },
}))

import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { pluginRecordEmailStateWriter } from '@aglyn/aglyn/plugin-manager/plugin-record-email-state'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { createCrmRecordEmailStateWriter, registerCrmRecordEmailStateWriter } from './record-email-state'

const ORG = 'org-1'
const EMAIL = 'morgan@kcorp.example'
const KEY = personKey(EMAIL) as string
const AT = 1_790_000_000_000
const BLOCKED = {
  status: 'blocked' as const,
  atMs: AT,
  source: 'sequence' as const,
  detail: '  550   (the address:blocked) ',
  enrollmentId: 'seq-1_c-1',
}

const writer = createCrmRecordEmailStateWriter({ firestore: () => mockFirestore })

beforeEach(() => {
  mockDocs.clear()
  mockWrites.length = 0
  mockFailHosts = false
  mockDocs.set('hosts/site-a', { orgId: ORG })
  mockDocs.set('hosts/site-b', { orgId: ORG })
  mockDocs.set('hosts/site-elsewhere', { orgId: 'org-2' })
  mockDocs.set(`orgs/${ORG}/contacts/c-1`, { email: EMAIL, name: 'Morgan' })
  mockDocs.set(`hosts/site-a/leads/${KEY}`, { email: EMAIL })
  mockDocs.set(`hosts/site-elsewhere/leads/${KEY}`, { email: EMAIL })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the CRM on the record email-state seam (AGL-3245)', () => {
  it('registers as the workspace record system', () => {
    resetPluginServicesForTests()
    registerCrmRecordEmailStateWriter({ firestore: () => mockFirestore })
    expect(pluginRecordEmailStateWriter()?.pluginId).toBe('crm')
  })

  it('stamps the contact and every lead the organization’s sites hold, and no other organization’s', async () => {
    expect(await writer.stamp({ orgId: ORG, email: ' Morgan@KCorp.Example ', state: BLOCKED })).toEqual({ records: 2 })
    const expected = { status: 'blocked', atMs: AT, source: 'sequence', detail: '550 (the address:blocked)', enrollmentId: 'seq-1_c-1' }
    expect(mockDocs.get(`orgs/${ORG}/contacts/c-1`)?.['emailState']).toEqual(expected)
    expect(mockDocs.get(`hosts/site-a/leads/${KEY}`)?.['emailState']).toEqual(expected)
    expect(mockDocs.get(`hosts/site-elsewhere/leads/${KEY}`)?.['emailState']).toBeUndefined()
    // No lead was minted under a site that had none.
    expect(mockDocs.has(`hosts/site-b/leads/${KEY}`)).toBe(false)
  })

  it('keeps the stronger verdict, and writes nothing when the record already holds it', async () => {
    mockDocs.set(`orgs/${ORG}/contacts/c-1`, {
      email: EMAIL,
      emailState: { status: 'do_not_contact', atMs: 1, source: 'member', detail: 'Asked' },
    })
    expect(await writer.stamp({ orgId: ORG, email: EMAIL, state: { ...BLOCKED, status: 'bounced' } })).toEqual({ records: 1 })
    expect(mockDocs.get(`orgs/${ORG}/contacts/c-1`)?.['emailState']).toMatchObject({ status: 'do_not_contact' })
    mockWrites.length = 0
    expect(await writer.stamp({ orgId: ORG, email: EMAIL, state: { ...BLOCKED, status: 'bounced' } })).toEqual({ records: 0 })
    expect(mockWrites).toEqual([])
    // A forced write lands whatever stands: a release.
    await writer.stamp({ orgId: ORG, email: EMAIL, state: { status: 'ok', atMs: AT, source: 'member', detail: null }, force: true })
    expect(mockDocs.get(`orgs/${ORG}/contacts/c-1`)?.['emailState']).toMatchObject({ status: 'ok' })
  })

  it('stamps nothing for a value that is not an address, and never throws when a read fails', async () => {
    expect(await writer.stamp({ orgId: ORG, email: 'nobody', state: BLOCKED })).toEqual({ records: 0 })
    mockFailHosts = true
    expect(await writer.stamp({ orgId: ORG, email: EMAIL, state: BLOCKED })).toEqual({ records: 1 })
  })

  it('reads the organization off the site when only the site is known', async () => {
    expect(
      await writer.stamp({ hostId: 'site-b', email: EMAIL, state: { status: 'unsubscribed', atMs: AT, source: 'campaign', detail: null } }),
    ).toEqual({ records: 2 })
    expect(mockDocs.get(`hosts/site-a/leads/${KEY}`)?.['emailState']).toMatchObject({ status: 'unsubscribed', source: 'campaign' })
    expect(await writer.stamp({ hostId: 'site-unknown', email: EMAIL, state: BLOCKED })).toEqual({ records: 0 })
    expect(await writer.stamp({ email: EMAIL, state: BLOCKED })).toEqual({ records: 0 })
  })
})
