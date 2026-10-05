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
 * A site's form submissions on the server, as this plugin publishes them to
 * the plugin that reads them (AGL-3080): site-scoped, newest first with a
 * probe for "more", one by id, and the document a reader marks answered and
 * keeps its own records under — registered from the server declarations so a
 * reader finds it without loading this plugin's code until it asks.
 */

const docs = new Map<string, Record<string, unknown>>()

function collectionRef(path: string): any {
  return {
    path,
    doc: (id: string) => ({
      id,
      path: `${path}/${id}`,
      collection: (name: string) => collectionRef(`${path}/${id}/${name}`),
      get: async () => ({
        id,
        exists: docs.has(`${path}/${id}`),
        data: () => docs.get(`${path}/${id}`),
      }),
    }),
    orderBy: () => collectionRef(path),
    limit: (count: number) => ({
      get: async () => {
        const rows = [...docs.entries()]
          .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
          .slice(0, count)
          .map(([key, data]) => ({ id: key.slice(path.length + 1), data: () => data }))
        return { docs: rows, size: rows.length }
      },
    }),
  }
}

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => ({ collection: (name: string) => collectionRef(name) }) }),
  },
}))

import { pluginRecordIndex } from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerFormsServerDeclarations } from '../declarations.server'
import { formSubmissionRecordIndex } from './form-submission-index'

beforeEach(() => {
  docs.clear()
  resetPluginServicesForTests()
  docs.set('hosts/h1/formSubmissions/s1', { formName: 'Contact', read: false, fields: { a: 1 } })
  docs.set('hosts/h1/formSubmissions/s2', { formName: 'Quote', read: true, fields: {} })
  docs.set('hosts/h2/formSubmissions/s9', { formName: 'Elsewhere' })
})

describe('the form submission index', () => {
  it('lists one site’s, and says when the site holds more', async () => {
    const page = await formSubmissionRecordIndex.list({ hostId: 'h1', limit: 1 })
    expect(page.records.map((record) => record.id)).toEqual(['s1'])
    expect(page.truncated).toBe(true)
  })

  it('answers none where no site is named', async () => {
    expect(await formSubmissionRecordIndex.list({ orgId: 'o1', limit: 10 })).toEqual({
      records: [],
      truncated: false,
    })
    expect(await formSubmissionRecordIndex.get({ orgId: 'o1', id: 's1' })).toBeNull()
  })

  it('reads one by id, under its own site only', async () => {
    expect((await formSubmissionRecordIndex.get({ hostId: 'h1', id: 's2' }))?.name).toBe('Quote')
    expect(await formSubmissionRecordIndex.get({ hostId: 'h1', id: 's9' })).toBeNull()
  })

  it('hands a reader the one document, under its site', async () => {
    const ref = (await formSubmissionRecordIndex.ref?.({ hostId: 'h1', id: 's1' })) as { path: string }
    expect(ref.path).toBe('hosts/h1/formSubmissions/s1')
    expect(await formSubmissionRecordIndex.ref?.({ orgId: 'o1', id: 's1' })).toBeNull()
  })

  it('is registered under this plugin from its server declarations, loaded when first asked', async () => {
    registerFormsServerDeclarations()
    const owner = pluginRecordIndex('formSubmission')
    expect(owner?.pluginId).toBe('forms')
    const ref = (await owner?.index.ref?.({ hostId: 'h1', id: 's2' })) as { path: string }
    expect(ref.path).toBe('hosts/h1/formSubmissions/s2')
    expect((await owner?.index.get({ hostId: 'h1', id: 's1' }))?.facts['read']).toBe(false)
  })
})
