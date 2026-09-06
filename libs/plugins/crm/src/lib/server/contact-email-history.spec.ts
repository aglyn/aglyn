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
 * `crm/contact-email-history` (AGL-2616): the campaign mail one contact was
 * sent, read off the person's own delivery log, filtered to the reading
 * group's campaigns, projected to what a timeline shows, and gated the way
 * the contacts read rule gates the row.
 */

import type { EmailDeliveryRecord } from '@aglyn/tenant-data-admin/server/email-delivery-log'

const verifyIdToken = jest.fn()
const getOrgForHost = jest.fn()
const resolveOrgMembership = jest.fn()
const memberHasOrgPermission = jest.fn()
const readEmailDeliveryHistory = jest.fn()

/** `hosts/{hostId}/campaigns/{campaignId}` → the email document. */
let campaigns: Record<string, Record<string, unknown>> = {}
/** `orgs/org-1/contacts/{id}` → the contact document. */
let contacts: Record<string, Record<string, unknown>> = {}
let groupHostIds: string[] = ['site-1']

const campaignRef = (hostId: string, campaignId: string) => ({
  id: campaignId,
  path: `hosts/${hostId}/campaigns/${campaignId}`,
  parent: { parent: { id: hostId } },
})

const firestoreHandle = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      collection: (sub: string) => ({
        doc: (subId: string) => campaignRef(id, subId),
      }),
    }),
  }),
  getAll: async (...refs: Array<ReturnType<typeof campaignRef>>) =>
    refs.map((ref) => {
      const data = campaigns[ref.path]
      return {
        id: ref.id,
        ref,
        exists: data !== undefined,
        get: (field: string) => data?.[field],
        data: () => data,
      }
    }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (token: string) => verifyIdToken(token) }),
      firestore: () => firestoreHandle,
    }),
  },
  getOrgForHost: (...args: unknown[]) => getOrgForHost(...args),
  resolveOrgMembership: (...args: unknown[]) => resolveOrgMembership(...args),
  memberHasOrgPermission: (...args: unknown[]) => memberHasOrgPermission(...args),
  orgDataCollectionForHost: async (_hostId: string, name: string) => ({
    doc: (id: string) => ({
      get: async () => {
        const data = contacts[`orgs/org-1/${name}/${id}`]
        return {
          exists: data !== undefined,
          get: (field: string) => data?.[field],
          data: () => data,
        }
      },
    }),
  }),
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: groupHostIds.length > 1 ? 'group-1' : hostId,
    name: null,
    hostIds: groupHostIds,
    declared: groupHostIds.length > 1,
  }),
}))

jest.mock('@aglyn/tenant-data-admin/server/email-delivery-log', () => ({
  __esModule: true,
  EMAIL_DELIVERY_READ_LIMIT: 50,
  readEmailDeliveryHistory: (...args: unknown[]) => readEmailDeliveryHistory(...args),
}))

import {
  contactCampaignEmailFromDelivery,
  contactEmailHistoryHandler,
} from './contact-email-history'

const HOST_ID = 'site-1'
const ORG_ID = 'org-1'
const READER = 'reader-uid'
const CONTACT = 'con-1'
const EMAIL = 'dana@example.com'

let roster: Record<string, Record<string, unknown>> = {}

async function call(options: {
  method?: string
  body?: unknown
  token?: string | null
}) {
  const { method = 'POST', body, token = 'good-token' } = options
  let status = 0
  let payload: any
  const headers: Record<string, unknown> = {}
  const res: any = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      payload = value
    },
    send: (value: unknown) => {
      payload = value
    },
    setHeader: (name: string, value: unknown) => {
      headers[name] = value
    },
    redirect: () => undefined,
    end: () => undefined,
  }
  await contactEmailHistoryHandler(
    {
      method,
      query: {},
      body,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      cookies: {},
      socket: {},
    } as never,
    res,
  )
  return { status, body: payload, headers }
}

const ask = (over: Record<string, unknown> = {}) =>
  call({ body: { hostId: HOST_ID, contactId: CONTACT, ...over } })

/** One delivery-log row, as the reader hands it back. */
const delivery = (over: Partial<EmailDeliveryRecord> = {}): EmailDeliveryRecord => ({
  messageId: 'msg-1',
  provider: 'resend',
  to: EMAIL,
  subject: 'Spring sale ends Sunday',
  context: 'campaign',
  status: 'sent',
  timestamps: { sent: 1_000 },
  firstSeenAtMs: 1_000,
  openCount: 0,
  clickCount: 0,
  clickedLinks: [],
  bounceType: null,
  detail: null,
  hostId: HOST_ID,
  campaignId: 'camp-1',
  ...over,
})

/** An editor scoped to one site — `hostAccess` is what makes them scoped. */
const scopedEditor = () => ({
  role: 'editor',
  allHosts: false,
  hostAccess: { [HOST_ID]: 'editor' },
  scopeTokens: [`host:${HOST_ID}`],
})

beforeEach(() => {
  roster = { [READER]: scopedEditor() }
  contacts = {
    [`orgs/${ORG_ID}/contacts/${CONTACT}`]: {
      email: EMAIL,
      visibleTo: [`host:${HOST_ID}`],
    },
  }
  campaigns = {
    [`hosts/${HOST_ID}/campaigns/camp-1`]: {
      displayName: 'Spring sale',
      subject: 'Spring sale ends Sunday',
    },
    [`hosts/${HOST_ID}/campaigns/camp-2`]: { subject: 'Summer preview' },
  }
  groupHostIds = [HOST_ID]
  verifyIdToken.mockReset().mockResolvedValue({ uid: READER })
  getOrgForHost.mockReset().mockImplementation(async () => ({ orgId: ORG_ID, org: {} }))
  resolveOrgMembership
    .mockReset()
    .mockImplementation(async (uid: string, orgId: string) =>
      roster[uid] ? { orgId, member: roster[uid] } : null,
    )
  memberHasOrgPermission.mockReset().mockResolvedValue(true)
  readEmailDeliveryHistory.mockReset().mockResolvedValue({
    lookupFailed: false,
    rows: [],
  })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the door', () => {
  it('answers only POST, and wants both ids', async () => {
    const get = await call({ method: 'GET' })
    expect(get.status).toBe(405)
    expect(get.headers['Allow']).toBe('POST')
    expect((await call({ body: { hostId: HOST_ID } })).status).toBe(400)
    expect((await call({ body: { contactId: CONTACT } })).status).toBe(400)
    expect(readEmailDeliveryHistory).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated or unverifiable caller before reading anything', async () => {
    expect((await call({ body: { hostId: HOST_ID, contactId: CONTACT }, token: null })).status).toBe(401)
    verifyIdToken.mockRejectedValueOnce(new Error('expired'))
    expect((await ask()).status).toBe(401)
    expect(readEmailDeliveryHistory).not.toHaveBeenCalled()
  })

  /*
   * The contacts read rule, restated: membership alone admits nobody — the
   * org viewer whose whole definition is reading and changing nothing was
   * never admitted to a person's mail — and `data.manage` is the key.
   */
  it('refuses a stranger, a suspended member and a member without data.manage', async () => {
    verifyIdToken.mockResolvedValueOnce({ uid: 'stranger' })
    expect((await ask()).status).toBe(403)

    roster[READER] = { ...roster[READER], orgSuspended: true }
    expect((await ask()).status).toBe(403)

    roster[READER] = { ...scopedEditor(), role: 'viewer' }
    memberHasOrgPermission.mockResolvedValueOnce(false)
    expect((await ask()).status).toBe(403)
    expect(readEmailDeliveryHistory).not.toHaveBeenCalled()
  })

  it('answers 404 for a site with no org', async () => {
    getOrgForHost.mockResolvedValueOnce(null)
    expect((await ask()).status).toBe(404)
  })

  /*
   * The per-document half. The Admin SDK evaluates no rules, so a scoped
   * member who guesses the id of a contact only another site holds must be
   * refused here exactly as their listener refuses the row — and told
   * nothing, because a 403 would confirm the id.
   */
  it('hides a contact the caller’s scope does not reach, and one that is not there', async () => {
    contacts[`orgs/${ORG_ID}/contacts/${CONTACT}`].visibleTo = ['host:site-9']
    expect((await ask()).status).toBe(404)
    expect((await ask({ contactId: 'nobody' })).status).toBe(404)
    expect(readEmailDeliveryHistory).not.toHaveBeenCalled()

    // An org-wide member reaches it; so does staff, on the claim alone.
    roster[READER] = { role: 'admin', scopeTokens: ['org'] }
    expect((await ask()).status).toBe(200)
    roster = {}
    verifyIdToken.mockResolvedValueOnce({ uid: 'staff-uid', staff: true })
    expect((await ask()).status).toBe(200)
  })
})

describe('what comes back', () => {
  it('reads the person’s own log, capped, and hands back this site’s campaign mail newest first', async () => {
    readEmailDeliveryHistory.mockResolvedValueOnce({
      lookupFailed: false,
      rows: [
        delivery({
          messageId: 'msg-old',
          campaignId: 'camp-2',
          subject: 'Summer preview',
          timestamps: { sent: 1_000, delivered: 1_100, opened: 1_200, clicked: 1_300 },
          firstSeenAtMs: 1_000,
          openCount: 2,
          clickCount: 1,
          clickedLinks: ['https://example.com/secret'],
        }),
        delivery({
          messageId: 'msg-new',
          campaignId: 'camp-1',
          timestamps: { sent: 5_000, bounced: 5_100 },
          firstSeenAtMs: 5_000,
          status: 'bounced',
          bounceType: 'Permanent',
          detail: 'mailbox full',
        }),
      ],
    })

    const { status, body } = await ask()

    expect(status).toBe(200)
    expect(readEmailDeliveryHistory).toHaveBeenCalledWith(EMAIL, { limit: 50 })
    expect(body).toEqual({
      ok: true,
      lookupFailed: false,
      limit: 50,
      emails: [
        {
          messageId: 'msg-new',
          hostId: HOST_ID,
          campaignId: 'camp-1',
          campaignName: 'Spring sale',
          subject: 'Spring sale ends Sunday',
          sentAtMs: 5_000,
          bouncedAtMs: 5_100,
          openCount: 0,
          clickCount: 0,
        },
        {
          messageId: 'msg-old',
          hostId: HOST_ID,
          campaignId: 'camp-2',
          // No display name on the email, so its subject names it.
          campaignName: 'Summer preview',
          subject: 'Summer preview',
          sentAtMs: 1_000,
          deliveredAtMs: 1_100,
          openedAtMs: 1_200,
          clickedAtMs: 1_300,
          openCount: 2,
          clickCount: 1,
        },
      ],
    })
    // Nothing the log holds about the person beyond the timeline's fields.
    const text = JSON.stringify(body)
    expect(text).not.toContain(EMAIL)
    expect(text).not.toContain('secret')
    expect(text).not.toContain('resend')
    expect(text).not.toContain('mailbox full')
  })

  /*
   * ⛔ THE LOG IS PLATFORM-WIDE; THE TIMELINE IS ONE GROUP'S. A sibling
   * business sharing the contact row, and the platform's own receipts, both
   * mail the same address and neither is this site's history.
   */
  it('leaves out another site’s campaigns and mail that names no campaign', async () => {
    readEmailDeliveryHistory.mockResolvedValueOnce({
      lookupFailed: false,
      rows: [
        delivery({ messageId: 'theirs', hostId: 'site-9', campaignId: 'camp-9' }),
        delivery({ messageId: 'receipt', hostId: null, campaignId: null, context: 'order' }),
        delivery({ messageId: 'invite', hostId: HOST_ID, campaignId: null, context: 'invite' }),
        delivery({ messageId: 'ours', campaignId: 'camp-1' }),
      ],
    })

    const { body } = await ask()

    expect(body.emails.map((entry: any) => entry.messageId)).toEqual(['ours'])
  })

  it('keeps a sibling site’s campaign when the two are one consent group', async () => {
    groupHostIds = [HOST_ID, 'site-2']
    campaigns['hosts/site-2/campaigns/camp-s2'] = { displayName: 'Sister brand launch' }
    readEmailDeliveryHistory.mockResolvedValueOnce({
      lookupFailed: false,
      rows: [
        delivery({ messageId: 'sister', hostId: 'site-2', campaignId: 'camp-s2' }),
        delivery({ messageId: 'other', hostId: 'site-9', campaignId: 'camp-9' }),
      ],
    })

    const { body } = await ask()

    expect(body.emails).toEqual([
      expect.objectContaining({
        messageId: 'sister',
        hostId: 'site-2',
        campaignName: 'Sister brand launch',
      }),
    ])
  })

  it('names a deleted email null and keeps the subject the person received', async () => {
    readEmailDeliveryHistory.mockResolvedValueOnce({
      lookupFailed: false,
      rows: [delivery({ campaignId: 'camp-gone', subject: 'Gone but sent' })],
    })

    const { body } = await ask()

    expect(body.emails).toEqual([
      expect.objectContaining({ campaignName: null, subject: 'Gone but sent' }),
    ])
  })

  it('says when the log could not be read, rather than answering an empty history', async () => {
    readEmailDeliveryHistory.mockResolvedValueOnce({ lookupFailed: true, rows: [] })

    const { status, body } = await ask()

    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, lookupFailed: true, emails: [] })
  })
})

describe('the projection', () => {
  it('places a row by its sent instant, or by the first event seen when sent never arrived', () => {
    expect(
      contactCampaignEmailFromDelivery(
        delivery({ timestamps: { opened: 900 }, firstSeenAtMs: 800 }),
        'Name',
      ),
    ).toMatchObject({ sentAtMs: 800, openedAtMs: 900 })
  })

  it('answers nothing for a row that names no campaign, no site, or no time at all', () => {
    expect(contactCampaignEmailFromDelivery(delivery({ campaignId: null }), null)).toBeNull()
    expect(contactCampaignEmailFromDelivery(delivery({ hostId: null }), null)).toBeNull()
    expect(
      contactCampaignEmailFromDelivery(
        delivery({ timestamps: {}, firstSeenAtMs: 0 }),
        null,
      ),
    ).toBeNull()
  })
})
