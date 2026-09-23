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
 * THE ROUTE THAT HANDS OUT RECIPIENT ADDRESSES.
 *
 * Every assertion here is about who is allowed to ask and what they are
 * allowed to ask for. The reader behind it is proven separately
 * (`email-campaign-engagement.spec.ts`); this file is the gate.
 */

const mockState: {
  role: string | undefined
  hostExists: boolean
  verifyThrows: boolean
  messages: Array<{ id: string; data: Record<string, unknown> }>
  engagementCalls: Array<Record<string, unknown>>
  /** The site's organization; null for a site with none. */
  orgId: string | null
  /** Every message collection a read addressed, and the filters it applied. */
  reads: Array<{ path: string; where: Array<[string, string, unknown]> }>
} = {
  role: 'editor',
  hostExists: true,
  verifyThrows: false,
  messages: [],
  engagementCalls: [],
  orgId: 'org_1',
  reads: [],
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  /*
   * The real resolution's shape: an org that declared no pooling resolves
   * every site to a group of ONE. Faked rather than imported because this
   * file mocks the whole module — but faked to the NARROW answer, which is
   * the direction a wrong group may fail in.
   */
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  __esModule: true,
  resolveOrgIdForHost: async () => mockState.orgId,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => {
          if (mockState.verifyThrows) throw new Error('bad token')
          return { uid: 'user_1' }
        },
      }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) =>
            name === 'hosts' ? hostRef() : parentRef(`${name}/${id}`),
        }),
      }),
    }),
  },
}))

jest.mock('@aglyn/tenant-data-admin/server/email-delivery-log', () => ({
  __esModule: true,
  EMAIL_CAMPAIGN_ENGAGEMENT_MAX_CAMPAIGNS: 30,
  readCampaignEngagement: async (options: Record<string, unknown>) => {
    mockState.engagementCalls.push(options)
    return {
      /*
       * A FULL stored record, including the operational fields a merchant has
       * no reading for. The route is supposed to drop them, and it can only be
       * seen to drop them if they were there to drop.
       */
      rows: [
        {
          messageId: 'm1',
          provider: 'resend',
          to: 'reader@acme.test',
          subject: null,
          context: 'campaign',
          status: 'opened',
          timestamps: { opened: 1_700_000_000_500 },
          firstSeenAtMs: 1_700_000_000_000,
          openCount: 3,
          clickCount: 1,
          clickedLinks: ['https://acme.test/spring'],
          bounceType: null,
          detail: 'smtp chatter nobody outside operations should read',
          hostId: 'site1',
          campaignId: 'msg_1',
        },
      ],
      cursor: null,
      lookupFailed: false,
      campaignsOmitted: 0,
    }
  },
}))

jest.mock('@aglyn/tenant-data-admin/server/document-id', () => ({
  __esModule: true,
  isDocumentId: (value: unknown) =>
    typeof value === 'string' && value.length > 0 && !value.includes('/'),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldPath: { documentId: () => '__name__' },
}))

/** The site document. */
function hostRef() {
  return {
    get: async () => ({
      exists: mockState.hostExists,
      get: (field: string) =>
        field === 'memberRoles' ? { user_1: mockState.role } : undefined,
    }),
  }
}

/**
 * The organization's message collection, which answers every equality the
 * read applies — so a read that forgot to narrow to its site would be handed
 * the sibling's messages here as it would be by Firestore.
 */
function parentRef(path: string) {
  return {
    collection: (name: string) => {
      const read = { path: `${path}/${name}`, where: [] as Array<[string, string, unknown]> }
      mockState.reads.push(read)
      const query: any = {
        where: (field: string, op: string, value: unknown) => {
          read.where.push([field, op, value])
          return query
        },
        orderBy: () => query,
        limit: () => query,
        get: async () => ({
          docs: mockState.messages
            .filter((message) =>
              read.where.every(([field, , value]) => message.data[field] === value),
            )
            .map(messageSnapshot),
        }),
      }
      return {
        ...query,
        doc: (id: string) => ({
          get: async () => {
            const found = mockState.messages.find((one) => one.id === id)
            return found
              ? messageSnapshot(found)
              : { exists: false, id, get: () => undefined }
          },
        }),
      }
    },
  }
}

function messageSnapshot(message: { id: string; data: Record<string, unknown> }) {
  return {
    id: message.id,
    exists: true,
    get: (field: string) => message.data[field],
  }
}

import { campaignRecipientsHandler } from './campaign-recipients'

function fakeResponse() {
  const answer: { status: number; body: any } = { status: 0, body: null }
  return {
    answer,
    status(code: number) {
      answer.status = code
      return this
    },
    json(body: unknown) {
      answer.body = body
      return this
    },
  }
}

async function call(body: Record<string, unknown>, authorized = true) {
  const res = fakeResponse()
  await campaignRecipientsHandler(
    {
      method: 'POST',
      body,
      headers: authorized ? { authorization: 'Bearer token' } : {},
    } as any,
    res as any,
  )
  return res.answer
}

beforeEach(() => {
  mockState.role = 'editor'
  mockState.hostExists = true
  mockState.verifyThrows = false
  mockState.messages = [
    {
      id: 'msg_1',
      data: {
        hostId: 'site1',
        templateScreenId: 'scr_1',
        subject: 'Spring sale',
        sentAt: { toMillis: () => 2 },
      },
    },
    {
      id: 'msg_2',
      data: {
        hostId: 'site1',
        templateScreenId: 'scr_1',
        subject: 'Older',
        sentAt: { toMillis: () => 1 },
      },
    },
  ]
  mockState.engagementCalls = []
  mockState.orgId = 'org_1'
  mockState.reads = []
})

describe('who may read recipient addresses', () => {
  it('refuses a request carrying no credential', async () => {
    expect((await call({ hostId: 'site1', screenId: 'scr_1' }, false)).status).toBe(
      401,
    )
  })

  it('refuses a member who is neither admin nor editor', async () => {
    mockState.role = 'viewer'
    const answer = await call({ hostId: 'site1', screenId: 'scr_1' })
    // The same role the SEND path requires: whoever may address these people
    // may see which of them opened, and nobody else.
    expect(answer.status).toBe(403)
    expect(mockState.engagementCalls).toHaveLength(0)
  })

  it('refuses somebody with no role on the site at all', async () => {
    mockState.role = undefined
    expect((await call({ hostId: 'site1', screenId: 'scr_1' })).status).toBe(403)
  })

  it('CONTROL: an editor is served', async () => {
    const answer = await call({ hostId: 'site1', screenId: 'scr_1' })
    expect(answer.status).toBe(200)
    expect(mockState.engagementCalls).toHaveLength(1)
  })

  it('admits an admin too', async () => {
    mockState.role = 'admin'
    expect((await call({ hostId: 'site1', screenId: 'scr_1' })).status).toBe(200)
  })

  it('answers 404 for a site that does not exist', async () => {
    mockState.hostExists = false
    expect((await call({ hostId: 'site1', screenId: 'scr_1' })).status).toBe(404)
  })

  it('refuses anything but POST', async () => {
    const res = fakeResponse()
    await campaignRecipientsHandler({ method: 'GET', headers: {} } as any, res as any)
    expect(res.answer.status).toBe(405)
  })
})

describe('what a caller may ask for', () => {
  it('refuses an id that names a path rather than a document', async () => {
    // Both ids are path components on the reads behind this, so "non-empty"
    // was never the whole question.
    expect((await call({ hostId: 'site1', screenId: 'a/b' })).status).toBe(400)
    expect((await call({ hostId: 'a/b', screenId: 'scr_1' })).status).toBe(400)
  })

  it('refuses naming neither scope', async () => {
    expect((await call({ hostId: 'site1' })).status).toBe(400)
  })

  it('refuses naming both scopes at once', async () => {
    // Serving one of them silently would answer a question nobody asked.
    const answer = await call({
      hostId: 'site1',
      screenId: 'scr_1',
      emailId: 'msg_1',
    })
    expect(answer.status).toBe(400)
  })

  it('reads one message when asked for one', async () => {
    await call({ hostId: 'site1', emailId: 'msg_1' })
    expect(mockState.engagementCalls[0]['campaignIds']).toEqual(['msg_1'])
  })

  it('answers 404 for a message that does not exist', async () => {
    expect((await call({ hostId: 'site1', emailId: 'nope' })).status).toBe(404)
  })

  it('resolves a template to its own messages, newest first', async () => {
    await call({ hostId: 'site1', screenId: 'scr_1' })
    // Ids are never taken from the request: a caller who could name them
    // could name another site's.
    expect(mockState.engagementCalls[0]['campaignIds']).toEqual([
      'msg_1',
      'msg_2',
    ])
  })

  it('sorts a scheduled message beside a sent one', async () => {
    mockState.messages = [
      {
        id: 'sent',
        data: { hostId: 'site1', templateScreenId: 'scr_1', sentAt: { toMillis: () => 10 } },
      },
      {
        id: 'scheduled',
        data: { hostId: 'site1', templateScreenId: 'scr_1', sendAtMs: 20 },
      },
    ]
    await call({ hostId: 'site1', screenId: 'scr_1' })
    // A message with no `sentAt` would otherwise sort last forever, which is
    // the same drop `orderBy` would have caused in the query.
    expect(mockState.engagementCalls[0]['campaignIds']).toEqual([
      'scheduled',
      'sent',
    ])
  })

  it('passes only a recognised engagement filter through', async () => {
    await call({ hostId: 'site1', screenId: 'scr_1', filter: 'nonsense' })
    expect(mockState.engagementCalls[0]['filter']).toBe('all')
    await call({ hostId: 'site1', screenId: 'scr_1', filter: 'clicked' })
    expect(mockState.engagementCalls[1]['filter']).toBe('clicked')
  })
})

/*
 * THE MESSAGES ARE THE ORGANIZATION'S, one collection for every site, so a
 * read narrows to the site the caller holds a role on — or it would hand one
 * site's editors the addresses another site mailed.
 */
describe('whose messages are read', () => {
  it('reads the organization’s messages, narrowed to this site and this design', async () => {
    mockState.messages.push({
      id: 'theirs',
      data: { hostId: 'site2', templateScreenId: 'scr_1', sentAt: { toMillis: () => 3 } },
    })
    await call({ hostId: 'site1', screenId: 'scr_1' })
    expect(mockState.reads.map((read) => read.path)).toEqual(['orgs/org_1/campaigns'])
    expect(mockState.reads[0].where).toEqual([
      ['hostId', '==', 'site1'],
      ['templateScreenId', '==', 'scr_1'],
    ])
    expect(mockState.engagementCalls[0]['campaignIds']).toEqual(['msg_1', 'msg_2'])
  })

  it('answers a sibling site’s message as one that does not exist', async () => {
    mockState.messages.push({ id: 'theirs', data: { hostId: 'site2', subject: 'Theirs' } })
    expect((await call({ hostId: 'site1', emailId: 'theirs' })).status).toBe(404)
    expect(mockState.engagementCalls).toHaveLength(0)
  })

  it('answers 404 for a site with no organization, which has no messages', async () => {
    mockState.orgId = null
    expect((await call({ hostId: 'site1', emailId: 'msg_1' })).status).toBe(404)
    expect(mockState.engagementCalls).toHaveLength(0)
  })
})

describe('what comes back', () => {
  it('answers with the page and nothing else', async () => {
    const answer = await call({ hostId: 'site1', screenId: 'scr_1' })
    expect(Object.keys(answer.body)).toEqual([
      'rows',
      'cursor',
      'lookupFailed',
      'campaignsRead',
      'campaignsOmitted',
    ])
  })

  it('does not ship the internal record wholesale', async () => {
    const answer = await call({ hostId: 'site1', screenId: 'scr_1' })
    // Shipping every field of an internal record to a browser is how one
    // becomes an accidental contract — and `detail` is operational text a
    // merchant has no reading for.
    expect(Object.keys(answer.body.rows[0]).sort()).toEqual([
      'campaignId',
      'clickCount',
      'clickedLinks',
      'firstSeenAtMs',
      'lastEventAtMs',
      'messageId',
      'openCount',
      'status',
      'subject',
      'to',
    ])
  })

  it('falls back to the message subject when the row carries none', async () => {
    const answer = await call({ hostId: 'site1', screenId: 'scr_1' })
    expect(answer.body.rows[0].subject).toBe('Spring sale')
  })

  it('reports the last engagement rather than the first sighting', async () => {
    const answer = await call({ hostId: 'site1', screenId: 'scr_1' })
    expect(answer.body.rows[0].lastEventAtMs).toBe(1_700_000_000_500)
  })
})
