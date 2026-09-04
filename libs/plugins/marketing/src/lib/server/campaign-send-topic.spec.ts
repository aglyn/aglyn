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
 * A CAMPAIGN CARRIES A TOPIC, and the topic decides three things: who the send
 * skips, what the preference page highlights as "this email", and which stream
 * a resulting unsubscribe is recorded against.
 *
 * The links are minted per recipient inside `performCampaignSend`, so the
 * assertions are made against WHAT WAS HANDED TO `sendEmail` — the header and
 * the text part — rather than against the return value. A send that mailed the
 * right people with the wrong unsubscribe link returns exactly the same
 * success body as one that did not, which is why the URLs are what is checked.
 *
 * The property most at risk is the RFC 8058 one. `List-Unsubscribe` names a
 * URL a mailbox provider POSTs with no human present, and the preference
 * center is a page somebody has to submit. Pointing the header at it would
 * read as compliant, answer 200, and unsubscribe nobody. So the header and the
 * footer are asserted to be DIFFERENT routes.
 *
 * THE DOUBLE MODELS `.doc()`'s PATH ARITHMETIC (inherited from
 * `campaign-send-ids.spec.ts`): the argument is APPENDED as a slash-separated
 * path, refused only when the resulting component count comes out odd, and
 * that refusal is a SYNCHRONOUS throw.
 */


/** The `FieldValue.delete()` marker, resolved by the document double below. */
const DELETE_SENTINEL = '__delete__'

const store = new Map<string, Record<string, any>>()
const sent: Array<Record<string, any>> = []

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    exists: data !== undefined,
    id: path.split('/').pop() as string,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

/** What the SERVICE refuses on the RPC, as opposed to what `.doc()` refuses. */
function serviceRejection(path: string): (Error & { code?: number }) | null {
  const bad = path
    .split('/')
    .find((part) => /^__.*__$/.test(part) || part === '.' || part === '..')
  if (!bad) return null
  const error: Error & { code?: number } = new Error(
    `INVALID_ARGUMENT: Document name "${path}" is not valid.`,
  )
  error.code = 3
  return error
}

function docRef(path: string): any {
  const reject = () => {
    const failure = serviceRejection(path)
    if (failure) throw failure
  }
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => {
      reject()
      return snapshotOf(path)
    },
    set: async (value: Record<string, any>) => {
      reject()
      /*
       * `FieldValue.delete()` REMOVES the field rather than storing a marker.
       * A double that merged the sentinel in as a value would leave the field
       * set to it — which is exactly the leftover the delete exists to clear,
       * so a double that kept it would pass a test the product fails.
       */
      const merged: Record<string, any> = {
        ...(store.get(path) ?? {}),
        ...value,
      }
      for (const [field, entry] of Object.entries(value)) {
        if (entry === DELETE_SENTINEL) delete merged[field]
      }
      store.set(path, merged)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  return {
    doc: (id: string) => {
      // Measured against the installed client: an empty id is refused first,
      // and SYNCHRONOUSLY.
      if (id === '') {
        throw new Error(
          `Value for argument "documentPath" is not a valid resource path. ` +
            `Path must be a non-empty string.`,
        )
      }
      const full = `${path}/${id}`
      // A document path has an EVEN component count; `.doc()` throws outright,
      // and SYNCHRONOUSLY, when the argument makes it odd.
      if (full.split('/').length % 2 !== 0) {
        throw new Error(
          `Value for argument "documentPath" must point to a document, ` +
            `but was "${id}".`,
        )
      }
      return docRef(full)
    },
    ...queryRef(path),
    get parent() {
      return docRef(path.split('/').slice(0, -1).join('/'))
    },
  }
}

/** The ids directly under `path`, in the `__name__` order the sweep asks for. */
function childIds(path: string): string[] {
  return [...store.keys()]
    .filter(
      (key) =>
        key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
    )
    .map((key) => key.slice(path.length + 1))
    .sort()
}

/** `orderBy` / `startAfter` / `limit`, and `limit` honors its argument. */
function queryRef(path: string, after?: string): any {
  return {
    orderBy: () => queryRef(path, after),
    startAfter: (cursor: any) => queryRef(path, cursor?.id ?? String(cursor)),
    limit: (max: number) => ({
      get: async () => {
        const ids = childIds(path).filter((id) => !after || id > after)
        return { docs: ids.slice(0, max).map((id) => snapshotOf(`${path}/${id}`)) }
      },
    }),
  }
}

const mockFirestore = () => ({
  collection: (name: string) => collectionRef(name),
})

let mockUid = 'uid-1'

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
  firebaseAdmin: {
    app: () => ({
      firestore: () => mockFirestore(),
      auth: () => ({
        // Verified, because a host member is one: nothing enters a
        // `memberRoles` map unverified, and the send gate reads this
        // claim directly since AGL-2589.
        verifyIdToken: async () => ({ uid: mockUid, email_verified: true }),
      }),
    }),
    firestore: {
      FieldValue: {
        increment: (value: number) => ({ increment: value }),
        serverTimestamp: () => 'server-timestamp',
        // Recognized by the document double above, which removes the field
        // rather than storing this marker.
        delete: () => DELETE_SENTINEL,
      },
      FieldPath: { documentId: () => '__name__' },
    },
  },
  /*
   * The send's THIRD filter, driven from a module-scope map so a test can put
   * somebody off one stream. It reaches through `globalThis` rather than
   * closing over a fixture because a `jest.mock` factory is hoisted above
   * every import, so a top-level binding is still in its temporal dead zone
   * when this object is built.
   */
  filterTopicSendable: async (
    _hostId: string,
    topicId: string,
    emails: string[],
  ) =>
    emails.filter(
      (email) =>
        !(globalThis as any).__topicOptOuts?.[email]?.includes(topicId),
    ),
  // Nobody in these fixtures is suppressed; the topic is what is under test.
  filterSendableForHost: async (_hostId: string, emails: string[]) => emails,
  // Starter, so the monthly campaign cap does not refuse before the write.
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'pro' } }),
  // No site here selects a custom sending domain, so every send resolves to
  // the platform identity — the behavior these suites were written against.
  resolveHostSendingIdentity: async () =>
    jest
      .requireActual('@aglyn/shared-util-email')
      .resolveSendingIdentity({
        selection: null,
        platformFrom: process.env.USAGE_EMAIL_FROM || 'noreply@aglyn.com',
      }),
  orgDataCollectionForHost: jest.fn(),
  orgDataQueryForHost: jest.fn(),
  meterHostEmail: async () => undefined,
  /*
   * AGL-2267/AGL-2409. The barrel factory is a CLOSED WORLD — anything the
   * sender imports and this object omits arrives as `undefined` and throws at
   * the call — so the org-scoped cap and the platform send-rate governor have
   * to be listed here even where neither is what the file is testing.
   *
   * Permissive on purpose: this file is about something else, and a cap or a
   * ceiling that refused here would make every assertion below a test of the
   * cap. `campaign-send.spec.ts` owns the enforcement.
   */
  orgCampaignEmailSendsForMonth: async () => 0,
  reserveCampaignEmailSends: async ({ count }: any) => ({
    ok: true,
    reservation: { orgId: 'org-1', month: '2026-08', reserved: count },
    used: 0,
    limit: 500,
  }),
  reconcileCampaignSendReservation: async () => undefined,
  readEmailSendRateConfig: async () => ({
    perHour: 100_000,
    enabled: true,
    updatedAtMs: null,
    updatedByEmail: null,
    note: '',
  }),
  claimOrgEmailSendBudget: async (options: any = {}) => {
    const ceiling = Math.max(1, Math.floor((options.platformPerHour ?? 100_000) * 0.25))
    const count = Math.max(0, Math.floor(Number(options.count) || 0))
    return {
      allowed: true,
      used: 0,
      ceiling,
      remaining: Math.max(0, ceiling - count),
      retryAtMs: 3_600_000,
      degraded: false,
    }
  },
  readEmailSendRateWindow: async () => ({
    windowStartMs: 0,
    resetMs: 3_600_000,
    used: 0,
  }),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, unknown>) => {
    sent.push(message)
    return { sent: true }
  },
}))

import type { PluginApiResponse } from '@aglyn/aglyn/server'
import { DEFAULT_CAMPAIGN_TOPIC_ID } from '@aglyn/aglyn'
import { createHmac } from 'crypto'
import {
  campaignSendHandler,
  performCampaignSend,
  unsubscribeSignature,
} from './campaign-send'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HOST = 'host-1'
const RECIPIENT = 'dana@example.com'
const SECRET = 'unsubscribe-secret'

/** Per-test opt-outs, read by the `filterTopicSendable` double above. */
const topicOptOuts: Record<string, string[]> = {}
;(globalThis as any).__topicOptOuts = topicOptOuts

function seed() {
  store.clear()
  sent.length = 0
  mockUid = 'uid-1'
  for (const key of Object.keys(topicOptOuts)) delete topicOptOuts[key]
  store.set(`hosts/${HOST}`, {
    subdomain: 'acme',
    memberRoles: { 'uid-1': 'admin' },
  })
  store.set(`hosts/${HOST}/leads/lead-1`, {
    email: RECIPIENT,
    name: 'Dana Reed',
    // A recorded opt-in, in the shape every capture path writes it. The send
    // withholds a recipient with no basis and refuses an audience where nobody
    // has one, so a lead this suite expects to reach has to declare it.
    // The basis belongs to the site sending, not to the org.
    marketingConsentByHost: {
      'host-1': { marketingConsent: true, marketingConsentAtMs: Date.UTC(2026, 7, 1) },
    },
  })
}

function makeResponse() {
  const result = { status: 0, body: undefined as any }
  const res: PluginApiResponse = {
    status(code) {
      result.status = code
      return res
    },
    json(body) {
      result.body = body
    },
    send(body) {
      result.body = body
    },
    setHeader() {
      // unused
    },
    redirect() {
      // unused
    },
    end() {
      // unused
    },
  }
  return { res, result }
}

async function post(body: Record<string, unknown>) {
  const { res, result } = makeResponse()
  await campaignSendHandler(
    {
      method: 'POST',
      query: {},
      body,
      cookies: {},
      headers: { authorization: 'Bearer token' },
    } as any,
    res,
  )
  return result
}

/** The one message this suite's fixtures produce. */
const onlyMessage = () => {
  expect(sent).toHaveLength(1)
  return sent[0] as Record<string, any>
}

/** The `List-Unsubscribe` header URL, unwrapped from its angle brackets. */
const headerUrl = () =>
  String((onlyMessage()['headers'] ?? {})['List-Unsubscribe'] ?? '').replace(
    /^<|>$/g,
    '',
  )

/** The link the footer offers a person. */
const footerUrl = () => {
  const text = String(onlyMessage()['text'] ?? '')
  return text.slice(text.lastIndexOf('http')).trim()
}

const paramsOf = (url: string) => new URL(url).searchParams

/** The send this suite makes, varied only by topic. */
const send = (topicId?: string) =>
  performCampaignSend({
    hostId: HOST,
    subject: 'Hello',
    body: 'Hi',
    audience: 'leads',
    ...(topicId ? { topicId } : {}),
    senderUid: 'uid-1',
  })

beforeEach(() => {
  seed()
  process.env.EMAIL_UNSUBSCRIBE_SECRET = SECRET
  process.env.USAGE_EMAIL_FROM = 'noreply@aglyn.com'
})

describe('the links a campaign mints', () => {
  it('points List-Unsubscribe at the ONE-CLICK route, not the page', async () => {
    await send('newsletter')
    // A mailbox provider POSTs this URL with nobody watching. A page of
    // checkboxes at the other end answers 200 and unsubscribes nobody.
    expect(headerUrl()).toContain('/api/email/unsubscribe?')
    expect(headerUrl()).not.toContain('/api/email/preferences')
  })

  it('advertises the one-click PAIR, which is what Gmail asks for', async () => {
    await send('newsletter')
    // `List-Unsubscribe` alone does not satisfy the bulk-sender rules.
    expect(onlyMessage()['headers']).toMatchObject({
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
  })

  it('points the FOOTER at the preference page', async () => {
    await send('newsletter')
    // Where a human is present to choose. The word "unsubscribe" stays in the
    // line because that is what a recipient scans a footer for.
    expect(footerUrl()).toContain('/api/email/preferences?')
    expect(String(onlyMessage()['text'])).toContain('unsubscribe')
  })

  it('carries the topic on both links, under ONE signature', async () => {
    await send('newsletter')
    const header = paramsOf(headerUrl())
    const footer = paramsOf(footerUrl())
    expect(header.get('tid')).toBe('newsletter')
    expect(footer.get('tid')).toBe('newsletter')
    // One signature over both, so the page reached from either link verifies —
    // a second scheme is how one of them comes to refuse a signature the other
    // just accepted.
    expect(footer.get('sig')).toBe(header.get('sig'))
  })

  it('SIGNS the topic, so editing it in the URL cannot verify', async () => {
    await send('newsletter')
    const params = paramsOf(headerUrl())
    expect(params.get('sig')).toBe(
      createHmac('sha256', SECRET)
        .update(`${HOST}:${RECIPIENT}:${params.get('cid')}:newsletter`)
        .digest('hex'),
    )
    // And the three-part digest over the same link is a DIFFERENT value, which
    // is what makes dropping `tid` fail rather than downgrade.
    expect(params.get('sig')).not.toBe(
      createHmac('sha256', SECRET)
        .update(`${HOST}:${RECIPIENT}:${params.get('cid')}`)
        .digest('hex'),
    )
  })

  it('falls back to the default topic when the composer named none', async () => {
    await send()
    // Every send belongs to SOME topic, or the preference page could offer the
    // catalog without saying which entry the message in front of them was.
    expect(paramsOf(headerUrl()).get('tid')).toBe(DEFAULT_CAMPAIGN_TOPIC_ID)
  })
})

describe('unsubscribeSignature', () => {
  it('leaves a two-part link from before campaigns byte-identical', () => {
    // Every email already in an inbox. An unsubscribe link that has stopped
    // honoring itself is the one failure in this area nobody gets to shrug at.
    expect(unsubscribeSignature(HOST, RECIPIENT, SECRET)).toBe(
      createHmac('sha256', SECRET).update(`${HOST}:${RECIPIENT}`).digest('hex'),
    )
  })

  it('leaves a three-part link from before topics byte-identical', () => {
    expect(unsubscribeSignature(HOST, RECIPIENT, SECRET, 'camp-1')).toBe(
      createHmac('sha256', SECRET)
        .update(`${HOST}:${RECIPIENT}:camp-1`)
        .digest('hex'),
    )
  })

  it('ignores a topic with no campaign, so the subject has no empty part', () => {
    // `host:email::topic` and a campaign id of `:topic` would be the same
    // string. The four-part form is only used when there is a campaign to put
    // in the middle of it.
    expect(unsubscribeSignature(HOST, RECIPIENT, SECRET, '', 'news')).toBe(
      createHmac('sha256', SECRET).update(`${HOST}:${RECIPIENT}`).digest('hex'),
    )
  })

  it('lowercases the address, as the suppression key does', () => {
    expect(
      unsubscribeSignature(HOST, 'DANA@Example.com', SECRET, 'camp-1', 'news'),
    ).toBe(unsubscribeSignature(HOST, RECIPIENT, SECRET, 'camp-1', 'news'))
  })
})

describe('the campaign record', () => {
  it('stores the RESOLVED topic, so the report and the page agree', async () => {
    const result = await send('newsletter')
    expect(
      store.get(`hosts/${HOST}/campaigns/${result.campaignId}`),
    ).toMatchObject({ topicId: 'newsletter' })
  })

  it('stores the default rather than nothing when none was chosen', async () => {
    const result = await send()
    expect(
      store.get(`hosts/${HOST}/campaigns/${result.campaignId}`),
    ).toMatchObject({ topicId: DEFAULT_CAMPAIGN_TOPIC_ID })
  })

  it('carries the topic onto a SCHEDULED campaign', async () => {
    // The scheduler re-reads this document days later and mints the links from
    // it, so a topic dropped here is a topic the send can never recover.
    const result = await post({
      hostId: HOST,
      action: 'schedule',
      subject: 'Hello',
      body: 'Hi',
      audience: 'leads',
      topicId: 'newsletter',
      sendAtMs: Date.now() + 60_000,
    })
    expect(result.status).toBe(200)
    expect(
      store.get(`hosts/${HOST}/campaigns/${result.body.campaignId}`),
    ).toMatchObject({ topicId: 'newsletter', status: 'scheduled' })
  })
})

describe('a topic id that could not be signed', () => {
  it('is refused by the route before anything is sent', async () => {
    const result = await post({
      hostId: HOST,
      subject: 'Hello',
      body: 'Hi',
      audience: 'leads',
      topicId: 'news:letter',
    })
    expect(result.status).toBe(400)
    expect(sent).toHaveLength(0)
  })

  it('is refused on the SCHEDULE branch too, which writes without sending', async () => {
    // The AGL-1771 asymmetry: this branch writes the campaign document without
    // going through `performCampaignSend`, so a value only the send validated
    // would be stored unchecked and signed into a link a fortnight later.
    const result = await post({
      hostId: HOST,
      action: 'schedule',
      subject: 'Hello',
      body: 'Hi',
      audience: 'leads',
      topicId: 'news:letter',
      sendAtMs: Date.now() + 60_000,
    })
    expect(result.status).toBe(400)
    expect([...store.keys()].some((key) => key.includes('/campaigns/'))).toBe(
      false,
    )
  })

  it('is refused inside performCampaignSend, for a caller that is not the route', async () => {
    await expect(send('news:letter')).rejects.toThrow('Invalid topicId')
  })

  it('is refused for a path separator too', async () => {
    await expect(send('a/b')).rejects.toThrow('Invalid topicId')
  })
})

describe('who a topic-carrying campaign reaches', () => {
  it('skips a recipient who left that stream', async () => {
    topicOptOuts[RECIPIENT] = ['newsletter']
    await expect(send('newsletter')).rejects.toThrow(
      'Every recipient has unsubscribed or been suppressed',
    )
    expect(sent).toHaveLength(0)
  })

  it('still reaches them on a stream they did not leave', async () => {
    // The whole point of topics: leaving one is not leaving all of them.
    topicOptOuts[RECIPIENT] = ['newsletter']
    await send('marketing')
    expect(sent).toHaveLength(1)
  })
})
