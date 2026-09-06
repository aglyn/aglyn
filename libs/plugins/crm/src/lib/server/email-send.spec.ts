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
 * `crm/email-send` (AGL-2615): one email to one person from their record.
 *
 * WHAT THE DOUBLES MODEL. The Firestore store is real enough for the reads
 * the route makes — `doc().get()` by path — and every write the route owes
 * goes through a named seam that is a spy here: the activity row, today's
 * counter, the cost meter, the provider send. `@aglyn/aglyn/server` is the
 * REAL module, so the daily cap is judged by `checkCrmEmailQuota` against
 * the real plan table, the `declined` basis by `readMarketingBasis`, the
 * scope by `crmScopeTokens` and the row by `buildCrmEmailActivity` — the
 * rules under test, which a double would only restate.
 *
 * The claims: the recipient comes off the RECORD and never the body; every
 * gate refuses BEFORE the provider is called and nothing is written on a
 * refusal; a send the provider accepted is logged, counted and metered, in
 * that order, and a send it refused is none of those.
 */

const verifyIdToken = jest.fn()
const getOrgForHost = jest.fn()
const resolveOrgMembership = jest.fn()
const memberHasOrgPermission = jest.fn()
const consumeRateLimit = jest.fn()
const crmEmailsSentToday = jest.fn()
const recordCrmEmailSend = jest.fn()
const recordEmailSends = jest.fn()
const filterSendableForHost = jest.fn()
const hostSendingIdentity = jest.fn()
const countCrmActivitiesForRecord = jest.fn()
const writeCrmEmailActivity = jest.fn()
const sendEmail = jest.fn()
const isEmailConfigured = jest.fn()

let store: Record<string, Record<string, any>> = {}

const snapshotFor = (path: string) => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  get exists() {
    return store[path] !== undefined
  },
  get: (field: string) => store[path]?.[field],
  data: () => store[path],
})

const docHandle = (path: string) => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  path,
  get: async () => snapshotFor(path),
})

const collectionHandle = (path: string) => ({
  doc: (id: string) => docHandle(`${path}/${id}`),
})

const firestoreHandle = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      path: `${name}/${id}`,
      collection: (sub: string) => collectionHandle(`${name}/${id}/${sub}`),
    }),
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
  consumeRateLimit: (...args: unknown[]) => consumeRateLimit(...args),
  crmEmailsSentToday: (...args: unknown[]) => crmEmailsSentToday(...args),
  recordCrmEmailSend: (...args: unknown[]) => recordCrmEmailSend(...args),
  recordEmailSends: (...args: unknown[]) => recordEmailSends(...args),
  filterSendableForHost: (...args: unknown[]) => filterSendableForHost(...args),
  hostSendingIdentity: (...args: unknown[]) => hostSendingIdentity(...args),
  countCrmActivitiesForRecord: (...args: unknown[]) =>
    countCrmActivitiesForRecord(...args),
  writeCrmEmailActivity: (...args: unknown[]) => writeCrmEmailActivity(...args),
  // The minted reference: a fixed id, so the tags and the row can be
  // matched against it.
  newCrmActivityRef: () => ({ id: 'act-new', path: 'orgs/org-1/crmActivities/act-new' }),
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  orgDataCollectionForHost: async (_hostId: string, name: string) =>
    collectionHandle(`orgs/org-1/${name}`),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => isEmailConfigured(),
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  sendFailureReason: (result: { sent?: boolean; reason?: string } | null) =>
    !result || result.sent ? null : (result.reason ?? null),
}))

import {
  CRM_ACTIVITY_LOG_FULL_MESSAGE,
  CRM_ACTIVITIES_PER_RECORD_CEILING,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/server'
import {
  CRM_EMAIL_DECLINED_MESSAGE,
  CRM_EMAIL_NOT_INCLUDED_MESSAGE,
  CRM_EMAIL_RATE_MESSAGE,
  CRM_EMAIL_SUPPRESSED_MESSAGE,
  crmEmailCapReachedMessage,
  crmEmailSendHandler,
} from './email-send'

const HOST_ID = 'site-1'
const ORG_ID = 'org-1'
const CONTACT = `orgs/${ORG_ID}/contacts/contact-1`
const DEAL = `orgs/${ORG_ID}/deals/deal-1`
const LEAD = `hosts/${HOST_ID}/leads/lead-1`
/** A plan that carries the suite; the cap is read off the real table. */
const PLAN = 'starter'
const INCLUDED = resolveOrgEntitlements({ plan: PLAN } as never).crmEmailsPerDay

async function call(body: Record<string, unknown>, options: { token?: string | null; method?: string } = {}) {
  let status = 0
  let answered: any
  const headers: Record<string, string> = {}
  const res: any = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      answered = value
    },
    send: (value: unknown) => {
      answered = value
    },
    setHeader: (name: string, value: string) => {
      headers[name] = value
    },
    redirect: () => undefined,
    end: () => undefined,
  }
  const token = options.token === undefined ? 'good-token' : options.token
  await crmEmailSendHandler(
    {
      method: options.method ?? 'POST',
      query: {},
      body: { hostId: HOST_ID, ...body },
      headers: token ? { authorization: `Bearer ${token}` } : {},
      cookies: {},
      socket: {},
    } as any,
    res,
  )
  return { status, body: answered, headers }
}

const MESSAGE = { contactId: 'contact-1', subject: 'Quick question', body: 'Hi Ada,\r\n\r\nStill keen?' }

beforeEach(() => {
  jest.clearAllMocks()
  store = {
    [CONTACT]: {
      email: 'Ada@Example.com',
      visibleTo: [`host:${HOST_ID}`],
      facets: { [HOST_ID]: { companyId: 'co-1' } },
    },
    [DEAL]: { contactId: 'contact-1', visibleTo: [`host:${HOST_ID}`] },
    [LEAD]: { email: 'lead@example.com' },
  }
  verifyIdToken.mockResolvedValue({ uid: 'u-rep', email: 'Rep@Acme.com', name: 'Rep Ada' })
  getOrgForHost.mockResolvedValue({ orgId: ORG_ID, org: { plan: PLAN } })
  resolveOrgMembership.mockResolvedValue({
    member: { role: 'editor', hostAccess: { [HOST_ID]: true } },
  })
  memberHasOrgPermission.mockResolvedValue(true)
  consumeRateLimit.mockResolvedValue({ allowed: true, resetMs: Date.now() + 60_000 })
  crmEmailsSentToday.mockResolvedValue(0)
  countCrmActivitiesForRecord.mockResolvedValue(0)
  filterSendableForHost.mockImplementation(async (_host: string, emails: string[]) => emails)
  hostSendingIdentity.mockResolvedValue({
    from: 'hello@site.mail.aglyn.app',
    source: 'custom',
    domain: 'site.mail.aglyn.app',
    summary: 'Sending as hello@site.mail.aglyn.app.',
    refusal: null,
  })
  isEmailConfigured.mockReturnValue(true)
  sendEmail.mockResolvedValue({ sent: true, id: 'msg-1' })
  writeCrmEmailActivity.mockResolvedValue(undefined)
  recordCrmEmailSend.mockResolvedValue(undefined)
  recordEmailSends.mockResolvedValue(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

/** Nothing left the building, nothing was written. */
const expectNothingSent = () => {
  expect(sendEmail).not.toHaveBeenCalled()
  expect(writeCrmEmailActivity).not.toHaveBeenCalled()
  expect(recordCrmEmailSend).not.toHaveBeenCalled()
  expect(recordEmailSends).not.toHaveBeenCalled()
}

describe('the request', () => {
  it('answers POST only', async () => {
    const { status, headers } = await call(MESSAGE, { method: 'GET' })
    expect(status).toBe(405)
    expect(headers['Allow']).toBe('POST')
  })

  it('refuses a body that names no record, no subject or no message', async () => {
    expect((await call({ subject: 'x', body: 'y' })).status).toBe(400)
    expect((await call({ contactId: 'contact-1', body: 'y' })).status).toBe(400)
    expect((await call({ contactId: 'contact-1', subject: 'x', body: '   ' })).status).toBe(400)
    expectNothingSent()
  })

  it('refuses without a token, before any read', async () => {
    const { status } = await call(MESSAGE, { token: null })
    expect(status).toBe(401)
    expect(getOrgForHost).not.toHaveBeenCalled()
    expectNothingSent()
  })

  it('refuses a member without data.manage on this site', async () => {
    memberHasOrgPermission.mockResolvedValue(false)
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(403)
    expect(body.error).toContain('data.manage')
    expectNothingSent()
  })

  it('refuses a member whose tokens do not reach this site', async () => {
    resolveOrgMembership.mockResolvedValue({
      member: { role: 'editor', hostAccess: { 'other-site': true } },
    })
    expect((await call(MESSAGE)).status).toBe(403)
    expectNothingSent()
  })

  it('refuses an account with no address to receive replies at', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u-rep' })
    const { status } = await call(MESSAGE)
    expect(status).toBe(403)
    expectNothingSent()
  })
})

describe('the per-user pace', () => {
  it('counts one send on a bucket keyed by the uid, twenty a minute', async () => {
    await call(MESSAGE)
    expect(consumeRateLimit).toHaveBeenCalledWith('crm-email-send:uid:u-rep', {
      limit: 20,
      windowMs: 60_000,
    })
  })

  it('answers 429 with Retry-After once the bucket is spent, and reads no record', async () => {
    consumeRateLimit.mockResolvedValue({ allowed: false, resetMs: Date.now() + 42_000 })
    const { status, body, headers } = await call(MESSAGE)
    expect(status).toBe(429)
    expect(body).toMatchObject({ error: CRM_EMAIL_RATE_MESSAGE, reason: 'rate' })
    expect(Number(headers['Retry-After'])).toBeGreaterThanOrEqual(41)
    expect(crmEmailsSentToday).not.toHaveBeenCalled()
    expectNothingSent()
  })
})

describe('the recipient comes off the record', () => {
  it('ignores any address in the body and mails the contact\'s own, normalized', async () => {
    await call({ ...MESSAGE, to: 'attacker@example.com' })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0].to).toBe('ada@example.com')
  })

  it('refuses a contact this site cannot see, as if it did not exist', async () => {
    store[CONTACT].visibleTo = ['host:other-site']
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(404)
    expect(body.error).toBe('Unknown contact')
    expectNothingSent()
  })

  it('refuses a contact with no address', async () => {
    store[CONTACT].email = ''
    expect((await call(MESSAGE)).status).toBe(400)
    expectNothingSent()
  })

  it('resolves a deal to its contact and files the email under both', async () => {
    await call({ dealId: 'deal-1', subject: 'Proposal', body: 'Attached.' })
    expect(sendEmail.mock.calls[0][0].to).toBe('ada@example.com')
    expect(writeCrmEmailActivity.mock.calls[0][1]).toMatchObject({
      contactId: 'contact-1',
      dealId: 'deal-1',
      companyId: 'co-1',
    })
  })

  it('refuses a deal that names no contact', async () => {
    delete store[DEAL].contactId
    const { status, body } = await call({ dealId: 'deal-1', subject: 'x', body: 'y' })
    expect(status).toBe(400)
    expect(body.error).toContain('names no contact')
    expectNothingSent()
  })

  it('refuses a deal outside this site\'s scope', async () => {
    store[DEAL].visibleTo = ['host:other-site']
    expect((await call({ dealId: 'deal-1', subject: 'x', body: 'y' })).status).toBe(404)
    expectNothingSent()
  })

  it('mails a lead at its own address and files the email under the lead', async () => {
    await call({ leadId: 'lead-1', subject: 'Welcome', body: 'Thanks for asking.' })
    expect(sendEmail.mock.calls[0][0].to).toBe('lead@example.com')
    const row = writeCrmEmailActivity.mock.calls[0][1]
    expect(row.leadId).toBe('lead-1')
    expect('contactId' in row).toBe(false)
  })

  it('files a converted lead\'s email under the contact it became as well', async () => {
    store[LEAD].convertedContactId = 'contact-1'
    await call({ leadId: 'lead-1', subject: 'Welcome', body: 'Thanks.' })
    expect(writeCrmEmailActivity.mock.calls[0][1]).toMatchObject({
      leadId: 'lead-1',
      contactId: 'contact-1',
    })
  })
})

describe('the daily cap (AGL-2611)', () => {
  it('sends the last email inside the cap and refuses the next', async () => {
    expect(INCLUDED).toBeGreaterThan(0)
    crmEmailsSentToday.mockResolvedValue(INCLUDED - 1)
    expect((await call(MESSAGE)).status).toBe(200)
    expect(sendEmail).toHaveBeenCalledTimes(1)

    jest.clearAllMocks()
    crmEmailsSentToday.mockResolvedValue(INCLUDED)
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(409)
    expect(body).toMatchObject({
      error: crmEmailCapReachedMessage(INCLUDED),
      reason: 'quota',
      included: INCLUDED,
      used: INCLUDED,
    })
    expect(body.resetsAtMs).toEqual(expect.any(Number))
    expectNothingSent()
  })

  it('tells a plan with no one-to-one email to upgrade, at zero', async () => {
    getOrgForHost.mockResolvedValue({ orgId: ORG_ID, org: { plan: 'free' } })
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(409)
    expect(body).toMatchObject({ error: CRM_EMAIL_NOT_INCLUDED_MESSAGE, included: 0 })
    expectNothingSent()
  })
})

describe('the other gates, each before the provider', () => {
  it('refuses a record at the activity ceiling', async () => {
    countCrmActivitiesForRecord.mockResolvedValue(CRM_ACTIVITIES_PER_RECORD_CEILING)
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(409)
    expect(body).toMatchObject({ error: CRM_ACTIVITY_LOG_FULL_MESSAGE, reason: 'ceiling' })
    expectNothingSent()
  })

  it('refuses an address on either suppression list', async () => {
    filterSendableForHost.mockResolvedValue([])
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(409)
    expect(body).toMatchObject({ error: CRM_EMAIL_SUPPRESSED_MESSAGE, reason: 'suppressed' })
    expect(filterSendableForHost).toHaveBeenCalledWith(HOST_ID, ['ada@example.com'])
    expectNothingSent()
  })

  it('refuses a person with a recorded refusal on this site', async () => {
    store[CONTACT].marketingConsentByHost = { [HOST_ID]: { marketingConsent: false } }
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(409)
    expect(body).toMatchObject({ error: CRM_EMAIL_DECLINED_MESSAGE, reason: 'declined' })
    expectNothingSent()
  })

  it('does not require a grant — an unrecorded basis is not a refusal', async () => {
    delete store[CONTACT].marketingConsentByHost
    expect((await call(MESSAGE)).status).toBe(200)
  })

  it('refuses when the site has no sending identity, with the setup reason', async () => {
    hostSendingIdentity.mockResolvedValue({
      from: null,
      source: null,
      domain: 'mail.acme.com',
      summary: 'mail.acme.com is not verified.',
      refusal: { code: 'unverified', domain: 'mail.acme.com', message: 'Verify mail.acme.com first.', missing: ['dkim'] },
    })
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(409)
    expect(body).toEqual({ error: 'Verify mail.acme.com first.', reason: 'sending-identity' })
    expectNothingSent()
  })

  it('answers 501 on a deployment with no mail configured', async () => {
    isEmailConfigured.mockReturnValue(false)
    expect((await call(MESSAGE)).status).toBe(501)
    expectNothingSent()
  })
})

describe('a send the provider accepted', () => {
  it('leaves on the site\'s identity, as the rep, replying to the rep, tagged for the webhook', async () => {
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(200)
    expect(body).toEqual({
      ok: true,
      activityId: 'act-new',
      to: 'ada@example.com',
      from: 'hello@site.mail.aglyn.app',
      logged: true,
    })
    expect(sendEmail).toHaveBeenCalledWith({
      to: 'ada@example.com',
      subject: 'Quick question',
      text: 'Hi Ada,\n\nStill keen?',
      sendingIdentity: expect.objectContaining({ from: 'hello@site.mail.aglyn.app' }),
      audience: 'tenant',
      context: 'crm',
      replyTo: 'rep@acme.com',
      fromName: 'Rep Ada',
      tags: [
        { name: 'orgId', value: ORG_ID },
        { name: 'activityId', value: 'act-new' },
        { name: 'hostId', value: HOST_ID },
      ],
    })
  })

  it('logs the row under the minted id, then counts it, then meters it', async () => {
    await call(MESSAGE)
    const [ref, row] = writeCrmEmailActivity.mock.calls[0]
    expect(ref.id).toBe('act-new')
    expect(row).toMatchObject({
      kind: 'email',
      subject: 'Quick question',
      body: 'Hi Ada,\n\nStill keen?',
      to: 'ada@example.com',
      direction: 'outbound',
      deliveryState: 'sent',
      byUid: 'u-rep',
      byName: 'Rep Ada',
      contactId: 'contact-1',
      companyId: 'co-1',
      hostId: HOST_ID,
      visibleTo: [`host:${HOST_ID}`],
    })
    expect(row.atMs).toEqual(expect.any(Number))
    expect(recordCrmEmailSend).toHaveBeenCalledWith(firestoreHandle, ORG_ID)
    expect(recordEmailSends).toHaveBeenCalledWith({
      scope: { kind: 'org', orgId: ORG_ID },
      count: 1,
      sendClass: 'transactional',
      firestore: firestoreHandle,
    })
    const order = [writeCrmEmailActivity, recordCrmEmailSend, recordEmailSends].map(
      (spy) => spy.mock.invocationCallOrder[0],
    )
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('still counts and answers when the row could not be written, and says so', async () => {
    writeCrmEmailActivity.mockRejectedValue(new Error('unavailable'))
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(200)
    expect(body.logged).toBe(false)
    expect(recordCrmEmailSend).toHaveBeenCalledTimes(1)
    expect(recordEmailSends).toHaveBeenCalledTimes(1)
  })
})

describe('a send the provider refused', () => {
  it('writes and counts nothing, and names the failure', async () => {
    sendEmail.mockResolvedValue({ sent: false, reason: 'rejected', status: 422, detail: 'bad' })
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(502)
    expect(body.reason).toBe('send-failed')
    expect(writeCrmEmailActivity).not.toHaveBeenCalled()
    expect(recordCrmEmailSend).not.toHaveBeenCalled()
    expect(recordEmailSends).not.toHaveBeenCalled()
  })

  it('relays a provider rate limit as a retry, not a fault', async () => {
    sendEmail.mockResolvedValue({ sent: false, reason: 'rate-limited', retryAtMs: Date.now() + 30_000 })
    const { status, body, headers } = await call(MESSAGE)
    expect(status).toBe(503)
    expect(body.reason).toBe('provider-rate')
    expect(Number(headers['Retry-After'])).toBeGreaterThanOrEqual(29)
  })

  it('relays the seam\'s own identity refusal', async () => {
    sendEmail.mockResolvedValue({ sent: false, reason: 'unverified-domain', detail: 'No identity.' })
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(409)
    expect(body).toEqual({ error: 'No identity.', reason: 'sending-identity' })
  })
})
