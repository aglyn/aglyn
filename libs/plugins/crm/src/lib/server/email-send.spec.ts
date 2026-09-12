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
 * the route makes — `doc().get()` by path — and for the one transaction it
 * runs, the daily cap's reservation (AGL-2645), which is the REAL
 * `reserveCrmEmailSend` over a `runTransaction` that serializes its
 * callers the way Firestore's optimistic concurrency does: the second
 * transaction reads what the first committed. Every other write the route
 * owes goes through a named seam that is a spy here: the activity row, the
 * cost meter, the provider send. `@aglyn/aglyn/server` is the REAL module,
 * so the daily cap is judged by `checkCrmEmailQuota` against the real plan
 * table, the `declined` basis by `readMarketingBasis`, the scope by
 * `crmScopeTokens` and the row by `buildCrmEmailActivity` — the rules under
 * test, which a double would only restate.
 *
 * The claims: the recipient comes off the RECORD and never the body; every
 * gate refuses BEFORE the provider is called and nothing is written on a
 * refusal; the cap is a slot taken before the send, so two sends racing at
 * the last slot yield one send; a send the provider accepted is logged and
 * metered, and a send it refused is neither and gives the slot back.
 */

const verifyIdToken = jest.fn()
const getOrgForHost = jest.fn()
const resolveOrgMembership = jest.fn()
const memberHasOrgPermission = jest.fn()
const consumeRateLimit = jest.fn()
const recordEmailSends = jest.fn()
const filterSendableForHost = jest.fn()
const hostSendingIdentity = jest.fn()
const countCrmActivitiesForRecord = jest.fn()
const writeCrmEmailActivity = jest.fn()
const sendEmail = jest.fn()
const isEmailConfigured = jest.fn()
const resolveOrgPermissions = jest.fn()
const logOrgActivity = jest.fn()
const getHostDocAdmin = jest.fn()
const readOrgEmailRamp = jest.fn()

/**
 * The real ramp policy, built here rather than hand-written, so a spec
 * asserting the fraction a young workspace is held to is asserting the
 * shipped ladder and not a number copied beside it.
 */
const rampVerdict = (ageDays: number | null, deliveredLifetime = 0) =>
  jest
    .requireActual('@aglyn/shared-util-email')
    .emailRampVerdict({ ageDays, deliveredLifetime, graduatedPerDay: 6_000 })

let store: Record<string, Record<string, any>> = {}
/** The org's sites, as `hosts.orgId` answers the org variant's sweep. */
let orgHosts: string[] = []

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

/**
 * Transactions run one after another, each reading the store the previous
 * one committed — the observable guarantee Firestore gives two transactions
 * over one document, which a fake that let both read the same figure would
 * not model. A spy, so a gate can prove no transaction ran before it.
 */
let transactionQueue: Promise<unknown> = Promise.resolve()
const runTransaction = jest.fn(async (body: (tx: any) => Promise<unknown>) => {
  const run = transactionQueue.then(async () => {
    const writes: Array<{ path: string; data: Record<string, any>; merge: boolean }> = []
    const tx = {
      get: async (ref: { path: string }) => snapshotFor(ref.path),
      set: (ref: { path: string }, data: Record<string, any>, options?: { merge?: boolean }) =>
        writes.push({ path: ref.path, data, merge: Boolean(options?.merge) }),
    }
    const result = await body(tx)
    for (const write of writes) {
      store[write.path] = write.merge ? { ...store[write.path], ...write.data } : write.data
    }
    return result
  })
  transactionQueue = run.catch(() => undefined)
  return run
})

const firestoreHandle = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      path: `${name}/${id}`,
      collection: (sub: string) => collectionHandle(`${name}/${id}/${sub}`),
    }),
    where: (field: string, _op: string, value: unknown) => ({
      get: async () => ({
        docs:
          name === 'hosts' && field === 'orgId' && value === ORG_ID
            ? orgHosts.map((id) => ({ id }))
            : [],
      }),
    }),
  }),
  runTransaction: (body: (tx: any) => Promise<unknown>) => runTransaction(body),
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'server-timestamp' },
}))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: (...args: unknown[]) => resolveOrgPermissions(...args),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (token: string) => verifyIdToken(token) }),
      firestore: () => firestoreHandle,
    }),
  },
  getOrgForHost: (...args: unknown[]) => getOrgForHost(...args),
  getHostDocAdmin: (...args: unknown[]) => getHostDocAdmin(...args),
  getOrgDoc: async (orgId: string) => (orgId === ORG_ID ? orgDoc : null),
  logOrgActivity: (...args: unknown[]) => logOrgActivity(...args),
  resolveOrgMembership: (...args: unknown[]) => resolveOrgMembership(...args),
  memberHasOrgPermission: (...args: unknown[]) => memberHasOrgPermission(...args),
  consumeRateLimit: (...args: unknown[]) => consumeRateLimit(...args),
  // The ramp's two READS — the platform ceiling and the seven-day window —
  // are Firestore's, not this route's; the step they resolve to is the
  // input the route acts on, so the resolver is the seam and the step is
  // what a case sets.
  readOrgEmailRamp: (...args: unknown[]) => readOrgEmailRamp(...args),
  // The cap's reservation and its release are the real helpers over the
  // store above: the transaction is what this file has to prove.
  reserveCrmEmailSend: (...args: unknown[]) =>
    jest
      .requireActual('@aglyn/tenant-data-admin/server/crm-records')
      .reserveCrmEmailSend(...args),
  releaseCrmEmailSend: (...args: unknown[]) =>
    jest
      .requireActual('@aglyn/tenant-data-admin/server/crm-records')
      .releaseCrmEmailSend(...args),
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
  // The REAL policy, for the same reason the reservation is real: the share
  // a step takes off the plan's day is a rule under test.
  rampedDailyAllowance: (...args: unknown[]) =>
    jest
      .requireActual('@aglyn/shared-util-email')
      .rampedDailyAllowance(...args),
}))

import {
  CRM_ACTIVITY_LOG_FULL_MESSAGE,
  CRM_ACTIVITIES_PER_RECORD_CEILING,
  crmEmailUsageDayKey,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/server'
import {
  CRM_EMAIL_DECLINED_MESSAGE,
  CRM_EMAIL_EMPTY_AFTER_MERGE_MESSAGE,
  CRM_EMAIL_NOT_INCLUDED_MESSAGE,
  CRM_EMAIL_PICK_SITE_MESSAGE,
  CRM_EMAIL_RAMP_UNAVAILABLE_MESSAGE,
  CRM_EMAIL_RATE_MESSAGE,
  CRM_EMAIL_SUPPRESSED_MESSAGE,
  crmEmailCapReachedMessage,
  crmEmailRampReachedMessage,
  crmEmailSendHandler,
} from './email-send'

const HOST_ID = 'site-1'
const ORG_ID = 'org-1'
const CONTACT = `orgs/${ORG_ID}/contacts/contact-1`
const DEAL = `orgs/${ORG_ID}/deals/deal-1`
const LEAD = `hosts/${HOST_ID}/leads/lead-1`
/** A plan that carries the suite; the cap is read off the real table. */
const PLAN = 'starter'
/** The org document the organization variant reads. */
let orgDoc: Record<string, unknown> = { $id: ORG_ID, plan: PLAN }
const INCLUDED = resolveOrgEntitlements({ plan: PLAN } as never).crmEmailsPerDay
/** Today's counter document, the one the reservation reads and raises. */
const USAGE = `orgs/${ORG_ID}/crmEmailUsage/${crmEmailUsageDayKey()}`
const sentToday = (count: number) => {
  store[USAGE] = { count, day: crmEmailUsageDayKey() }
}
const countedToday = () => Number(store[USAGE]?.['count'] ?? 0)

async function call(
  body: Record<string, unknown>,
  options: { token?: string | null; method?: string; scope?: Record<string, unknown> } = {},
) {
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
      body: { ...(options.scope ?? { hostId: HOST_ID }), ...body },
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
  orgDoc = { $id: ORG_ID, plan: PLAN }
  resolveOrgMembership.mockResolvedValue({
    member: { role: 'editor', hostAccess: { [HOST_ID]: true } },
  })
  memberHasOrgPermission.mockResolvedValue(true)
  orgHosts = [HOST_ID, 'site-2']
  resolveOrgPermissions.mockResolvedValue({
    orgId: ORG_ID,
    role: 'editor',
    isOwner: false,
    permissions: { 'data.manage': true },
    orgWide: true,
    hostRole: 'editor',
  })
  logOrgActivity.mockResolvedValue(undefined)
  getHostDocAdmin.mockImplementation(async (hostId: string) =>
    hostId === HOST_ID ? { displayName: 'Site One' } : null,
  )
  consumeRateLimit.mockResolvedValue({ allowed: true, resetMs: Date.now() + 60_000 })
  // An established workspace: the ramp does not bind, which is the state
  // every case that is not about the ramp is written against.
  readOrgEmailRamp.mockResolvedValue({ ramp: rampVerdict(null), degraded: false })
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
  recordEmailSends.mockResolvedValue(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

/**
 * Nothing left the building, nothing was written, and no slot was kept:
 * the day's counter still reads `counted`, whatever earlier sends left it at.
 */
const expectNothingSent = (counted = 0) => {
  expect(sendEmail).not.toHaveBeenCalled()
  expect(writeCrmEmailActivity).not.toHaveBeenCalled()
  expect(recordEmailSends).not.toHaveBeenCalled()
  expect(countedToday()).toBe(counted)
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

  it('answers a refused token 401 and a certificate outage 500, before any read (AGL-2852)', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    verifyIdToken.mockRejectedValueOnce(
      Object.assign(new Error('revoked'), { code: 'auth/id-token-revoked' }),
    )
    expect((await call(MESSAGE)).status).toBe(401)
    verifyIdToken.mockRejectedValueOnce(
      Object.assign(new Error('Error fetching public keys for Google certs'), {
        code: 'auth/argument-error',
      }),
    )
    expect((await call(MESSAGE)).status).toBe(500)
    expect(getOrgForHost).not.toHaveBeenCalled()
    expectNothingSent()
    logged.mockRestore()
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

/**
 * THE PLAN (AGL-2787), asked once the sender is authorized and before the
 * pace and the cap. One-to-one email is the CRM suite's, included from
 * Starter; a plan without the suite is told so rather than reaching a daily
 * cap of zero. It is asked of the workspace, so staff are refused alike.
 */
describe('the plan (AGL-2787)', () => {
  const FREE_SITE = { orgId: ORG_ID, org: { plan: 'free' } }
  const expectRefused = ({ status, body }: { status: number; body: any }) => {
    expect(status).toBe(403)
    expect(body).toMatchObject({ reason: 'plan_required', code: 'crm' })
    expect(body.error).toMatch(/part of the CRM/)
    expect(body.error).toMatch(/Included from Starter/)
  }

  it('refuses a Free workspace under a site, before the pace is spent or a slot reserved', async () => {
    getOrgForHost.mockResolvedValue(FREE_SITE)
    expectRefused(await call(MESSAGE))
    expect(consumeRateLimit).not.toHaveBeenCalled()
    expect(runTransaction).not.toHaveBeenCalled()
    expectNothingSent()
  })

  it('refuses staff sending inside a Free workspace the same way', async () => {
    getOrgForHost.mockResolvedValue(FREE_SITE)
    verifyIdToken.mockResolvedValue({ uid: 'staff-1', email: 'support@example.test', staff: true })
    resolveOrgMembership.mockResolvedValue(null)
    expectRefused(await call(MESSAGE))
    expectNothingSent()
  })

  it('refuses a Free workspace at the organization level, logging no org line', async () => {
    orgDoc = { $id: ORG_ID, plan: 'free' }
    expectRefused(await call(MESSAGE, { scope: { orgId: ORG_ID, hostId: HOST_ID } }))
    expect(consumeRateLimit).not.toHaveBeenCalled()
    expectNothingSent()
    expect(logOrgActivity).not.toHaveBeenCalled()
  })

  it('tells a member without data.manage about the permission, not the plan', async () => {
    getOrgForHost.mockResolvedValue(FREE_SITE)
    memberHasOrgPermission.mockResolvedValue(false)
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(403)
    expect(body.error).toContain('data.manage')
    expect(body).not.toHaveProperty('reason')
  })

  it('admits Starter, the lowest plan that carries the suite, at both levels', async () => {
    expect((await call(MESSAGE)).status).toBe(200)
    expect((await call(MESSAGE, { scope: { orgId: ORG_ID, hostId: HOST_ID } })).status).toBe(200)
    expect(sendEmail).toHaveBeenCalledTimes(2)
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
    expect(runTransaction).not.toHaveBeenCalled()
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

/**
 * Merge fields (AGL-2658) are filled by the ROUTE, off the documents it
 * already read, so the letter that leaves is the letter that is logged —
 * and the one the dialog previewed with the same resolver.
 */
describe('merge fields, filled at send time', () => {
  beforeEach(() => {
    store[CONTACT].name = 'Ada Lovelace'
    store[CONTACT].facets[HOST_ID].jobTitle = 'Analyst'
    store[CONTACT].facets[HOST_ID].companyName = 'Analytical Engines'
    store[DEAL].title = 'Difference Engine'
    store[DEAL].amountCents = 125_000
    store[DEAL].currency = 'usd'
  })

  it('fills the subject and the body from the contact, the deal, the sender and the site, and logs the letter as sent', async () => {
    const { status } = await call({
      dealId: 'deal-1',
      subject: 'About {{deal.name}}',
      body: 'Hi {{contact.firstName}} ({{contact.title}}, {{contact.company}}),\r\n\r\n{{deal.amount}} — {{sender.firstName}} at {{site.name}}',
    })
    expect(status).toBe(200)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      subject: 'About Difference Engine',
      text: 'Hi Ada (Analyst, Analytical Engines),\n\n$1,250.00 — Rep at Site One',
    })
    expect(writeCrmEmailActivity.mock.calls[0][1]).toMatchObject({
      subject: 'About Difference Engine',
      body: 'Hi Ada (Analyst, Analytical Engines),\n\n$1,250.00 — Rep at Site One',
    })
    expect(getHostDocAdmin).toHaveBeenCalledWith(HOST_ID)
  })

  it('reads the site document only when a field asks for it', async () => {
    await call(MESSAGE)
    expect(getHostDocAdmin).not.toHaveBeenCalled()
    await call({ ...MESSAGE, body: 'From {{sender.name}}' })
    expect(getHostDocAdmin).not.toHaveBeenCalled()
    await call({ ...MESSAGE, body: 'From {{site.name}}' })
    expect(getHostDocAdmin).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[2][0].text).toBe('From Site One')
  })

  it('renders a field with no value, an unknown field and a missing record as nothing', async () => {
    delete store[CONTACT].name
    await call({
      ...MESSAGE,
      body: 'Hi {{contact.firstName}}, re {{deal.name}} {{contact.shoeSize}} {{ contact.email }}',
    })
    expect(sendEmail.mock.calls[0][0].text).toBe('Hi , re   ada@example.com')
  })

  it('fills a lead\'s fields from the lead document', async () => {
    store[LEAD].name = 'Charles Babbage'
    await call({ leadId: 'lead-1', subject: 'Hello {{lead.firstName}}', body: '{{lead.name}} <{{lead.email}}>' })
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      subject: 'Hello Charles',
      text: 'Charles Babbage <lead@example.com>',
    })
  })

  it('refuses a subject or a message that is nothing once filled, before any gate', async () => {
    delete store[CONTACT].name
    const { status, body } = await call({ ...MESSAGE, subject: '{{contact.firstName}}' })
    expect(status).toBe(400)
    expect(body).toMatchObject({ error: CRM_EMAIL_EMPTY_AFTER_MERGE_MESSAGE, reason: 'merge' })
    expect(countCrmActivitiesForRecord).not.toHaveBeenCalled()
    expectNothingSent()
  })
})

describe('the daily cap (AGL-2611), reserved in a transaction (AGL-2645)', () => {
  it('sends the last email inside the cap and refuses the next', async () => {
    expect(INCLUDED).toBeGreaterThan(0)
    sentToday(INCLUDED - 1)
    expect((await call(MESSAGE)).status).toBe(200)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(countedToday()).toBe(INCLUDED)

    jest.clearAllMocks()
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(409)
    expect(body).toMatchObject({
      error: crmEmailCapReachedMessage(INCLUDED),
      reason: 'quota',
      included: INCLUDED,
      used: INCLUDED,
    })
    expect(body.resetsAtMs).toEqual(expect.any(Number))
    expect(sendEmail).not.toHaveBeenCalled()
    expect(writeCrmEmailActivity).not.toHaveBeenCalled()
    expect(recordEmailSends).not.toHaveBeenCalled()
    // A refusal writes nothing: the counter stands where it was.
    expect(countedToday()).toBe(INCLUDED)
  })

  it('tells a plan with no one-to-one email to upgrade, at zero', async () => {
    // A Free workspace granted the suite per org still has a zero one-to-one email cap.
    getOrgForHost.mockResolvedValue({
      orgId: ORG_ID,
      org: { plan: 'free', entitlements: { features: { crm: true } } },
    })
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(409)
    expect(body).toMatchObject({ error: CRM_EMAIL_NOT_INCLUDED_MESSAGE, included: 0 })
    expectNothingSent()
  })

  it('takes the slot BEFORE the provider is called, and keeps it once accepted', async () => {
    await call(MESSAGE)
    expect(runTransaction).toHaveBeenCalledTimes(1)
    expect(runTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      sendEmail.mock.invocationCallOrder[0],
    )
    expect(store[USAGE]).toMatchObject({ count: 1, day: crmEmailUsageDayKey() })
  })

  /**
   * THE ISSUE, reproduced and closed. Two reps send at the last slot; each
   * passes every gate before the cap. Exactly one message may leave.
   */
  it('CANNOT be raced: two sends at the last slot yield one send and one refusal', async () => {
    sentToday(INCLUDED - 1)
    const answers = await Promise.all([call(MESSAGE), call(MESSAGE)])
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409])
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(writeCrmEmailActivity).toHaveBeenCalledTimes(1)
    expect(recordEmailSends).toHaveBeenCalledTimes(1)
    expect(countedToday()).toBe(INCLUDED)
    const refused = answers.find((answer) => answer.status === 409)
    expect(refused?.body).toMatchObject({ reason: 'quota', used: INCLUDED })
  })
})

/**
 * THE NEW-WORKSPACE RAMP ON THIS PATH (AGL-2680).
 *
 * The ramp is the campaign path's, resolved through the same
 * `readOrgEmailRamp` and taken to the allowance this surface meters. What
 * these cases hold are the four things that make it a control rather than a
 * decoration: that it BINDS on a young workspace, that it does NOT bind on
 * an established one, that what it narrows is the ceiling the RESERVATION
 * judges — so the slot a ramped send takes is still given back when the
 * provider refuses — and that it refuses rather than admits when the history
 * behind it cannot be read.
 *
 * The ramped figure is computed from the shipped ladder rather than written
 * down: the first step is 200 against a graduated day of 6,000, so a
 * workspace created today keeps a thirtieth of its plan's day, and a spec
 * that pinned "1" would go green if the ladder moved underneath it.
 */
describe('the new-workspace ramp, inside the same reservation', () => {
  /** The plan's day held to the share a workspace of `ageDays` has earned. */
  const rampedTo = (ageDays: number, delivered = 0) =>
    jest
      .requireActual('@aglyn/shared-util-email')
      .rampedDailyAllowance(INCLUDED, rampVerdict(ageDays, delivered))

  const onTheRamp = (ageDays: number, delivered = 0) => {
    readOrgEmailRamp.mockResolvedValue({
      ramp: rampVerdict(ageDays, delivered),
      degraded: false,
    })
  }

  it('holds a workspace created today to a share of the plan’s day', async () => {
    const ceiling = rampedTo(0)
    expect(ceiling).toBeGreaterThan(0)
    expect(ceiling).toBeLessThan(INCLUDED)
    onTheRamp(0)

    sentToday(ceiling - 1)
    expect((await call(MESSAGE)).status).toBe(200)
    expect(countedToday()).toBe(ceiling)

    jest.clearAllMocks()
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(409)
    expect(body).toMatchObject({
      error: crmEmailRampReachedMessage(ceiling, ceiling),
      reason: 'ramp',
      included: ceiling,
      used: ceiling,
    })
    // The refusal names the ramp's number and never the plan's, and it says
    // the allowance grows rather than that a limit was hit.
    expect(body.error).not.toContain(String(INCLUDED))
    expect(body.error).toContain('establishes a sending history')
    expectNothingSent(ceiling)
  })

  it('raises the ceiling for a step the workspace has earned, and binds there too', async () => {
    // Day 1 with the first step delivered is the SECOND step: a bigger
    // share of the same plan day, off the same ladder — and still a
    // ceiling, which is what separates a ramp from a formality.
    const ceiling = rampedTo(1, 100)
    expect(ceiling).toBeGreaterThan(rampedTo(0))
    expect(ceiling).toBeLessThan(INCLUDED)
    onTheRamp(1, 100)

    sentToday(ceiling - 1)
    expect((await call(MESSAGE)).status).toBe(200)

    jest.clearAllMocks()
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(409)
    expect(body).toMatchObject({ reason: 'ramp', included: ceiling })
    expectNothingSent(ceiling)
  })

  it('does not bind an established workspace, which sends its plan’s whole day', async () => {
    // The default: `readOrgEmailRamp` graduates an org whose record carries
    // no creation date, and a graduated step takes nothing off the plan.
    sentToday(INCLUDED - 1)
    expect((await call(MESSAGE)).status).toBe(200)
    expect(countedToday()).toBe(INCLUDED)

    jest.clearAllMocks()
    const { body } = await call(MESSAGE)
    expect(body).toMatchObject({ reason: 'quota', included: INCLUDED })
  })

  it('gives the ramped slot back when the provider refuses, and it is spendable', async () => {
    const ceiling = rampedTo(0)
    onTheRamp(0)
    // The LAST slot of the ramped day, so what comes back is the difference
    // between a workspace that may still write to somebody and one that may
    // not until midnight.
    sentToday(ceiling - 1)
    sendEmail.mockResolvedValue({ sent: false, reason: 'invalid' })

    const { status } = await call(MESSAGE)
    expect(status).toBe(502)
    expect(countedToday()).toBe(ceiling - 1)
    expect(writeCrmEmailActivity).not.toHaveBeenCalled()
    expect(recordEmailSends).not.toHaveBeenCalled()

    jest.clearAllMocks()
    sendEmail.mockResolvedValue({ sent: true, id: 'msg-2' })
    expect((await call(MESSAGE)).status).toBe(200)
    expect(countedToday()).toBe(ceiling)

    // And it was one slot back, not an amnesty: the ramp closes the day
    // behind it.
    jest.clearAllMocks()
    const { status: refused, body } = await call(MESSAGE)
    expect(refused).toBe(409)
    expect(body).toMatchObject({ reason: 'ramp', included: ceiling })
    expectNothingSent(ceiling)
  })

  /**
   * A LIMITER THAT CANNOT ANSWER REFUSES. The window a step is sized from
   * is unreadable, so the route does not know what this workspace has
   * earned — and there is no third answer for one message the way there is
   * for a campaign, which defers its remainder to tomorrow.
   */
  it('refuses, and reserves nothing, when the ramp cannot resolve the history', async () => {
    readOrgEmailRamp.mockResolvedValue({ ramp: rampVerdict(0), degraded: true })
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(503)
    expect(body).toMatchObject({
      error: CRM_EMAIL_RAMP_UNAVAILABLE_MESSAGE,
      reason: 'ramp-unavailable',
    })
    // Refused BEFORE the reservation, so nothing was written and no slot is
    // held over a day the workspace never spent.
    expect(runTransaction).not.toHaveBeenCalled()
    expectNothingSent()
  })

  it('does not refuse an established workspace for a history it never reads', async () => {
    // `readOrgEmailRamp` graduates on the org record alone and never gets as
    // far as the window, so the degraded answer cannot reach one.
    readOrgEmailRamp.mockResolvedValue({
      ramp: rampVerdict(null),
      degraded: false,
    })
    expect((await call(MESSAGE)).status).toBe(200)
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

  it('logs the row under the minted id, then meters it', async () => {
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
    expect(recordEmailSends).toHaveBeenCalledWith({
      scope: { kind: 'org', orgId: ORG_ID },
      count: 1,
      sendClass: 'transactional',
      firestore: firestoreHandle,
    })
    expect(writeCrmEmailActivity.mock.invocationCallOrder[0]).toBeLessThan(
      recordEmailSends.mock.invocationCallOrder[0],
    )
  })

  it('still keeps the slot and answers when the row could not be written, and says so', async () => {
    writeCrmEmailActivity.mockRejectedValue(new Error('unavailable'))
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(200)
    expect(body.logged).toBe(false)
    expect(countedToday()).toBe(1)
    expect(recordEmailSends).toHaveBeenCalledTimes(1)
  })
})

describe('a send the provider refused', () => {
  it('writes nothing, gives the slot back, and names the failure', async () => {
    sentToday(5)
    sendEmail.mockResolvedValue({ sent: false, reason: 'rejected', status: 422, detail: 'bad' })
    const { status, body } = await call(MESSAGE)
    expect(status).toBe(502)
    expect(body.reason).toBe('send-failed')
    expect(writeCrmEmailActivity).not.toHaveBeenCalled()
    expect(recordEmailSends).not.toHaveBeenCalled()
    // Reserved, then released: the day's figure is what it was.
    expect(runTransaction).toHaveBeenCalledTimes(2)
    expect(countedToday()).toBe(5)
  })

  it('gives the slot back when the provider never answered', async () => {
    sentToday(5)
    sendEmail.mockRejectedValue(new Error('socket hang up'))
    const { status } = await call(MESSAGE)
    expect(status).toBe(500)
    expect(writeCrmEmailActivity).not.toHaveBeenCalled()
    expect(countedToday()).toBe(5)
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

/**
 * THE ORGANIZATION VARIANT (AGL-2634): authorized by the org, the record
 * read with no site's visibility to check, and the message still leaving
 * from ONE site — named, or the record's own, or the org's only one.
 */
describe('at the organization level', () => {
  const asOrg = (extra: Record<string, unknown> = {}) => ({ scope: { orgId: ORG_ID, ...extra } })

  it('mails a contact another site captured, from the site the body names, and logs the org line', async () => {
    store[CONTACT].visibleTo = ['host:other-site']
    const { status } = await call(MESSAGE, asOrg({ hostId: 'site-2' }))
    expect(status).toBe(200)
    expect(resolveOrgPermissions).toHaveBeenCalledWith('u-rep', { orgId: ORG_ID })
    expect(getOrgForHost).not.toHaveBeenCalled()
    // Everything a site owns is the sending site's.
    expect(hostSendingIdentity).toHaveBeenCalledWith('site-2')
    expect(filterSendableForHost).toHaveBeenCalledWith('site-2', ['ada@example.com'])
    expect(sendEmail.mock.calls[0][0].tags).toEqual(
      expect.arrayContaining([
        { name: 'hostId', value: 'site-2' },
        { name: 'orgId', value: ORG_ID },
      ]),
    )
    // The row is visible where the RECORD is, not only to the sending site.
    const row = writeCrmEmailActivity.mock.calls[0][1]
    expect(row).toMatchObject({ hostId: 'site-2', visibleTo: ['host:other-site'] })
    expect(logOrgActivity).toHaveBeenCalledWith(
      ORG_ID,
      { uid: 'u-rep', email: 'rep@acme.com' },
      'Sent email',
      { type: 'contact', id: 'contact-1', name: 'ada@example.com' },
    )
  })

  it('leaves from the record’s own site when the body names none', async () => {
    store[CONTACT].capturedByHostIds = ['site-2']
    await call(MESSAGE, asOrg())
    expect(hostSendingIdentity).toHaveBeenCalledWith('site-2')
    jest.clearAllMocks()
    hostSendingIdentity.mockResolvedValue({ from: 'x@y.z', refusal: null })
    sendEmail.mockResolvedValue({ sent: true, id: 'msg-2' })
    await call({ dealId: 'deal-1', subject: 'x', body: 'y' }, asOrg())
    // A deal's own site, ahead of its contact's.
    store[DEAL].hostId = HOST_ID
    await call({ dealId: 'deal-1', subject: 'x', body: 'y' }, asOrg())
    expect(hostSendingIdentity).toHaveBeenLastCalledWith(HOST_ID)
  })

  it('leaves from the org’s only site for a record no site captured, and asks when there are several', async () => {
    delete store[CONTACT].capturedByHostIds
    orgHosts = ['site-2']
    expect((await call(MESSAGE, asOrg())).status).toBe(200)
    expect(hostSendingIdentity).toHaveBeenCalledWith('site-2')
    jest.clearAllMocks()
    orgHosts = [HOST_ID, 'site-2']
    const { status, body } = await call(MESSAGE, asOrg())
    expect(status).toBe(409)
    expect(body).toMatchObject({ error: CRM_EMAIL_PICK_SITE_MESSAGE, reason: 'site' })
    // The first send's slot stands; the refused one took none.
    expectNothingSent(1)
    expect(logOrgActivity).not.toHaveBeenCalled()
  })

  it('refuses a site-scoped member, whatever their site role, sending nothing', async () => {
    resolveOrgPermissions.mockResolvedValue({
      orgId: ORG_ID,
      role: 'admin',
      isOwner: true,
      permissions: { 'data.manage': true },
      orgWide: false,
      hostRole: 'admin',
    })
    const { status, body } = await call(MESSAGE, asOrg({ hostId: HOST_ID }))
    expect(status).toBe(403)
    expect(body.error).toContain('whole workspace')
    expectNothingSent()
  })

  it('needs a lead’s site named, and files a lead’s email under the lead in the org line', async () => {
    expect((await call({ leadId: 'lead-1', subject: 'x', body: 'y' }, asOrg())).status).toBe(400)
    expectNothingSent()
    const { status } = await call({ leadId: 'lead-1', subject: 'x', body: 'y' }, asOrg({ hostId: HOST_ID }))
    expect(status).toBe(200)
    expect(logOrgActivity).toHaveBeenCalledWith(ORG_ID, expect.anything(), 'Sent email', {
      type: 'lead',
      id: 'lead-1',
      name: 'lead@example.com',
    })
  })

  it('writes no org line under a site', async () => {
    await call(MESSAGE)
    expect(logOrgActivity).not.toHaveBeenCalled()
  })
})
