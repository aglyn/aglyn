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
jest.mock(
  '@aglyn/tenant-data-admin/server/email-delivery-log',
  () => ({
    recordEmailDeliveryEvents: jest.fn(async (events: unknown[]) => {
      recordedDeliveryEvents.push(events)
      return events.length
    }),
  }),
)

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore }) },
  updateExisting: jest.requireActual(
    '@aglyn/tenant-data-admin/server/update-existing',
  ).updateExisting,
}))

import { emailEventsHandler } from './email-events'

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
async function deliver(event: Record<string, unknown>) {
  const rawBody = JSON.stringify(event)
  const id = 'msg_1'
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
  return result
}

/** An `email.opened`/`email.clicked` payload with the tags Aglyn stamps. */
const event = (
  type: 'email.opened' | 'email.clicked',
  tags: Record<string, string>,
) => ({ type, data: { to: [RECIPIENT], tags } })

const TAGS = { hostId: HOST, campaignId: CAMPAIGN }

let errors: unknown[][] = []

beforeEach(() => {
  docs.clear()
  recordedDeliveryEvents.length = 0
  updateFailure = null
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

    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({ opens: 3, clicks: 5 })
  })

  it('keeps `opens` when a click lands', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(event('email.clicked', TAGS))

    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({ opens: 2, clicks: 6 })
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

    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({ clicks: 1 })
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

    expect([...docs.keys()]).toEqual([])
    expect(result.body).toEqual({ ignored: true })
  })

  it('writes nothing for a nested `campaignId`', async () => {
    const result = await deliver(
      event('email.opened', { hostId: HOST, campaignId: 'a/b/c' }),
    )

    expect([...docs.keys()]).toEqual([])
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

    expect([...docs.keys()]).toEqual([])
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

    expect([...docs.keys()].filter((key) => key.includes('/stats/'))).toEqual(
      [],
    )
  })

  it('writes nothing for an experimentId that names a path', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    await deliver(event('email.clicked', { ...TAGS, experimentId: 'a/b/c' }))

    expect([...docs.keys()]).toEqual([CAMPAIGN_PATH])
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

  it('ignores an event type that is neither an open nor a click', async () => {
    docs.set(CAMPAIGN_PATH, { ...REAL_CAMPAIGN })

    const result = await deliver(event('email.delivered' as never, TAGS))

    expect(result.body).toEqual({ ignored: true })
    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({ opens: 2, clicks: 5 })
  })

  it('ignores an event carrying no campaign tag', async () => {
    const result = await deliver(event('email.opened', { hostId: HOST }))

    expect(result.body).toEqual({ ignored: true })
    expect([...docs.keys()]).toEqual([])
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
    expect([...docs.keys()]).toEqual([PLATFORM_PATH])
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
    expect([...docs.keys()]).toEqual([])
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
    expect([...docs.keys()]).toEqual([])
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

    expect([...docs.keys()]).toEqual([PLATFORM_PATH])
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

    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({ opens: 3, clicks: 5 })
    expect(docs.has(SUPPRESSION_PATH)).toBe(false)
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
    expect(docs.get(CAMPAIGN_PATH)?.stats).toEqual({ opens: 3, clicks: 5 })
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
