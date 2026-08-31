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
 * `inbox/reply` — the assertions are about what reaches the wire.
 *
 * WHAT THE DOUBLES MODEL, stated so a false green is visible:
 *
 *  1. `sendEmail` is a spy returning `{sent:true,id}`. Every assertion about
 *     the envelope reads the payload it was CALLED with, never a rendered
 *     message — the thing under test is which fields the handler fills in.
 *  2. `isEmailSuppressed` is a spy over the platform list. The real one fails
 *     CLOSED on a throwing read; that behavior belongs to `email-suppression`
 *     and is asserted there, so this double only distinguishes true/false.
 *  3. The Firestore double is a flat path→document map. `add()` allocates an
 *     id and `set({merge:true})` merges, which is all the handler uses. No
 *     transactions and no contention are modelled, faithfully — the handler
 *     runs none.
 *  4. `verifyIdToken` resolves to whatever `decodedToken` currently holds, so
 *     the role gate and the missing-account-email refusal are both reachable.
 */

const sendEmail = jest.fn()
const isEmailSuppressed = jest.fn()
const meterHostEmail = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__serverTimestamp' },
}))

jest.mock('@aglyn/shared-util-email', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  registerPluginApiRoute: jest.fn(),
  resolveBrandingProfile: () => ({ fromName: 'Aglyn' }),
}))

const docs = new Map<string, Record<string, unknown>>()
let decodedToken: { uid: string; email?: string } = {
  uid: 'editor-uid',
  email: 'owner@lumen.co',
}
let nextId = 0

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop(),
    get: async () => ({
      exists: docs.has(path),
      data: () => docs.get(path),
      get: (field: string) => (docs.get(path) ?? {})[field],
    }),
    set: async (patch: Record<string, unknown>) => {
      docs.set(path, { ...(docs.get(path) ?? {}), ...patch })
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  return {
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    add: async (data: Record<string, unknown>) => {
      const id = `doc-${(nextId += 1)}`
      docs.set(`${path}/${id}`, data)
      return { id }
    },
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  // The literal three call sites compare against — the unsubscribe writes
  // it, the resubscribe link refuses to reverse anything else, and the
  // preference page reads it. A mock that omitted it would write `undefined`
  // and every one of those comparisons would silently stop matching.
  UNSUBSCRIBE_SUPPRESSION_REASON: 'unsubscribe',
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
  emailSuppressionKey: (email: string) =>
    email.includes('@') ? `key:${email.trim().toLowerCase()}` : null,
  isEmailSuppressed: (...args: unknown[]) => isEmailSuppressed(...args),
  meterHostEmail: (...args: unknown[]) => meterHostEmail(...args),
  getOrgForHost: async () => ({ orgId: 'org1', org: {} }),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => decodedToken }),
      firestore: () => ({ collection: (name: string) => makeCollectionRef(name) }),
    }),
  },
}))

import { inboxReplyHandler } from './server'

function makeResponse() {
  const out: { code: number; body: any } = { code: 0, body: undefined }
  const res: any = {
    status(code: number) {
      out.code = code
      return res
    },
    json(body: unknown) {
      out.body = body
    },
  }
  return { res, out }
}

async function reply(body: Record<string, unknown>, headers?: Record<string, string>) {
  const { res, out } = makeResponse()
  await inboxReplyHandler(
    {
      method: 'POST',
      body,
      headers: headers ?? { authorization: 'Bearer token' },
      query: {},
      cookies: {},
      socket: {},
    } as any,
    res,
  )
  return out
}

const GOOD_BODY = {
  hostId: 'host1',
  submissionId: 'sub1',
  subject: 'Re: your message to Lumen Studio',
  message: 'Yes, we ship to Ireland.',
}

beforeEach(() => {
  docs.clear()
  nextId = 0
  sendEmail.mockReset().mockResolvedValue({ sent: true, id: 'msg-1' })
  isEmailSuppressed.mockReset().mockResolvedValue(false)
  meterHostEmail.mockReset()
  decodedToken = { uid: 'editor-uid', email: 'owner@lumen.co' }
  docs.set('hosts/host1', {
    displayName: 'Lumen Studio',
    memberRoles: { 'editor-uid': 'editor', 'viewer-uid': 'viewer' },
  })
  docs.set('hosts/host1/formSubmissions/sub1', {
    formName: 'Contact',
    read: false,
    fields: { name: 'Priya Nair', email: 'Priya@Lumen.co', message: 'Ship to IE?' },
  })
})

describe('the envelope', () => {
  it('mails the address on the submission, not one the caller named', async () => {
    const out = await reply({ ...GOOD_BODY, to: 'attacker@evil.example' })
    expect(out.code).toBe(200)
    expect(sendEmail.mock.calls[0][0].to).toBe('priya@lumen.co')
  })

  /**
   * The reply invites an answer, and the answer must reach a person. The
   * `From:` is the platform's one verified identity and nothing in the
   * product can change it, so `Reply-To` is the only thing standing between
   * the customer's reply and an unmonitored mailbox.
   */
  it('points Reply-To at the account that pressed Send', async () => {
    await reply(GOOD_BODY)
    expect(sendEmail.mock.calls[0][0].replyTo).toBe('owner@lumen.co')
  })

  it('refuses when the sending account has no address to reply back to', async () => {
    decodedToken = { uid: 'editor-uid' }
    const out = await reply(GOOD_BODY)
    expect(out.code).toBe(400)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  /**
   * `sendEmail` synthesizes the HTML part from `text`. Passing an `html` of
   * our own — and an empty one especially — is the defect that made the click
   * rate structurally zero, so the handler must pass none at all.
   */
  it('sends no html of its own, leaving the shared synthesis to fill it', async () => {
    await reply(GOOD_BODY)
    expect(sendEmail.mock.calls[0][0]).not.toHaveProperty('html')
    expect(sendEmail.mock.calls[0][0].text).toContain('Yes, we ship to Ireland.')
  })

  /**
   * Absent, `priority` resolves to transactional, which the platform hourly
   * governor may never refuse. A reply cannot be deferred to a later window:
   * nothing sweeps it up and sends it tomorrow.
   */
  it('sets no priority, so the governor cannot refuse a person answering a person', async () => {
    await reply(GOOD_BODY)
    expect(sendEmail.mock.calls[0][0]).not.toHaveProperty('priority')
  })

  /**
   * The submission arrived over HTTP, so no message exists for these headers
   * to name. Threading is ours, in the stored replies, and not on the wire.
   */
  it('sends no threading headers, because there is no message to thread against', async () => {
    await reply(GOOD_BODY)
    expect(sendEmail.mock.calls[0][0].headers).toBeUndefined()
  })
})

describe('suppression', () => {
  it('refuses an address on the platform bounce and complaint list', async () => {
    isEmailSuppressed.mockResolvedValue(true)
    const out = await reply(GOOD_BODY)
    expect(out.code).toBe(409)
    expect(out.body.reason).toBe('suppressed-platform')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  /**
   * `campaign-send.ts` reads this list and not the platform one; the reply
   * reads both. An address that unsubscribed from THIS site is off limits to
   * a reply as well — the person asked this site to stop mailing them.
   */
  it('refuses an address suppressed on this site', async () => {
    docs.set('hosts/host1/suppressions/key:priya@lumen.co', {
      reason: 'unsubscribe',
    })
    const out = await reply(GOOD_BODY)
    expect(out.code).toBe(409)
    expect(out.body.reason).toBe('suppressed-host')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('sends when neither list holds the address', async () => {
    const out = await reply(GOOD_BODY)
    expect(out.code).toBe(200)
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })
})

describe('authorization', () => {
  it('refuses an unauthenticated caller', async () => {
    const out = await reply(GOOD_BODY, {})
    expect(out.code).toBe(401)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('refuses a role below editor', async () => {
    decodedToken = { uid: 'viewer-uid', email: 'viewer@lumen.co' }
    const out = await reply(GOOD_BODY)
    expect(out.code).toBe(403)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('what is recorded', () => {
  it('stores the reply under the submission it answers', async () => {
    const out = await reply(GOOD_BODY)
    const stored = docs.get(`hosts/host1/formSubmissions/sub1/replies/${out.body.replyId}`)
    expect(stored).toMatchObject({
      to: 'priya@lumen.co',
      subject: GOOD_BODY.subject,
      message: GOOD_BODY.message,
      replyTo: 'owner@lumen.co',
      sentByUid: 'editor-uid',
      providerMessageId: 'msg-1',
    })
  })

  it('marks the submission replied and read in one write', async () => {
    await reply(GOOD_BODY)
    const submission = docs.get('hosts/host1/formSubmissions/sub1') as any
    expect(submission.read).toBe(true)
    expect(submission.repliedAtMs).toEqual(expect.any(Number))
  })

  /**
   * A reply is metered as a cost, never against the campaign allowance a plan
   * limit can refuse. Answering a customer must not be able to exhaust the
   * quota that stops a newsletter.
   */
  it('meters the send as transactional', async () => {
    await reply(GOOD_BODY)
    expect(meterHostEmail).toHaveBeenCalledWith('host1', 1, 'transactional')
  })

  /** A failed send leaves no record claiming a message went out. */
  it('records nothing when the provider refused the send', async () => {
    sendEmail.mockResolvedValue({ sent: false, reason: 'unconfigured' })
    const out = await reply(GOOD_BODY)
    expect(out.code).toBe(502)
    expect(docs.get('hosts/host1/formSubmissions/sub1/replies/doc-1')).toBeUndefined()
    expect((docs.get('hosts/host1/formSubmissions/sub1') as any).repliedAtMs).toBeUndefined()
    expect(meterHostEmail).not.toHaveBeenCalled()
  })
})

describe('what cannot be replied to', () => {
  it('refuses a submission whose form carried no email field', async () => {
    docs.set('hosts/host1/formSubmissions/sub1', {
      formName: 'Contact',
      fields: { name: 'Priya', message: 'Ship to IE?' },
    })
    const out = await reply(GOOD_BODY)
    expect(out.code).toBe(422)
    expect(out.body.reason).toBe('no-address')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('refuses a submission that does not exist', async () => {
    const out = await reply({ ...GOOD_BODY, submissionId: 'nope' })
    expect(out.code).toBe(404)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('refuses an empty message', async () => {
    const out = await reply({ ...GOOD_BODY, message: '   ' })
    expect(out.code).toBe(400)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
