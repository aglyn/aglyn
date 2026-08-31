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
 * Adding a suppression by hand.
 *
 * WHAT THIS FILE HAS TO CATCH, in the order the failures would hurt:
 *
 *  1. **THE KEY.** An entry filed under anything other than
 *     `sha256(trimmed, lowercased address)` is invisible to the send path,
 *     and the merchant has been told the person is suppressed. The assertion
 *     is the document ID, computed independently here, and it is checked for
 *     a mixed-case address with surrounding space — the exact input a person
 *     produces by pasting one out of a reply.
 *  2. **THE ROLE.** This route writes a site's own list, so a site editor may
 *     use it. A viewer may not, and neither may somebody holding no role at
 *     all — checked in both directions, because a gate that admits everybody
 *     passes every test that only tries an admin.
 *  3. **AN EXISTING ENTRY IS NOT REWRITTEN.** A bounce that has been on the
 *     list for a month must keep its reason and its date: the reason is what
 *     the Remove confirmation warns with, and the date is what a merchant is
 *     asked for.
 *  4. **A LINE THAT IS NOT AN ADDRESS IS NAMED, not silently dropped.** The
 *     lines that fail are the people who asked to stop being emailed.
 */

const docs = new Map<string, Record<string, unknown>>()
let clock = 0

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}))

const isSentinel = (value: unknown) =>
  (value as { __serverTimestamp?: boolean })?.__serverTimestamp === true

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => ({
      exists: docs.has(path),
      data: () => docs.get(path),
      get: (field: string) => (docs.get(path) ?? {})[field],
    }),
    set: async (
      value: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      const base = options?.merge ? (docs.get(path) ?? {}) : {}
      const next: Record<string, unknown> = { ...base }
      for (const [field, raw] of Object.entries(value)) {
        // A monotonic clock rather than one constant string, so a RESTAMPED
        // `createdAt` is distinguishable from a preserved one.
        next[field] = isSentinel(raw) ? `t${(clock += 1)}` : raw
      }
      docs.set(path, next)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  return { doc: (id: string) => makeDocRef(`${path}/${id}`) }
}

let decoded: { uid: string } | Error = { uid: 'uid-editor' }

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
  // The REAL derivation. A double would let this suite certify a route that
  // files entries under a key nothing looks up — the one failure here that is
  // silent and one-directional.
  ...jest.requireActual('@aglyn/tenant-data-admin/server/email-suppression'),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => {
          if (decoded instanceof Error) throw decoded
          return decoded
        },
      }),
      firestore: () => ({ collection: (name: string) => makeCollectionRef(name) }),
    }),
  },
}))

const registered: string[] = []
jest.mock('@aglyn/aglyn/server', () => ({
  registerPluginApiRoute: (route: string) => registered.push(route),
}))

import { createHash } from 'crypto'
import {
  MANUAL_SUPPRESSION_REASON,
  SUPPRESSION_ADD_BATCH_MAX,
  emailSuppressionAddHandler,
  emailSuppressionStatusHandler,
  readSuppressionAddresses,
  registerEmailSuppressionsApi,
} from './server-suppressions'

const HOST = 'host-1'
const ADDRESS = 'dana@example.com'
const KEY = createHash('sha256').update(ADDRESS).digest('hex')
const ENTRY = `hosts/${HOST}/suppressions/${KEY}`

interface Reply {
  status: number
  body: any
}

async function callHandler(
  handler: typeof emailSuppressionAddHandler,
  body: Record<string, unknown>,
  options: { method?: string; token?: string | null } = {},
): Promise<Reply> {
  const reply: Reply = { status: 200, body: null }
  const res: any = {
    status: (code: number) => {
      reply.status = code
      return res
    },
    json: (value: unknown) => {
      reply.body = value
      return res
    },
  }
  const token = options.token === undefined ? 'id-token' : options.token
  await handler(
    {
      method: options.method ?? 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      query: {},
      body,
    } as any,
    res,
  )
  return reply
}

const status = (
  body: Record<string, unknown>,
  options?: { method?: string; token?: string | null },
) => callHandler(emailSuppressionStatusHandler, body, options)

async function call(
  body: Record<string, unknown>,
  options: { method?: string; token?: string | null } = {},
): Promise<Reply> {
  const reply: Reply = { status: 200, body: null }
  const res: any = {
    status: (code: number) => {
      reply.status = code
      return res
    },
    json: (value: unknown) => {
      reply.body = value
      return res
    },
  }
  const token = options.token === undefined ? 'id-token' : options.token
  await emailSuppressionAddHandler(
    {
      method: options.method ?? 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      query: {},
      body,
    } as any,
    res,
  )
  return reply
}

beforeEach(() => {
  docs.clear()
  clock = 0
  decoded = { uid: 'uid-editor' }
  registered.length = 0
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  docs.set(`hosts/${HOST}`, {
    memberRoles: {
      'uid-editor': 'editor',
      'uid-admin': 'admin',
      'uid-viewer': 'viewer',
    },
  })
})

afterEach(() => jest.restoreAllMocks())

describe('readSuppressionAddresses', () => {
  it('splits the ways an operator actually pastes', () => {
    expect(
      readSuppressionAddresses('a@x.co\nb@x.co, c@x.co; d@x.co'),
    ).toEqual(['a@x.co', 'b@x.co', 'c@x.co', 'd@x.co'])
  })

  it('bounds the batch', () => {
    const many = Array.from({ length: 200 }, (_x, i) => `p${i}@x.co`).join('\n')
    expect(readSuppressionAddresses(many)).toHaveLength(
      SUPPRESSION_ADD_BATCH_MAX,
    )
  })
})

describe('email/suppression-add', () => {
  it('files the entry under the key the send path looks up', async () => {
    // The mixed case and the surrounding space are the point: this is what a
    // person produces by copying an address out of a reply.
    const reply = await call({ hostId: HOST, email: '  DANA@Example.com ' })

    expect(reply.status).toBe(200)
    expect(reply.body.added).toBe(1)
    expect(docs.has(ENTRY)).toBe(true)
    // The address is stored in the clear beside its hash, so the card shows a
    // human something they can act on.
    expect(docs.get(ENTRY)).toMatchObject({
      email: ADDRESS,
      reason: MANUAL_SUPPRESSION_REASON,
      suppressedByUid: 'uid-editor',
    })
  })

  it('records the reason as its own, not as an unsubscribe', async () => {
    await call({ hostId: HOST, email: ADDRESS })
    // Saying `unsubscribe` would claim the person clicked a link they never
    // saw — and the Remove confirmation reads the reason back to whoever
    // undoes it.
    expect(docs.get(ENTRY)!.reason).not.toBe('unsubscribe')
    expect(docs.get(ENTRY)!.reason).toBe('manual')
  })

  it('keeps the note as the record that the request was honored', async () => {
    await call({ hostId: HOST, email: ADDRESS, note: 'asked by phone' })
    expect(docs.get(ENTRY)!.note).toBe('asked by phone')
  })

  it('bounds the note rather than storing whatever was pasted', async () => {
    await call({ hostId: HOST, email: ADDRESS, note: 'x'.repeat(5_000) })
    expect(String(docs.get(ENTRY)!.note)).toHaveLength(200)
  })

  it('adds several addresses from one paste', async () => {
    const reply = await call({
      hostId: HOST,
      emails: `${ADDRESS}\nsam@example.com, lee@example.com`,
    })
    expect(reply.body.added).toBe(3)
    expect(
      [...docs.keys()].filter((path) =>
        path.startsWith(`hosts/${HOST}/suppressions/`),
      ),
    ).toHaveLength(3)
  })

  it('names a line that is not an address instead of dropping it', async () => {
    // The lines that fail are people who asked to stop being emailed. A
    // count with no names leaves the operator to work out which.
    const reply = await call({
      hostId: HOST,
      emails: `${ADDRESS}\nnot an address`,
    })
    expect(reply.body.added).toBe(1)
    expect(reply.body.results).toContainEqual({
      input: 'not an address',
      email: null,
      added: false,
      refusal: 'not-an-address',
    })
  })

  it('does NOT rewrite an entry that is already there', async () => {
    docs.set(ENTRY, {
      email: ADDRESS,
      reason: 'bounce',
      createdAt: 'original',
    })

    const reply = await call({ hostId: HOST, email: ADDRESS, note: 'hi' })

    expect(reply.body.added).toBe(0)
    expect(reply.body.results[0].refusal).toBe('already-suppressed')
    // The reason is what the Remove confirmation warns with, and the date is
    // what a merchant is asked for. Relabelling a month-old bounce `manual`
    // would lose both.
    expect(docs.get(ENTRY)).toEqual({
      email: ADDRESS,
      reason: 'bounce',
      createdAt: 'original',
    })
  })

  it('counts one person once when a paste names them twice', async () => {
    const reply = await call({
      hostId: HOST,
      emails: `${ADDRESS}\n DANA@Example.com `,
    })
    expect(reply.body.added).toBe(1)
    expect(reply.body.results).toHaveLength(1)
  })

  it('admits a site editor', async () => {
    decoded = { uid: 'uid-editor' }
    expect((await call({ hostId: HOST, email: ADDRESS })).status).toBe(200)
  })

  it('admits a site admin', async () => {
    decoded = { uid: 'uid-admin' }
    expect((await call({ hostId: HOST, email: ADDRESS })).status).toBe(200)
  })

  it('refuses a viewer, and writes nothing', async () => {
    decoded = { uid: 'uid-viewer' }
    const reply = await call({ hostId: HOST, email: ADDRESS })
    expect(reply.status).toBe(403)
    expect(docs.has(ENTRY)).toBe(false)
  })

  it('refuses somebody holding no role on this site at all', async () => {
    // An ALLOWLIST, not a denylist: a role union that grows must not widen
    // this route by default.
    decoded = { uid: 'uid-stranger' }
    expect((await call({ hostId: HOST, email: ADDRESS })).status).toBe(403)
    expect(docs.has(ENTRY)).toBe(false)
  })

  it('refuses an unauthenticated request', async () => {
    const reply = await call({ hostId: HOST, email: ADDRESS }, { token: null })
    expect(reply.status).toBe(401)
    expect(docs.has(ENTRY)).toBe(false)
  })

  it('refuses a site that does not exist rather than creating one', async () => {
    const reply = await call({ hostId: 'no-such-site', email: ADDRESS })
    expect(reply.status).toBe(404)
    expect(docs.has(`hosts/no-such-site`)).toBe(false)
  })

  it('refuses a GET', async () => {
    expect((await call({ hostId: HOST }, { method: 'GET' })).status).toBe(405)
  })

  it('refuses a request naming no address', async () => {
    expect((await call({ hostId: HOST, emails: '   ' })).status).toBe(400)
  })

  it('registers both routes under the email prefix', () => {
    registerEmailSuppressionsApi()
    expect(registered).toEqual([
      'email/suppression-add',
      'email/suppression-status',
    ])
  })
})

/**
 * THE PLATFORM HALF, told to the merchant.
 *
 * The two lists are consulted together at send time and were visible
 * separately, so a merchant who removed their own entry could still find the
 * address was never mailed with nothing anywhere saying why. The platform
 * entry is invisible to them and cannot be lifted by them, so it has to be
 * said before the click rather than discovered from a recipient count that
 * stays short.
 */
describe('email/suppression-status', () => {
  const PLATFORM = `emailSuppressions/${KEY}`

  it('says an address is blocked when the platform list holds it', async () => {
    docs.set(PLATFORM, { email: ADDRESS, reason: 'bounce', releasedAt: null })
    const reply = await status({ hostId: HOST, emails: ADDRESS })
    expect(reply.status).toBe(200)
    expect(reply.body.platform).toEqual([ADDRESS])
  })

  it('says an address is NOT blocked when it is not', async () => {
    // The other direction, in the same harness: a reader that answered
    // "blocked" for everything would warn on every removal and be useless.
    const reply = await status({ hostId: HOST, emails: ADDRESS })
    expect(reply.body.platform).toEqual([])
  })

  it('treats a RELEASED platform record as not blocking', async () => {
    docs.set(PLATFORM, {
      email: ADDRESS,
      reason: 'bounce',
      releasedAt: 'yes',
    })
    expect((await status({ hostId: HOST, emails: ADDRESS })).body.platform)
      .toEqual([])
  })

  it('answers per address, not for the whole request', async () => {
    docs.set(PLATFORM, { email: ADDRESS, reason: 'bounce', releasedAt: null })
    const reply = await status({
      hostId: HOST,
      emails: `${ADDRESS}\nsam@example.com`,
    })
    expect(reply.body.platform).toEqual([ADDRESS])
  })

  it('refuses a viewer', async () => {
    decoded = { uid: 'uid-viewer' }
    expect((await status({ hostId: HOST, emails: ADDRESS })).status).toBe(403)
  })

  it('refuses an unauthenticated request', async () => {
    expect(
      (await status({ hostId: HOST, emails: ADDRESS }, { token: null })).status,
    ).toBe(401)
  })

  it('refuses a GET', async () => {
    expect((await status({ hostId: HOST }, { method: 'GET' })).status).toBe(405)
  })
})
