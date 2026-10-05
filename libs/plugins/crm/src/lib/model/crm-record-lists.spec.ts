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
 * The CRM's records as another plugin's picker lists them (AGL-3080): saved
 * views, message templates, a contact search and a site's leads — each the
 * query the CRM's own console reads by, and each record read back through the
 * CRM's own listing rules.
 */

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
  orderBy: (field: unknown, direction?: string) => ({ orderBy: direction ? [field, direction] : field }),
  limit: (count: number) => ({ limit: count }),
  query: (base: { path: string }, ...constraints: unknown[]) => ({ path: base.path, constraints }),
}))

import { pluginRecordListSource } from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import type { Firestore } from 'firebase/firestore'
import {
  contactRecordListSource,
  leadRecordListSource,
  messageTemplateRecordListSource,
  registerCrmRecordLists,
  savedViewRecordListSource,
} from './crm-record-lists'

const DB = {} as Firestore

beforeEach(() => resetPluginServicesForTests())

it('publishes all four kinds under this plugin', () => {
  registerCrmRecordLists()
  for (const kind of ['savedView', 'messageTemplate', 'contact', 'lead']) {
    expect(pluginRecordListSource(kind)?.pluginId).toBe('crm')
  }
})

describe('saved views', () => {
  it('lists the Contacts and Leads views of the organization, by name', () => {
    expect(savedViewRecordListSource.query(DB, { orgId: 'o1', limit: 50 })).toEqual({
      path: 'orgs/o1/crmViews',
      constraints: [{ where: ['section', 'in', ['contacts', 'leads']] }, { orderBy: 'name' }, { limit: 50 }],
    })
    expect(savedViewRecordListSource.query(DB, { orgId: null, limit: 50 })).toBeNull()
  })

  it('reads a member’s own and the shared views, leaving out a colleague’s private one', () => {
    const request = { orgId: 'o1', viewerUid: 'u1', limit: 50 }
    expect(
      savedViewRecordListSource.record('v1', { name: 'Warm', section: 'contacts', shared: true, filters: [] }, request),
    ).toEqual({ id: 'v1', name: 'Warm', facts: { recordKind: 'contact', takeable: true } })
    expect(
      savedViewRecordListSource.record('v2', { name: 'Mine', section: 'leads', ownerUid: 'u1', filters: [] }, request),
    ).toEqual({ id: 'v2', name: 'Mine', facts: { recordKind: 'lead', takeable: true } })
    expect(
      savedViewRecordListSource.record('v3', { name: 'Theirs', section: 'contacts', ownerUid: 'u2' }, request),
    ).toBeNull()
  })

  it('says a Contacts view filtering on what only the list can apply cannot be taken whole', () => {
    expect(
      savedViewRecordListSource.record(
        'v4',
        {
          name: 'Odd',
          section: 'contacts',
          shared: true,
          filters: [{ field: 'nextTaskAtMs', op: 'isEmpty', value: '', label: 'Next task' }],
        },
        { orgId: 'o1', limit: 5 },
      )?.facts,
    ).toEqual({ recordKind: 'contact', takeable: false })
  })
})

describe('message templates', () => {
  const template = (fields: Record<string, unknown>) => ({
    name: 'Intro',
    kind: 'template',
    subject: 'Hi',
    body: 'Hello',
    visibleTo: ['org'],
    ...fields,
  })

  it('lists the organization’s templates by name, at most the CRM’s own ceiling', () => {
    expect(messageTemplateRecordListSource.query(DB, { orgId: 'o1', limit: 1000 })).toEqual({
      path: 'orgs/o1/crmEmailTemplates',
      constraints: [{ orderBy: 'name' }, { limit: 200 }],
    })
  })

  it('reads the team’s and the member’s own, written for the organization or the site', () => {
    const request = { orgId: 'o1', hostId: 'h1', viewerUid: 'u1', limit: 50 }
    expect(messageTemplateRecordListSource.record('t1', template({}), request)).toEqual({
      id: 't1',
      name: 'Intro',
      facts: { kind: 'template', subject: 'Hi', body: 'Hello' },
    })
    expect(
      messageTemplateRecordListSource.record('t2', template({ visibility: 'personal', ownerUid: 'u2' }), request),
    ).toBeNull()
    expect(messageTemplateRecordListSource.record('t3', template({ visibleTo: ['host:h2'] }), request)).toBeNull()
  })
})

describe('the contact search', () => {
  it('finds by address when the text is one, else by a word of the name', () => {
    expect(
      contactRecordListSource.query(DB, { orgId: 'o1', hostId: 'h1', search: 'Pat@Example.com', limit: 25 }),
    ).toEqual({
      path: 'orgs/o1/contacts',
      constraints: [{ where: ['email', '==', 'pat@example.com'] }, { limit: 25 }],
    })
    expect(contactRecordListSource.query(DB, { orgId: 'o1', hostId: 'h1', search: 'Pat Doe', limit: 25 })).toEqual({
      path: 'orgs/o1/contacts',
      constraints: [{ where: ['nameTokens', 'array-contains', 'pat'] }, { orderBy: 'nameLower' }, { limit: 25 }],
    })
    expect(contactRecordListSource.query(DB, { orgId: 'o1', hostId: 'h1', search: ' ', limit: 25 })).toBeNull()
    expect(contactRecordListSource.query(DB, { orgId: 'o1', hostId: null, search: 'pat', limit: 25 })).toBeNull()
  })

  it('names a contact as the site’s group knows them, and leaves out one the site may not see', () => {
    const contact = {
      email: 'Pat@Example.com',
      name: 'Patricia',
      visibleTo: ['host:h1'],
      facets: { 'group-a': { name: 'Pat' } },
    }
    expect(
      contactRecordListSource.record('c1', contact, { orgId: 'o1', hostId: 'h1', consentGroupId: 'group-a', limit: 5 }),
    ).toEqual({ id: 'c1', name: 'Pat', facts: { email: 'pat@example.com' } })
    expect(contactRecordListSource.record('c1', contact, { orgId: 'o1', hostId: 'h1', limit: 5 })?.name).toBe('Patricia')
    expect(contactRecordListSource.record('c1', contact, { orgId: 'o1', hostId: 'h2', limit: 5 })).toBeNull()
  })
})

describe('a site’s leads', () => {
  it('reads the site’s most recently seen leads', () => {
    expect(leadRecordListSource.query(DB, { orgId: 'o1', hostId: 'h1', limit: 200 })).toEqual({
      path: 'orgs/o1/leads',
      constraints: [
        { where: ['visibleTo', 'array-contains-any', ['org', 'host:h1']] },
        { orderBy: ['lastSeenAtMs', 'desc'] },
        { limit: 200 },
      ],
    })
  })

  it('says which leads are still open — neither closed nor converted', () => {
    expect(leadRecordListSource.record('l1', { email: 'Lee@Example.com', status: 'new' })).toEqual({
      id: 'l1',
      name: 'Lee@Example.com',
      facts: { email: 'lee@example.com', open: true },
    })
    expect(leadRecordListSource.record('l2', { name: 'Lou', status: 'unqualified' })?.facts['open']).toBe(false)
    expect(leadRecordListSource.record('l3', { name: 'Lu', convertedContactId: 'c1' })?.facts['open']).toBe(false)
  })
})
