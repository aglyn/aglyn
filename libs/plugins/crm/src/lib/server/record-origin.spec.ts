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
 * A door's origin, stamped as the built-in Lead source (AGL-3519) — on a
 * record naming none, and never over one that names something.
 */

const docs = new Map<string, Record<string, any>>()
const restamped: string[] = []
let mockList: Record<string, unknown> | null = null

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

/** Writes a dotted update into the stored document, as Firestore does. */
function applyUpdate(path: string, update: Record<string, unknown>) {
  const next = JSON.parse(JSON.stringify(docs.get(path) ?? {}))
  for (const [key, value] of Object.entries(update)) {
    const segments = key.split('.')
    let at: Record<string, any> = next
    for (const segment of segments.slice(0, -1)) at = at[segment] ??= {}
    at[segments[segments.length - 1]] = value
  }
  docs.set(path, next)
}

const ref = (path: string) => ({
  path,
  get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
  collection: (name: string) => collection(`${path}/${name}`),
})
const collection = (path: string) => ({ doc: (id: string) => ref(`${path}/${id}`) })
const firestore = {
  collection,
  runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      get: (target: { get: () => Promise<unknown> }) => target.get(),
      update: (target: { path: string }, update: Record<string, unknown>) => applyUpdate(target.path, update),
    }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => firestore }) },
  getOrgForHost: async (hostId: string) =>
    hostId === 'site-1' || hostId === 'site-2'
      ? { orgId: 'org-1', org: { hosts: { 'site-1': true, 'site-2': true } } }
      : null,
  findContactByEmail: async (contacts: { doc: (id: string) => { path: string } }, email: string) => {
    const path = contacts.doc('c-1').path
    return docs.get(path)?.email === email ? { ref: ref(path) } : null
  },
  restampCrmListFieldsAt: async (target: { path: string }) => {
    restamped.push(target.path)
    return 'restamped'
  },
}))

jest.mock('./lead-source-picklist', () => ({
  __esModule: true,
  readLeadSourcePicklist: async () => {
    const { effectiveCrmLeadSourcePicklist } = jest.requireActual('@aglyn/aglyn/app-utils/crm')
    return effectiveCrmLeadSourcePicklist(mockList)
  },
}))

import { personKey } from '@aglyn/aglyn/server'
import { crmRecordOriginWriter, stampCrmRecordOrigin } from './record-origin'

const EMAIL = 'dana@example.com'
const LEAD = `orgs/org-1/leads/${personKey(EMAIL)}`
const CONTACT = 'orgs/org-1/contacts/c-1'

beforeEach(() => {
  docs.clear()
  restamped.length = 0
  mockList = null
})

describe('stampCrmRecordOrigin', () => {
  it('stamps the built-in value on the lead the site sees, with its key, and restamps the list fields', async () => {
    docs.set(LEAD, { email: EMAIL, visibleTo: ['host:site-1'], submissionCount: 1 })
    const report = await stampCrmRecordOrigin(
      { hostId: 'site-1', email: ' Dana@Example.com ', origin: 'form', firstTouchOnly: true },
      firestore as never,
    )
    expect(report).toEqual({ records: 1 })
    expect(docs.get(LEAD)).toMatchObject({ leadSource: 'Website form', leadSourceKey: 'website form' })
    expect(restamped).toEqual([LEAD])
  })

  it('never overwrites a lead source, and a returning person is not a first touch', async () => {
    docs.set(LEAD, { email: EMAIL, visibleTo: ['org'], leadSource: 'Trade show', submissionCount: 1 })
    await stampCrmRecordOrigin({ hostId: 'site-1', email: EMAIL, origin: 'booking' }, firestore as never)
    expect(docs.get(LEAD)?.leadSource).toBe('Trade show')
    docs.set(LEAD, { email: EMAIL, visibleTo: ['org'], submissionCount: 3 })
    await stampCrmRecordOrigin(
      { hostId: 'site-1', email: EMAIL, origin: 'booking', firstTouchOnly: true },
      firestore as never,
    )
    expect(docs.get(LEAD)).not.toHaveProperty('leadSource')
    // An enrollment acts on a person deliberately: no first-touch rule.
    await stampCrmRecordOrigin({ hostId: 'site-1', email: EMAIL, origin: 'sequence' }, firestore as never)
    expect(docs.get(LEAD)?.leadSource).toBe('Sequence')
  })

  it('stamps nothing for a value the org deactivated, a word with no value, or a lead the site cannot see', async () => {
    mockList = { values: [{ id: 'booking', label: 'Booking', active: false }], defaultValueId: null }
    docs.set(LEAD, { email: EMAIL, visibleTo: ['org'] })
    expect(await stampCrmRecordOrigin({ hostId: 'site-1', email: EMAIL, origin: 'booking' }, firestore as never)).toEqual({
      records: 0,
    })
    expect(await stampCrmRecordOrigin({ hostId: 'site-1', email: EMAIL, origin: 'import' }, firestore as never)).toEqual({
      records: 0,
    })
    docs.set(LEAD, { email: EMAIL, visibleTo: ['host:site-2'] })
    await stampCrmRecordOrigin({ hostId: 'site-1', email: EMAIL, origin: 'form' }, firestore as never)
    expect(docs.get(LEAD)).not.toHaveProperty('leadSource')
    expect(restamped).toEqual([])
  })

  it('stamps the org’s spelling on the site’s own new facet, leaving another holder’s alone', async () => {
    mockList = { values: [{ id: 'site-member-sign-up', label: 'Member', active: true }], defaultValueId: null }
    docs.set(CONTACT, {
      email: EMAIL,
      facets: {
        'site-1': { interactions: [{ type: 'member' }] },
        'site-2': { interactions: [{ type: 'form' }], leadSource: 'Webinar' },
      },
    })
    const report = await crmRecordOriginWriter.stamp({
      hostId: 'site-1',
      email: EMAIL,
      origin: 'member',
      firstTouchOnly: true,
    })
    expect(report).toEqual({ records: 1 })
    expect(docs.get(CONTACT)?.facets).toEqual({
      'site-1': { interactions: [{ type: 'member' }], leadSource: 'Member' },
      'site-2': { interactions: [{ type: 'form' }], leadSource: 'Webinar' },
    })
    expect(restamped).toEqual([CONTACT])
  })

  it('leaves a facet the person has been met on before, at a first touch', async () => {
    docs.set(CONTACT, { email: EMAIL, facets: { 'site-1': { interactions: [{}, {}] } } })
    await crmRecordOriginWriter.stamp({ hostId: 'site-1', email: EMAIL, origin: 'order', firstTouchOnly: true })
    expect(docs.get(CONTACT)?.facets['site-1']).not.toHaveProperty('leadSource')
  })
})
