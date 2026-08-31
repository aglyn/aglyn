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
 * The unsubscribe link is SAFE on GET (AGL-2408).
 *
 * The assertion that matters is `docs.size` after a GET with a perfectly
 * valid signature: zero. That is the prescanner case — Safe Links, Proofpoint
 * and friends fetch every URL in a message before the recipient sees it, and
 * against the old handler each of those fetches unsubscribed someone.
 *
 * THE DOUBLE MODELS WHAT THE HANDLER DEPENDS ON, stated so a false green is
 * visible:
 *
 *  1. `set({ merge: true })` merges into the existing document and CREATES it
 *     when absent — the write path.
 *  2. `runTransaction` buffers `tx.set` until the callback resolves, and
 *     `tx.get` sees committed state — which is what makes "stamp `createdAt`
 *     only when new" mean anything. Contention/retry are NOT modelled: the
 *     callback runs exactly once, faithful to the uncontended path here.
 *  3. `serverTimestamp()` is a sentinel resolved on write, so a re-stamped
 *     `createdAt` is DISTINGUISHABLE from a preserved one — the double keeps
 *     a monotonic clock rather than one constant string, or the "does not
 *     restamp" assertion could not fail.
 */

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

let clock = 0

interface ServerTimestampSentinel {
  __serverTimestamp: true
}

const isServerTimestamp = (value: unknown): value is ServerTimestampSentinel =>
  (value as ServerTimestampSentinel)?.__serverTimestamp === true

/**
 * `increment`, modelled because the campaign's unsubscribe counter is one.
 *
 * A double that resolved it to a plain number would make "counted once" and
 * "counted three times" the same assertion, which is the whole property the
 * idempotency here has to have.
 */
interface IncrementSentinel {
  __increment: number
}

const isIncrement = (value: unknown): value is IncrementSentinel =>
  typeof (value as IncrementSentinel)?.__increment === 'number'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    increment: (by: number) => ({ __increment: by }),
  },
}))

const docs = new Map<string, Record<string, unknown>>()

function mergeInto(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isServerTimestamp(value) ? `t${(clock += 1)}` : value
  }
  return out
}

/** Writes a dotted field path, creating intermediate maps — as `update()` does. */
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

/** Reads a dotted field path. */
function readPath(doc: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (cursor, part) =>
      cursor && typeof cursor === 'object'
        ? (cursor as Record<string, unknown>)[part]
        : undefined,
    doc,
  )
}

/** Forced failure for the next transaction, to model an outage. */
let transactionFailure: Error | null = null

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
     * behaviour the campaign counter relies on: an unsubscribe arriving after
     * the merchant deleted the campaign must not re-create it as a document
     * holding one `stats` map. A double where `update` behaved like a
     * merge-set would report that guard as working while it did nothing.
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
            ? Number(readPath(next, field) ?? 0) + raw.__increment
            : isServerTimestamp(raw)
              ? `t${(clock += 1)}`
              : raw,
        )
      }
      docs.set(path, next)
    },
  }
}

function makeCollectionRef(path: string): any {
  return {
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
      return { ...makeDocRef(full), collection: (name: string) => makeCollectionRef(`${full}/${name}`) }
    },
  }
}

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
  __esModule: true,
  /*
   * The REAL key derivation and the REAL signature verifier. Both are pure
   * `crypto`, and both are the thing under test here: a double would let this
   * suite pass over a handler that files a suppression under an id no send
   * path looks up, or that accepts a signature the minter never produced.
   */
  ...jest.requireActual('@aglyn/tenant-data-admin/server/email-suppression'),
  ...jest.requireActual(
    '@aglyn/tenant-data-admin/server/email-unsubscribe-link',
  ),
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore }) },
}))

import { resolvePluginApiRoute } from '@aglyn/aglyn/server'
import { createHash, createHmac } from 'crypto'
import { registerEmailApi } from './server'

registerEmailApi()

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECRET = 'unsubscribe-secret'
const HOST = 'host-1'
const RECIPIENT = 'dana@example.com'
const SUPPRESSION_PATH = `hosts/${HOST}/suppressions/${createHash('sha256')
  .update(RECIPIENT)
  .digest('hex')}`

const sign = (hostId: string, email: string) =>
  createHmac('sha256', SECRET).update(`${hostId}:${email}`).digest('hex')

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
  const handler = resolvePluginApiRoute(options.route ?? 'email/unsubscribe')
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

const validQuery = () => ({
  hostId: HOST,
  email: RECIPIENT,
  sig: sign(HOST, RECIPIENT),
})

describe('email/unsubscribe', () => {
  beforeEach(() => {
    docs.clear()
    clock = 0
    transactionFailure = null
    process.env.EMAIL_UNSUBSCRIBE_SECRET = SECRET
  })

  it('does NOT write on GET — a link prescanner unsubscribes nobody', async () => {
    const reply = await call({ method: 'GET', query: validQuery() })
    expect(reply.status).toBe(200)
    expect(docs.size).toBe(0)
  })

  it('offers a same-URL POST form carrying the signature', async () => {
    const reply = await call({ method: 'GET', query: validQuery() })
    expect(reply.body).toContain('method="post"')
    expect(reply.body).toContain(`sig=${sign(HOST, RECIPIENT)}`)
    // `&` inside an attribute must be escaped or the second and third
    // parameters are lost and the POST answers "Invalid unsubscribe link".
    expect(reply.body).toContain('&amp;email=')
    expect(reply.body).not.toMatch(/action="[^"]*[^p;]&email=/)
  })

  it('writes the suppression on POST, with an explicit reason', async () => {
    const reply = await call({ method: 'POST', query: validQuery() })
    expect(reply.status).toBe(200)
    expect(reply.body).toContain("You're unsubscribed")
    expect(docs.get(SUPPRESSION_PATH)).toEqual({
      email: RECIPIENT,
      reason: 'unsubscribe',
      // `suppressedAt` is written before the conditional `createdAt`, so it
      // takes the earlier tick. Both are asserted by exact value so a
      // sentinel that stopped resolving would fail rather than pass as
      // "some object".
      suppressedAt: 't1',
      createdAt: 't2',
    })
  })

  it('accepts the RFC 8058 one-click POST body', async () => {
    // What Gmail sends: the header URL verbatim, `List-Unsubscribe=One-Click`
    // as the urlencoded body. The handler must not require anything else.
    const reply = await call({
      method: 'POST',
      query: validQuery(),
      body: { 'List-Unsubscribe': 'One-Click' },
    })
    expect(reply.status).toBe(200)
    expect(docs.has(SUPPRESSION_PATH)).toBe(true)
  })

  it('reads the parameters from a form body when the query is bare', async () => {
    const reply = await call({ method: 'POST', body: validQuery() })
    expect(reply.status).toBe(200)
    expect(docs.has(SUPPRESSION_PATH)).toBe(true)
  })

  it('does not restamp createdAt on a second POST', async () => {
    await call({ method: 'POST', query: validQuery() })
    await call({ method: 'POST', query: validQuery() })
    const entry = docs.get(SUPPRESSION_PATH) as Record<string, unknown>
    // Stamped once, on the first POST, and left alone by the second.
    expect(entry['createdAt']).toBe('t2')
    // The clock moved, so a restamp would be visible rather than a tie.
    expect(entry['suppressedAt']).toBe('t3')
  })

  it('refuses a bad signature on POST without writing', async () => {
    const reply = await call({
      method: 'POST',
      query: { ...validQuery(), sig: 'deadbeef' },
    })
    expect(reply.status).toBe(403)
    expect(docs.size).toBe(0)
  })

  it('refuses another recipient signed for a different address', async () => {
    const reply = await call({
      method: 'POST',
      query: {
        hostId: HOST,
        email: 'someone-else@example.com',
        sig: sign(HOST, RECIPIENT),
      },
    })
    expect(reply.status).toBe(403)
    expect(docs.size).toBe(0)
  })

  it('answers 405 to a verb that is neither', async () => {
    const reply = await call({ method: 'DELETE', query: validQuery() })
    expect(reply.status).toBe(405)
    expect(reply.headers['allow']).toBe('GET, POST')
    expect(docs.size).toBe(0)
  })

  it('answers 500 when the write fails, and writes nothing', async () => {
    transactionFailure = new Error('firestore down')
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const reply = await call({ method: 'POST', query: validQuery() })
    expect(reply.status).toBe(500)
    expect(docs.size).toBe(0)
    consoleError.mockRestore()
  })
})

describe('email/resubscribe', () => {
  const RESUB = { route: 'email/resubscribe' }

  beforeEach(() => {
    docs.clear()
    clock = 0
    transactionFailure = null
    process.env.EMAIL_UNSUBSCRIBE_SECRET = SECRET
  })

  it('does NOT write on GET', async () => {
    docs.set(SUPPRESSION_PATH, { email: RECIPIENT, reason: 'unsubscribe' })
    const reply = await call({ ...RESUB, method: 'GET', query: validQuery() })
    expect(reply.status).toBe(200)
    expect(docs.has(SUPPRESSION_PATH)).toBe(true)
  })

  it('reuses the SAME signature the unsubscribe link carries', async () => {
    // The whole point (AGL-2499): no second token, no second email — the
    // signed params already in hand on the unsubscribe success page work
    // here unmodified.
    const reply = await call({ ...RESUB, method: 'GET', query: validQuery() })
    expect(reply.body).toContain(`sig=${sign(HOST, RECIPIENT)}`)
  })

  it('deletes an unsubscribe-reason suppression on POST', async () => {
    docs.set(SUPPRESSION_PATH, { email: RECIPIENT, reason: 'unsubscribe' })
    const reply = await call({ ...RESUB, method: 'POST', query: validQuery() })
    expect(reply.status).toBe(200)
    expect(reply.body).toContain("You're resubscribed")
    expect(docs.has(SUPPRESSION_PATH)).toBe(false)
  })

  it('is idempotent when nothing was suppressed', async () => {
    const reply = await call({ ...RESUB, method: 'POST', query: validQuery() })
    expect(reply.status).toBe(200)
    expect(reply.body).toContain("You're resubscribed")
  })

  it('refuses to reverse a bounce suppression', async () => {
    docs.set(SUPPRESSION_PATH, { email: RECIPIENT, reason: 'bounce' })
    const reply = await call({ ...RESUB, method: 'POST', query: validQuery() })
    expect(reply.status).toBe(200)
    expect(reply.body).toContain("Can't resubscribe")
    // Untouched — still suppressed, by the reason it was suppressed for.
    expect(docs.get(SUPPRESSION_PATH)).toEqual({
      email: RECIPIENT,
      reason: 'bounce',
    })
  })

  it('refuses to reverse a spam-complaint suppression', async () => {
    docs.set(SUPPRESSION_PATH, { email: RECIPIENT, reason: 'complaint' })
    const reply = await call({ ...RESUB, method: 'POST', query: validQuery() })
    expect(docs.get(SUPPRESSION_PATH)?.['reason']).toBe('complaint')
    expect(reply.body).toContain("Can't resubscribe")
  })

  it('refuses a bad signature on POST without writing', async () => {
    docs.set(SUPPRESSION_PATH, { email: RECIPIENT, reason: 'unsubscribe' })
    const reply = await call({
      ...RESUB,
      method: 'POST',
      query: { ...validQuery(), sig: 'deadbeef' },
    })
    expect(reply.status).toBe(403)
    expect(docs.has(SUPPRESSION_PATH)).toBe(true)
  })

  it('answers 405 to a verb that is neither', async () => {
    const reply = await call({ ...RESUB, method: 'DELETE', query: validQuery() })
    expect(reply.status).toBe(405)
    expect(reply.headers['allow']).toBe('GET, POST')
  })
})

/*==========================================
 * ATTRIBUTING AN UNSUBSCRIBE TO THE CAMPAIGN THAT CAUSED IT.
 *
 * The suppression list has always recorded that somebody left. It never
 * recorded which mailing they left over — which is the only question an
 * unsubscribe rate exists to answer, and the reason a campaign report could
 * not have one.
 *
 * The constraint that shapes all of this: EVERY EMAIL ALREADY IN AN INBOX
 * carries a link signed over `hostId:email`, and those links have to go on
 * working. So `cid` is additive, the signature covers it when it is present,
 * and the verifier picks its form from the link rather than from the
 * signature. The tests below are mostly about that pair of forms, because a
 * mistake there does not look like a bug — it looks like an unsubscribe link
 * that quietly stopped working, on mail nobody can recall.
 *=========================================*/

const CAMPAIGN = 'camp-1'
const CAMPAIGN_PATH = `hosts/${HOST}/campaigns/${CAMPAIGN}`

/** The three-part signature a link minted since attribution carries. */
const signWithCampaign = (
  hostId: string,
  email: string,
  campaignId: string,
) =>
  createHmac('sha256', SECRET)
    .update(`${hostId}:${email}:${campaignId}`)
    .digest('hex')

const attributedQuery = (campaignId = CAMPAIGN) => ({
  hostId: HOST,
  email: RECIPIENT,
  sig: signWithCampaign(HOST, RECIPIENT, campaignId),
  cid: campaignId,
})

describe('unsubscribe attribution', () => {
  beforeEach(() => {
    docs.clear()
    clock = 0
    transactionFailure = null
    process.env.EMAIL_UNSUBSCRIBE_SECRET = SECRET
  })

  /*
   * THE COMPATIBILITY ASSERTION, first because it is the one that must never
   * break. A link with no `cid` is checked against the two-part form, exactly
   * as before — this is the mail already sitting in people's inboxes.
   */
  it('still honours a link with no campaign, signed the old way', async () => {
    const reply = await call({ method: 'POST', query: validQuery() })

    expect(reply.status).toBe(200)
    expect(docs.get(SUPPRESSION_PATH)).toMatchObject({
      reason: 'unsubscribe',
    })
  })

  it('honours a link that names its campaign, signed the new way', async () => {
    docs.set(CAMPAIGN_PATH, { subject: 'Spring sale', stats: { sent: 10 } })

    const reply = await call({ method: 'POST', query: attributedQuery() })

    expect(reply.status).toBe(200)
    expect(docs.get(SUPPRESSION_PATH)).toMatchObject({
      reason: 'unsubscribe',
      campaignId: CAMPAIGN,
    })
  })

  it('counts the unsubscribe against the campaign', async () => {
    docs.set(CAMPAIGN_PATH, { subject: 'Spring sale', stats: { sent: 10 } })

    await call({ method: 'POST', query: attributedQuery() })

    expect((docs.get(CAMPAIGN_PATH)?.stats as any).unsubscribes).toBe(1)
    // The counter is a dotted field path, so it must not have replaced the
    // stats map the send wrote.
    expect((docs.get(CAMPAIGN_PATH)?.stats as any).sent).toBe(10)
  })

  /*
   * IDEMPOTENT, and not by a claim document. The transaction that writes the
   * suppression already reads it to decide whether to stamp `createdAt`, so
   * "did this click create the entry" is free — and a second press of the
   * button, or a client re-POSTing the one-click header, contributes nothing.
   * `stats.unsubscribes` therefore counts PEOPLE, which is what a rate over
   * delivered needs.
   */
  it('counts one person once, however many times they press the button', async () => {
    docs.set(CAMPAIGN_PATH, { subject: 'Spring sale', stats: { sent: 10 } })

    await call({ method: 'POST', query: attributedQuery() })
    await call({ method: 'POST', query: attributedQuery() })
    await call({ method: 'POST', query: attributedQuery() })

    expect((docs.get(CAMPAIGN_PATH)?.stats as any).unsubscribes).toBe(1)
  })

  /*
   * A re-click must not RE-ATTRIBUTE either. Somebody who unsubscribed via
   * March's campaign and later clicked January's link did not unsubscribe
   * over January's — the entry records when and why they left, and the second
   * click is not a second leaving.
   */
  it('does not re-attribute an existing unsubscribe to a later link', async () => {
    docs.set(CAMPAIGN_PATH, { subject: 'Spring sale', stats: { sent: 10 } })
    docs.set(`hosts/${HOST}/campaigns/camp-2`, { stats: { sent: 10 } })

    await call({ method: 'POST', query: attributedQuery() })
    await call({ method: 'POST', query: attributedQuery('camp-2') })

    expect(docs.get(SUPPRESSION_PATH)).toMatchObject({ campaignId: CAMPAIGN })
    expect((docs.get('hosts/host-1/campaigns/camp-2')?.stats as any)
      .unsubscribes).toBeUndefined()
  })

  it('does not re-create a campaign the merchant deleted', async () => {
    await call({ method: 'POST', query: attributedQuery() })

    expect(docs.has(CAMPAIGN_PATH)).toBe(false)
    // The suppression is the write that must happen whatever the counter does.
    expect(docs.get(SUPPRESSION_PATH)).toMatchObject({ reason: 'unsubscribe' })
  })

  /*==========================================
   * THE TWO SIGNED FORMS, AND WHY ACCEPTING BOTH IS NOT A DOWNGRADE.
   *
   * The LINK decides which form is checked, not the signature — so there is
   * no fallback between them and neither can be reached by tampering with the
   * other's URL.
   *=========================================*/
  it('refuses a campaign bolted onto an old two-part signature', async () => {
    const reply = await call({
      method: 'POST',
      query: { ...validQuery(), cid: CAMPAIGN },
    })

    expect(reply.status).toBe(403)
    expect(docs.size).toBe(0)
  })

  it('refuses a new link with its campaign stripped off', async () => {
    const withoutCampaign = { ...attributedQuery() } as Record<string, string>
    delete withoutCampaign['cid']

    const reply = await call({ method: 'POST', query: withoutCampaign })

    expect(reply.status).toBe(403)
    expect(docs.size).toBe(0)
  })

  it('refuses a campaign swapped for another', async () => {
    const reply = await call({
      method: 'POST',
      query: { ...attributedQuery(), cid: 'camp-someone-elses' },
    })

    expect(reply.status).toBe(403)
    expect(docs.size).toBe(0)
  })

  it('refuses a campaign id that names a path rather than a document', async () => {
    // Signed correctly — the signature is not the lock being tested here. A
    // `cid` of `a/b/c` addresses `campaigns/a/b/c`: `.doc()` accepts a
    // slashed argument as long as the total component count stays even, so
    // this is a real document at a path the merchant can neither see in their
    // campaigns list nor delete. It is seeded HERE so the assertion has
    // something to catch — against a missing document `update()` refuses on
    // its own, which would let the guard pass by never being needed.
    docs.set(CAMPAIGN_PATH, { subject: 'Spring sale', stats: { sent: 10 } })
    docs.set(`hosts/${HOST}/campaigns/a/b/c`, { stats: { sent: 1 } })

    const reply = await call({ method: 'POST', query: attributedQuery('a/b/c') })

    // The unsubscribe itself still happens — refusing it over a malformed
    // statistic would be the statistic costing the suppression.
    expect(reply.status).toBe(200)
    expect(docs.get(SUPPRESSION_PATH)).toMatchObject({ reason: 'unsubscribe' })
    expect(docs.get(`hosts/${HOST}/campaigns/a/b/c`)).toEqual({
      stats: { sent: 1 },
    })
  })

  /*
   * The confirmation form and the resubscribe link both re-serve the query,
   * and both are checked against the signature the link arrived with — so
   * dropping `cid` from either would produce a URL that refuses itself.
   */
  it('carries the campaign through the GET confirmation form', async () => {
    const reply = await call({ method: 'GET', query: attributedQuery() })

    expect(reply.body).toContain(`cid=${CAMPAIGN}`)
    expect(docs.size).toBe(0)
  })

  it('carries the campaign through to the resubscribe link', async () => {
    docs.set(CAMPAIGN_PATH, { subject: 'Spring sale', stats: { sent: 10 } })

    const reply = await call({ method: 'POST', query: attributedQuery() })

    expect(reply.body).toContain('/api/email/resubscribe?')
    expect(reply.body).toContain(`cid=${CAMPAIGN}`)
  })

  it('accepts the three-part signature on the resubscribe route too', async () => {
    docs.set(SUPPRESSION_PATH, { email: RECIPIENT, reason: 'unsubscribe' })

    const reply = await call({
      method: 'POST',
      route: 'email/resubscribe',
      query: attributedQuery(),
    })

    expect(reply.status).toBe(200)
    expect(docs.has(SUPPRESSION_PATH)).toBe(false)
  })

  it('still accepts the two-part signature on the resubscribe route', async () => {
    docs.set(SUPPRESSION_PATH, { email: RECIPIENT, reason: 'unsubscribe' })

    const reply = await call({
      method: 'POST',
      route: 'email/resubscribe',
      query: validQuery(),
    })

    expect(reply.status).toBe(200)
    expect(docs.has(SUPPRESSION_PATH)).toBe(false)
  })

  /*
   * A resubscribe DELETES the entry, so the next unsubscribe creates one —
   * and is therefore counted against whichever campaign it came from. That is
   * the intended reading: they really did leave twice.
   */
  it('counts a fresh unsubscribe after a resubscribe', async () => {
    docs.set(CAMPAIGN_PATH, { subject: 'Spring sale', stats: { sent: 10 } })

    await call({ method: 'POST', query: attributedQuery() })
    await call({
      method: 'POST',
      route: 'email/resubscribe',
      query: attributedQuery(),
    })
    await call({ method: 'POST', query: attributedQuery() })

    expect((docs.get(CAMPAIGN_PATH)?.stats as any).unsubscribes).toBe(2)
  })
})
