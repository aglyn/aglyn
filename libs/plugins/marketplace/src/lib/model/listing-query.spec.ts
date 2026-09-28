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
 * Every marketplace list on its query (AGL-3321): what each one asks, the
 * composites that serve it, and the fields a listing carries for them.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  AWAITING_REVIEW_STATES,
  BROWSE_SORTS,
  browseBase,
  HELD_LICENCE_QUERY,
  licenceBase,
  listingBrowseAudience,
  listingQueryFields,
  listingQueryFieldsPatch,
  LISTING_NAME_LOOKUP,
  MARKETPLACE_BROWSE_BASE_PATHS,
  MARKETPLACE_BROWSE_QUERY,
  MARKETPLACE_REPORTS_QUERY,
  MINE_LICENCE_QUERY,
  mineLicenceClauses,
  REVIEW_QUEUE_QUERY,
  reviewQueueBase,
  reviewQueueStatusClauses,
} from './listing-query'

const REPO = join(__dirname, '..', '..', '..', '..', '..', '..')
const read = (path: string) => JSON.parse(readFileSync(join(REPO, path), 'utf8'))
const INDEXES = read('cloud/firebase-firestore.indexes.json')

describe('the fields a listing carries for its lists', () => {
  const fixtures = read('tools/scripts/lib/listing-query-fields.fixtures.json')

  it.each(fixtures.listings.map((one: any) => [one.name, one]))(
    'derives them as the script-side copy does: %s',
    (_name, one: any) => {
      expect(listingQueryFields(one.listing)).toEqual(one.expected)
    },
  )

  it('shows browse the listing the in-memory gate showed, to whom it showed it', () => {
    // Public and reviewed: everyone. In review: its publisher only. Deleted
    // or private: nobody, not even the publisher.
    expect(listingBrowseAudience({ profileId: 'o1', artifactType: 'component' })).toEqual([
      '*',
      '*|o1',
    ])
    expect(
      listingBrowseAudience({ profileId: 'o1', artifactType: 'plugin', reviewStatus: 'submitted' }),
    ).toEqual(['o1', 'o1|o1'])
    expect(
      listingBrowseAudience({ profileId: 'o1', artifactType: 'plugin', reviewStatus: 'rejected' }),
    ).toEqual(['o1', 'o1|o1'])
    expect(
      listingBrowseAudience({ profileId: 'o1', artifactType: 'component', hiddenAt: { seconds: 1 } }),
    ).toEqual(['o1', 'o1|o1'])
    expect(listingBrowseAudience({ profileId: 'o1', deletedAt: { seconds: 1 } })).toEqual([])
    expect(
      listingBrowseAudience({ profileId: 'o1', artifactType: 'plugin', reviewStatus: 'listed', visibility: 'private' }),
    ).toEqual([])
  })

  it('writes nothing to a current listing, and only the moved fields to a stale one', () => {
    const listing = { displayName: 'Promo', profileId: 'o1', artifactType: 'component' }
    const stamped = { ...listing, ...listingQueryFieldsPatch(listing) }
    expect(stamped).toMatchObject({ installCount: 0, ratingAverage: null })
    expect(listingQueryFieldsPatch(stamped)).toBeNull()
    expect(listingQueryFieldsPatch({ ...stamped, hiddenAt: { seconds: 1 } })).toEqual({
      browseAudience: ['o1', 'o1|o1'],
      browseTokens: listingQueryFields({ ...listing, hiddenAt: 1 }).browseTokens,
      takenDown: true,
    })
    // A count or an average the install and review routes wrote is theirs.
    expect(listingQueryFieldsPatch({ ...stamped, installCount: 9, ratingAverage: 4.2 })).toBeNull()
  })
})

describe('browse', () => {
  const plan = (
    request: Partial<Parameters<typeof planListQuery>[1]> & { viewer?: string | null; publisher?: string },
  ) =>
    planListQuery(
      MARKETPLACE_BROWSE_QUERY,
      {
        clauses: request.clauses ?? [],
        search: request.search,
        sort: request.sort,
        base: browseBase(request.viewer ?? null, request.publisher),
      },
      nameSearchNormalizers,
    )

  it('asks for everything public and the viewer’s own listings in review', () => {
    expect(plan({ viewer: 'o1' }).filters).toEqual([
      { path: 'browseAudience', op: 'array-contains-any', value: ['*', 'o1'] },
    ])
    expect(plan({}).filters).toEqual([
      { path: 'browseAudience', op: 'array-contains-any', value: ['*'] },
    ])
  })

  it('narrows a publisher page by the same clause, joined to the publisher', () => {
    expect(plan({ viewer: 'o1', publisher: 'o2' }).filters).toEqual([
      { path: 'browseAudience', op: 'array-contains-any', value: ['*|o2', 'o1|o2'] },
    ])
  })

  it('folds the search into the audience, and serves category and every sort beside it', () => {
    const asked = plan({
      viewer: 'o1',
      search: ['Countdown'],
      clauses: [{ field: 'category', op: 'equals', value: 'marketing' }],
      sort: BROWSE_SORTS.rated,
    })
    expect(asked.refused).toEqual([])
    expect(asked.filters).toEqual([
      { path: 'browseTokens', op: 'array-contains-any', value: ['*~countdown', 'o1~countdown'] },
      { path: 'category', op: '==', value: 'marketing' },
    ])
    expect(asked.orderBy).toEqual({ path: 'ratingAverage', direction: 'desc' })
  })

  it('finds a searched listing by the tokens its writer stamped', () => {
    const tokens = listingQueryFields({
      displayName: 'Promo Countdown',
      profileId: 'o9',
      artifactType: 'component',
    }).browseTokens
    const asked = plan({ viewer: 'o1', search: ['count'] })
    const wanted = asked.filters[0].value as string[]
    expect(wanted.some((token) => tokens.includes(token))).toBe(true)
  })

  it('pins its composites: one per clause field per order, nothing more', () => {
    const needed = listQueryIndexes(MARKETPLACE_BROWSE_QUERY, MARKETPLACE_BROWSE_BASE_PATHS)
    expect(needed).toHaveLength(9)
    expect(missingListQueryIndexes(INDEXES, 'marketplaceListings', needed)).toEqual([])
  })
})

describe('the licenses tab', () => {
  it('scopes each table to live licenses of its owner, and a search to the listings it named', () => {
    expect(licenceBase({ path: 'buyerOrgId', value: 'org1' }, null)).toEqual([
      { path: 'buyerOrgId', op: '==', value: 'org1' },
      { path: 'refundedAt', op: '==', value: null },
    ])
    expect(licenceBase({ path: 'buyerUid', value: 'u1' }, ['l1', 'l2'])).toContainEqual({
      path: 'listingId',
      op: 'in',
      value: ['l1', 'l2'],
    })
  })

  it('asks "every workspace" as the null a pre-AGL-2331 purchase carries', () => {
    const clauses = mineLicenceClauses([{ field: 'buyerOrgId', op: 'equals', value: 'every' }])
    const asked = planListQuery(
      MINE_LICENCE_QUERY,
      { clauses, base: licenceBase({ path: 'buyerUid', value: 'u1' }, null) },
      nameSearchNormalizers,
    )
    expect(asked.refused).toEqual([])
    expect(asked.filters).toContainEqual({ path: 'buyerOrgId', op: '==', value: null })
  })

  it('serves Bought by You on the query', () => {
    const asked = planListQuery(
      HELD_LICENCE_QUERY,
      {
        clauses: [{ field: 'buyerUid', op: 'equals', value: 'u1' }],
        base: licenceBase({ path: 'buyerOrgId', value: 'org1' }, ['l1']),
      },
      nameSearchNormalizers,
    )
    expect(asked.refused).toEqual([])
    expect(asked.filters).toContainEqual({ path: 'buyerUid', op: '==', value: 'u1' })
  })

  it('looks listing names up by the token every listing writer stamps', () => {
    const asked = planListQuery(
      LISTING_NAME_LOOKUP,
      { clauses: [], search: ['Promo'] },
      nameSearchNormalizers,
    )
    expect(asked.filters).toEqual([{ path: 'nameTokens', op: 'array-contains', value: 'promo' }])
  })

  it('needs no composite: equalities in document order are served by index merging', () => {
    expect(listQueryIndexes(HELD_LICENCE_QUERY, [{ path: 'buyerOrgId' }, { path: 'refundedAt' }, { path: 'listingId' }])).toEqual([])
    expect(listQueryIndexes(MINE_LICENCE_QUERY, [{ path: 'buyerUid' }, { path: 'refundedAt' }, { path: 'listingId' }])).toEqual([])
  })
})

describe('the staff review queue', () => {
  it('reads live plugin listings in each section', () => {
    expect(reviewQueueBase('queue', [])).toEqual([
      { path: 'type', op: '==', value: 'plugin' },
      { path: 'deletedAt', op: '==', value: null },
      { path: 'latestVersionReviewState', op: 'in', value: ['pending', 'rejected'] },
    ])
    expect(reviewQueueBase('verification', [])).toContainEqual({
      path: 'verificationRequest.state',
      op: '==',
      value: 'pending',
    })
    expect(reviewQueueBase('listed', [])).toContainEqual({
      path: 'reviewStatus',
      op: 'in',
      value: ['listed', 'verified'],
    })
  })

  it('never lets a revoked or approved summary into Awaiting review', () => {
    expect(AWAITING_REVIEW_STATES).not.toContain('revoked')
    expect(AWAITING_REVIEW_STATES).not.toContain('approved')
  })

  it('lets a Listed status stand in for the section’s own, and empties it for any other', () => {
    const verified = reviewQueueStatusClauses('verified')
    expect(reviewQueueBase('listed', verified)).not.toContainEqual(
      expect.objectContaining({ path: 'reviewStatus', op: 'in' }),
    )
    expect(reviewQueueBase('listed', reviewQueueStatusClauses('submitted'))).toBeNull()
  })

  it('serves the Status select and the search on one query', () => {
    for (const status of ['submitted', 'in_review', 'listed', 'verified', 'hidden']) {
      const clauses = reviewQueueStatusClauses(status)
      const asked = planListQuery(
        REVIEW_QUEUE_QUERY,
        { clauses, search: ['Hours'], base: reviewQueueBase('queue', clauses) ?? [] },
        nameSearchNormalizers,
      )
      expect(asked.refused).toEqual([])
      expect(asked.filters).toContainEqual({ path: 'nameTokens', op: 'array-contains', value: 'hours' })
    }
    expect(reviewQueueStatusClauses('hidden')).toEqual([{ field: 'takenDown', op: 'is', value: 'true' }])
    expect(reviewQueueStatusClauses('all')).toEqual([])
  })

  it('needs no composite: equalities in document order', () => {
    expect(
      listQueryIndexes(REVIEW_QUEUE_QUERY, [
        { path: 'type' },
        { path: 'deletedAt' },
        { path: 'latestVersionReviewState' },
        { path: 'verificationRequest.state' },
      ]),
    ).toEqual([])
  })
})

describe('the abuse-report queue', () => {
  it('puts the status on the query, newest activity first', () => {
    const asked = planListQuery(
      MARKETPLACE_REPORTS_QUERY,
      { clauses: [{ field: 'status', op: 'equals', value: 'open' }] },
      nameSearchNormalizers,
    )
    expect(asked.filters).toEqual([{ path: 'status', op: '==', value: 'open' }])
    expect(asked.orderBy).toEqual({ path: 'updatedAt', direction: 'desc' })
  })

  it('pins its one composite', () => {
    const needed = listQueryIndexes(MARKETPLACE_REPORTS_QUERY)
    expect(needed).toEqual([
      {
        fields: [
          { fieldPath: 'status', order: 'ASCENDING' },
          { fieldPath: 'updatedAt', order: 'DESCENDING' },
        ],
      },
    ])
    expect(missingListQueryIndexes(INDEXES, 'marketplaceReports', needed)).toEqual([])
  })
})
