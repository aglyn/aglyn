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
 * @jest-environment node
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  LIST_QUERY_ID_PATH,
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  CAMPAIGN_MEMBERS_QUERY,
  campaignMembersBase,
  campaignMembersSearchClause,
  type CampaignMemberCollection,
} from './campaign-members-query'
import { EXPERIMENT_LIST_QUERY } from './experiment-list-query'

/**
 * Every shape the Marketing lists' queries can take has its composite index
 * (AGL-3321).
 *
 * The emulator serves any query, so a missing index is invisible to every
 * other spec; production answers FAILED_PRECONDITION and the list shows a
 * load error the moment a reader sets the filter that needs it. A list
 * declared through `planListQuery` enumerates its shapes (`listQueryIndexes`)
 * and this holds the index file to them — and to the count, which the
 * project's index budget is spent from. A list that is not declared names its
 * shapes here by hand.
 */

const INDEXES = JSON.parse(
  readFileSync(join(__dirname, '../../../../../../cloud/firebase-firestore.indexes.json'), 'utf8'),
)

describe('a site’s A/B testing list (hosts/{hostId}/experiments)', () => {
  const needed = listQueryIndexes(EXPERIMENT_LIST_QUERY)

  it('has every composite its filters and search need', () => {
    expect(missingListQueryIndexes(INDEXES, 'experiments', needed, 'COLLECTION')).toEqual([])
  })

  it('spends four: one per filterable field and the search, under the one order', () => {
    expect(needed).toHaveLength(4)
    expect(needed.map((index) => index.fields[0].fieldPath).sort()).toEqual([
      'nameLower',
      'nameTokens',
      'status',
      'target',
    ])
    for (const index of needed) {
      expect(index.fields[1]).toEqual({ fieldPath: 'name', order: 'ASCENDING' })
    }
  })
})

describe('the Conversions lists (hosts/{hostId}/campaignAttributions)', () => {
  /*
   * Not declared through `planListQuery`: the card offers no Filters panel
   * and no search. Its two lists are each one query — the kind the toggle
   * picked, and the channel (or, reached from one campaign, that campaign) —
   * walked in document-name order (`collectionPage`). These are the shapes.
   */
  const shape = (...paths: string[]) => ({
    fields: paths.map((fieldPath) => ({ fieldPath, order: 'ASCENDING' as const })),
  })

  it('has the kind + channel and kind + campaign composites its lists read', () => {
    expect(
      missingListQueryIndexes(
        INDEXES,
        'campaignAttributions',
        [shape('kind', 'channel'), shape('kind', 'campaignId')],
        'COLLECTION',
      ),
    ).toEqual([])
  })

  it('CONTROL: an absent shape is reported missing, so the check is looking', () => {
    expect(
      missingListQueryIndexes(INDEXES, 'campaignAttributions', [shape('kind', 'nothing')], 'COLLECTION'),
    ).toHaveLength(1)
  })
})

describe('a campaign’s screens and forms (hosts/{hostId}/screens, /forms)', () => {
  /*
   * Two shapes per collection: unsearched, the membership (and for screens
   * `deletedAt == null`) walked by document name, which merges on the
   * single-field indexes; searched, the same base beside a prefix range on
   * `nameLower`, ordered by it. The searched shape is served by ONE
   * composite per collection holding the whole base and the range — named
   * here by hand rather than as `listQueryIndexes`' merged pairs, which
   * would spend three composites where two serve (AGL-3321, the fewest).
   */
  const plan = (collection: CampaignMemberCollection, words: string[]) => {
    const search = campaignMembersSearchClause(words)
    return planListQuery(
      CAMPAIGN_MEMBERS_QUERY,
      {
        clauses: search ? [search] : [],
        base: campaignMembersBase(collection, 'spring-2026'),
      },
      nameSearchNormalizers,
    )
  }

  /** The composite a searched plan needs: every predicate, then its order. */
  const composite = (collection: CampaignMemberCollection) => {
    const searched = plan(collection, ['Spring'])
    const fields: Array<{ fieldPath: string; order?: 'ASCENDING'; arrayConfig?: 'CONTAINS' }> = []
    for (const filter of searched.filters) {
      if (filter.path === searched.orderBy.path) continue
      if (fields.some((field) => field.fieldPath === filter.path)) continue
      fields.push(
        filter.op === 'array-contains'
          ? { fieldPath: filter.path, arrayConfig: 'CONTAINS' }
          : { fieldPath: filter.path, order: 'ASCENDING' },
      )
    }
    fields.push({ fieldPath: searched.orderBy.path, order: 'ASCENDING' })
    return { fields }
  }

  it('walks the document name unsearched, which needs no composite', () => {
    for (const collection of ['screens', 'forms'] as const) {
      const unsearched = plan(collection, [])
      expect(unsearched.orderBy).toEqual({ path: LIST_QUERY_ID_PATH, direction: 'asc' })
      expect(unsearched.filters.every((filter) => filter.op === '==' || filter.op === 'array-contains')).toBe(true)
    }
  })

  it('searches the start of the name beside the membership, refusing nothing', () => {
    for (const collection of ['screens', 'forms'] as const) {
      const searched = plan(collection, ['Spring', 'sale'])
      expect(searched.refused).toEqual([])
      expect(searched.orderBy).toEqual({ path: 'nameLower', direction: 'asc' })
    }
  })

  it('holds the one composite each searched shape needs', () => {
    expect(composite('screens')).toEqual({
      fields: [
        { fieldPath: 'campaignIds', arrayConfig: 'CONTAINS' },
        { fieldPath: 'deletedAt', order: 'ASCENDING' },
        { fieldPath: 'nameLower', order: 'ASCENDING' },
      ],
    })
    expect(composite('forms')).toEqual({
      fields: [
        { fieldPath: 'campaignIds', arrayConfig: 'CONTAINS' },
        { fieldPath: 'nameLower', order: 'ASCENDING' },
      ],
    })
    expect(missingListQueryIndexes(INDEXES, 'screens', [composite('screens')], 'COLLECTION')).toEqual([])
    expect(missingListQueryIndexes(INDEXES, 'forms', [composite('forms')], 'COLLECTION')).toEqual([])
  })

  it('declares nothing listQueryIndexes would add beyond the search range', () => {
    // No column filter, so the only order a declared field adds is the
    // search's: the merged pairs are the three this spends two in place of.
    const merged = listQueryIndexes(CAMPAIGN_MEMBERS_QUERY, [
      { path: 'campaignIds', array: true },
      { path: 'deletedAt' },
    ])
    expect(merged.map((index) => index.fields[1])).toEqual([
      { fieldPath: 'nameLower', order: 'ASCENDING' },
      { fieldPath: 'nameLower', order: 'ASCENDING' },
    ])
  })
})
