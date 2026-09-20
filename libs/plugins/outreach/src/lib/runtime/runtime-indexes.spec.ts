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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The indexes the sending runtime's queries need (AGL-2981).
 *
 * The emulator serves any query, so the emulator specs cannot see a missing
 * index; production answers FAILED_PRECONDITION and the job reads nothing.
 * Two queries need one declared:
 *
 *   send:  collectionGroup('outreachEnrollments')
 *            .where('status', '==', 'active')
 *            .where('nextDueAtMs', '<=', now).orderBy('nextDueAtMs')
 *   sync:  orgs/{orgId}/outreachEnrollments
 *            .where('mailboxId', '==', id).where('lastSentAtMs', '>=', since)
 *
 * The first is a COLLECTION_GROUP composite — automatic single-field indexes
 * exist at collection scope only — and the second a collection-scope one.
 * Every other runtime query is a single-field equality, which Firestore
 * indexes on its own. **If you add or change a filter on either, add its
 * shape here.**
 */

interface CompositeIndex {
  collectionGroup: string
  queryScope: string
  fields: Array<{ fieldPath: string; order?: string }>
}

const CONFIG: { indexes: CompositeIndex[] } = JSON.parse(
  readFileSync(join(__dirname, '../../../../../../cloud/firebase-firestore.indexes.json'), 'utf8'),
)

const shapes = (scope: string) =>
  CONFIG.indexes
    .filter((index) => index.collectionGroup === 'outreachEnrollments' && index.queryScope === scope)
    .map((index) => index.fields.map((field) => `${field.fieldPath}:${field.order}`).join(','))

describe('the sending runtime’s indexes (AGL-2981)', () => {
  it('declares the collection-group index the send job’s due scan needs', () => {
    expect(shapes('COLLECTION_GROUP')).toContain('status:ASCENDING,nextDueAtMs:ASCENDING')
  })

  it('declares the collection index the sync job’s watched enrollments need', () => {
    expect(shapes('COLLECTION')).toContain('mailboxId:ASCENDING,lastSentAtMs:ASCENDING')
  })

  it('names the queries it guards, so a changed filter is changed here too', () => {
    const send = readFileSync(join(__dirname, 'send-job.ts'), 'utf8')
    expect(send).toMatch(/\.where\('status', '==', 'active'\)\s*\.where\('nextDueAtMs', '<=', context\.nowMs\)\s*\.orderBy\('nextDueAtMs'\)/)
    const sync = readFileSync(join(__dirname, 'sync-job.ts'), 'utf8')
    expect(sync).toMatch(/\.where\('mailboxId', '==', mailbox\.id\)\s*\.where\('lastSentAtMs', '>=', nowMs - OUTREACH_SYNC_WATCH_MS\)/)
  })
})
