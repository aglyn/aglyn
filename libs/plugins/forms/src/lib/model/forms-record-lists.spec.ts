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
 * The `form` list source (AGL-3080): a site's forms, as another plugin's
 * picker lists them — a recipe keyed on the form a person picks.
 */

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  documentId: () => '__name__',
  orderBy: (field: string) => ({ orderBy: field }),
  limit: (count: number) => ({ limit: count }),
  query: (ref: { path: string }, ...constraints: unknown[]) => ({ path: ref.path, constraints }),
}))

import {
  pluginRecordListSource,
  pluginRecordsFromRows,
} from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { formRecordListSource, registerFormRecordList } from './forms-record-lists'

afterAll(() => unregisterPluginServices('forms'))

describe('the form list source', () => {
  it('lists one site’s forms, by document id, one past the window it asks for', () => {
    expect(formRecordListSource.query({} as never, { hostId: 'site-1', limit: 101 })).toEqual({
      path: 'hosts/site-1/forms',
      constraints: [{ orderBy: '__name__' }, { limit: 101 }],
    })
  })

  it('lists nothing where no site is named: a form is a site’s', () => {
    expect(formRecordListSource.query({} as never, { orgId: 'org-1', limit: 10 })).toBeNull()
  })

  it('names a form by its display name, or its id, and leaves an archived one out', () => {
    registerFormRecordList()
    expect(pluginRecordListSource('form')?.pluginId).toBe('forms')
    expect(
      pluginRecordsFromRows('form', [
        { $id: 'form-contact', displayName: ' Contact us ' },
        { $id: 'form-untitled' },
        { $id: 'form-old', displayName: 'Old campaign', archivedAt: 1 },
      ]),
    ).toEqual([
      { id: 'form-contact', name: 'Contact us', facts: {} },
      { id: 'form-untitled', name: 'form-untitled', facts: {} },
    ])
  })
})
