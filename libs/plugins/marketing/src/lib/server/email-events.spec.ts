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
 * What a Resend open/click event is allowed to CREATE (AGL-1768).
 *
 * The assertions are made against the in-memory store — what LANDED at which
 * document path — rather than against the handler's response, because the
 * handler answers `200` for every outcome by design (Resend must not
 * retry-storm) and so its body says almost nothing about the write.
 *
 * THE DOUBLE MODELS THE THREE FIRESTORE BEHAVIOURS THIS FIX TURNS ON, and it
 * is worth stating them because a fake that got any one of them wrong would
 * pass against the broken code as happily as against the fix:
 *
 *  1. `set({ merge: true })` merges maps RECURSIVELY and creates the document
 *     when absent — that create is the defect.
 *  2. `update()` rejects a missing document with gRPC `NOT_FOUND` (code 5),
 *     which is the only thing `updateExisting` treats as "absent".
 *  3. `update()` does NOT merge a nested map: a plain object replaces the
 *     whole field, and sentinels inside it are lifted out into transforms at
 *     their own dotted paths. This is why the patch uses `'stats.opens'` — a
 *     mechanical `update({ stats: { opens: … } })` would destroy `clicks` on
 *     every open, and the double is built so that mistake shows up as a red.
 *
 * `.doc()` also appends a SLASH-SEPARATED path and refuses it only when the
 * component count comes out odd, and reserved `__…__` ids answer
 * `INVALID_ARGUMENT` rather than an absent snapshot — both mirrored from
 * `cart-cookie.spec.ts` (`f053417fa`).
 */

import type { PluginApiResponse } from '@aglyn/aglyn/server'
import { createHmac } from 'crypto'

// ---------------------------------------------------------------------------
// Sentinels
// ---------------------------------------------------------------------------

interface IncrementSentinel {
  __increment: number
}
interface ServerTimestampSentinel {
  __serverTimestamp: true
}

const SERVER_TIME = '<server-timestamp>'

const isIncrement = (value: unknown): value is IncrementSentinel =>
  typeof (value as IncrementSentinel)?.__increment === 'number'

const isServerTimestamp = (value: unknown): value is ServerTimestampSentinel =>
  (value as ServerTimestampSentinel)?.__serverTimestamp === true

const isPlainMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !isIncrement(value) &&
  !isServerTimestamp(value)

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (value: number) => ({ __increment: value }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
  },
}))

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, unknown>>()

/** Forced failure for the next `update()`, to model an outage. */
let updateFailure: (Error & { code?: number }) | null = null

/** `set({ merge: true })`: recursive map merge, sentinels honoured at depth. */
function mergeInto(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (isIncrement(value)) {
      out[key] = Number(out[key] ?? 0) + value.__increment
    } else if (isServerTimestamp(value)) {
      out[key] = SERVER_TIME
    } else if (isPlainMap(value)) {
      out[key] = mergeInto(
        isPlainMap(out[key]) ? (out[key] as Record<string, unknown>) : {},
        value,
      )
    } else {
      out[key] = value
    }
  }
  return out
}

/** Reads a dotted field path out of a document. */
function readPath(doc: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (cursor, part) =>
        isPlainMap(cursor)
          ? (cursor as Record<string, unknown>)[part]
          : undefined,
      doc,
    )
}

/** Writes a dotted field path into a document, creating intermediate maps. */
function writePath(
  doc: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split('.')
  let cursor = doc
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part]
    cursor[part] = isPlainMap(next) ? { ...(next as object) } : {}
    cursor = cursor[part] as Record<string, unknown>
  }
  cursor[parts[parts.length - 1]] = value
}

/**
 * Splits an `update()` value into the plain residue that REPLACES the field
 * and the sentinel transforms that apply afterwards at their own field paths
 * — which is exactly what the `@google-cloud/firestore` serializer does, and
 * the reason a nested map loses its sibling keys.
 */
function splitTransforms(
  prefix: string,
  value: unknown,
  transforms: Array<[string, IncrementSentinel | ServerTimestampSentinel]>,
): { plain: unknown; hasPlain: boolean } {
  if (isIncrement(value) || isServerTimestamp(value)) {
    transforms.push([prefix, value])
    return { plain: undefined, hasPlain: false }
  }
  if (!isPlainMap(value)) return { plain: value, hasPlain: true }
  const plain: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const result = splitTransforms(`${prefix}.${key}`, child, transforms)
    if (result.hasPlain) plain[key] = result.plain
  }
  // A map that held only sentinels still replaces the field, with `{}`.
  return { plain, hasPlain: true }
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => {
      const data = docs.get(path)
      return {
        id: path.split('/').pop(),
        exists: data !== undefined,
        data: () => data,
        get: (field: string) => data?.[field],
        ref: makeDocRef(path),
      }
    },
    set: async (
      value: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      docs.set(
        path,
        options?.merge ? mergeInto(docs.get(path) ?? {}, value) : { ...value },
      )
    },
    update: async (value: Record<string, unknown>) => {
      if (updateFailure) {
        const failure = updateFailure
        updateFailure = null
        throw failure
      }
      if (!docs.has(path)) {
        const error: Error & { code?: number } = new Error(
          `NOT_FOUND: no entity to update: ${path}`,
        )
        error.code = 5
        throw error
      }
      const next = { ...(docs.get(path) as Record<string, unknown>) }
      const transforms: Array<
        [string, IncrementSentinel | ServerTimestampSentinel]
      > = []
      for (const [field, raw] of Object.entries(value)) {
        const result = splitTransforms(field, raw, transforms)
        if (result.hasPlain) writePath(next, field, result.plain)
      }
      for (const [field, sentinel] of transforms) {
        writePath(
          next,
          field,
          isIncrement(sentinel)
            ? Number(readPath(next, field) ?? 0) + sentinel.__increment
            : SERVER_TIME,
        )
      }
      docs.set(path, next)
    },
    /*
     * `create` REJECTS when the document already exists, which is the whole
     * reason the replay guard can be atomic — it is the claim primitive, not
     * a convenience for `set`. A double that let a second create succeed
     * would report a guard that dedupes nothing as working.
     */
    create: async (value: Record<string, unknown>) => {
      if (docs.has(path)) {
        const error: Error & { code?: number } = new Error(
          `ALREADY_EXISTS: Document already exists: ${path}`,
        )
        error.code = 6
        throw error
      }
      docs.set(path, { ...value })
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
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
      if (full.split('/').some((part) => /^__.*__$/.test(part))) {
        const error: Error & { code?: number } = new Error(
          `INVALID_ARGUMENT: Document name "${full}" is reserved.`,
        )
        error.code = 3
        throw error
      }
      return makeDocRef(full)
    },
  }
}

/**
 * `runTransaction`, modelled on the two behaviours the suppression write
 * depends on: a `tx.get` sees COMMITTED state, and `tx.set` buffers until the
 * callback resolves, so a throw part-way leaves nothing behind.
 *
 * Contention and retry are NOT modelled — the callback runs exactly once.
 * That is faithful to the uncontended path every caller in this file takes,
 * and stated here rather than assumed, because a double that silently ran the
 * callback twice (or committed reads eagerly) would fabricate results in both
 * directions.
 */
async function runTransaction<T>(body: (tx: any) => Promise<T>): Promise<T> {
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
          options?.merge ? mergeInto(docs.get(ref.path) ?? {}, value) : { ...value },
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

// `updateExisting` is the REAL one, reached through its secondary entry point
// so that mocking the barrel (whose graph pulls the admin SDK, which does not
// load under jest) does not quietly replace the helper under test.
//
// `isDocumentId` needs no entry here: AGL-1771 moved it to
// `@aglyn/tenant-data-admin/server/document-id`, which this mock does not
// intercept, so the handler always gets the real predicate. That is the point
// of importing it from the leaf rather than the barrel — a permissive stub
// would turn every path-shaped tag below into a false green.
/*
 * The delivery log, mocked at its LEAF so the write is observable.
 *
 * The real module reaches the admin SDK and swallows its own failures by
 * design — so left unmocked it would no-op here and the assertions below
 * would pass over a handler that never called it.
 */
const recordedDeliveryEvents: unknown[][] = []
/**
 * Whether the mocked log reports each event as the FIRST of its type for its
 * message.
 *
 * The real log derives this inside the transaction it already runs, and the
 * handler leans on it for every distinct-recipient counter — unique opens,
 * unique clicks, delivered, bounced, complained. A stub that hard-coded
 * `true` would make those counters look idempotent while proving nothing
 * about the mechanism, and one that hard-coded `false` would silence them
 * entirely and let every assertion about them pass by asserting zero. So it
 * is settable per test, and both readings are exercised below.
 */
let mockFirstOfType = true
/**
 * What the handler handed the PERSON ROLLUP, per call.
 *
 * The rollup's own idempotency is proven against a Firestore double in
 * `tenant-data-admin`; what only this file can prove is that the handler
 * feeds it the delivery log's own verdict rather than re-deriving one — which
 * is the entire reason a replay costs nothing.
 */
const recordedEngagement: unknown[][] = []
const recordedTouches: unknown[] = []
jest.mock(
  '@aglyn/tenant-data-admin/server/email-delivery-log',
  () => ({
    recordEmailDeliveryEvents: jest.fn(async (events: unknown[]) => {
      recordedDeliveryEvents.push(events)
      return events.map((event: any) => ({
        firstOfType: mockFirstOfType,
        providerMessageId: String(event?.providerMessageId ?? ''),
        to: String(event?.to ?? ''),
        type: String(event?.type ?? ''),
        at: Number(event?.at ?? 0),
      }))
    }),
    recordPersonEngagement: jest.fn(async (outcomes: unknown[]) => {
      recordedEngagement.push(outcomes)
      return 0
    }),
    /*
     * The campaign touch revenue attribution is taken over. Recorded rather
     * than asserted-on-storage here for the same reason the engagement rollup
     * is: this file's subject is what the WEBHOOK does, and the touch's own
     * storage rules — forward-only, per host, capped — are proved against a
     * real double in `email-revenue-attribution.spec.ts`.
     */
    recordEmailCampaignTouch: jest.fn(async (touch: unknown) => {
      recordedTouches.push(touch)
      return true
    }),
  }),
)

jest.mock('@aglyn/tenant-data-admin', () => ({
  /*
   * The unsubscribe-link signer and URL builder are the REAL ones. They need
   * nothing but `crypto`, and a double would let a spec assert on a URL shape
   * the product does not actually mint — which is the whole failure mode of a
   * stubbed policy module.
   */
  ...jest.requireActual(
    '@aglyn/tenant-data-admin/server/email-unsubscribe-link',
  ),
  /*
   * The marketing frequency window is a no-op here, and deliberately so: it
   * is a durable counter whose behavior is proven against a Firestore double
   * in `tenant-data-admin`, and the campaign sender's only contract with it
   * is that it is called with the addresses that were reached and that it
   * cannot fail a send.
   */
  recordMarketingSends: async (_hostId: string, emails: readonly string[]) =>
    emails.length,
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore }) },
  updateExisting: jest.requireActual(
    '@aglyn/tenant-data-admin/server/update-existing',
  ).updateExisting,
}))

/**
 * The per-tenant reputation counter, doubled at its LEAF so the attribution
 * is observable.
 *
 * The counter's own behavior is proven against a Firestore double in
 * `tenant-data-admin`; what this file owns is the question that module cannot
 * answer — which workspace a delivery event belongs to, and whether one that
 * belongs to nobody is counted against somebody.
 */
const reputationFailures: Array<{ orgId: string; kind: string }> = []
jest.mock('@aglyn/tenant-data-admin/server/email-sender-reputation', () => ({
  recordEmailReputationFailure: async (orgId: string, kind: string) => {
    reputationFailures.push({ orgId, kind })
  },
}))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  ...jest.requireActual('@aglyn/tenant-data-admin/server/organizations'),
  getOrgForHost: async (hostId: string) => ({
    orgId: `org-of-${hostId}`,
    org: {},
  }),
}))

import { emailEventsHandler } from './email-events'
// The REAL cap, not a local copy: a spec that retyped it would go on passing
// after the value it asserts moved. (`suppressionId` is imported further
// down, beside the block that explains why it is not recomputed here.)
import { CAMPAIGN_LINK_ROLLUP_MAX } from '@aglyn/plugins-email/model'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECRET = 'whsec_' + Buffer.from('resend-signing-key').toString('base64')
const HOST = 'host-1'
const CAMPAIGN = 'camp-1'
const CAMPAIGN_PATH = `hosts/${HOST}/campaigns/${CAMPAIGN}`
const EXPERIMENT = 'exp-1'
const EXPERIMENT_PATH = `hosts/${HOST}/experiments/${EXPERIMENT}`
const RECIPIENT = 'dana@example.com'

/** A campaign as `performCampaignSend` leaves it — the fields a stub lacks. */
const REAL_CAMPAIGN = {
  subject: 'Spring sale',
  body: 'Ends Sunday',
  audience: 'leads',
  status: 'sent',
  sentAtMs: 1799000000000,
  recipients: 40,
  stats: { opens: 2, clicks: 5 },
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

/** Delivers a genuinely Svix-signed event, as Resend does. */
/*
 * Every delivery gets its OWN message id, because every delivery in
 * production does. Re-using one id across calls made this suite assert that
 * the same event counts twice, which is the behaviour the replay guard
 * exists to prevent — so a shared id here would have read as the guard
 * being broken.
 *
 * `replayOf` is how a test asks for the other case on purpose: the SAME id
 * delivered again, which is what a provider retry and a dashboard replay
 * both look like on the wire.
 */
let deliveryCounter = 0
async function deliver(
  event: Record<string, unknown>,
  options: { replayOf?: string } = {},
) {
  const rawBody = JSON.stringify(event)
  const id = options.replayOf ?? `msg_${(deliveryCounter += 1)}`
  const timestamp = '1799000000'
  const signature = createHmac(
    'sha256',
    Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64'),
  )
    .update(`${id}.${timestamp}.`)
    .update(Buffer.from(rawBody, 'utf8'))
    .digest('base64')
  const { res, result } = makeResponse()
  await emailEventsHandler(
    {
      method: 'POST',
      query: {},
      body: event,
      rawBody,
      cookies: {},
      headers: {
        'svix-id': id,
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${signature}`,
      },
    } as any,
    res,
  )
  return Object.assign(result, { messageId: id })
}

/**
 * Every path the handler wrote, EXCEPT the replay guard's own claim.
 *
 * The claim is bookkeeping rather than an outcome — it records that an event
 * was counted, and it is written on every counted event by construction. A
 * whole-store equality that included it would assert the guard's mechanics in
 * cases that are about something else entirely, so it is excluded once here
 * rather than tolerated case by case. The exclusion is exact: anything
 * outside `apiIdempotency/` still has to be accounted for, so a stray write
 * is still a failure.
 */
const writtenPaths = () =>
  [...docs.keys()].filter((key) => !key.startsWith('apiIdempotency/'))

/**
 * An `email.opened`/`email.clicked` payload with the tags Aglyn stamps.
 *
 * `email_id` is on every real Resend payload and the fixture now carries one,
 * because the handler's distinct-recipient counters are derived from the
 * delivery log — which keys on that id and records nothing without it. A
 * fixture missing it exercised a path where those counters never fire, which
 * would have let them pass by never running.
 *
 * A FRESH id per call, so two `deliver()`s in one test are two messages
 * unless a test deliberately says otherwise. `messageId` on the delivered
 * payload is separate: that is the Svix id, and it is what the replay guard
 * keys on.
 */
let fixtureMessageCounter = 0
const event = (
  type: 'email.opened' | 'email.clicked',
  tags: Record<string, string>,
) => ({
  type,
  data: {
    email_id: `email_${(fixtureMessageCounter += 1)}`,
    to: [RECIPIENT],
    tags,
  },
})

const TAGS = { hostId: HOST, campaignId: CAMPAIGN }

let errors: unknown[][] = []

beforeEach(() => {
  docs.clear()
  recordedDeliveryEvents.length = 0
  recordedEngagement.length = 0
  recordedTouches.length = 0
  fixtureMessageCounter = 0
  mockFirstOfType = true
  updateFailure = null
  reputationFailures.length = 0
  errors = []
  jest.spyOn(console, 'error').mockImplementation((...args) => {
    errors.push(args)
  })
  process.env.RESEND_WEBHOOK_SECRET = SECRET
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// The defect: a deleted campaign must stay deleted
// ---------------------------------------------------------------------------

describe('a Resend event against a campaign that no longer exists', () => {
  it('does not re-create it', async () => {
    const result = await deliver(event('email.opened', TAGS))

    expect(docs.has(CAMPAIGN_PATH)).toBe(false)
    expect(result.status).toBe(200)
  })

  it('stays refused however many opens trail the send', async () => {
    // The half of the defect that made it unfixable by hand: deleting the
    // resurrected document again did not help, because the next open put it
    // straight back.
    await deliver(event('email.opened', TAGS))
    await deliver(event('email.opened', TAGS))
    await deliver(event('email.clicked', TAGS))

    expect(docs.has(CAMPAIGN_PATH)).toBe(false)
  })

  it('is not reported as an error — a deleted campaign is not an outage', async () => {
    await deliver(event('email.opened', TAGS))

    expect(errors).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The trap a mechanical fix falls into
// ---------------------------------------------------------------------------

describe('the counter the event does not touch', () => {
  it('keeps `clicks` when an open lands', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(event('email.opened', TAGS))

    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({
      opens: 3,
      clicks: 5,
      uniqueOpens: 1,
    })
  })

  it('keeps `opens` when a click lands', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(event('email.clicked', TAGS))

    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({
      opens: 2,
      clicks: 6,
      uniqueClicks: 1,
    })
  })

  it('leaves every other field of the campaign alone', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(event('email.opened', TAGS))

    const stored = docs.get(CAMPAIGN_PATH) as Record<string, unknown>
    expect(stored.subject).toBe('Spring sale')
    expect(stored.body).toBe('Ends Sunday')
    expect(stored.audience).toBe('leads')
    expect(stored.status).toBe('sent')
    expect(stored.sentAtMs).toBe(1799000000000)
    expect(stored.recipients).toBe(40)
  })

  it('starts the counter from nothing on a campaign with no stats yet', async () => {
    const noStats: Record<string, unknown> = { ...REAL_CAMPAIGN }
    delete noStats.stats
    docs.set(CAMPAIGN_PATH, noStats)

    await deliver(event('email.clicked', TAGS))

    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({
      clicks: 1,
      uniqueClicks: 1,
    })
  })
})

// ---------------------------------------------------------------------------
// The tags are path components, not opaque ids
// ---------------------------------------------------------------------------

describe('a tag that names a path rather than an id', () => {
  it('writes nothing for a nested `hostId`', async () => {
    const result = await deliver(
      event('email.opened', { hostId: 'a/b/c', campaignId: CAMPAIGN }),
    )

    expect(writtenPaths()).toEqual([])
    expect(result.body).toEqual({ ignored: true })
  })

  it('writes nothing for a nested `campaignId`', async () => {
    const result = await deliver(
      event('email.opened', { hostId: HOST, campaignId: 'a/b/c' }),
    )

    expect(writtenPaths()).toEqual([])
    expect(result.body).toEqual({ ignored: true })
  })

  it('refuses an even-component id instead of throwing through the handler', async () => {
    // `.doc('a/b')` throws SYNCHRONOUSLY. Here that landed in the handler's
    // own `try` and became a logged 200, so it was survivable — but it is a
    // parse error dressed up as an outage.
    const result = await deliver(
      event('email.opened', { hostId: 'a/b', campaignId: CAMPAIGN }),
    )

    expect(result.body).toEqual({ ignored: true })
    expect(errors).toEqual([])
  })

  it('refuses a reserved `__…__` id rather than logging INVALID_ARGUMENT', async () => {
    const result = await deliver(
      event('email.opened', { hostId: HOST, campaignId: '__missing__' }),
    )

    expect(result.body).toEqual({ ignored: true })
    expect(errors).toEqual([])
  })

  it.each([
    ['a traversal id', '.'],
    ['a double-dot id', '..'],
    ['an oversized id', 'x'.repeat(1501)],
  ])('refuses %s', async (_label, campaignId) => {
    const result = await deliver(
      event('email.opened', { hostId: HOST, campaignId }),
    )

    expect(writtenPaths()).toEqual([])
    expect(result.body).toEqual({ ignored: true })
  })
})

// ---------------------------------------------------------------------------
// A real failure must stay visible
// ---------------------------------------------------------------------------

describe('a genuine Firestore failure', () => {
  it('is logged rather than swallowed', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })
    const outage: Error & { code?: number } = new Error('INTERNAL')
    outage.code = 13
    updateFailure = outage

    const result = await deliver(event('email.opened', TAGS))

    expect(errors).toHaveLength(1)
    // Resend still must not retry-storm.
    expect(result.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Experiment conversions
// ---------------------------------------------------------------------------

/** An experiment whose assignment is forced, so the spec picks the variant. */
const experimentDoc = (variantId: string) => ({
  name: 'Subject test',
  status: 'done',
  target: 'email',
  winnerVariantId: variantId,
  variants: [
    { id: variantId, subject: 'A' },
    { id: 'other', subject: 'B' },
  ],
})

describe('experiment conversion', () => {
  it('records the click on the assigned variant', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })
    docs.set(EXPERIMENT_PATH, experimentDoc('variant-a'))

    await deliver(event('email.clicked', { ...TAGS, experimentId: EXPERIMENT }))

    expect(docs.get(`${EXPERIMENT_PATH}/stats/variant-a`)).toEqual({
      conversions: 1,
      updatedAt: SERVER_TIME,
    })
  })

  it('still records it when the campaign has been deleted', async () => {
    // The refusal must not cost the conversion: the click really happened,
    // and the experiment is a separate record from the campaign.
    docs.set(EXPERIMENT_PATH, experimentDoc('variant-a'))

    await deliver(event('email.clicked', { ...TAGS, experimentId: EXPERIMENT }))

    expect(docs.get(`${EXPERIMENT_PATH}/stats/variant-a`)).toEqual({
      conversions: 1,
      updatedAt: SERVER_TIME,
    })
    expect(docs.has(CAMPAIGN_PATH)).toBe(false)
  })

  it('writes no stats document for a variant id that names a path', async () => {
    // `validateExperiment` checks variant ids are UNIQUE and nothing about
    // their shape, so this one is merchant-authored rather than webhook-borne
    // — the same defect class, found in the same handler.
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })
    docs.set(EXPERIMENT_PATH, experimentDoc('a/b/c'))

    await deliver(event('email.clicked', { ...TAGS, experimentId: EXPERIMENT }))

    expect(writtenPaths().filter((key) => key.includes('/stats/'))).toEqual(
      [],
    )
  })

  it('writes nothing for an experimentId that names a path', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(event('email.clicked', { ...TAGS, experimentId: 'a/b/c' }))

    // The campaign counters and the link rollup — the two writes a click
    // against a live campaign always makes. Named in full rather than
    // filtered, so a NEW write appearing here fails as itself.
    expect(writtenPaths()).toEqual([CAMPAIGN_PATH, `${CAMPAIGN_PATH}/reports/links`])
  })

  it('does not convert on an open', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })
    docs.set(EXPERIMENT_PATH, experimentDoc('variant-a'))

    await deliver(event('email.opened', { ...TAGS, experimentId: EXPERIMENT }))

    expect(docs.has(`${EXPERIMENT_PATH}/stats/variant-a`)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The gates the fix must not have bought its refusal by weakening
// ---------------------------------------------------------------------------

describe('the pre-existing gates', () => {
  it('rejects a bad signature before any write', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })
    const { res, result } = makeResponse()
    await emailEventsHandler(
      {
        method: 'POST',
        query: {},
        body: {},
        rawBody: JSON.stringify(event('email.opened', TAGS)),
        cookies: {},
        headers: {
          'svix-id': 'msg_1',
          'svix-timestamp': '1799000000',
          'svix-signature': 'v1,ZGVhZGJlZWY=',
        },
      } as any,
      res,
    )

    expect(result.status).toBe(401)
    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({ opens: 2, clicks: 5 })
  })

  it('ignores an event type no campaign counter is kept for', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    // `email.sent`, not `email.delivered`: delivered IS counted now — it is
    // the denominator every campaign rate is taken over. `sent` is the
    // provider acknowledging the handoff, which the send itself already
    // recorded, so counting it here would be a second opinion on a number
    // that is not in question.
    const result = await deliver(event('email.sent' as never, TAGS))

    expect(result.body).toEqual({ ignored: true })
    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({ opens: 2, clicks: 5 })
  })

  it('ignores an event carrying no campaign tag', async () => {
    const result = await deliver(event('email.opened', { hostId: HOST }))

    expect(result.body).toEqual({ ignored: true })
    expect(writtenPaths()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Bounces and complaints suppress the address (AGL-1918)
// ---------------------------------------------------------------------------

/**
 * The reason these are asserted against the SUPPRESSION path and not against
 * a counter: `campaign-send.ts` filters its audience by reading
 * `hosts/{hostId}/suppressions` and testing `suppressionId(email)` membership.
 * That collection is the only thing in the product that can stop a bounced or
 * complaining address being mailed again, and before this change nothing but
 * an unsubscribe CLICK ever wrote to it — the webhook answered
 * `200 {ignored:true}` and dropped the event.
 *
 * So the key is imported from `campaign-send` rather than recomputed here. A
 * local `sha256(email)` would pass while writing to a document the reader
 * never looks at, which is the failure this whole block exists to rule out.
 */
import { suppressionId } from './campaign-send'

const SUPPRESSION_PATH = `hosts/${HOST}/suppressions/${suppressionId(RECIPIENT)}`

/**
 * The PLATFORM list (AGL-2407). Keyed by the same `suppressionId` derivation,
 * which is asserted rather than assumed: two lists that disagree about which
 * document describes which person is a defect nothing would ever report.
 *
 * The writer reached from `email-events` is the REAL `suppressEmail`, imported
 * through its leaf entry point so the `@aglyn/tenant-data-admin` barrel mock
 * above does not replace it with a stub. A stub here would be a false green on
 * exactly the behaviour this issue is about.
 */
const PLATFORM_PATH = `emailSuppressions/${suppressionId(RECIPIENT)}`

/** A Resend delivery-failure payload, tagged as Aglyn tags a campaign send. */
const failure = (
  type: 'email.bounced' | 'email.complained',
  extra: Record<string, unknown> = {},
  tags: Record<string, string> = TAGS,
) => ({ type, data: { to: [RECIPIENT], tags, ...extra } })

describe('a complaint', () => {
  it('suppresses the address, on the list campaign-send reads', async () => {
    const result = await deliver(failure('email.complained'))

    expect(result.status).toBe(200)
    expect(docs.get(SUPPRESSION_PATH)).toEqual({
      email: RECIPIENT,
      reason: 'complaint',
      suppressedAt: SERVER_TIME,
      createdAt: SERVER_TIME,
    })
  })

  it('does not need a campaign tag — a suppression outlives the campaign', async () => {
    await deliver(failure('email.complained', {}, { hostId: HOST }))

    expect(docs.get(SUPPRESSION_PATH)?.reason).toBe('complaint')
  })
})

describe('the workspace a failure belongs to', () => {
  it('counts a complaint against the workspace that sent it', async () => {
    await deliver(failure('email.complained'))
    // The rate that decides whether this workspace may keep sending on the
    // shared domain. Without it one merchant's bad list is invisible until a
    // mailbox provider acts on the whole domain.
    expect(reputationFailures).toEqual([
      { orgId: `org-of-${HOST}`, kind: 'complaint' },
    ])
  })

  it('counts a permanent bounce, and not a transient one', async () => {
    await deliver(
      failure('email.bounced', {
        bounce: { type: 'Permanent', subType: 'General', message: 'no such user' },
      }),
    )
    expect(reputationFailures).toEqual([
      { orgId: `org-of-${HOST}`, kind: 'bounce' },
    ])

    reputationFailures.length = 0
    await deliver(
      failure('email.bounced', {
        bounce: { type: 'Transient', subType: 'MailboxFull', message: 'full' },
      }),
    )
    // A full mailbox is not a list-quality signal, and it does not suppress
    // either — counting it would put somebody's holiday auto-reply into a
    // rate that stops a merchant sending.
    expect(reputationFailures).toEqual([])
  })

  it('counts NOTHING against a workspace when the send named none', async () => {
    // A bounce on a password reset, an invite or a usage summary carries no
    // `hostId` tag. It still suppresses the address — that is address-level
    // truth — but it may not enter a rate that only campaigns are judged on,
    // in either direction: it can neither inflate one nor dilute one.
    await deliver(failure('email.complained', {}, { context: 'password-reset' }))
    expect(docs.get(PLATFORM_PATH)?.reason).toBe('complaint')
    expect(reputationFailures).toEqual([])
  })
})

describe('a bounce', () => {
  it('suppresses when the bounce is permanent', async () => {
    await deliver(
      failure('email.bounced', {
        bounce: { type: 'Permanent', subType: 'General', message: 'no such user' },
      }),
    )

    expect(docs.get(SUPPRESSION_PATH)).toEqual({
      email: RECIPIENT,
      reason: 'bounce',
      suppressedAt: SERVER_TIME,
      createdAt: SERVER_TIME,
    })
  })

  it('does NOT suppress a transient bounce', async () => {
    // A full mailbox or a greylisting server. Suppressing here would
    // unsubscribe a real subscriber over a temporary condition at their
    // provider — a customer's list destroyed by our error handling.
    const result = await deliver(
      failure('email.bounced', {
        bounce: { type: 'Transient', subType: 'MailboxFull' },
      }),
    )

    expect(result.body).toEqual({ ok: true, suppressed: false })
    expect(docs.has(SUPPRESSION_PATH)).toBe(false)
  })

  it('does NOT suppress when the payload carries no bounce type', async () => {
    // Guessing in the suppressing direction is the destructive guess. This
    // assertion is also the tripwire on the payload shape: if Resend renames
    // `data.bounce.type`, the permanent-bounce test above goes red rather
    // than this one silently becoming the only behaviour.
    await deliver(failure('email.bounced'))

    expect(docs.has(SUPPRESSION_PATH)).toBe(false)
  })
})

/**
 * TRANSACTIONAL DELIVERY FAILURES (AGL-2407).
 *
 * This block used to assert the opposite: "ignores an event with no host tag",
 * `{ignored: true}`, nothing written. That WAS the shipped behaviour and it
 * was the defect. Only `campaign-send.ts` ever stamped a `hostId` tag, so
 * every bounce on an invite, a password reset, a verification, a receipt, a
 * booking confirmation or the monthly usage summary failed that gate and was
 * acknowledged-and-dropped — the address re-mailed on every subsequent send,
 * forever, on the same Resend key and the same From address as the campaigns.
 */
describe('a delivery failure with no site to attribute it to', () => {
  it('files a PLATFORM suppression instead of dropping it', async () => {
    const result = await deliver(
      failure(
        'email.bounced',
        { bounce: { type: 'Permanent' } },
        { context: 'invite' },
      ),
    )

    expect(result.body).toMatchObject({ suppressed: true, scope: 'platform' })
    expect(docs.get(PLATFORM_PATH)).toMatchObject({
      email: RECIPIENT,
      reason: 'bounce',
      // Which of our senders produced the address that died. `sendEmail`
      // stamps this on every send now, which is what makes an untagged
      // transactional bounce placeable at all.
      context: 'invite',
      hostId: null,
      releasedAt: null,
    })
    // And no per-host document was invented for a site that was never named.
    expect(writtenPaths()).toEqual([PLATFORM_PATH])
  })

  it('files a platform complaint too', async () => {
    // A complaint about mail from `noreply@aglyn.com` is a reason not to send
    // more BULK mail from `noreply@aglyn.com`, whichever sender it came from.
    await deliver(failure('email.complained', {}, { context: 'usage-summary' }))

    expect(docs.get(PLATFORM_PATH)).toMatchObject({ reason: 'complaint' })
  })

  it('still does NOT suppress a transient bounce', async () => {
    // The rule that protects a real subscriber from a full mailbox did not
    // move when the destination did.
    const result = await deliver(
      failure('email.bounced', { bounce: { type: 'Transient' } }, {}),
    )

    expect(result.body).toEqual({ ok: true, suppressed: false })
    expect(writtenPaths()).toEqual([])
  })

  it('ignores an event with no recipient', async () => {
    // Nothing to key a suppression on. Unchanged, and the negative control
    // for the block above: "writes something for every failure" would be a
    // different bug.
    const result = await deliver({
      type: 'email.complained',
      data: { tags: TAGS },
    })

    expect(result.body).toEqual({ ignored: true })
    expect(writtenPaths()).toEqual([])
  })

  it('writes NO platform record for a hostId that names a path', async () => {
    // `isDocumentId` still rejects a path-shaped tag, and the failure path
    // now treats that as "no host" rather than as "ignore the event" — so the
    // platform record lands and no `hosts/a/b/c/...` document is created.
    await deliver(
      failure(
        'email.bounced',
        { bounce: { type: 'Permanent' } },
        { hostId: 'host-1/campaigns/evil' },
      ),
    )

    expect(writtenPaths()).toEqual([PLATFORM_PATH])
    expect(docs.get(PLATFORM_PATH)?.['hostId']).toBeNull()
  })
})

describe('a delivery failure that DOES name a site', () => {
  it('files BOTH lists — the merchant’s and the platform’s', async () => {
    // A hard bounce is address-level truth: the mailbox does not exist for
    // anyone, so it belongs on the platform list even though a site was
    // named. The per-host copy is what `campaign-send` filters its audience
    // against and what the merchant can see and undo.
    const result = await deliver(
      failure('email.bounced', { bounce: { type: 'Permanent' } }),
    )

    expect(result.body).toMatchObject({ scope: 'host' })
    expect(docs.get(SUPPRESSION_PATH)?.['reason']).toBe('bounce')
    expect(docs.get(PLATFORM_PATH)).toMatchObject({
      reason: 'bounce',
      hostId: HOST,
    })
  })
})

describe('a bounce arriving after an unsubscribe', () => {
  it('keeps the date the person actually unsubscribed', async () => {
    // The unsubscribe handler's shape, written first.
    docs.set(SUPPRESSION_PATH, {
      email: RECIPIENT,
      createdAt: '2026-08-01T00:00:00.000Z',
    })

    await deliver(
      failure('email.bounced', { bounce: { type: 'Permanent' } }),
    )

    const entry = docs.get(SUPPRESSION_PATH)
    expect(entry?.createdAt).toBe('2026-08-01T00:00:00.000Z')
    expect(entry?.reason).toBe('bounce')
    expect(entry?.suppressedAt).toBe(SERVER_TIME)
  })
})

describe('the open and click path is unchanged', () => {
  // Anti-vacuity for the block above: the new branch must not have swallowed
  // the events this handler already served.
  it('still counts an open against a live campaign', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(event('email.opened', TAGS))

    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({
      opens: 3,
      clicks: 5,
      uniqueOpens: 1,
    })
    expect(docs.has(SUPPRESSION_PATH)).toBe(false)
  })
})

/*==========================================
 * THE REPLAY GUARD.
 *
 * Delivery is at least once and the counters are `increment(1)`, so the same
 * event arriving twice used to mean two opens. A provider retry, a retry
 * after a non-2xx, and a human pressing Replay in the dashboard all put the
 * SAME message id back on the wire — which is what these deliver.
 *=========================================*/
describe('the same delivery event arriving twice', () => {
  it('counts it once, however many times it is replayed', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    const first = await deliver(event('email.opened', TAGS))
    await deliver(event('email.opened', TAGS), { replayOf: first.messageId })
    await deliver(event('email.opened', TAGS), { replayOf: first.messageId })

    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({
      opens: 3,
      clicks: 5,
      uniqueOpens: 1,
    })
  })

  it('says so rather than reporting a count it did not make', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    const first = await deliver(event('email.opened', TAGS))
    const again = await deliver(event('email.opened', TAGS), {
      replayOf: first.messageId,
    })

    // 200, because a replay is not an error and must not provoke a retry.
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ counted: false })
  })

  /**
   * ANTI-VACUITY. Without this, a guard that refused EVERY event would pass
   * both cases above — two distinct events are exactly what must still count
   * twice, and they are the common case.
   */
  it('CONTROL — two DIFFERENT events still count twice', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(event('email.opened', TAGS))
    await deliver(event('email.opened', TAGS))

    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({
      opens: 4,
      clicks: 5,
      uniqueOpens: 2,
    })
  })

  /**
   * THE CLAIM IS THE MESSAGE ID, and nothing else about the payload.
   *
   * So a redelivery whose body has been changed — a different event type in
   * this case — is still refused, because the id says it is the same
   * delivery. That is the right direction for a counter: the provider mints
   * one id per event, two types can never legitimately share one, and if they
   * ever did, believing the id over the body under-counts rather than
   * inflates.
   *
   * Stated as a test because it is genuinely surprising if you assume the
   * digest covers the payload, and someone widening the guard later needs to
   * know the payload was never in it.
   */
  it('refuses a redelivery on the message id alone, not the payload', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    const first = await deliver(event('email.opened', TAGS))
    await deliver(event('email.clicked', TAGS), { replayOf: first.messageId })

    // The click did NOT count: same id, therefore the same delivery.
    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({
      opens: 3,
      clicks: 5,
      uniqueOpens: 1,
    })
  })

  /**
   * THE RELEASE PATH. A counter write that fails must hand the key back, or
   * the event becomes permanently uncountable: the handler answers 200
   * whatever happens, so the provider never retries, and a settled claim
   * would then refuse the manual replay that is the only way left to recover
   * it. Failing and then refusing the retry is worse than either alone.
   */
  it('lets a replay count an event whose first attempt failed', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })
    const outage: Error & { code?: number } = new Error('INTERNAL')
    outage.code = 13
    updateFailure = outage

    const first = await deliver(event('email.opened', TAGS))
    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({ opens: 2, clicks: 5 })

    updateFailure = undefined
    await deliver(event('email.opened', TAGS), { replayOf: first.messageId })

    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({
      opens: 3,
      clicks: 5,
      uniqueOpens: 1,
    })
  })

  /**
   * The experiment conversion is the SECOND `increment(1)` behind the same
   * claim, and it would double just as quietly.
   */
  it('does not double an experiment conversion on a replay', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })
    docs.set(EXPERIMENT_PATH, experimentDoc('variant-a'))

    const first = await deliver(
      event('email.clicked', { ...TAGS, experimentId: EXPERIMENT }),
    )
    await deliver(event('email.clicked', { ...TAGS, experimentId: EXPERIMENT }), {
      replayOf: first.messageId,
    })

    expect(docs.get(`${EXPERIMENT_PATH}/stats/variant-a`)).toEqual({
      conversions: 1,
      updatedAt: SERVER_TIME,
    })
  })

  /**
   * The delivery log is deliberately OUTSIDE the guard: it keys by the
   * provider's message id and merges, so replaying refreshes a row rather
   * than adding one — and a row whose first write failed should get another
   * chance. A guard that covered it would make that unrecoverable.
   */
  it('still runs the delivery log on a replay', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })
    const payload = {
      type: 'email.opened',
      data: { email_id: 'msg_log', to: [RECIPIENT], tags: TAGS },
    }

    const first = await deliver(payload)
    await deliver(payload, { replayOf: first.messageId })

    // TWICE for the log — it keys by the provider's message id and merges, so
    // the second pass refreshes the row rather than adding one, and a row
    // whose first write failed gets another chance.
    expect(recordedDeliveryEvents.flat()).toHaveLength(2)
    // ONCE for each counter, in the same pair of deliveries. `uniqueOpens`
    // rides the same replay guard as `opens` and is asserted beside it,
    // because a distinct-reader count that double-counted a replay would be
    // the same defect one field over.
    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({
      opens: 3,
      clicks: 5,
      uniqueOpens: 1,
    })
  })
})

/*==========================================
 * THE PER-RECIPIENT DELIVERY LOG.
 *
 * A different audience from everything above. The campaign statistics answer
 * "how did this send perform"; the log answers "did THIS person get their
 * invite" — which is a support question, and the events it needs are exactly
 * the ones the campaign path has no use for and returns `ignored: true` on.
 *=========================================*/
describe('the delivery log', () => {
  it('records a send that carries no campaign at all', async () => {
    const result = await deliver({
      type: 'email.sent',
      data: {
        email_id: 'msg_sent_1',
        to: [RECIPIENT],
        subject: 'Confirm your email address',
        tags: [{ name: 'context', value: 'email-verification' }],
      },
    })

    // `ignored: true` is about the CAMPAIGN stats. The log took it anyway,
    // which is the whole point — a verification email has no campaign and is
    // the mail support is most often asked about.
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ignored: true })
    expect(recordedDeliveryEvents).toHaveLength(1)
    expect(recordedDeliveryEvents[0]).toEqual([
      expect.objectContaining({
        type: 'sent',
        to: RECIPIENT,
        subject: 'Confirm your email address',
        context: 'email-verification',
        providerMessageId: 'msg_sent_1',
      }),
    ])
  })

  it('records the lifecycle states the campaign path never sees', async () => {
    for (const type of ['email.delivered', 'email.delivery_delayed', 'email.failed']) {
      await deliver({
        type,
        data: { email_id: 'msg_2', to: [RECIPIENT], subject: 'Receipt' },
      })
    }

    expect(recordedDeliveryEvents.flat().map((e: any) => e.type)).toEqual([
      'delivered',
      'delayed',
      'failed',
    ])
  })

  it('records an open alongside the campaign stats rather than instead of them', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver({
      type: 'email.opened',
      data: { email_id: 'msg_3', to: [RECIPIENT], tags: TAGS },
    })

    // Both, not either: the campaign counter and the per-person row are
    // different questions and a regression in one must not look like the
    // other still working.
    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({
      opens: 3,
      clicks: 5,
      uniqueOpens: 1,
    })
    expect(recordedDeliveryEvents.flat()).toHaveLength(1)
  })

  it('records nothing for an event that is not about a message', async () => {
    await deliver({ type: 'contact.created', data: { id: 'contact_1' } })
    expect(recordedDeliveryEvents.flat()).toHaveLength(0)
  })

  it('is never consulted on an unsigned request', async () => {
    const { res, result } = makeResponse()
    await emailEventsHandler(
      {
        method: 'POST',
        query: {},
        body: {},
        rawBody: JSON.stringify({ type: 'email.sent' }),
        cookies: {},
        headers: { 'svix-id': 'x', 'svix-timestamp': '1', 'svix-signature': 'v1,bad' },
      } as any,
      res,
    )

    // The signature check stands in front of the log, so a forged payload
    // cannot write a row into a person's support history.
    expect(result.status).toBe(401)
    expect(recordedDeliveryEvents).toHaveLength(0)
  })
})

/*==========================================
 * THE DENOMINATOR, AND THE COUNTERS THE REPORT DIVIDES.
 *
 * Every rate on the campaign report is taken over `delivered` or `sent`, and
 * `delivered` did not exist: `email.delivered` was answered
 * `200 {ignored:true}`. These are the writes that produce it, and the
 * property each of them has to have is that a REPLAY contributes nothing —
 * a webhook is at-least-once, and a counter that inflates is worse than one
 * that is absent, because the absent one is visibly absent.
 *
 * The idempotency here is NOT the `apiIdempotency` claim. It is `firstOfType`
 * off the delivery log's own transaction: a second `delivered` for the same
 * MESSAGE finds the state recorded and reports false. That is why
 * `mockFirstOfType` is set explicitly in each of these rather than left at
 * its default — a stub that always said `true` would let a broken counter
 * pass, and one that always said `false` would let a counter that never fired
 * pass.
 *=========================================*/

/** A payload for any delivery event type, with the tags a campaign stamps. */
const deliveryEvent = (
  type: string,
  extra: Record<string, unknown> = {},
  tags: Record<string, string> = TAGS,
) => ({
  type,
  data: {
    email_id: `email_${(fixtureMessageCounter += 1)}`,
    to: [RECIPIENT],
    tags,
    ...extra,
  },
})

describe('the delivered counter — the denominator every rate needs', () => {
  it('counts a delivery against the campaign', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(deliveryEvent('email.delivered'))

    expect((docs.get(CAMPAIGN_PATH)?.stats as any).delivered).toBe(1)
  })

  it('does NOT count a second delivery event for the same message', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(deliveryEvent('email.delivered'))
    // The delivery log has already recorded a `delivered` for this message,
    // so it reports the second one as not-first — which is exactly what a
    // provider retry or a dashboard replay looks like from here.
    mockFirstOfType = false
    await deliver(deliveryEvent('email.delivered'))

    expect((docs.get(CAMPAIGN_PATH)?.stats as any).delivered).toBe(1)
  })

  it('CONTROL: two deliveries to two DIFFERENT recipients both count', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(deliveryEvent('email.delivered'))
    await deliver(deliveryEvent('email.delivered'))

    expect((docs.get(CAMPAIGN_PATH)?.stats as any).delivered).toBe(2)
  })

  it('does not re-create a campaign the merchant deleted', async () => {
    await deliver(deliveryEvent('email.delivered'))

    expect(docs.has(CAMPAIGN_PATH)).toBe(false)
  })

  it('ignores a delivery that names no campaign', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(deliveryEvent('email.delivered', {}, { hostId: HOST }))

    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({ opens: 2, clicks: 5 })
  })

  it('still records the per-recipient delivery row either way', async () => {
    await deliver(deliveryEvent('email.delivered', {}, { hostId: HOST }))

    expect(recordedDeliveryEvents.flat()).toHaveLength(1)
  })
})

describe('the bounce and complaint counters', () => {
  it('counts a bounce against the campaign AND still suppresses', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(
      deliveryEvent('email.bounced', { bounce: { type: 'Permanent' } }),
    )

    expect((docs.get(CAMPAIGN_PATH)?.stats as any).bounced).toBe(1)
    expect(
      docs.get(`hosts/${HOST}/suppressions/${suppressionId(RECIPIENT)}`),
    ).toMatchObject({ reason: 'bounce' })
  })

  /*
   * A TRANSIENT bounce is counted and deliberately not suppressed. The
   * campaign's bounce rate is a fact about the send — a full mailbox really
   * did refuse the message — while suppression is a decision about whether to
   * mail the person again, and those are different questions. Counting only
   * the suppressing half would under-report a bounce rate on exactly the
   * campaigns where it matters.
   */
  it('counts a transient bounce without suppressing the address', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(
      deliveryEvent('email.bounced', { bounce: { type: 'Transient' } }),
    )

    expect((docs.get(CAMPAIGN_PATH)?.stats as any).bounced).toBe(1)
    expect(
      docs.has(`hosts/${HOST}/suppressions/${suppressionId(RECIPIENT)}`),
    ).toBe(false)
  })

  it('counts a complaint against the campaign', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(deliveryEvent('email.complained'))

    expect((docs.get(CAMPAIGN_PATH)?.stats as any).complained).toBe(1)
  })

  it('does not count the same bounce twice', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(
      deliveryEvent('email.bounced', { bounce: { type: 'Permanent' } }),
    )
    mockFirstOfType = false
    await deliver(
      deliveryEvent('email.bounced', { bounce: { type: 'Permanent' } }),
    )

    expect((docs.get(CAMPAIGN_PATH)?.stats as any).bounced).toBe(1)
  })

  /*
   * THE ORDERING THAT MATTERS. A statistic must never be able to cost a
   * suppression: the suppression is what stops us mailing a dead or hostile
   * address again, and the counter is a number on a report.
   */
  it('suppresses even when the campaign counter fails', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })
    updateFailure = new Error('firestore is unavailable')

    await deliver(
      deliveryEvent('email.bounced', { bounce: { type: 'Permanent' } }),
    )

    expect(
      docs.get(`hosts/${HOST}/suppressions/${suppressionId(RECIPIENT)}`),
    ).toMatchObject({ reason: 'bounce' })
    expect(docs.get('emailSuppressions/' + suppressionId(RECIPIENT))).toBeDefined()
  })
})

describe('unique opens and clicks — the numerator a rate can use', () => {
  it('counts a distinct reader beside the raw event count', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(event('email.opened', TAGS))

    const stats = docs.get(CAMPAIGN_PATH)?.stats as any
    expect(stats.opens).toBe(3)
    expect(stats.uniqueOpens).toBe(1)
  })

  /*
   * The two counters diverging is the whole point of having both: a second
   * open by the SAME reader is another open event and not another reader, and
   * an open rate built on the event count would exceed 100% on any campaign
   * whose audience re-reads it.
   */
  it('counts a second open by the same reader as an event, not a reader', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(event('email.opened', TAGS))
    mockFirstOfType = false
    await deliver(event('email.opened', TAGS))

    const stats = docs.get(CAMPAIGN_PATH)?.stats as any
    expect(stats.opens).toBe(4)
    expect(stats.uniqueOpens).toBe(1)
  })

  it('does the same for clicks', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(event('email.clicked', TAGS))
    mockFirstOfType = false
    await deliver(event('email.clicked', TAGS))

    const stats = docs.get(CAMPAIGN_PATH)?.stats as any
    expect(stats.clicks).toBe(7)
    expect(stats.uniqueClicks).toBe(1)
  })
})

/*==========================================
 * LINK-LEVEL CLICKS.
 *
 * `data.click.link` IS on Resend's payload and has been normalized for a
 * while; what did not exist was a per-campaign aggregate. These assert the
 * rollup document the report reads — one document, whatever the campaign's
 * size, because the alternative is querying every recipient's delivery row.
 *=========================================*/

const LINKS_PATH = `${CAMPAIGN_PATH}/reports/links`

const clickOn = (link: string | undefined) =>
  deliveryEvent('email.clicked', link === undefined ? {} : { click: { link } })

const linkRows = () =>
  Object.values(((docs.get(LINKS_PATH) as any)?.links ?? {}) as Record<
    string,
    { url: string; clicks: number }
  >)

/*==========================================
 * THE TOUCH REVENUE ATTRIBUTION IS TAKEN OVER.
 *
 * The webhook's half of the commerce↔email join: a click, and only a click,
 * writes down which campaign this person last engaged with, so an order
 * placed later can find it with one keyed read instead of a scan over every
 * message ever sent to them.
 *=========================================*/
describe('the campaign touch', () => {
  it('records a click against the campaign and the site that sent it', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(clickOn('https://shop.example/sale'))

    expect(recordedTouches).toEqual([
      expect.objectContaining({
        email: RECIPIENT,
        hostId: HOST,
        campaignId: CAMPAIGN,
      }),
    ])
  })

  it('does NOT record an open as a touch', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(deliveryEvent('email.opened'))

    // Since Mail Privacy Protection an open is substantially a statement
    // about the recipient's mail client. Crediting money to one would hand a
    // campaign the orders of people who never read it.
    expect(recordedTouches).toEqual([])
  })

  it('does not record a bounce, a complaint or a delivery as a touch', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(deliveryEvent('email.delivered'))
    await deliver(deliveryEvent('email.bounced'))
    await deliver(deliveryEvent('email.complained'))

    expect(recordedTouches).toEqual([])
  })

  it('takes the provider’s instant for the click, not the moment we heard', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(clickOn('https://shop.example/sale'))

    // A delayed webhook must credit the click at the time it happened: for a
    // click near the edge of the window that is the difference between inside
    // and outside it. The outcome carries the normalized provider time.
    const outcomes = recordedDeliveryEvents.at(-1) as any[]
    expect((recordedTouches[0] as any).atMs).toBe(outcomes[0].at)
  })

  it('records nothing for a click that names no campaign', async () => {
    // A receipt or a password reset carries no campaign tag. There is nothing
    // to credit, and a touch naming no campaign would sit in the map blocking
    // one that does.
    await deliver(
      deliveryEvent('email.clicked', { click: { link: 'https://x.example' } }, {}),
    )

    expect(recordedTouches).toEqual([])
  })
})

describe('the per-campaign link rollup', () => {
  it('counts a click against its destination', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(clickOn('https://shop.example/sale'))

    expect(linkRows()).toEqual([
      { url: 'https://shop.example/sale', clicks: 1 },
    ])
  })

  it('keeps two destinations apart and adds up repeats', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(clickOn('https://shop.example/sale'))
    await deliver(clickOn('https://shop.example/sale'))
    await deliver(clickOn('https://shop.example/new'))

    expect(
      linkRows().sort((a, b) => b.clicks - a.clicks),
    ).toEqual([
      { url: 'https://shop.example/sale', clicks: 2 },
      { url: 'https://shop.example/new', clicks: 1 },
    ])
  })

  /*
   * The normalisation, proven at the write rather than only in the pure
   * model: a campaign body is merge-tagged per recipient, so a personalised
   * query would otherwise mint one row per RECIPIENT — an aggregate that is
   * no longer an aggregate, and a document that grows without bound.
   */
  it('folds a per-recipient query string onto one row', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(clickOn('https://shop.example/sale?u=alice@example.com'))
    await deliver(clickOn('https://shop.example/sale?u=bob@example.com'))

    expect(linkRows()).toEqual([
      { url: 'https://shop.example/sale', clicks: 2 },
    ])
  })

  it('records a click with no destination as unattributed, not as a row', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(clickOn(undefined))

    expect(linkRows()).toEqual([])
    expect((docs.get(LINKS_PATH) as any).unattributedClicks).toBe(1)
  })

  /*
   * Past the cap the click is COUNTED, not dropped. The table's own total
   * plus the overflow reconciles with `stats.clicks`, so a merchant reading
   * both can see where the difference went — a silently dropped click leaves
   * two numbers that disagree with no explanation.
   */
  it('counts a click past the cap as overflow rather than dropping it', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })
    for (let index = 0; index < CAMPAIGN_LINK_ROLLUP_MAX; index += 1) {
      await deliver(clickOn(`https://shop.example/p/${index}`))
    }

    await deliver(clickOn('https://shop.example/one-too-many'))

    expect(linkRows()).toHaveLength(CAMPAIGN_LINK_ROLLUP_MAX)
    expect((docs.get(LINKS_PATH) as any).overflowClicks).toBe(1)
  })

  it('still counts a repeat of a link already in the map once the cap is full', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })
    for (let index = 0; index < CAMPAIGN_LINK_ROLLUP_MAX; index += 1) {
      await deliver(clickOn(`https://shop.example/p/${index}`))
    }

    await deliver(clickOn('https://shop.example/p/0'))

    expect(
      linkRows().find((row) => row.url === 'https://shop.example/p/0'),
    ).toEqual({ url: 'https://shop.example/p/0', clicks: 2 })
    expect((docs.get(LINKS_PATH) as any).overflowClicks).toBeUndefined()
  })

  it('does not count a replayed click twice', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })
    const payload = clickOn('https://shop.example/sale')

    const first = await deliver(payload)
    await deliver(payload, { replayOf: first.messageId })

    expect(linkRows()).toEqual([
      { url: 'https://shop.example/sale', clicks: 1 },
    ])
  })

  it('writes no rollup for a campaign the merchant deleted', async () => {
    await deliver(clickOn('https://shop.example/sale'))

    expect(docs.has(LINKS_PATH)).toBe(false)
  })

  it('does not build a rollup out of an open', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(event('email.opened', TAGS))

    expect(docs.has(LINKS_PATH)).toBe(false)
  })
})

/*==========================================
 * THE PER-PERSON ENGAGEMENT ROLLUP.
 *
 * What only this file can prove is WHERE the handler asks for it and WHAT it
 * hands over. The rollup's own arithmetic — that it moves forward only, and
 * that a `firstOfType: false` outcome writes nothing — is asserted against a
 * Firestore double in `tenant-data-admin`.
 *=========================================*/

describe('the person rollup', () => {
  /**
   * ⚠️ THE PROPERTY THAT MAKES A REPLAY FREE.
   *
   * The handler passes the delivery log's OWN verdict through untouched. A
   * handler that re-derived `firstOfType`, or that passed a hard-coded
   * `true`, would advance a person's stamp on every redelivered event — and
   * for a counted rollup it would inflate one.
   */
  it('is handed the delivery log’s verdict rather than a re-derived one', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(event('email.clicked', TAGS))

    expect(recordedEngagement).toHaveLength(1)
    expect(recordedEngagement[0]).toEqual([
      expect.objectContaining({
        firstOfType: true,
        to: RECIPIENT,
        type: 'clicked',
      }),
    ])
  })

  it('passes a repeat event through as not-first, not as first', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })
    mockFirstOfType = false

    await deliver(event('email.opened', TAGS))

    expect(recordedEngagement[0]).toEqual([
      expect.objectContaining({ firstOfType: false }),
    ])
  })

  /**
   * ABOVE THE CAMPAIGN GATES.
   *
   * Engagement is a fact about the PERSON, and the message they engaged with
   * does not have to be a campaign for it to be one — somebody who clicks a
   * receipt is reading our mail. A rollup below the `hostId`/`campaignId`
   * gate would record engagement for campaign mail only, and then let a
   * sunset refuse people on the strength of a fraction of the evidence.
   */
  it('records an open on mail that carries no campaign tag at all', async () => {
    const result = await deliver(event('email.opened', {}))

    expect(result.body).toMatchObject({ ignored: true })
    expect(recordedEngagement[0]).toEqual([
      expect.objectContaining({ to: RECIPIENT, type: 'opened' }),
    ])
  })

  /*
   * And above the type gate: a `sent` or `delivered` event reaches the rollup
   * too, which is what lets the rollup rather than the handler decide which
   * event types count as engagement. One list of engagement types, in the
   * module that owns the store.
   */
  it('is asked about every event type, and decides nothing itself', async () => {
    await deliver({ type: 'email.sent', data: { email_id: 'e1', to: [RECIPIENT] } })

    expect(recordedEngagement).toHaveLength(1)
  })

  it('cannot cost the campaign counters anything when it fails', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })
    const rollup = jest.requireMock(
      '@aglyn/tenant-data-admin/server/email-delivery-log',
    ).recordPersonEngagement as jest.Mock
    rollup.mockRejectedValueOnce(new Error('rollup is down'))

    const result = await deliver(event('email.opened', TAGS))

    expect(result.body).toMatchObject({ ok: true })
    expect((docs.get(CAMPAIGN_PATH) as any).stats.opens).toBe(3)
  })
})
