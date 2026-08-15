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
 * Which document paths a campaign send is allowed to name (AGL-1771).
 *
 * This is where the `campaignId` on every Resend tag is MINTED. AGL-1768
 * refused a webhook open against a campaign that no longer exists, and noted
 * that the id it receives is one an authenticated merchant chose — filled from
 * `String(req.body?.campaignId ?? '')` on the send route. This file is the
 * other end of that trace: the send route wrote the campaign document at
 * whatever path that value named.
 *
 * Assertions are made against WHICH DOCUMENT PATHS EXIST when the call
 * returns, not against the response, because a campaign filed at
 * `campaigns/a/b/c` returns exactly the same success body as one filed
 * correctly — that is the whole reason it went unnoticed.
 *
 * THE DOUBLE MODELS `.doc()`'s PATH ARITHMETIC: the argument is APPENDED as a
 * slash-separated path, refused only when the resulting component count comes
 * out odd, and that refusal is a SYNCHRONOUS throw. A double treating the
 * argument as one opaque key would file `a/b/c` at a harmless flat id and pass
 * against the broken code as happily as against the fix.
 *
 * Two corrections to the model `email-events.spec.ts` (`d51e23df4`) and
 * `cart-cookie.spec.ts` (`f053417fa`) used, measured against the installed
 * `@google-cloud/firestore` rather than reasoned about: a reserved `__…__` id
 * (and the `.`/`..` forms) does NOT throw out of `.doc()` — the client builds
 * the reference and the SERVICE answers `INVALID_ARGUMENT` when the RPC is
 * issued; and `.doc('')` DOES throw synchronously, which neither earlier
 * double modelled. The second one matters here: it is what turned this file's
 * `cancel` branch into a 500 where the code intended a 400.
 *
 * `isDocumentId` is the REAL one throughout: it lives at
 * `@aglyn/tenant-data-admin/server/document-id`, a leaf entry point this
 * file's barrel mock does not intercept.
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
      store.set(path, { ...(store.get(path) ?? {}), ...value })
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
    limit: () => ({
      get: async () => ({
        docs: [...store.keys()]
          .filter(
            (key) =>
              key.startsWith(`${path}/`) &&
              !key.slice(path.length + 1).includes('/'),
          )
          .map(snapshotOf),
      }),
    }),
    get parent() {
      return docRef(path.split('/').slice(0, -1).join('/'))
    },
  }
}

const mockFirestore = () => ({
  collection: (name: string) => collectionRef(name),
})

let mockUid = 'uid-1'

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => mockFirestore(),
      auth: () => ({ verifyIdToken: async () => ({ uid: mockUid }) }),
    }),
    firestore: {
      FieldValue: {
        increment: (value: number) => ({ increment: value }),
        serverTimestamp: () => 'server-timestamp',
      },
    },
  },
  // Starter, so the monthly campaign cap does not refuse before the write.
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'starter' } }),
  orgDataCollectionForHost: jest.fn(),
  orgDataQueryForHost: jest.fn(),
  meterHostEmail: async () => undefined,
  campaignEmailSendsForMonth: async () => 0,
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
import { campaignSendHandler, performCampaignSend } from './campaign-send'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HOST = 'host-1'

/**
 * A running email experiment whose assignment is DETERMINISTIC.
 *
 * `assignExperimentVariant` buckets on a hash of the recipient address, and a
 * winner cannot be used to force it here because the exposure write only runs
 * while the experiment is still `running`. Weighting the second variant to
 * zero is the realistic lever — a merchant who paused an arm — and leaves a
 * total weight of 1, so every recipient lands in the first.
 */
const experimentDoc = (variantId: string) => ({
  name: 'Subject test',
  status: 'running',
  target: 'email',
  variants: [
    { id: variantId, subject: 'A', weight: 1 },
    { id: 'other-variant', subject: 'B', weight: 0 },
  ],
})

function seed() {
  store.clear()
  sent.length = 0
  mockUid = 'uid-1'
  store.set(`hosts/${HOST}`, {
    subdomain: 'acme',
    memberRoles: { 'uid-1': 'admin' },
  })
  store.set(`hosts/${HOST}/leads/lead-1`, {
    email: 'dana@example.com',
    name: 'Dana Reed',
  })
}

/** Every campaign document path in the store, at any depth. */
function campaignPaths(): string[] {
  return [...store.keys()].filter((key) => key.includes('/campaigns/')).sort()
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

const send = (options: Record<string, unknown> = {}) =>
  performCampaignSend({
    hostId: HOST,
    subject: 'Spring sale',
    body: 'Ends Sunday',
    audience: 'leads',
    senderUid: 'uid-1',
    ...options,
  } as any)

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
// The defect: a campaign filed where the merchant cannot see it
// ---------------------------------------------------------------------------

describe('a campaignId that names a path rather than an id', () => {
  it('files no campaign at a caller-chosen nesting', async () => {
    await expect(send({ campaignId: 'a/b/c' })).rejects.toThrow(
      /Invalid campaignId/,
    )

    // `hosts/{h}/campaigns/a/b/c` is a legal document path, so this used to
    // write the campaign beneath a document that does not exist — invisible to
    // the merchant's own campaigns list, which resolves the parent first.
    expect(campaignPaths()).toEqual([])
  })

  it('refuses BEFORE a single email goes out', async () => {
    // The ordering is the point. Refusing after the send would strand real
    // delivered mail with no record of it anywhere — AGL-1760's test failed
    // rather than passed.
    await expect(send({ campaignId: 'a/b/c' })).rejects.toThrow()

    expect(sent).toEqual([])
  })

  it('refuses an even-component id rather than throwing out of `.doc()`', async () => {
    await expect(send({ campaignId: 'half/path' })).rejects.toThrow(
      /Invalid campaignId/,
    )
    expect(campaignPaths()).toEqual([])
  })

  it.each([
    ['a reserved id', '__missing__'],
    ['self', '.'],
    ['parent', '..'],
    ['an oversized id', 'x'.repeat(1501)],
  ])('refuses %s', async (_label, campaignId) => {
    await expect(send({ campaignId })).rejects.toThrow(/Invalid campaignId/)
    expect(campaignPaths()).toEqual([])
  })

  it('names the id that was wrong, not the last one checked', async () => {
    await expect(send({ experimentId: 'a/b/c' })).rejects.toThrow(
      /Invalid experimentId/,
    )
    await expect(
      send({ segmentId: 'a/b/c', audience: 'segment' }),
    ).rejects.toThrow(/Invalid segmentId/)
  })
})

describe('the schedule branch, which writes without going through the send core', () => {
  it('stores no scheduled campaign at a caller-chosen nesting', async () => {
    const result = await post({
      hostId: HOST,
      action: 'schedule',
      subject: 'Spring sale',
      body: 'Ends Sunday',
      campaignId: 'a/b/c',
      sendAtMs: Date.now() + 60_000,
    })

    // Worse than the send path: the scheduled-campaign processor finds this by
    // `collectionGroup` and sends it, from a document the merchant can neither
    // see in their list nor cancel.
    expect(result.status).toBe(400)
    expect(campaignPaths()).toEqual([])
  })

  it('answers 400 rather than 500 when cancel carries no campaignId', async () => {
    // The ref used to be built ABOVE the `campaignId ?` guard, so `.doc('')`
    // threw where the code intended a plain refusal.
    const result = await post({ hostId: HOST, action: 'cancel' })

    expect(result.status).toBe(400)
    expect(result.body).toEqual({ error: 'Not a scheduled campaign' })
  })

  it('answers 400 for a cancel naming a path', async () => {
    const result = await post({
      hostId: HOST,
      action: 'cancel',
      campaignId: 'a/b/c',
    })

    expect(result.status).toBe(400)
    expect(campaignPaths()).toEqual([])
  })
})

describe('a merchant-authored variant id', () => {
  it('writes no exposure document for a variant id that names a path', async () => {
    // `validateExperiment` checks variant ids are UNIQUE and nothing about
    // their SHAPE — the same third instance `d51e23df4` found on the
    // conversion write, here on the exposure write that pairs with it.
    store.set(`hosts/${HOST}/experiments/exp-1`, experimentDoc('a/b/c'))

    const result = await send({ experimentId: 'exp-1' })

    expect([...store.keys()].filter((key) => key.includes('/stats/'))).toEqual(
      [],
    )
    // The refusal must not cost the send: the emails really went out.
    expect(result.sent).toBe(1)
    expect(campaignPaths()).toEqual([
      `hosts/${HOST}/campaigns/${result.campaignId}`,
    ])
  })
})

// ---------------------------------------------------------------------------
// The behaviour the refusal must not have been bought with
// ---------------------------------------------------------------------------

describe('the ordinary campaign still sends', () => {
  // Guards, not fixes: each passes before and after.
  it('files a campaign the merchant chose an ordinary id for', async () => {
    const result = await send({ campaignId: 'spring-2026' })

    expect(result.sent).toBe(1)
    expect(campaignPaths()).toEqual([`hosts/${HOST}/campaigns/spring-2026`])
    expect(store.get(`hosts/${HOST}/campaigns/spring-2026`)).toMatchObject({
      subject: 'Spring sale',
      status: 'sent',
    })
  })

  it('mints an id when the caller supplies none', async () => {
    const result = await send()

    expect(campaignPaths()).toEqual([
      `hosts/${HOST}/campaigns/${result.campaignId}`,
    ])
  })

  it('records exposures for a well-formed variant id', async () => {
    store.set(`hosts/${HOST}/experiments/exp-1`, experimentDoc('variant-a'))

    await send({ experimentId: 'exp-1' })

    const stats = [...store.keys()].filter((key) => key.includes('/stats/'))
    expect(stats).toEqual([`hosts/${HOST}/experiments/exp-1/stats/variant-a`])
  })

  it('schedules a campaign with an ordinary id', async () => {
    const result = await post({
      hostId: HOST,
      action: 'schedule',
      subject: 'Spring sale',
      body: 'Ends Sunday',
      campaignId: 'spring-2026',
      sendAtMs: Date.now() + 60_000,
    })

    expect(result.status).toBe(200)
    expect(store.get(`hosts/${HOST}/campaigns/spring-2026`)).toMatchObject({
      status: 'scheduled',
    })
  })

  it('still requires a site admin before any of this', async () => {
    mockUid = 'someone-else'
    const result = await post({
      hostId: HOST,
      action: 'schedule',
      subject: 'Spring sale',
      body: 'Ends Sunday',
      campaignId: 'spring-2026',
      sendAtMs: Date.now() + 60_000,
    })

    expect(result.status).toBe(403)
    expect(campaignPaths()).toEqual([])
  })
})
