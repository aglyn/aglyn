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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  listQueryIndexes,
  missingListQueryIndexes,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { OUTREACH_DO_NOT_CONTACT_DOMAIN_LIST_QUERY } from './do-not-contact-domain-list-query'
import { OUTREACH_ENROLLMENT_LIST_QUERY } from './enrollment-list-query'
import { OUTREACH_SEQUENCE_LIST_QUERY } from './sequence-list-query'

/**
 * Every shape the Outreach lists' queries can take has its composite index
 * (AGL-3321).
 *
 * The emulator serves any query, so a missing index is invisible to every
 * other spec; production answers FAILED_PRECONDITION and the list shows a
 * load error the moment a reader sets the filter that needs it. Each list's
 * declaration enumerates its shapes (`listQueryIndexes`) and this holds the
 * index file to them — and to the count, which the project's index budget
 * is spent from.
 */

const INDEXES = JSON.parse(
  readFileSync(join(__dirname, '../../../../../../cloud/firebase-firestore.indexes.json'), 'utf8'),
)

/** The composites a list's declaration needs, by field paths and order, for the count assertions. */
const shapes = (needed: ReturnType<typeof listQueryIndexes>) =>
  needed.map((index) =>
    index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(','),
  )

describe('the sequences list (orgs/{orgId}/outreachSequences)', () => {
  const needed = listQueryIndexes(OUTREACH_SEQUENCE_LIST_QUERY)

  it('has every composite its filters and search need', () => {
    expect(missingListQueryIndexes(INDEXES, 'outreachSequences', needed, 'COLLECTION')).toEqual([])
  })

  it('spends four: one per filterable field under the one order, which the range shares', () => {
    expect(shapes(needed).sort()).toEqual(
      [
        'mailboxId:ASCENDING,createdAtMs:DESCENDING',
        'nameLower:ASCENDING,createdAtMs:DESCENDING',
        'nameTokens:CONTAINS,createdAtMs:DESCENDING',
        'status:ASCENDING,createdAtMs:DESCENDING',
      ].sort(),
    )
  })
})

describe('a sequence’s enrollments (orgs/{orgId}/outreachEnrollments)', () => {
  // The table's base, `sequenceId ==`, is an equality like any other.
  const needed = listQueryIndexes(OUTREACH_ENROLLMENT_LIST_QUERY, [{ path: 'sequenceId' }])

  it('has every composite its filters and search need', () => {
    expect(missingListQueryIndexes(INDEXES, 'outreachEnrollments', needed, 'COLLECTION')).toEqual([])
  })

  it('spends eight: the base and each filterable field under the one order, which the range shares', () => {
    expect(shapes(needed).sort()).toEqual(
      [
        'sequenceId:ASCENDING,createdAtMs:DESCENDING',
        'searchTokens:CONTAINS,createdAtMs:DESCENDING',
        'status:ASCENDING,createdAtMs:DESCENDING',
        'target:ASCENDING,createdAtMs:DESCENDING',
        'stopReason:ASCENDING,createdAtMs:DESCENDING',
        'email:ASCENDING,createdAtMs:DESCENDING',
        // The two click filters (AGL-3332).
        'clicked:ASCENDING,createdAtMs:DESCENDING',
        'engagement.links:CONTAINS,createdAtMs:DESCENDING',
      ].sort(),
    )
  })
})

describe('the do-not-contact domains (orgs/{orgId}/outreachDoNotContactDomains)', () => {
  const needed = listQueryIndexes(OUTREACH_DO_NOT_CONTACT_DOMAIN_LIST_QUERY)

  it('has every composite its filters and search need', () => {
    expect(
      missingListQueryIndexes(INDEXES, 'outreachDoNotContactDomains', needed, 'COLLECTION'),
    ).toEqual([])
  })

  it('spends three, all for the date range: alphabetical by id needs none', () => {
    expect(shapes(needed).sort()).toEqual(
      [
        'domain:ASCENDING,addedAtMs:DESCENDING',
        'reason:ASCENDING,addedAtMs:DESCENDING',
        'searchTokens:CONTAINS,addedAtMs:DESCENDING',
      ].sort(),
    )
  })
})
