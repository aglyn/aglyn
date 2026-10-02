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

import { crmRecordIndexes } from './crm-record-indexes'

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({ firebaseAdmin: {} }))

/**
 * The CRM's `company` and `messageTemplate` indexes (AGL-3080): what another
 * plugin reads of the company a person works for and of a template a rep
 * wrote, scoped like the CRM's own lists.
 */

const docs = new Map<string, Record<string, unknown>>()

function collection(path: string): any {
  const rows = () =>
    [...docs.entries()]
      .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
      .sort(([, a], [, b]) => String(a['name'] ?? '').localeCompare(String(b['name'] ?? '')))
  const snapshot = ([key, data]: [string, Record<string, unknown>]) => ({
    id: key.slice(path.length + 1),
    exists: true,
    data: () => data,
  })
  return {
    orderBy: () => ({
      limit: (count: number) => ({ get: async () => ({ docs: rows().slice(0, count).map(snapshot) }) }),
    }),
    doc: (id: string) => ({
      get: async () => {
        const data = docs.get(`${path}/${id}`)
        return { id, exists: data !== undefined, data: () => data }
      },
    }),
  }
}

const firestore: any = {
  collection: (name: string) => ({ doc: (id: string) => ({ collection: (sub: string) => collection(`${name}/${id}/${sub}`) }) }),
}
const indexes = crmRecordIndexes(() => firestore)

beforeEach(() => {
  docs.clear()
  docs.set('orgs/o1/companies/co-1', {
    name: 'Example Co',
    domain: 'example.com',
    address: { country: 'US' },
    visibleTo: ['host:h1'],
  })
  docs.set('orgs/o1/companies/co-2', { domain: 'nameless.example', visibleTo: ['org'] })
  docs.set('orgs/o1/crmEmailTemplates/t-1', {
    name: 'Intro',
    kind: 'template',
    subject: 'Hi {{contact.firstName}}',
    body: 'Hello there',
    visibleTo: ['org'],
  })
  docs.set('orgs/o1/crmEmailTemplates/t-2', { name: '', body: 'unnamed' })
})

describe('the company index', () => {
  it('reads a company whole, by its name, else its domain', async () => {
    expect(await indexes.company.get({ orgId: 'o1', id: 'co-1' })).toEqual({
      id: 'co-1',
      name: 'Example Co',
      facts: docs.get('orgs/o1/companies/co-1'),
    })
    expect((await indexes.company.get({ orgId: 'o1', id: 'co-2' }))?.name).toBe('nameless.example')
  })

  it('answers null for a company a site may not see, one that is gone, or no organization', async () => {
    expect(await indexes.company.get({ orgId: 'o1', hostId: 'h2', id: 'co-1' })).toBeNull()
    expect(await indexes.company.get({ orgId: 'o1', id: 'gone' })).toBeNull()
    expect(await indexes.company.get({ hostId: 'h1', id: 'co-1' })).toBeNull()
  })
})

describe('the message-template index', () => {
  it('reads a template as its kind, subject and body', async () => {
    expect(await indexes.messageTemplate.get({ orgId: 'o1', id: 't-1' })).toEqual({
      id: 't-1',
      name: 'Intro',
      facts: { kind: 'template', subject: 'Hi {{contact.firstName}}', body: 'Hello there' },
    })
  })

  it('lists the named templates, leaving out one saved without a name', async () => {
    expect(await indexes.messageTemplate.list({ orgId: 'o1', limit: 5 })).toEqual({
      records: [{ id: 't-1', name: 'Intro', facts: { kind: 'template', subject: 'Hi {{contact.firstName}}', body: 'Hello there' } }],
      truncated: false,
    })
    expect(await indexes.messageTemplate.get({ orgId: 'o1', id: 't-2' })).toBeNull()
  })
})
