/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
 *
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
 * THE PREFERENCE CENTER, and the four properties it may not cost.
 *
 * `email/preferences` is a third route over the same signed link, so it is a
 * third chance to lose something the first two already hold. The suite is
 * organized around the four:
 *
 *  1. A GET writes nothing — the AGL-2408 prescanner property, now on three
 *     routes instead of two.
 *  2. A topic edited in the URL is refused. The topic decides which stream a
 *     recipient is shown as leaving, so an unsigned one would be editable by
 *     anybody holding the mail.
 *  3. RFC 8058 one-click still unsubscribes, immediately, with no page in the
 *     way. Gmail POSTs the header URL with nobody watching.
 *  4. A resubscribe cannot clear a bounce or a complaint. That is the sender's
 *     protection and not the recipient's preference, and the preference page
 *     is a NEW way into the same release.
 *
 * THE DOUBLE MODELS WHAT THE HANDLERS DEPEND ON, stated so a false green is
 * visible:
 *
 *  1. `set({ merge: true })` merges into the existing document and CREATES it
 *     when absent.
 *  2. `runTransaction` buffers `tx.set` until the callback resolves, and
 *     `tx.get` sees committed state. Contention/retry are NOT modeled: the
 *     callback runs exactly once, faithful to the uncontended path here.
 *  3. `serverTimestamp()` is a sentinel resolved on write against a monotonic
 *     clock, so a re-stamped timestamp is DISTINGUISHABLE from a preserved
 *     one — without that, "does not restamp" could not fail.
 *  4. `increment` stays a sentinel until applied, so "counted once" and
 *     "counted three times" are different assertions.
 */

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

let clock = 0

const isServerTimestamp = (value: unknown): boolean =>
  (value as { __serverTimestamp?: boolean })?.__serverTimestamp === true

const isIncrement = (value: unknown): boolean =>
  typeof (value as { __increment?: number })?.__increment === 'number'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    increment: (by: number) => ({ __increment: by }),
  },
}))

const docs = new Map<string, Record<string, unknown>>()

/** Resolves sentinels one level deep, and inside a nested plain map. */
function resolveSentinels(value: unknown): unknown {
  if (isServerTimestamp(value)) return `t${(clock += 1)}`
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
        key,
        resolveSentinels(inner),
      ]),
    )
  }
  return value
}

function mergeInto(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    out[key] = resolveSentinels(value)
  }
  return out
}

function writePath(
  doc: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split('.')
  let cursor = doc
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part]
    cursor[part] =
      next && typeof next === 'object' && !Array.isArray(next)
        ? { ...(next as object) }
        : {}
    cursor = cursor[part] as Record<string, unknown>
  }
  cursor[parts[parts.length - 1]] = value
}

function readPath(doc: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (cursor, part) =>
      cursor && typeof cursor === 'object'
        ? (cursor as Record<string, unknown>)[part]
        : undefined,
    doc,
  )
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => ({
      exists: docs.has(path),
      data: () => docs.get(path),
      get: (field: string) => (docs.get(path) ?? {})[field],
    }),
    delete: async () => {
      docs.delete(path)
    },
    /*
     * `update()` REJECTS a document that does not exist, which is the
     * behavior the campaign counter relies on: an unsubscribe arriving after
     * the merchant deleted the campaign must not re-create it as a document
     * holding one `stats` map.
     */
    update: async (value: Record<string, unknown>) => {
      if (!docs.has(path)) {
        const error: Error & { code?: number } = new Error(
          `NOT_FOUND: no entity to update: ${path}`,
        )
        error.code = 5
        throw error
      }
      const next = { ...(docs.get(path) as Record<string, unknown>) }
      for (const [field, raw] of Object.entries(value)) {
        writePath(
          next,
          field,
          isIncrement(raw)
            ? Number(readPath(next, field) ?? 0) +
                (raw as { __increment: number }).__increment
            : resolveSentinels(raw),
        )
      }
      docs.set(path, next)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  return {
    path,
    doc: (id: string) => {
      const full = `${path}/${id}`
      // A document path has an EVEN component count; `.doc()` throws outright
      // when the argument makes it odd — SYNCHRONOUSLY, not as a rejection.
      if (full.split('/').length % 2 !== 0) {
        throw new Error(
          `Value for argument "documentPath" must point to a document, ` +
            `but was "${id}".`,
        )
      }
      return makeDocRef(full)
    },
    // The topic catalog read: every document one level under this collection.
    get: async () => ({
      docs: [...docs.entries()]
        .filter(
          ([key]) =>
            key.startsWith(`${path}/`) &&
            key.slice(path.length + 1).split('/').length === 1,
        )
        .map(([key, data]) => ({
          id: key.slice(path.length + 1),
          data: () => data,
          get: (field: string) => data[field],
        })),
    }),
  }
}

/** Forced failure for the next transaction, to model an outage. */
let transactionFailure: Error | null = null

async function runTransaction<T>(body: (tx: any) => Promise<T>): Promise<T> {
  if (transactionFailure) {
    const failure = transactionFailure
    transactionFailure = null
    throw failure
  }
  const pending: Array<() => void> = []
  const tx = {
    get: (ref: any) => ref.get(),
    set: (
      ref: any,
      value: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      pending.push(() => {
        docs.set(
          ref.path,
          options?.merge
            ? mergeInto(docs.get(ref.path) ?? {}, value)
            : mergeInto({}, value),
        )
      })
      return tx
    },
  }
  const result = await body(tx)
  for (const write of pending) write()
  return result
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction,
}

/** Null models a host with no owning org, which must still render a page. */
let orgIdForHost: string | null = 'org-1'

/** Forced failure for the next cadence write, to model an outage. */
let cadenceWriteFails = false

/*
 * The cadence write is a DOUBLE that writes into the same fake store.
 *
 * Whether the real `setMarketingCadence` puts the field on the right document
 * is `email-marketing-gate.spec.ts`'s question, and it needs the Admin SDK to
 * answer. What this file certifies is that the PAGE records what the
 * recipient chose, reads it back onto the form, and says so — so the double
 * has to be durable enough to round-trip, and no more.
 */
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore }) },
  resolveOrgIdForHost: async () => orgIdForHost,
  EMAIL_FREQUENCY_SUBCOLLECTION: 'emailFrequency',
  setMarketingCadence: async (
    hostId: string,
    email: string,
    cadence: string,
  ) => {
    if (cadenceWriteFails) return false
    const path = `hosts/${hostId}/emailFrequency/${createHash('sha256')
      .update(email)
      .digest('hex')}`
    docs.set(path, { ...(docs.get(path) ?? {}), email, cadence })
    return true
  },
}))

import { resolvePluginApiRoute } from '@aglyn/aglyn/server'
import { DEFAULT_EMAIL_TOPICS } from '@aglyn/aglyn'
import { createHash, createHmac } from 'crypto'
import { registerEmailApi } from './server'

registerEmailApi()

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECRET = 'unsubscribe-secret'
const HOST = 'host-1'
const CAMPAIGN = 'camp-1'
const TOPIC = 'newsletter'
const RECIPIENT = 'dana@example.com'
const KEY = createHash('sha256').update(RECIPIENT).digest('hex')
const SUPPRESSION_PATH = `hosts/${HOST}/suppressions/${KEY}`
const OPT_OUT_PATH = `hosts/${HOST}/topicOptOuts/${KEY}`
const CAMPAIGN_PATH = `hosts/${HOST}/campaigns/${CAMPAIGN}`

/** Signs whichever of the three forms the arguments describe. */
function sign(options?: {
  hostId?: string
  email?: string
  cid?: string
  tid?: string
}) {
  const hostId = options?.hostId ?? HOST
  const email = options?.email ?? RECIPIENT
  const cid = options?.cid ?? ''
  const tid = options?.tid ?? ''
  const subject =
    tid && cid
      ? `${hostId}:${email}:${cid}:${tid}`
      : cid
        ? `${hostId}:${email}:${cid}`
        : `${hostId}:${email}`
  return createHmac('sha256', SECRET).update(subject).digest('hex')
}

/** The full four-part link a campaign mints today. */
const topicQuery = () => ({
  hostId: HOST,
  email: RECIPIENT,
  cid: CAMPAIGN,
  tid: TOPIC,
  sig: sign({ cid: CAMPAIGN, tid: TOPIC }),
})

/** The two-part link every email sent before campaign attribution carries. */
const legacyQuery = () => ({
  hostId: HOST,
  email: RECIPIENT,
  sig: sign(),
})

interface Reply {
  status: number
  body: string
  headers: Record<string, string>
}

async function call(options: {
  method: string
  route?: string
  query?: Record<string, string>
  body?: Record<string, string>
}): Promise<Reply> {
  const handler = resolvePluginApiRoute(options.route ?? 'email/preferences')
  expect(handler).toBeDefined()
  const reply: Reply = { status: 200, body: '', headers: {} }
  const res: any = {
    status: (code: number) => {
      reply.status = code
      return res
    },
    setHeader: (name: string, value: unknown) => {
      reply.headers[String(name).toLowerCase()] = String(value)
    },
    send: (value: unknown) => {
      reply.body = String(value ?? '')
    },
    json: (value: unknown) => {
      reply.body = JSON.stringify(value)
    },
  }
  await handler!(
    {
      method: options.method,
      query: options.query ?? {},
      body: options.body,
      headers: {},
      cookies: {},
      socket: {},
    } as any,
    res,
  )
  return reply
}

/** Whether a topic's checkbox is rendered ticked. */
function checkedTopics(html: string): string[] {
  return [...html.matchAll(/name="topic:([^"]+)" value="on"( checked)?/g)]
    .filter((match) => !!match[2])
    .map((match) => match[1])
}

beforeEach(() => {
  docs.clear()
  clock = 0
  transactionFailure = null
  cadenceWriteFails = false
  orgIdForHost = 'org-1'
  process.env.EMAIL_UNSUBSCRIBE_SECRET = SECRET
})

// ---------------------------------------------------------------------------
// 1. A GET writes nothing
// ---------------------------------------------------------------------------

describe('the preference page is SAFE on GET', () => {
  it('writes nothing at all — a link prescanner changes no preference', () => {
    // The AGL-2408 property, extended to the third route. Safe Links,
    // Proofpoint and friends fetch every URL in a message before the
    // recipient sees it.
    return call({ method: 'GET', query: topicQuery() }).then((reply) => {
      expect(reply.status).toBe(200)
      expect(docs.size).toBe(0)
    })
  })

  it('is never indexed and never cached — it names the address', async () => {
    const reply = await call({ method: 'GET', query: topicQuery() })
    expect(reply.headers['x-robots-tag']).toBe('noindex, nofollow')
    expect(reply.headers['cache-control']).toBe('no-store')
  })

  it('offers every built-in topic, ticked, for an address with no records', async () => {
    const reply = await call({ method: 'GET', query: topicQuery() })
    expect(checkedTopics(reply.body)).toEqual(
      DEFAULT_EMAIL_TOPICS.map((topic) => topic.id),
    )
  })

  it('marks the topic the message belonged to', async () => {
    const reply = await call({ method: 'GET', query: topicQuery() })
    // The one thing the recipient arrives already knowing is which email they
    // are holding, so the page has to be able to point at it.
    expect(reply.body).toContain('This email')
  })

  it('renders a form the recipient must submit, not a completed action', async () => {
    const reply = await call({ method: 'GET', query: topicQuery() })
    expect(reply.body).toContain('method="post"')
    // `&` inside an attribute must be escaped or the later parameters are lost
    // and the POST answers "Invalid preferences link".
    expect(reply.body).toContain('&amp;email=')
    expect(reply.body).toContain('&amp;tid=')
  })

  it('answers 405 to a verb that is neither', async () => {
    const reply = await call({ method: 'DELETE', query: topicQuery() })
    expect(reply.status).toBe(405)
    expect(reply.headers['allow']).toBe('GET, POST')
    expect(docs.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 2. The signature covers the topic
// ---------------------------------------------------------------------------

describe('a topic edited in the URL is refused', () => {
  it('refuses a DIFFERENT topic against the same signature', async () => {
    // The forgery the signature exists to stop: keep the signature, swap the
    // stream, and the recipient is shown as leaving something else.
    const reply = await call({
      method: 'POST',
      query: { ...topicQuery(), tid: 'marketing' },
    })
    expect(reply.status).toBe(403)
    expect(docs.size).toBe(0)
  })

  it('refuses the topic being DROPPED from a four-part link', async () => {
    const withoutTopic = topicQuery()
    delete (withoutTopic as Partial<typeof withoutTopic>).tid
    const reply = await call({ method: 'POST', query: withoutTopic })
    expect(reply.status).toBe(403)
    expect(docs.size).toBe(0)
  })

  it('refuses a topic BOLTED ONTO a link that carried none', async () => {
    const reply = await call({
      method: 'POST',
      query: { ...legacyQuery(), cid: CAMPAIGN, tid: TOPIC },
    })
    expect(reply.status).toBe(403)
    expect(docs.size).toBe(0)
  })

  it('refuses a COLON spliced into the campaign id', async () => {
    /*
     * The ambiguity the colon rule closes. `host:email:camp-1:newsletter` is
     * one string, and without this it could be presented either as a
     * four-part link (campaign `camp-1`, topic `newsletter`) or as a
     * three-part link whose campaign id is `camp-1:newsletter`. Both would
     * verify against the SAME signature, so a topic could be laundered into
     * a campaign id and back out again.
     */
    const reply = await call({
      method: 'POST',
      query: {
        hostId: HOST,
        email: RECIPIENT,
        cid: `${CAMPAIGN}:${TOPIC}`,
        sig: sign({ cid: CAMPAIGN, tid: TOPIC }),
      },
    })
    expect(reply.status).toBe(403)
    expect(docs.size).toBe(0)
  })

  it('refuses a topic with NO campaign, whose subject has an empty part', async () => {
    /*
     * The other half of the ambiguity. `host:email::topic` — an empty middle
     * component — is the same string as a three-part subject whose campaign id
     * is `:topic`, so the four-part form is only usable with a campaign in the
     * middle of it. Every link the send path mints carries both.
     */
    const reply = await call({
      method: 'POST',
      query: {
        hostId: HOST,
        email: RECIPIENT,
        tid: TOPIC,
        sig: createHmac('sha256', SECRET)
          .update(`${HOST}:${RECIPIENT}::${TOPIC}`)
          .digest('hex'),
      },
    })
    expect(reply.status).toBe(403)
    expect(docs.size).toBe(0)
  })

  it('refuses a colon inside the TOPIC id, the same ambiguity mirrored', async () => {
    const reply = await call({
      method: 'POST',
      query: {
        hostId: HOST,
        email: RECIPIENT,
        cid: CAMPAIGN,
        tid: 'a:b',
        sig: sign({ cid: CAMPAIGN, tid: 'a:b' }),
      },
    })
    expect(reply.status).toBe(403)
    expect(docs.size).toBe(0)
  })

  it('refuses a topic link signed for a DIFFERENT recipient', async () => {
    const reply = await call({
      method: 'POST',
      query: { ...topicQuery(), email: 'someone-else@example.com' },
    })
    expect(reply.status).toBe(403)
    expect(docs.size).toBe(0)
  })

  it('still honors a two-part link from before topics existed', async () => {
    // An email is not recallable. Every link already in an inbox has to work.
    const reply = await call({ method: 'GET', query: legacyQuery() })
    expect(reply.status).toBe(200)
    expect(checkedTopics(reply.body).length).toBe(DEFAULT_EMAIL_TOPICS.length)
  })
})

// ---------------------------------------------------------------------------
// 3. RFC 8058 one-click
// ---------------------------------------------------------------------------

describe('RFC 8058 one-click still unsubscribes', () => {
  it('acts immediately on the header POST, with no page in the way', async () => {
    // Exactly what Gmail sends: the header URL verbatim, with
    // `List-Unsubscribe=One-Click` as the urlencoded body and no human
    // present. The suppression must exist when the 200 is read.
    const reply = await call({
      method: 'POST',
      route: 'email/unsubscribe',
      query: topicQuery(),
      body: { 'List-Unsubscribe': 'One-Click' },
    })
    expect(reply.status).toBe(200)
    expect(docs.get(SUPPRESSION_PATH)).toMatchObject({
      email: RECIPIENT,
      reason: 'unsubscribe',
    })
  })

  it('removes the whole site, which is at least the stream it belonged to', async () => {
    // A machine POSTing this header is promised that the recipient stops
    // hearing from this site. Narrowing one-click to the topic would be a
    // REDUCTION in what a recipient gets from the same button.
    await call({
      method: 'POST',
      route: 'email/unsubscribe',
      query: topicQuery(),
      body: { 'List-Unsubscribe': 'One-Click' },
    })
    expect(docs.has(SUPPRESSION_PATH)).toBe(true)
  })

  it('records WHICH stream lost them on the suppression', async () => {
    await call({
      method: 'POST',
      route: 'email/unsubscribe',
      query: topicQuery(),
    })
    expect(docs.get(SUPPRESSION_PATH)).toMatchObject({
      campaignId: CAMPAIGN,
      topicId: TOPIC,
    })
  })

  it('counts the campaign unsubscribe exactly once across re-POSTs', async () => {
    docs.set(CAMPAIGN_PATH, { subject: 'Hello' })
    await call({
      method: 'POST',
      route: 'email/unsubscribe',
      query: topicQuery(),
    })
    await call({
      method: 'POST',
      route: 'email/unsubscribe',
      query: topicQuery(),
    })
    // A client re-POSTing a one-click header is normal. `stats.unsubscribes`
    // counts PEOPLE who left, not button presses.
    expect(readPath(docs.get(CAMPAIGN_PATH)!, 'stats.unsubscribes')).toBe(1)
  })

  it('does NOT write on the one-click route’s GET', async () => {
    const reply = await call({
      method: 'GET',
      route: 'email/unsubscribe',
      query: topicQuery(),
    })
    expect(reply.status).toBe(200)
    expect(docs.size).toBe(0)
  })

  it('offers the narrower choice from the one-click confirmation page', async () => {
    const reply = await call({
      method: 'GET',
      route: 'email/unsubscribe',
      query: topicQuery(),
    })
    expect(reply.body).toContain('/api/email/preferences?')
  })
})

// ---------------------------------------------------------------------------
// 4. A resubscribe may not clear a bounce or a complaint
// ---------------------------------------------------------------------------

describe('sender protection is not a recipient preference', () => {
  for (const reason of ['bounce', 'complaint']) {
    it(`the resubscribe route refuses to clear a ${reason}`, async () => {
      docs.set(SUPPRESSION_PATH, { email: RECIPIENT, reason })
      const reply = await call({
        method: 'POST',
        route: 'email/resubscribe',
        query: topicQuery(),
      })
      expect(reply.status).toBe(200)
      expect(reply.body).toContain("Can't resubscribe this address")
      // The record is still standing. This is the assertion that matters:
      // anybody holding an old campaign email could otherwise re-arm sending
      // to an address that hard-bounced or reported spam.
      expect(docs.get(SUPPRESSION_PATH)).toEqual({ email: RECIPIENT, reason })
    })

    it(`the preference page refuses to clear a ${reason} too`, async () => {
      docs.set(SUPPRESSION_PATH, { email: RECIPIENT, reason })
      // Ticking every box is a request to receive mail, which on an
      // unsubscribed address lifts the site suppression. It must not lift
      // THIS one — a new route to the same release is a new way to lose it.
      const reply = await call({
        method: 'POST',
        query: topicQuery(),
        body: Object.fromEntries(
          DEFAULT_EMAIL_TOPICS.map((topic) => [`topic:${topic.id}`, 'on']),
        ),
      })
      expect(reply.status).toBe(200)
      expect(docs.get(SUPPRESSION_PATH)).toEqual({ email: RECIPIENT, reason })
      expect(reply.body).toContain('could not change')
    })

    it(`the preference page offers no controls against a ${reason}`, async () => {
      docs.set(SUPPRESSION_PATH, { email: RECIPIENT, reason })
      const reply = await call({ method: 'GET', query: topicQuery() })
      // A form whose submit cannot take effect is worse than no form.
      expect(reply.body).toContain("Can't resubscribe this address")
      expect(reply.body).not.toContain('method="post"')
    })
  }

  it('does clear a self-service unsubscribe, which IS a preference', async () => {
    docs.set(SUPPRESSION_PATH, { email: RECIPIENT, reason: 'unsubscribe' })
    const reply = await call({
      method: 'POST',
      route: 'email/resubscribe',
      query: topicQuery(),
    })
    expect(reply.status).toBe(200)
    expect(docs.has(SUPPRESSION_PATH)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// What the preference page actually does
// ---------------------------------------------------------------------------

describe('saving preferences', () => {
  /** Every topic ticked except the ones named. */
  const keepAllBut = (...dropped: string[]) =>
    Object.fromEntries(
      DEFAULT_EMAIL_TOPICS.filter((topic) => !dropped.includes(topic.id)).map(
        (topic) => [`topic:${topic.id}`, 'on'],
      ),
    )

  it('records an opt-out for the UNTICKED topics only', async () => {
    const reply = await call({
      method: 'POST',
      query: topicQuery(),
      body: keepAllBut('newsletter'),
    })
    expect(reply.status).toBe(200)
    const record = docs.get(OPT_OUT_PATH) as any
    expect(Object.keys(record.topics)).toEqual(['newsletter'])
    expect(record.topics['newsletter'].resubscribedAt).toBeNull()
    expect(record.email).toBe(RECIPIENT)
  })

  it('leaves the site suppression alone — leaving one stream is not leaving', async () => {
    await call({
      method: 'POST',
      query: topicQuery(),
      body: keepAllBut('newsletter'),
    })
    expect(docs.has(SUPPRESSION_PATH)).toBe(false)
  })

  it('reads the saved opt-out back as an unticked box', async () => {
    await call({
      method: 'POST',
      query: topicQuery(),
      body: keepAllBut('newsletter'),
    })
    const reply = await call({ method: 'GET', query: topicQuery() })
    expect(checkedTopics(reply.body)).not.toContain('newsletter')
    expect(checkedTopics(reply.body)).toContain('marketing')
  })

  it('treats an EMPTY body as "stop everything", not as "change nothing"', async () => {
    // A browser submits nothing at all for an unchecked box, so a handler that
    // read the form for what to TURN OFF could not tell "all off" from "no
    // choice made". The complement is read off the catalog for this reason.
    const reply = await call({ method: 'POST', query: topicQuery(), body: {} })
    expect(reply.status).toBe(200)
    const record = docs.get(OPT_OUT_PATH) as any
    expect(Object.keys(record.topics).sort()).toEqual(
      DEFAULT_EMAIL_TOPICS.map((topic) => topic.id).sort(),
    )
  })

  it('does not restamp an opt-out the recipient already made', async () => {
    await call({
      method: 'POST',
      query: topicQuery(),
      body: keepAllBut('newsletter'),
    })
    const first = (docs.get(OPT_OUT_PATH) as any).topics['newsletter']
      .optedOutAt
    await call({
      method: 'POST',
      query: topicQuery(),
      body: keepAllBut('newsletter'),
    })
    // The clock moved, so a restamp would be visible rather than a tie. The
    // date somebody asked us to stop is the date a human is told.
    expect((docs.get(OPT_OUT_PATH) as any).topics['newsletter'].optedOutAt).toBe(
      first,
    )
  })

  it('KEEPS the record as evidence when a topic is rejoined', async () => {
    await call({
      method: 'POST',
      query: topicQuery(),
      body: keepAllBut('newsletter'),
    })
    await call({
      method: 'POST',
      query: topicQuery(),
      body: keepAllBut(),
    })
    const record = (docs.get(OPT_OUT_PATH) as any).topics['newsletter']
    // Not deleted: `email-suppression.ts`'s rule is that a revocation is a
    // FIELD, because the record is the proof the request was honored while it
    // stood. The pair of timestamps is the window it was in force for.
    expect(record.optedOutAt).toBeTruthy()
    expect(record.resubscribedAt).toBeTruthy()
  })

  it('reads a rejoined topic back as ticked', async () => {
    await call({
      method: 'POST',
      query: topicQuery(),
      body: keepAllBut('newsletter'),
    })
    await call({ method: 'POST', query: topicQuery(), body: keepAllBut() })
    const reply = await call({ method: 'GET', query: topicQuery() })
    expect(checkedTopics(reply.body)).toContain('newsletter')
  })

  it('lifts a self-service site unsubscribe when a stream is ticked', async () => {
    docs.set(SUPPRESSION_PATH, { email: RECIPIENT, reason: 'unsubscribe' })
    await call({ method: 'POST', query: topicQuery(), body: keepAllBut() })
    // Otherwise the page would accept a choice it cannot honor: every box
    // ticked, and the send path still dropping the address one layer above.
    expect(docs.has(SUPPRESSION_PATH)).toBe(false)
  })

  it('shows an unsubscribed address every box EMPTY, which is its real state', async () => {
    docs.set(SUPPRESSION_PATH, { email: RECIPIENT, reason: 'unsubscribe' })
    const reply = await call({ method: 'GET', query: topicQuery() })
    expect(checkedTopics(reply.body)).toEqual([])
    expect(reply.body).toContain('unsubscribed from everything')
  })

  it('names what changed and how to undo it', async () => {
    const reply = await call({
      method: 'POST',
      query: topicQuery(),
      body: keepAllBut('newsletter'),
    })
    expect(reply.body).toContain('Sorry to see you go')
    expect(reply.body).toContain('Newsletter')
    expect(reply.body).toContain('/api/email/preferences?')
  })
})

describe('unsubscribe from everything', () => {
  it('writes the site suppression and offers the way back', async () => {
    const reply = await call({
      method: 'POST',
      query: topicQuery(),
      body: { action: 'all' },
    })
    expect(reply.status).toBe(200)
    expect(docs.get(SUPPRESSION_PATH)).toMatchObject({
      reason: 'unsubscribe',
      topicId: TOPIC,
    })
    expect(reply.body).toContain('Sorry to see you go')
    expect(reply.body).toContain('/api/email/resubscribe?')
  })

  it('counts it on the campaign, once', async () => {
    docs.set(CAMPAIGN_PATH, { subject: 'Hello' })
    await call({
      method: 'POST',
      query: topicQuery(),
      body: { action: 'all' },
    })
    await call({
      method: 'POST',
      query: topicQuery(),
      body: { action: 'all' },
    })
    expect(readPath(docs.get(CAMPAIGN_PATH)!, 'stats.unsubscribes')).toBe(1)
  })

  it('does not create a campaign the merchant already deleted', async () => {
    await call({
      method: 'POST',
      query: topicQuery(),
      body: { action: 'all' },
    })
    // The suppression is the write that must happen; a statistic must never
    // be able to cost one, nor conjure a document holding one `stats` map.
    expect(docs.has(SUPPRESSION_PATH)).toBe(true)
    expect(docs.has(CAMPAIGN_PATH)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The catalog, and what the page may reveal
// ---------------------------------------------------------------------------

describe('the topic catalog on the preference page', () => {
  it('shows the org’s renamed topic rather than the built-in label', async () => {
    docs.set('orgs/org-1/emailTopics/newsletter', {
      name: 'The Dispatch',
      description: 'Monthly.',
    })
    const reply = await call({ method: 'GET', query: topicQuery() })
    expect(reply.body).toContain('The Dispatch')
  })

  it('shows a topic the org added', async () => {
    docs.set('orgs/org-1/emailTopics/events', {
      name: 'Event invitations',
      description: '',
    })
    const reply = await call({ method: 'GET', query: topicQuery() })
    expect(checkedTopics(reply.body)).toContain('events')
  })

  it('hides a retired topic from the choices', async () => {
    docs.set('orgs/org-1/emailTopics/sales', {
      name: 'Sales outreach',
      archived: true,
    })
    const reply = await call({ method: 'GET', query: topicQuery() })
    expect(checkedTopics(reply.body)).not.toContain('sales')
  })

  it('falls back to the built-ins for a host with no org', async () => {
    orgIdForHost = null
    const reply = await call({ method: 'GET', query: topicQuery() })
    // A page rendering NO topics offers a recipient nothing to untick, which
    // turns the one screen they came to in order to leave a stream into a
    // dead end.
    expect(checkedTopics(reply.body)).toEqual(
      DEFAULT_EMAIL_TOPICS.map((topic) => topic.id),
    )
  })
})

describe('what the page may reveal', () => {
  it('renders identically for an address it has never seen', async () => {
    const unknown = 'nobody@example.com'
    const known = await call({ method: 'GET', query: topicQuery() })
    const stranger = await call({
      method: 'GET',
      query: {
        hostId: HOST,
        email: unknown,
        cid: CAMPAIGN,
        tid: TOPIC,
        sig: sign({ email: unknown, cid: CAMPAIGN, tid: TOPIC }),
      },
    })
    /*
     * Both pages, with the address and its signature blanked out.
     *
     * There is deliberately no "we don't have that address" branch, because
     * that branch is the enumeration oracle: a caller holding one valid link
     * could otherwise ask about any address by watching which page comes
     * back. What is left after blanking is everything the page reveals ABOUT
     * the person, and it has to be the same for both.
     */
    const blank = (body: string, email: string, signature: string) =>
      body
        .split(email)
        .join('<address>')
        .split(encodeURIComponent(email))
        .join('<address>')
        .split(signature)
        .join('<signature>')
    expect(stranger.status).toBe(known.status)
    expect(
      blank(
        stranger.body,
        unknown,
        sign({ email: unknown, cid: CAMPAIGN, tid: TOPIC }),
      ),
    ).toEqual(
      blank(known.body, RECIPIENT, sign({ cid: CAMPAIGN, tid: TOPIC })),
    )
  })

  it('refuses a link with no signature at all', async () => {
    const reply = await call({
      method: 'GET',
      query: { hostId: HOST, email: RECIPIENT },
    })
    expect(reply.status).toBe(400)
  })

  it('refuses an `email` that is not an address, rather than keying one', async () => {
    // The old local `suppressionKey` hashed anything, so a malformed address
    // addressed a suppression document for a person who does not exist.
    const malformed = 'not-an-address'
    const reply = await call({
      method: 'POST',
      query: {
        hostId: HOST,
        email: malformed,
        cid: CAMPAIGN,
        tid: TOPIC,
        sig: sign({ email: malformed, cid: CAMPAIGN, tid: TOPIC }),
      },
    })
    expect(reply.status).toBe(400)
    expect(docs.size).toBe(0)
  })
})

/**
 * HOW OFTEN — `docs/specs/email-competitive-gaps.md` G10's other half.
 *
 * The cap shipped and this did not, so a recipient who wanted the same mail
 * less often had two options and one of them was the spam button. Every
 * assertion is written so that it can fail in both directions: a stored
 * choice is checked against the absence of one, and the round-trip is checked
 * on a value the recipient did not pick.
 */
describe('how often the recipient wants to hear', () => {
  const FREQUENCY_PATH = `hosts/${HOST}/emailFrequency/${KEY}`
  const keepAll = () =>
    Object.fromEntries(
      DEFAULT_EMAIL_TOPICS.map((topic) => [`topic:${topic.id}`, 'on']),
    )

  it('offers the choice on the page', async () => {
    const reply = await call({ method: 'GET', query: topicQuery() })
    expect(reply.body).toContain('name="cadence" value="weekly"')
    expect(reply.body).toContain('At most one a week')
    // The default is a named option rather than the absence of one.
    expect(reply.body).toContain('name="cadence" value="all"')
  })

  it('records what the recipient chose', async () => {
    await call({
      method: 'POST',
      query: topicQuery(),
      body: { ...keepAll(), cadence: 'weekly' },
    })
    expect((docs.get(FREQUENCY_PATH) as any)?.cadence).toBe('weekly')
  })

  it('ticks the stored choice when the page is next opened', async () => {
    docs.set(FREQUENCY_PATH, { email: RECIPIENT, cadence: 'monthly' })
    const reply = await call({ method: 'GET', query: topicQuery() })
    expect(reply.body).toContain('name="cadence" value="monthly" checked')
    expect(reply.body).not.toContain('name="cadence" value="all" checked')
  })

  it('ticks the default when nothing is stored', async () => {
    const reply = await call({ method: 'GET', query: topicQuery() })
    expect(reply.body).toContain('name="cadence" value="all" checked')
    expect(reply.body).not.toContain('name="cadence" value="weekly" checked')
  })

  it('says what will happen, but only when a pace was actually chosen', async () => {
    const chosen = await call({
      method: 'POST',
      query: topicQuery(),
      body: { ...keepAll(), cadence: 'monthly' },
    })
    expect(chosen.body).toContain('no more than one a month')
    const untouched = await call({
      method: 'POST',
      query: topicQuery(),
      body: keepAll(),
    })
    expect(untouched.body).not.toContain('no more than')
  })

  /**
   * The page is reached with no session by anybody holding the link, so the
   * body is untrusted. A value that is not a cadence must not become a 500
   * on the screen somebody came to in order to leave.
   */
  it('treats a value that is not a cadence as no preference', async () => {
    const reply = await call({
      method: 'POST',
      query: topicQuery(),
      body: { ...keepAll(), cadence: 'hourly' },
    })
    expect(reply.status).toBe(200)
    expect((docs.get(FREQUENCY_PATH) as any)?.cadence).toBe('all')
  })

  it('saves the topic choices even when the pace could not be stored', async () => {
    cadenceWriteFails = true
    const reply = await call({
      method: 'POST',
      query: topicQuery(),
      body: { ...keepAll(), cadence: 'weekly' },
    })
    expect(reply.status).toBe(200)
    expect(reply.body).toContain('could not change: how often')
    expect(docs.has(OPT_OUT_PATH)).toBe(true)
  })

  it('is not offered to an address held by a bounce or a complaint', async () => {
    docs.set(SUPPRESSION_PATH, { email: RECIPIENT, reason: 'bounce' })
    const reply = await call({ method: 'GET', query: topicQuery() })
    expect(reply.body).not.toContain('name="cadence"')
  })

  /**
   * RFC 8058 one-click is a POST a mailbox provider makes with nobody
   * watching. It must go on acting immediately, with no page and no choice in
   * front of it — a header that advertised one-click against a form would be
   * reporting an unsubscribe that never happened.
   */
  it('does not reach the one-click unsubscribe', async () => {
    const reply = await call({
      method: 'POST',
      route: 'email/unsubscribe',
      query: topicQuery(),
      body: { 'List-Unsubscribe': 'One-Click' },
    })
    expect(reply.status).toBe(200)
    expect(docs.has(SUPPRESSION_PATH)).toBe(true)
    expect(reply.body).not.toContain('name="cadence"')
    expect(docs.has(FREQUENCY_PATH)).toBe(false)
  })
})

describe('when Firestore is down', () => {
  it('answers 500 and writes nothing', async () => {
    transactionFailure = new Error('firestore down')
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const reply = await call({ method: 'POST', query: topicQuery(), body: {} })
    expect(reply.status).toBe(500)
    expect(docs.size).toBe(0)
    consoleError.mockRestore()
  })
})
