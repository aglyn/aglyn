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
 * @jest-environment node
 */

import type { PluginApiRequest } from '@aglyn/aglyn/server'
import { mintQuoteLinkToken } from './quote-link-token'
import { handleQuoteProof, handleQuoteRespond, handleQuoteUpload, type QuoteProofDeps } from './quote-proofs'
import type { QuoteUploadCalls } from './quote-uploads'

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {},
  getOrgForHost: jest.fn(),
  consumeRateLimit: jest.fn(),
  notifyHostManagers: jest.fn(),
  isServerReleaseFlagOnForOrg: jest.fn(),
}))

/**
 * The customer's side of a proof (AGL-4096), through the real handlers over
 * an in-memory Firestore: the proof route's gate, the artwork upload's, and
 * every answer the respond route records or refuses.
 */

const docs = new Map<string, Record<string, any>>()

/** A merge-set as Firestore applies it: nested maps merge key by key. */
function merged(base: Record<string, any> | undefined, patch: Record<string, any>): Record<string, any> {
  const next: Record<string, any> = { ...(base ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    const plain = (entry: unknown) => !!entry && typeof entry === 'object' && !Array.isArray(entry)
    next[key] = plain(value) && plain(next[key]) ? merged(next[key], value) : value
  }
  return next
}

function snapshotOf(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => (data === undefined ? undefined : JSON.parse(JSON.stringify(data))),
    get: (field: string) => field.split('.').reduce<any>((value, key) => value?.[key], data),
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => snapshotOf(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? merged(docs.get(path), value) : JSON.parse(JSON.stringify(value)))
    },
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
      docs.set(path, value)
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

/** Collections the routes listed, in order. */
const listedCollections: string[] = []

function collectionRef(path: string): any {
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    get: async () => {
      listedCollections.push(path)
      const children = [...docs.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
      return { docs: children.map((key) => snapshotOf(key)) }
    },
  }
}

const firestore: any = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async <T,>(fn: (transaction: any) => Promise<T>) =>
    fn({
      get: (ref: any) => ref.get(),
      set: (ref: any, value: any, options?: any) => void ref.set(value, options),
      delete: (ref: any) => void ref.delete(),
    }),
}

let rateAllowed = true
const limited: string[] = []
const notified: Array<Parameters<QuoteProofDeps['notify']>> = []
const minted: unknown[] = []
const finalized: unknown[] = []
const kept = new Map<string, { id: string; name: string; contentType: string; size: number; path: string; uploadedAtMs: number }>()

const uploads: QuoteUploadCalls = {
  mint: async (input) => {
    minted.push(input)
    return {
      ok: true,
      ticket: 'ticket-1',
      upload: { url: 'https://storage.example/bucket/', fields: { key: 'k' } },
      file: { id: 'a1', name: 'logo.ai', contentType: 'application/illustrator', size: 900 },
    }
  },
  finalize: async (input) => {
    finalized.push(input)
    return { ok: true, file: { id: 'a1', name: 'logo.ai', contentType: 'application/illustrator', size: 900, path: 'hosts/site1/private/uploads/quote-artwork/q-1/a1', uploadedAtMs: 9 } }
  },
  read: async (scope, id) => (scope.purpose === 'quote-artwork' && scope.purposeId === 'q-1' ? (kept.get(id) ?? null) : null),
  remove: async () => undefined,
  removeAll: async () => undefined,
  send: async () => undefined,
}

const deps: QuoteProofDeps = {
  firestore: () => firestore,
  consumeRateLimit: async (key) => {
    limited.push(key)
    return { allowed: rateAllowed, resetMs: 60_000 }
  },
  orgForHost: async () => ({ id: 'org-1', org: {} }),
  nativeMode: async () => ({ native: false, publishableKey: '' }) as never,
  taxRateId: async () => null,
  createSession: async () => ({ ok: false, session: {} }),
  expireSession: async () => 'expired',
  ensureDomain: async () => null,
  now: () => 10_000,
  uploads: async () => uploads,
  notify: async (...args) => {
    notified.push(args)
  },
}

const QUOTE_PATH = 'hosts/site1/orders/q-1'
const PENDING_PATH = `${QUOTE_PATH}/quoteUploadKeys/q-1`
const DAY_MS = 24 * 60 * 60 * 1000
const PROOF = {
  id: 'p1',
  revision: 1,
  name: 'banner.png',
  contentType: 'image/png',
  size: 1_000,
  path: 'hosts/site1/private/uploads/quote-proof/q-1/p1',
  addedAtMs: 1_500,
  addedBy: 'owner@example.com',
}

function storeQuote(section: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  docs.set(QUOTE_PATH, {
    number: 1042,
    status: 'pending',
    channel: 'quote',
    lineItems: [{ productId: '', custom: true, name: 'Banner', productType: 'physical', quantity: 1, unitAmountCents: 40_000 }],
    totals: { itemsCents: 40_000, discountCents: 0, shippingCents: 0, taxCents: 0, feeCents: 0, totalCents: 40_000 },
    timeline: [],
    checkoutSessionId: 'cs_open',
    quote: {
      stage: 'sent',
      revision: 1,
      customer: { name: 'Jordan Lee', email: 'jordan@example.com' },
      tax: { kind: 'none', reason: 'not-collected' },
      proofs: [PROOF],
      createdAtMs: 1_000,
      updatedAtMs: 2_000,
      createdBy: 'owner@example.com',
      updatedBy: 'owner@example.com',
      ...section,
    },
    ...overrides,
  })
}

const token = (version = 1) => String(mintQuoteLinkToken('site1', 'q-1', version))

function get(query: Record<string, string>): PluginApiRequest {
  return { method: 'GET', query, body: undefined, headers: {}, cookies: {}, socket: { remoteAddress: '203.0.113.9' } } as PluginApiRequest
}

function post(body: Record<string, unknown>, key = 'answer-1'): PluginApiRequest {
  return {
    method: 'POST',
    query: {},
    body: { hostId: 'site1', q: 'q-1', t: token(), ...body },
    headers: { ...(key ? { 'idempotency-key': key } : {}), 'user-agent': 'Spec Browser', 'x-forwarded-for': '203.0.113.9' },
    cookies: {},
    socket: { remoteAddress: '203.0.113.9' },
  } as PluginApiRequest
}

const SECRET = process.env.TOKEN_SIGNING_SECRET

beforeEach(() => {
  process.env.TOKEN_SIGNING_SECRET = 'quote-proofs-spec-secret'
  docs.clear()
  docs.set('hosts/site1', { subdomain: 'acme', businessName: 'Acme Signs', orgId: 'org-1' })
  docs.set('hosts/site1/settings/store', { currency: 'USD' })
  storeQuote()
  rateAllowed = true
  listedCollections.length = 0
  limited.length = 0
  notified.length = 0
  minted.length = 0
  finalized.length = 0
  kept.clear()
})

afterAll(() => {
  process.env.TOKEN_SIGNING_SECRET = SECRET
})

describe('GET commerce/quote-proof', () => {
  it('serves a current proof to the link’s holder, from its private path', async () => {
    const outcome = await handleQuoteProof(deps, get({ hostId: 'site1', q: 'q-1', t: token(), file: 'p1' }))
    expect(outcome).toEqual({
      status: 200,
      body: {},
      file: { path: PROOF.path, name: 'banner.png', contentType: 'image/png' },
    })
    expect(limited).toEqual(['commerce-quote-proof:site1:203.0.113.9'])
    // The current revision has it, so no earlier revision is read.
    expect(listedCollections).toEqual([])
  })

  /** Revision 3 is current on link version 2; revision 1's proof is kept in its snapshot (AGL-4097). */
  const PROOF_R3 = { ...PROOF, id: 'p3', revision: 3, name: 'banner-v3.png', path: 'hosts/site1/private/uploads/quote-proof/q-1/p3' }
  function storeLaterRevision() {
    storeQuote({ revision: 3, linkVersion: 2, proofs: [PROOF_R3] })
    docs.set(`${QUOTE_PATH}/revisions/1`, { revision: 1, proofs: [PROOF], responses: [], approval: null })
    docs.set(`${QUOTE_PATH}/revisions/2`, { revision: 2, proofs: [], responses: [], approval: null })
  }

  it('keeps serving an earlier email’s proof after a new revision and a replaced link', async () => {
    storeLaterRevision()
    // The first email's link (version 1) and its revision 1 proof.
    const earlier = await handleQuoteProof(deps, get({ hostId: 'site1', q: 'q-1', t: token(1), file: 'p1' }))
    expect(earlier).toEqual({ status: 200, body: {}, file: { path: PROOF.path, name: 'banner.png', contentType: 'image/png' } })
    expect(listedCollections).toEqual([`${QUOTE_PATH}/revisions`])
    // The same old link reaches the current revision's proof, and the new link the earlier one.
    expect((await handleQuoteProof(deps, get({ hostId: 'site1', q: 'q-1', t: token(1), file: 'p3' }))).file?.path).toBe(PROOF_R3.path)
    expect((await handleQuoteProof(deps, get({ hostId: 'site1', q: 'q-1', t: token(2), file: 'p1' }))).file?.path).toBe(PROOF.path)
  })

  it('answers a proof the business took off its revision as gone', async () => {
    // Revision 1's only proof, removed before anyone answered.
    storeQuote({ proofs: [] })
    const removed = await handleQuoteProof(deps, get({ hostId: 'site1', q: 'q-1', t: token(), file: 'p1' }))
    expect(removed).toEqual({ status: 404, body: { error: 'That proof is no longer on this quote.' } })
    // p2 went on revision 3 and was removed: on neither the quote nor a snapshot, through any link.
    storeLaterRevision()
    for (const t of [token(1), token(2)]) {
      const gone = await handleQuoteProof(deps, get({ hostId: 'site1', q: 'q-1', t, file: 'p2' }))
      expect(gone.status).toBe(404)
      expect(gone.file).toBeUndefined()
    }
  })

  it('answers a forged token, a token for a version never sent and an invoice’s link as a missing quote', async () => {
    storeLaterRevision()
    const forged = [
      '1.0000',
      `1.${'0'.repeat(32)}`,
      String(mintQuoteLinkToken('site1', 'q-2', 1)),
      String(mintQuoteLinkToken('site2', 'q-1', 1)),
      token(3),
    ]
    for (const t of forged) {
      const outcome = await handleQuoteProof(deps, get({ hostId: 'site1', q: 'q-1', t, file: 'p1' }))
      expect(outcome.status).toBe(404)
      expect(outcome.file).toBeUndefined()
    }
    docs.set(QUOTE_PATH, { number: 1042, status: 'pending', channel: 'draft', lineItems: [], timeline: [], payLink: { version: 1 } })
    expect((await handleQuoteProof(deps, get({ hostId: 'site1', q: 'q-1', t: token(1), file: 'p1' }))).status).toBe(404)
    expect(listedCollections).toEqual([])
  })

  it('never serves another quote’s file through this quote’s link', async () => {
    storeLaterRevision()
    // Another quote's proof, named by its id: not in this quote's history.
    docs.set('hosts/site1/orders/q-2/revisions/1', { revision: 1, proofs: [{ ...PROOF, id: 'other', path: 'hosts/site1/private/uploads/quote-proof/q-2/other' }] })
    expect((await handleQuoteProof(deps, get({ hostId: 'site1', q: 'q-1', t: token(1), file: 'other' }))).status).toBe(404)
    // A snapshot naming a file outside this quote's proofs is never streamed.
    docs.set(`${QUOTE_PATH}/revisions/2`, {
      revision: 2,
      proofs: [{ ...PROOF, id: 'stray', path: 'hosts/site1/private/uploads/quote-artwork/q-1/stray' }],
    })
    const stray = await handleQuoteProof(deps, get({ hostId: 'site1', q: 'q-1', t: token(1), file: 'stray' }))
    expect(stray.status).toBe(404)
    expect(stray.file).toBeUndefined()
  })

  it('leaves pay, answers and uploads on the current link version', async () => {
    storeLaterRevision()
    expect((await handleQuoteUpload(deps, post({ action: 'ticket', file: {}, t: token(1) }))).status).toBe(410)
    expect((await handleQuoteRespond(deps, post({ action: 'approve', name: 'Jordan Lee', v: 2_000, t: token(1) }))).status).toBe(410)
    expect(minted).toEqual([])
  })

  it('is rate-limited before the token is looked at', async () => {
    rateAllowed = false
    const outcome = await handleQuoteProof(deps, get({ hostId: 'site1', q: 'q-1', t: 'nonsense', file: 'p1' }))
    expect(outcome.status).toBe(429)
    expect(outcome.file).toBeUndefined()
  })

  it('still shows a paid quote’s proofs', async () => {
    storeQuote({}, { status: 'paid' })
    expect((await handleQuoteProof(deps, get({ hostId: 'site1', q: 'q-1', t: token(), file: 'p1' }))).status).toBe(200)
  })
})

describe('POST commerce/quote-upload', () => {
  it('mints a ticket scoped to this quote’s artwork, for the visitor’s address', async () => {
    const outcome = await handleQuoteUpload(deps, post({ action: 'ticket', file: { name: 'logo.ai', contentType: '', size: 900 } }))
    expect(outcome.status).toBe(200)
    expect(minted).toEqual([
      {
        scope: { hostId: 'site1', purpose: 'quote-artwork', purposeId: 'q-1' },
        request: { name: 'logo.ai', contentType: '', size: 900 },
        caller: { ip: '203.0.113.9' },
      },
    ])
  })

  it('finalizes into the same scope and never hands back the storage path', async () => {
    const outcome = await handleQuoteUpload(deps, post({ action: 'finalize', ticket: 'ticket-1' }))
    expect(outcome).toEqual({
      status: 200,
      body: { file: { id: 'a1', name: 'logo.ai', contentType: 'application/illustrator', size: 900, uploadedAtMs: 9 } },
    })
    expect(finalized).toEqual([
      { scope: { hostId: 'site1', purpose: 'quote-artwork', purposeId: 'q-1' }, ticket: 'ticket-1', caller: { ip: '203.0.113.9' } },
    ])
  })

  it('records each file as pending under its quote from its ticket on, swept a day after the latest', async () => {
    docs.set(PENDING_PATH, { hostId: 'site1', quoteId: 'q-1', files: { b2: 4_000 }, sweepAtMs: 4_000 + DAY_MS })
    expect((await handleQuoteUpload(deps, post({ action: 'ticket', file: { name: 'logo.ai', contentType: '', size: 900 } }))).status).toBe(200)
    expect(docs.get(PENDING_PATH)).toEqual({ hostId: 'site1', quoteId: 'q-1', files: { b2: 4_000, a1: 10_000 }, sweepAtMs: 10_000 + DAY_MS })
    docs.delete(PENDING_PATH)
    // A finalize records it again, so a file kept with no ticket record is still swept.
    expect((await handleQuoteUpload(deps, post({ action: 'finalize', ticket: 'ticket-1' }))).status).toBe(200)
    expect(docs.get(PENDING_PATH)).toEqual({ hostId: 'site1', quoteId: 'q-1', files: { a1: 10_000 }, sweepAtMs: 10_000 + DAY_MS })
  })

  it('takes no files for a paid quote, a replaced link or a wrong token', async () => {
    storeQuote({}, { status: 'paid' })
    expect((await handleQuoteUpload(deps, post({ action: 'ticket', file: {} }))).status).toBe(409)
    storeQuote({ linkVersion: 2 })
    expect((await handleQuoteUpload(deps, post({ action: 'ticket', file: {} }))).status).toBe(410)
    storeQuote()
    expect((await handleQuoteUpload(deps, post({ action: 'ticket', file: {}, t: '1.bad' }))).status).toBe(404)
    expect(minted).toEqual([])
    expect(docs.has(PENDING_PATH)).toBe(false)
  })

  it('pretends to a bot that filled the honeypot, and signs nothing', async () => {
    const outcome = await handleQuoteUpload(deps, post({ action: 'ticket', file: {}, website: 'http://spam.example' }))
    expect(outcome).toEqual({ status: 200, body: { received: true } })
    expect(minted).toEqual([])
  })
})

describe('POST commerce/quote-respond', () => {
  it('records an approval, answers the page’s new view, and tells the managers', async () => {
    const outcome = await handleQuoteRespond(deps, post({ v: 2_000, action: 'approve', name: 'Jordan Lee' }))
    expect(outcome.status).toBe(200)
    expect(outcome.body['view']).toMatchObject({ response: { action: 'approve', name: 'Jordan Lee' }, respondable: true })
    expect(docs.get(QUOTE_PATH)?.['quote']).toMatchObject({
      stage: 'approved',
      approvedRevision: 1,
      approval: { revision: 1, name: 'Jordan Lee', atMs: 10_000, ip: '203.0.113.9', userAgent: 'Spec Browser' },
      updatedAtMs: 2_000,
    })
    // The open session is the customer's to use: an answer is not an edit.
    expect(docs.get(QUOTE_PATH)?.['checkoutSessionId']).toBe('cs_open')
    expect(notified).toEqual([
      [
        'site1',
        expect.objectContaining({
          type: 'content.order',
          title: 'Proof approved — Quote #1042 on {site}',
          link: '/site1/products/orders?quote=q-1',
        }),
        expect.objectContaining({
          replyTo: 'jordan@example.com',
          emailDetails: expect.arrayContaining([{ label: 'Approved as', value: 'Jordan Lee' }]),
        }),
      ],
    ])
  })

  it('records a change request with the artwork read back from this quote, by id', async () => {
    kept.set('a1', { id: 'a1', name: 'logo.ai', contentType: 'application/illustrator', size: 900, path: 'hosts/site1/private/uploads/quote-artwork/q-1/a1', uploadedAtMs: 9 })
    const outcome = await handleQuoteRespond(deps, post({ v: 2_000, action: 'changes', comment: 'Bigger logo', fileIds: ['a1'] }))
    expect(outcome.status).toBe(200)
    const quote = docs.get(QUOTE_PATH)?.['quote']
    expect(quote.stage).toBe('changes_requested')
    expect(quote.responses).toEqual([
      {
        action: 'changes',
        revision: 1,
        atMs: 10_000,
        comment: 'Bigger logo',
        files: [{ id: 'a1', name: 'logo.ai', contentType: 'application/illustrator', size: 900, path: 'hosts/site1/private/uploads/quote-artwork/q-1/a1' }],
        ip: '203.0.113.9',
        userAgent: 'Spec Browser',
      },
    ])
    expect(notified[0][1]).toMatchObject({ title: 'Changes requested — Quote #1042 on {site}' })
    expect(notified[0][2]?.emailDetails).toEqual(
      expect.arrayContaining([
        { label: 'What to change', value: 'Bigger logo' },
        { label: 'Files sent', value: 'logo.ai' },
      ]),
    )
  })

  it('keeps the files it sends: they leave the pending record, and a record left with none goes', async () => {
    const file = (id: string) => ({ id, name: `${id}.ai`, contentType: 'application/illustrator', size: 900, path: `hosts/site1/private/uploads/quote-artwork/q-1/${id}`, uploadedAtMs: 9 })
    kept.set('a1', file('a1'))
    kept.set('b2', file('b2'))
    docs.set(PENDING_PATH, { hostId: 'site1', quoteId: 'q-1', files: { a1: 9_000, b2: 9_500, c3: 9_600 }, sweepAtMs: 9_600 + DAY_MS })
    expect((await handleQuoteRespond(deps, post({ v: 2_000, action: 'changes', comment: 'Bigger logo', fileIds: ['a1', 'b2'] }, 'k1'))).status).toBe(200)
    // The file attached and left out of the answer is still pending.
    expect(docs.get(PENDING_PATH)).toEqual({ hostId: 'site1', quoteId: 'q-1', files: { c3: 9_600 }, sweepAtMs: 9_600 + DAY_MS })

    storeQuote()
    kept.set('c3', file('c3'))
    expect((await handleQuoteRespond(deps, post({ v: 2_000, action: 'changes', comment: 'And this', fileIds: ['c3'] }, 'k2'))).status).toBe(200)
    expect(docs.has(PENDING_PATH)).toBe(false)
  })

  it('leaves the pending files alone for an approval, and for an answer that is refused', async () => {
    const pending = { hostId: 'site1', quoteId: 'q-1', files: { a1: 9_000 }, sweepAtMs: 9_000 + DAY_MS }
    docs.set(PENDING_PATH, pending)
    kept.set('a1', { id: 'a1', name: 'logo.ai', contentType: 'application/illustrator', size: 900, path: 'hosts/site1/private/uploads/quote-artwork/q-1/a1', uploadedAtMs: 9 })
    expect((await handleQuoteRespond(deps, post({ v: 1_000, action: 'changes', comment: 'x', fileIds: ['a1'] }, 'k1'))).status).toBe(409)
    expect((await handleQuoteRespond(deps, post({ v: 2_000, action: 'approve', name: 'Jordan Lee' }, 'k2'))).status).toBe(200)
    expect(docs.get(PENDING_PATH)).toEqual(pending)
  })

  it('refuses a file id that is not this quote’s artwork', async () => {
    const outcome = await handleQuoteRespond(deps, post({ v: 2_000, action: 'changes', comment: 'x', fileIds: ['someone-elses'] }))
    expect(outcome.status).toBe(400)
    expect(docs.get(QUOTE_PATH)?.['quote']?.responses).toBeUndefined()
  })

  it('refuses an answer to proofs the page did not show', async () => {
    const outcome = await handleQuoteRespond(deps, post({ v: 1_000, action: 'approve', name: 'Jordan Lee' }))
    expect(outcome).toMatchObject({ status: 409, body: { reason: 'updated' } })
    expect(docs.get(QUOTE_PATH)?.['quote']?.stage).toBe('sent')
  })

  it('refuses a replaced link, a paid quote and a wrong token', async () => {
    storeQuote({ linkVersion: 2 })
    expect((await handleQuoteRespond(deps, post({ v: 2_000, action: 'approve', name: 'Jordan Lee' }))).status).toBe(410)
    storeQuote({}, { status: 'paid' })
    expect(await handleQuoteRespond(deps, post({ v: 2_000, action: 'approve', name: 'Jordan Lee' }))).toMatchObject({
      status: 409,
      body: { reason: 'paid' },
    })
    storeQuote()
    expect((await handleQuoteRespond(deps, post({ v: 2_000, action: 'approve', name: 'Jordan Lee', t: '1.bad' }))).status).toBe(404)
    expect(notified).toEqual([])
  })

  it('is rate-limited per address on the site, before the token is checked', async () => {
    rateAllowed = false
    const outcome = await handleQuoteRespond(deps, post({ v: 2_000, action: 'approve', name: 'Jordan Lee', t: 'nonsense' }))
    expect(outcome.status).toBe(429)
    expect(limited).toEqual(['commerce-quote-respond:site1:203.0.113.9'])
  })

  it('needs an Idempotency-Key, and answers a retried answer from the first', async () => {
    expect((await handleQuoteRespond(deps, post({ v: 2_000, action: 'approve', name: 'Jordan Lee' }, ''))).status).toBe(400)
    const first = await handleQuoteRespond(deps, post({ v: 2_000, action: 'approve', name: 'Jordan Lee' }, 'k1'))
    const again = await handleQuoteRespond(deps, post({ v: 2_000, action: 'approve', name: 'Jordan Lee' }, 'k1'))
    expect(again).toEqual(first)
    expect(docs.get(QUOTE_PATH)?.['quote']?.responses).toHaveLength(1)
  })

  it('refuses a quote with no proof to answer, and pretends to a bot', async () => {
    storeQuote({ proofs: [] })
    expect(await handleQuoteRespond(deps, post({ v: 2_000, action: 'approve', name: 'Jordan Lee' }))).toMatchObject({
      status: 409,
      body: { reason: 'no-proof' },
    })
    storeQuote()
    expect(await handleQuoteRespond(deps, post({ v: 2_000, action: 'approve', name: 'Jordan Lee', website: 'x' }))).toEqual({
      status: 200,
      body: { received: true },
    })
    expect(docs.get(QUOTE_PATH)?.['quote']?.responses).toBeUndefined()
  })

  it('approving is what lets a quote that asks for approval be paid', async () => {
    storeQuote({ requireProofApproval: true })
    const outcome = await handleQuoteRespond(deps, post({ v: 2_000, action: 'approve', name: 'Jordan Lee' }))
    expect(outcome.body['view']).toMatchObject({ approvalRequired: false, payable: true })
    expect(notified[0][1].body).toContain('They can pay the quote now.')
  })
})
