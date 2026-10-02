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
 * A site's form submissions, as this plugin publishes them to the plugin that
 * reads them (AGL-3080): the newest of a site's for a glance, the base a paged
 * list walks (a site's, or every site's collection group), one submission's
 * document, and each stored document read as the server index reads it.
 */

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  collectionGroup: (_db: unknown, id: string) => ({ group: id }),
  doc: (_db: unknown, ...segments: string[]) => ({ doc: segments.join('/') }),
  orderBy: (field: string, direction: string) => ({ orderBy: [field, direction] }),
  limit: (count: number) => ({ limit: count }),
  query: (base: { path: string }, ...constraints: unknown[]) => ({ path: base.path, constraints }),
}))

import { pluginRecordListSource } from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import type { Firestore } from 'firebase/firestore'
import { formSubmissionListSource, registerFormSubmissionList } from './form-submission-list'
import { formSubmissionIndexedRecord } from './form-submission-record'

const DB = {} as Firestore

beforeEach(() => resetPluginServicesForTests())

describe('the form submission list source', () => {
  it('is published under this plugin', () => {
    registerFormSubmissionList()
    expect(pluginRecordListSource('formSubmission')?.pluginId).toBe('forms')
  })

  it('lists the newest of a site’s, at most the window asked for', () => {
    expect(formSubmissionListSource.query(DB, { hostId: 'h1', limit: 4 })).toEqual({
      path: 'hosts/h1/formSubmissions',
      constraints: [{ orderBy: ['createdAt', 'desc'] }, { limit: 4 }],
    })
  })

  it('lists none where no site is named, nor for a search or an install', () => {
    expect(formSubmissionListSource.query(DB, { orgId: 'o1', limit: 4 })).toBeNull()
    expect(formSubmissionListSource.query(DB, { hostId: 'h1', search: 'pri', limit: 4 })).toBeNull()
    expect(
      formSubmissionListSource.query(DB, { hostId: 'h1', installedFrom: 'l1', limit: 4 }),
    ).toBeNull()
  })

  it('walks a site’s own, or every site’s collection group at the organization', () => {
    expect(formSubmissionListSource.walk?.(DB, { hostId: 'h1', orgId: 'o1' })).toEqual({
      path: 'hosts/h1/formSubmissions',
    })
    expect(formSubmissionListSource.walk?.(DB, { orgId: 'o1' })).toEqual({ group: 'formSubmissions' })
    expect(formSubmissionListSource.walk?.(DB, {})).toBeNull()
  })

  it('opens one submission under its site, and none without one', () => {
    expect(formSubmissionListSource.doc?.(DB, { hostId: 'h1', id: 's1' })).toEqual({
      doc: 'hosts/h1/formSubmissions/s1',
    })
    expect(formSubmissionListSource.doc?.(DB, { orgId: 'o1', id: 's1' })).toBeNull()
    expect(formSubmissionListSource.doc?.(DB, { hostId: 'h1', id: '' })).toBeNull()
  })
})

describe('a submission, as a reader may rely on it', () => {
  it('names the form it was sent to and shares the documented facts', () => {
    expect(
      formSubmissionIndexedRecord('s1', {
        hostId: 'h1',
        orgId: 'o1',
        formId: 'f1',
        formName: 'Contact',
        path: '/contact',
        fields: { email: 'a@b.co' },
        read: true,
        createdAt: { toMillis: () => 1700 },
        senderTokens: ['a'],
      }),
    ).toEqual({
      id: 's1',
      name: 'Contact',
      facts: {
        hostId: 'h1',
        formId: 'f1',
        formName: 'Contact',
        path: '/contact',
        fields: { email: 'a@b.co' },
        read: true,
        createdAtMs: 1700,
      },
    })
  })

  it('reads a document the door wrote before its form had an entity or the server its time', () => {
    expect(formSubmissionIndexedRecord('s2', { fields: 'nonsense' })).toEqual({
      id: 's2',
      name: 'Form',
      facts: {
        hostId: null,
        formId: null,
        formName: '',
        path: '',
        fields: {},
        read: false,
        createdAtMs: null,
      },
    })
  })

  it('is nothing for a document that holds nothing', () => {
    expect(formSubmissionIndexedRecord('s3', undefined)).toBeNull()
  })
})
