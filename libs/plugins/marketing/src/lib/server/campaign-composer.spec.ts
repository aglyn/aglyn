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
 * WHAT THE COMPOSER MAY ASK THE SEND ROUTE FOR BEFORE IT SENDS.
 *
 * Three questions, and the first of them was answered `400 Missing subject or
 * body` for every plain-text campaign ever composed:
 *
 *  1. `preview` — how many people, split by consent basis. It carries no copy
 *     because it needs none; the route's own preview branch substitutes
 *     placeholder text before resolving anything. The route nonetheless
 *     required subject and body of every action but `cancel`, so the count and
 *     the consent split — the whole reason the readout exists — were never
 *     rendered to anybody.
 *  2. `renderPreview` — the HTML this campaign will actually mail. It resolves
 *     no audience at all: a merchant reading their own draft must not cost a
 *     sweep of their contact list per keystroke.
 *  3. `send` / `schedule` — carrying the composer's from-name, reply-to and
 *     preheader through to the message and onto the stored campaign.
 *
 * The Firestore double is `campaign-send-ids.spec.ts`'s, which models `.doc()`
 * path arithmetic rather than treating an id as an opaque key.
 */

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

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => snapshotOf(path),
    set: async (value: Record<string, any>) => {
      store.set(path, { ...(store.get(path) ?? {}), ...value })
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  return {
    doc: (id: string) => {
      if (id === '') {
        throw new Error(
          `Value for argument "documentPath" is not a valid resource path.`,
        )
      }
      const full = `${path}/${id}`
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

/** Every collection this call paged — the audience sweeps, by path. */
const sweeps: string[] = []

function queryRef(path: string, after?: string): any {
  return {
    orderBy: () => queryRef(path, after),
    startAfter: (cursor: any) => queryRef(path, cursor?.id ?? String(cursor)),
    limit: (max: number) => ({
      get: async () => {
        sweeps.push(path)
        const ids = childIds(path).filter((id) => !after || id > after)
        return {
          docs: ids.slice(0, max).map((id) => snapshotOf(`${path}/${id}`)),
        }
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
        verifyIdToken: async () => ({
          uid: mockUid,
          email: 'admin@example.com',
        }),
      }),
    }),
    firestore: {
      FieldValue: {
        increment: (value: number) => ({ increment: value }),
        serverTimestamp: () => 'server-timestamp',
      },
      FieldPath: { documentId: () => '__name__' },
    },
  },
  /*
   * Nobody here has left a topic, so the third list is a pass-through.
   * Modeled rather than omitted: the barrel factory is a CLOSED WORLD, and an
   * absent export arrives as `undefined` and fails the send with a TypeError
   * that says nothing about the behavior under test.
   */
  filterTopicSendable: async (
    _hostId: string,
    _topicId: string,
    emails: string[],
  ) => emails,
  filterSendableForHost: async (_hostId: string, emails: string[]) => emails,
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'pro' } }),
  resolveHostSendingIdentity: async () =>
    jest.requireActual('@aglyn/shared-util-email').resolveSendingIdentity({
      selection: null,
      platformFrom: process.env.USAGE_EMAIL_FROM || 'noreply@aglyn.com',
    }),
  // The `list` audience walks `orgDataCollectionForHost('contacts').parent`
  // to reach `orgs/{orgId}/lists`, so this has to be the real path shape.
  orgDataCollectionForHost: async (_hostId: string, name: string) =>
    mockFirestore().collection(`orgs/org-1/${name}`),
  orgDataQueryForHost: async (_hostId: string, name: string) => ({
    ref: mockFirestore().collection(`orgs/org-1/${name}`),
    query: mockFirestore().collection(`orgs/org-1/${name}`),
  }),
  meterHostEmail: async () => undefined,
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
  claimOrgEmailSendBudget: async () => ({
    allowed: true,
    used: 0,
    ceiling: 25_000,
    remaining: 25_000,
    retryAtMs: 3_600_000,
    degraded: false,
  }),
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
import { campaignSendHandler } from './campaign-send'

const HOST = 'host-1'

function seed() {
  store.clear()
  sent.length = 0
  sweeps.length = 0
  mockUid = 'uid-1'
  store.set(`hosts/${HOST}`, {
    subdomain: 'acme',
    memberRoles: { 'uid-1': 'admin' },
  })
  // Three leads with a recorded opt-in and one with none: enough for a
  // `sendable` of 3 against an `audienceSize` of 4, which is the shape the
  // confirm dialog and the consent line both have to state.
  for (const [id, email, consented] of [
    ['lead-1', 'dana@example.com', true],
    ['lead-2', 'evan@example.com', true],
    ['lead-3', 'faye@example.com', true],
    ['lead-4', 'gwen@example.com', false],
  ] as Array<[string, string, boolean]>) {
    store.set(`hosts/${HOST}/leads/${id}`, {
      email,
      name: 'Dana Reed',
      ...(consented
        ? {
            // The basis belongs to the site sending, not to the org.
            marketingConsentByHost: {
              'host-1': { marketingConsent: true, marketingConsentAtMs: Date.UTC(2026, 7, 1) },
            },
          }
        : {}),
    })
  }
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

let previousSecret: string | undefined
beforeAll(() => {
  previousSecret = process.env['EMAIL_UNSUBSCRIBE_SECRET']
  process.env['EMAIL_UNSUBSCRIBE_SECRET'] = 'test-secret'
})
afterAll(() => {
  if (previousSecret === undefined) {
    delete process.env['EMAIL_UNSUBSCRIBE_SECRET']
  } else {
    process.env['EMAIL_UNSUBSCRIBE_SECRET'] = previousSecret
  }
})

beforeEach(seed)

// ---------------------------------------------------------------------------
// The defect: the recipient count was never once rendered
// ---------------------------------------------------------------------------

describe('a preview of an unwritten campaign', () => {
  it('counts the audience with no subject and no body', async () => {
    /*
     * THE DEFECT, at the line that caused it. The composer asks for the count
     * as soon as the card mounts — before any copy exists, which is the point
     * of asking — and the route refused it, so the readout under the Subject
     * field said `Missing subject or body` and stayed there.
     */
    const result = await post({ hostId: HOST, action: 'preview' })

    expect(result.status).toBe(200)
    expect(result.body.sendable).toBe(3)
    expect(result.body.audienceSize).toBe(4)
  })

  it('reports the consent split the composer shows', async () => {
    const result = await post({ hostId: HOST, action: 'preview' })

    expect(result.body.consented).toBe(3)
    expect(result.body.consentWithheld).toBe(1)
  })

  it('still refuses a SEND with no subject or body', async () => {
    // The guard is right about the action that mails something; it was only
    // ever wrong about the two that do not.
    const result = await post({ hostId: HOST, audience: 'leads' })

    expect(result.status).toBe(400)
    expect(result.body.error).toBe('Missing subject or body')
    expect(sent).toEqual([])
  })

  it('sends nothing while previewing', async () => {
    await post({ hostId: HOST, action: 'preview' })

    expect(sent).toEqual([])
    expect([...store.keys()].some((key) => key.includes('/campaigns/'))).toBe(
      false,
    )
  })
})

// ---------------------------------------------------------------------------
// The rendered preview
// ---------------------------------------------------------------------------

describe('rendering the campaign before it is sent', () => {
  it('returns the HTML part a plain-text campaign will mail', async () => {
    const result = await post({
      hostId: HOST,
      action: 'renderPreview',
      subject: 'Spring sale',
      body: 'Ends Sunday. See https://acme.example/sale',
    })

    expect(result.status).toBe(200)
    // The same synthesis `sendEmail` performs for a body with no HTML part,
    // so what is previewed is what is mailed rather than a second renderer.
    expect(result.body.html).toContain('Ends Sunday')
    expect(result.body.html).toContain('<a href="https://acme.example/sale"')
  })

  it('resolves merge tags against a sample recipient rather than blanking them', async () => {
    const result = await post({
      hostId: HOST,
      action: 'renderPreview',
      subject: 'Hi {{firstName|there}}',
      body: 'Hello {{firstName|there}}',
    })

    expect(result.body.subject).toBe('Hi there')
    expect(result.body.html).toContain('Hello there')
  })

  it('carries the opt-out footer every campaign is sent with', async () => {
    const result = await post({
      hostId: HOST,
      action: 'renderPreview',
      subject: 'Spring sale',
      body: 'Ends Sunday',
    })

    expect(result.body.text).toContain(
      'Choose which emails you get, or unsubscribe:',
    )
  })

  it('resolves no audience at all', async () => {
    /*
     * The cost property, and the reason this is a separate action rather than
     * a field on `preview`. A rendered preview recomputes as the merchant
     * types; a preview that swept the audience would read the whole contact
     * list once per debounce tick to answer a question about the copy.
     *
     * The control is in the same test: the count preview DOES sweep, so an
     * empty `sweeps` proves the render skipped the audience rather than
     * proving the double records nothing.
     */
    const result = await post({
      hostId: HOST,
      action: 'renderPreview',
      subject: 'Spring sale',
      body: 'Ends Sunday',
    })

    expect(result.status).toBe(200)
    expect(sweeps).toEqual([])

    await post({ hostId: HOST, action: 'preview' })
    expect(sweeps).toContain(`hosts/${HOST}/leads`)
  })

  it('needs the same site role a send needs', async () => {
    mockUid = 'uid-stranger'

    const result = await post({
      hostId: HOST,
      action: 'renderPreview',
      subject: 'Spring sale',
      body: 'Ends Sunday',
    })

    expect(result.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// From name, reply-to and preheader
// ---------------------------------------------------------------------------

describe('the composer’s sender fields', () => {
  it('sends with the from-name, reply-to and preheader it was given', async () => {
    const result = await post({
      hostId: HOST,
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
      fromName: 'Acme Studio',
      replyTo: 'hello@acme.example',
      preheader: 'Everything half price until Sunday',
    })

    expect(result.status).toBe(200)
    expect(sent[0].fromName).toBe('Acme Studio')
    expect(sent[0].replyTo).toBe('hello@acme.example')
    expect(sent[0].html).toContain('Everything half price until Sunday')
  })

  it('refuses a reply-to that is not an address', async () => {
    const result = await post({
      hostId: HOST,
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
      replyTo: 'not-an-address',
    })

    expect(result.status).toBe(400)
    expect(sent).toEqual([])
  })

  it('strips a header break out of the from-name', async () => {
    // The display name lands in a `From:` header. A newline in it is the
    // injection shape, and the value is merchant-typed.
    const result = await post({
      hostId: HOST,
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
      fromName: 'Acme\r\nBcc: victim@example.com',
    })

    expect(result.status).toBe(200)
    expect(String(sent[0].fromName)).not.toMatch(/[\r\n]/)
  })

  it('records which campaign the send belongs to', async () => {
    // What a campaign's own page enumerates its emails by.
    const result = await post({
      hostId: HOST,
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
      emailCampaignId: 'camp-1',
    })

    const stored = store.get(`hosts/${HOST}/campaigns/${result.body.campaignId}`)
    expect(stored?.emailCampaignId).toBe('camp-1')
  })

  it('records WHICH LIST a list send addressed', async () => {
    /*
     * `audience` alone says `'list'`, which does not name the list — so a sent
     * campaign recorded that it went to a list and nothing about which one,
     * and the send's own detail page had no way to answer it. The scheduled
     * branch has always stored this; the send branch never did.
     */
    store.set('orgs/org-1/lists/list-7/members/m1', {
      email: 'hana@example.com',
      // The basis belongs to the site sending, not to the org.
      marketingConsentByHost: {
        'host-1': { marketingConsent: true, marketingConsentAtMs: Date.UTC(2026, 7, 1) },
      },
    })

    const result = await post({
      hostId: HOST,
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'list',
      listId: 'list-7',
    })

    expect(result.status).toBe(200)
    const stored = store.get(`hosts/${HOST}/campaigns/${result.body.campaignId}`)
    expect(stored?.audience).toBe('list')
    expect(stored?.listId).toBe('list-7')
  })

  it('refuses a campaign id that names a path', async () => {
    // It is stored and later queried as a document id.
    const result = await post({
      hostId: HOST,
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
      emailCampaignId: 'a/b/c',
    })

    expect(result.status).toBe(400)
    expect(sent).toEqual([])
  })

  it('stores them on a scheduled campaign so the cron sends the same message', async () => {
    const result = await post({
      hostId: HOST,
      action: 'schedule',
      subject: 'Spring sale',
      body: 'Ends Sunday',
      audience: 'leads',
      sendAtMs: Date.now() + 3_600_000,
      fromName: 'Acme Studio',
      replyTo: 'hello@acme.example',
      preheader: 'Half price until Sunday',
      emailCampaignId: 'camp-1',
    })

    const stored = store.get(`hosts/${HOST}/campaigns/${result.body.campaignId}`)
    expect(stored?.emailCampaignId).toBe('camp-1')
    expect(stored?.fromName).toBe('Acme Studio')
    expect(stored?.replyTo).toBe('hello@acme.example')
    expect(stored?.preheader).toBe('Half price until Sunday')
  })
})
