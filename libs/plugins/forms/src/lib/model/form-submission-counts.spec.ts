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
 * A site's form submissions, counted and read by name for another plugin
 * (AGL-3080) — a campaign's conversion report dividing by every submission
 * the site received, and grouping its credited ones by the page each was
 * sent from.
 */

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/'), clauses: [] }),
  collectionGroup: (_db: unknown, id: string) => ({ group: id }),
  doc: (_db: unknown, ...segments: string[]) => ({ doc: segments.join('/') }),
  documentId: () => '__name__',
  where: (field: string, op: string, value: unknown) => `${field} ${op} ${JSON.stringify(value)}`,
  orderBy: (field: string) => `order ${field}`,
  limit: (value: number) => `limit ${value}`,
  query: (source: { path: string; clauses: string[] }, ...clauses: string[]) => ({
    path: source.path,
    clauses: [...source.clauses, ...clauses],
  }),
}))

import { pluginRecordCountSource } from '@aglyn/aglyn/plugin-manager/plugin-record-counts'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import type { Firestore } from 'firebase/firestore'
import { formSubmissionRecordCountSource, registerFormSubmissionCounts } from './form-submission-counts'
import { formSubmissionListSource } from './form-submission-list'

const FIRESTORE = {} as Firestore

beforeEach(() => resetPluginServicesForTests())

it('counts every submission the site received, and none for no site', () => {
  registerFormSubmissionCounts()
  expect(pluginRecordCountSource('formSubmission')).toBe(formSubmissionRecordCountSource)
  expect(formSubmissionRecordCountSource.query(FIRESTORE, { hostId: 'site-1' })).toEqual({
    path: 'hosts/site-1/formSubmissions',
    clauses: [],
  })
  expect(formSubmissionRecordCountSource.query(FIRESTORE, { hostId: '' })).toBeNull()
  expect(formSubmissionRecordCountSource.crossesSites).toBeUndefined()
})

it('reads a site’s submissions by name, at most thirty at a time', () => {
  const ids = Array.from({ length: 35 }, (_, index) => `s${index}`)
  expect(formSubmissionListSource.byIds?.(FIRESTORE, { hostId: 'site-1', ids })).toEqual({
    path: 'hosts/site-1/formSubmissions',
    clauses: [`__name__ in ${JSON.stringify(ids.slice(0, 30))}`],
  })
  expect(formSubmissionListSource.byIds?.(FIRESTORE, { hostId: null, ids })).toBeNull()
  expect(formSubmissionListSource.byIds?.(FIRESTORE, { hostId: 'site-1', ids: [] })).toBeNull()
})
