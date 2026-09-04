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

/*==========================================
 * A QUERY-RECORDING DOUBLE, deliberately.
 *
 * The properties worth holding for this reader are properties of the QUERY it
 * builds, not of Firestore's evaluation of it: that the site filter is
 * present, that the `in` list is capped and the overflow reported, that each
 * engagement filter orders on the field its inequality is over, and that a
 * cursor resumes from a document rather than from a value.
 *
 * Re-implementing collection-group semantics — `in` as a merge of thirty
 * sub-queries, inequality-first ordering, cursor positioning — would be a
 * double that can be wrong in exactly the ways the real thing is, and a green
 * suite over it would prove nothing. The delivery log's own spec records that
 * failure happening once already, when its fake reproduced a merge-set bug
 * faithfully enough to pass.
 *=========================================*/

import {
  EMAIL_CAMPAIGN_ENGAGEMENT_MAX_CAMPAIGNS,
  readCampaignEngagement,
} from './email-delivery-log'

interface RecordedQuery {
  collectionGroup: string
  where: Array<[string, string, unknown]>
  orderBy: Array<[string, string]>
  limit: number | null
  startAfter: unknown
}

/** One stored message row, as the reader's mapper expects to find it. */
function messageDoc(id: string, data: Record<string, unknown>) {
  return {
    id,
    ref: { path: `emailDeliveries/key_${id}/messages/${id}` },
    data: () => data,
  }
}

function fakeFirestore(options?: {
  docs?: ReturnType<typeof messageDoc>[]
  /** Paths whose `get()` reports the document as missing. */
  missingCursors?: string[]
  throwOnGet?: boolean
}) {
  const recorded: RecordedQuery[] = []
  const docs = options?.docs ?? []

  const makeQuery = (state: RecordedQuery): any => ({
    where: (field: string, op: string, value: unknown) =>
      makeQuery({ ...state, where: [...state.where, [field, op, value]] }),
    orderBy: (field: string, direction = 'asc') =>
      makeQuery({
        ...state,
        orderBy: [...state.orderBy, [field, direction]],
      }),
    startAfter: (anchor: unknown) => makeQuery({ ...state, startAfter: anchor }),
    limit: (value: number) => makeQuery({ ...state, limit: value }),
    get: async () => {
      recorded.push(state)
      if (options?.throwOnGet) throw new Error('missing index')
      const rows = state.limit === null ? docs : docs.slice(0, state.limit)
      return { docs: rows }
    },
  })

  return {
    recorded,
    collectionGroup: (name: string) =>
      makeQuery({
        collectionGroup: name,
        where: [],
        orderBy: [],
        limit: null,
        startAfter: undefined,
      }),
    doc: (path: string) => ({
      get: async () => ({
        exists: !(options?.missingCursors ?? []).includes(path),
        path,
      }),
    }),
  }
}

const ROW = {
  messageId: 'm1',
  to: 'reader@acme.test',
  status: 'opened',
  openCount: 3,
  clickCount: 1,
  clickedLinks: ['https://acme.test/spring'],
  firstSeenAtMs: 1_700_000_000_000,
  hostId: 'site1',
  campaignId: 'msg_1',
}

describe('the campaign engagement read is scoped to one site', () => {
  it('filters on hostId as well as on the messages asked for', async () => {
    const firestore = fakeFirestore()
    await readCampaignEngagement({
      hostId: 'site1',
      campaignIds: ['msg_1'],
      firestore,
    })
    const [query] = firestore.recorded
    expect(query.collectionGroup).toBe('messages')
    // A row belonging to another site cannot come back even if a message id
    // were wrong — the site filter is what makes that true.
    expect(query.where).toContainEqual(['hostId', '==', 'site1'])
    expect(query.where).toContainEqual(['campaignId', 'in', ['msg_1']])
  })

  it('reads nothing at all when no message is named', async () => {
    const firestore = fakeFirestore()
    const page = await readCampaignEngagement({
      hostId: 'site1',
      campaignIds: [],
      firestore,
    })
    // An unfiltered collection-group query over this store would return every
    // site's mail, so "no messages" must mean no query rather than no filter.
    expect(firestore.recorded).toHaveLength(0)
    expect(page.rows).toEqual([])
  })

  it('caps the message list and reports what it left out', async () => {
    const firestore = fakeFirestore()
    const ids = Array.from({ length: 35 }, (_, index) => `msg_${index}`)
    const page = await readCampaignEngagement({
      hostId: 'site1',
      campaignIds: ids,
      firestore,
    })
    const [query] = firestore.recorded
    const [, , inList] = query.where.find(([field]) => field === 'campaignId')!
    // Firestore's own ceiling on `in`. Exceeding it is an error, not a slower
    // query, so the cap is the store's rather than a tuning choice.
    expect((inList as string[]).length).toBe(
      EMAIL_CAMPAIGN_ENGAGEMENT_MAX_CAMPAIGNS,
    )
    expect(page.campaignsOmitted).toBe(5)
  })
})

describe('each engagement filter orders on what it filters', () => {
  const orderingFor = async (filter: 'all' | 'opened' | 'clicked') => {
    const firestore = fakeFirestore()
    await readCampaignEngagement({
      hostId: 'site1',
      campaignIds: ['msg_1'],
      filter,
      firestore,
    })
    return firestore.recorded[0]
  }

  it('orders everyone by when the message was first seen', async () => {
    const query = await orderingFor('all')
    expect(query.orderBy).toEqual([['firstSeenAtMs', 'desc']])
    expect(query.where.map(([field]) => field)).not.toContain('openCount')
  })

  it('puts the inequality first when asking who opened', async () => {
    const query = await orderingFor('opened')
    // Firestore requires the first ordering to be on the inequality's own
    // field. It is also what excludes a message never opened, which carries
    // no `openCount` field at all.
    expect(query.where).toContainEqual(['openCount', '>', 0])
    expect(query.orderBy[0]).toEqual(['openCount', 'desc'])
    expect(query.orderBy[1]).toEqual(['firstSeenAtMs', 'desc'])
  })

  it('does the same for who clicked, on the click count', async () => {
    const query = await orderingFor('clicked')
    expect(query.where).toContainEqual(['clickCount', '>', 0])
    expect(query.orderBy[0]).toEqual(['clickCount', 'desc'])
  })
})

describe('paging through the recipients', () => {
  it('hands back a cursor only when the page was full', async () => {
    const full = Array.from({ length: 3 }, (_, index) =>
      messageDoc(`m${index}`, ROW),
    )
    const page = await readCampaignEngagement({
      hostId: 'site1',
      campaignIds: ['msg_1'],
      limit: 3,
      firestore: fakeFirestore({ docs: full }),
    })
    expect(page.rows).toHaveLength(3)
    expect(page.cursor).toBe('emailDeliveries/key_m2/messages/m2')
  })

  it('ends the feed on a short page', async () => {
    const page = await readCampaignEngagement({
      hostId: 'site1',
      campaignIds: ['msg_1'],
      limit: 3,
      firestore: fakeFirestore({ docs: [messageDoc('m0', ROW)] }),
    })
    // Offering a cursor that returns nothing makes a finished table look
    // unfinished.
    expect(page.cursor).toBeNull()
  })

  it('resumes from the cursor DOCUMENT, not from its sort value', async () => {
    const firestore = fakeFirestore({ docs: [messageDoc('m0', ROW)] })
    await readCampaignEngagement({
      hostId: 'site1',
      campaignIds: ['msg_1'],
      cursor: 'emailDeliveries/key_m0/messages/m0',
      firestore,
    })
    // A value cursor positions after EVERY document sharing that value, so
    // two messages recorded in the same millisecond would lose one between
    // pages — silently, and only under load.
    expect(firestore.recorded[0].startAfter).toMatchObject({
      path: 'emailDeliveries/key_m0/messages/m0',
    })
  })

  it('stops rather than restarting when the cursor row is gone', async () => {
    const firestore = fakeFirestore({
      docs: [messageDoc('m0', ROW)],
      missingCursors: ['emailDeliveries/key_gone/messages/gone'],
    })
    const page = await readCampaignEngagement({
      hostId: 'site1',
      campaignIds: ['msg_1'],
      cursor: 'emailDeliveries/key_gone/messages/gone',
      firestore,
    })
    // Restarting at page one would loop the reader through the same rows.
    expect(page.rows).toEqual([])
    expect(page.cursor).toBeNull()
    expect(firestore.recorded).toHaveLength(0)
  })
})

describe('a read that could not run', () => {
  it('is reported as a failure, never as nobody having opened', async () => {
    const page = await readCampaignEngagement({
      hostId: 'site1',
      campaignIds: ['msg_1'],
      firestore: fakeFirestore({ throwOnGet: true }),
    })
    // A missing collection-group index is the likely cause, and rendering it
    // as an empty table is how a merchant concludes their email reached
    // nobody.
    expect(page.lookupFailed).toBe(true)
    expect(page.rows).toEqual([])
  })

  it('CONTROL: a read that ran reports no failure', async () => {
    const page = await readCampaignEngagement({
      hostId: 'site1',
      campaignIds: ['msg_1'],
      firestore: fakeFirestore({ docs: [messageDoc('m0', ROW)] }),
    })
    expect(page.lookupFailed).toBe(false)
    expect(page.rows[0].to).toBe('reader@acme.test')
    expect(page.rows[0].clickedLinks).toEqual(['https://acme.test/spring'])
  })
})
