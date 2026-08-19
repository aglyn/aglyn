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
 * Digital delivery (AGL-302) and the download cap AGL-2275 made enforceable.
 *
 * ## The fake, and the two behaviours it has to get exactly right
 *
 * The fix turns a read-then-write into a transaction that writes a DOTTED
 * FIELD PATH, and both halves are places a sloppy double manufactures a false
 * verdict:
 *
 *  - **Transaction reads observe the CURRENT store and writes buffer to
 *    commit.** A fake whose read served a snapshot captured at handler entry
 *    would report the racing case green for code that never re-read.
 *  - **`update()` with `a.b` sets the NESTED key and leaves its siblings
 *    alone**, where `set(..., { merge: true })` would treat the same string as
 *    a literal field name containing a dot. Modelling it as a top-level
 *    assignment would let a map-clobbering regression pass.
 *
 * Both are asserted directly below, before anything about downloads, so the
 * double is measured rather than trusted.
 */

process.env.TOKEN_SIGNING_SECRET = 'download-spec-secret'

import { downloadHandler, mintDownloadToken } from './download'
import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'

const docs = new Map<string, Record<string, any>>()

/** Applies one `update()` patch, honouring dotted field paths. */
function applyUpdate(path: string, patch: Record<string, any>) {
  const current = { ...(docs.get(path) ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (!key.includes('.')) {
      current[key] = value
      continue
    }
    const segments = key.split('.')
    let cursor: Record<string, any> = current
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index]
      cursor[segment] = { ...(cursor[segment] ?? {}) }
      cursor = cursor[segment]
    }
    cursor[segments[segments.length - 1]] = value
  }
  docs.set(path, current)
}

function makeDocRef(path: string) {
  return {
    id: path.split('/').pop() as string,
    path,
    async get() {
      const data = docs.get(path)
      return {
        exists: data !== undefined,
        id: path.split('/').pop() as string,
        data: () => data,
        get: (field: string) => data?.[field],
      }
    },
    /**
     * Present because a real `DocumentReference` has it, NOT because the fixed
     * handler calls it — the fix does all its writing inside a transaction.
     *
     * Modelling only what the new code uses would make the forced-red run
     * against the OLD code fail with "set is not a function", which proves the
     * fake's shape rather than the product's behaviour. Merge is TOP-LEVEL,
     * which is what `set(..., { merge: true })` does with a plain object and is
     * exactly why the old code's whole-map write erased a sibling count.
     */
    async set(value: Record<string, any>, options?: { merge?: boolean }) {
      docs.set(
        path,
        options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value,
      )
    },
  }
}

function makeCollectionRef(path: string) {
  return {
    doc: (id: string) => ({
      ...makeDocRef(`${path}/${id}`),
      collection: (name: string) => makeCollectionRef(`${path}/${id}/${name}`),
    }),
  }
}

/** Lets a test run code BETWEEN a transaction's read and its commit. */
let betweenReadAndCommit: (() => void) | null = null

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  /**
   * Optimistic concurrency, because that is what Firestore actually does and
   * omitting it fabricates a false RED as readily as a false green.
   *
   * A first pass at this fake buffered writes and committed them unconditionally.
   * The racing test then failed against the FIXED handler: the racer's write
   * landed after our read, our commit overwrote it, and the fake reported the
   * transaction as having lost a race real Firestore would have made it re-run.
   * So the reads are versioned, and a commit whose read set moved underneath it
   * re-runs the body — which is exactly how the fixed handler sees the racer's
   * count and refuses.
   */
  async runTransaction(handler: (transaction: any) => Promise<any>) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const readVersions = new Map<string, string>()
      const buffered: { path: string; patch: Record<string, any> }[] = []
      const transaction = {
        get: async (reference: { get: () => Promise<any>; path: string }) => {
          const snapshot = await reference.get()
          readVersions.set(
            reference.path,
            JSON.stringify(docs.get(reference.path) ?? null),
          )
          betweenReadAndCommit?.()
          return snapshot
        },
        update: (reference: { path: string }, patch: Record<string, any>) => {
          buffered.push({ path: reference.path, patch })
        },
      }
      const outcome = await handler(transaction)
      const stale = [...readVersions.entries()].some(
        ([path, version]) =>
          JSON.stringify(docs.get(path) ?? null) !== version,
      )
      if (stale) continue
      for (const write of buffered) applyUpdate(write.path, write.patch)
      return outcome
    }
    throw new Error('Transaction failed after 5 attempts')
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore }) },
}))

const HOST = 'host-1'
const ORDER = 'order-1'

function makeResponse() {
  const result = {
    status: 0,
    body: undefined as any,
    redirectedTo: '' as string,
    headers: {} as Record<string, string>,
  }
  const res: PluginApiResponse = {
    status(code: number) {
      result.status = code
      return res
    },
    json(body: unknown) {
      result.body = body
    },
    send(body: unknown) {
      result.body = body
    },
    setHeader(name: string, value: string) {
      result.headers[name] = value
    },
    redirect(code: number, url: string) {
      result.status = code
      result.redirectedTo = url
    },
    end() {
      // unused
    },
  } as unknown as PluginApiResponse
  return { res, result }
}

async function download(productId = 'prod-pdf') {
  const { res, result } = makeResponse()
  const request = {
    method: 'GET',
    query: {
      hostId: HOST,
      orderId: ORDER,
      productId,
      token: mintDownloadToken(HOST, ORDER),
      file: 0,
    },
    body: {},
    headers: {},
    cookies: {},
    socket: {},
  } as unknown as PluginApiRequest
  await downloadHandler(request, res)
  return result
}

function storedOrder() {
  return docs.get(`hosts/${HOST}/orders/${ORDER}`) ?? {}
}

function seed({ downloadLimit }: { downloadLimit?: number | null } = {}) {
  docs.set(`hosts/${HOST}/orders/${ORDER}`, {
    status: 'paid',
    lineItems: [
      { productId: 'prod-pdf', quantity: 1, unitAmountCents: 1200 },
      { productId: 'prod-other', quantity: 1, unitAmountCents: 900 },
    ],
  })
  for (const id of ['prod-pdf', 'prod-other']) {
    docs.set(`hosts/${HOST}/products/${id}`, {
      name: id,
      type: 'digital',
      variants: [{ id: 'default', priceUsd: 12 }],
      digitalFiles: [{ url: `https://files.example/${id}.pdf` }],
      ...(downloadLimit === undefined ? {} : { downloadLimit }),
    })
  }
}

beforeEach(() => {
  docs.clear()
  betweenReadAndCommit = null
  seed({ downloadLimit: 2 })
})

// ---------------------------------------------------------------------------

describe('the fake models what the fix depends on', () => {
  it('applies a dotted update to the NESTED key, not a literal one', () => {
    docs.set('x/y', { downloadAttempts: { a: 1, b: 5 }, other: 'kept' })
    applyUpdate('x/y', { 'downloadAttempts.a': 2 })
    expect(docs.get('x/y')).toEqual({
      // `b` survives — the sibling a map-replacing write would have erased.
      downloadAttempts: { a: 2, b: 5 },
      other: 'kept',
    })
    // And no literal dotted key was created.
    expect(docs.get('x/y')?.['downloadAttempts.a']).toBeUndefined()
  })

  it('reads the CURRENT store inside a transaction and commits at the end', async () => {
    docs.set('x/y', { n: 1 })
    const seen: number[] = []
    await fakeFirestore.runTransaction(async (transaction: any) => {
      const snapshot = await transaction.get(makeDocRef('x/y'))
      seen.push(Number(snapshot.get('n')))
      transaction.update({ path: 'x/y' }, { n: 9 })
      // Not applied yet — buffered to commit.
      expect(docs.get('x/y')?.n).toBe(1)
    })
    expect(seen).toEqual([1])
    expect(docs.get('x/y')?.n).toBe(9)
  })

  it('RE-RUNS the body when a read moves underneath it', async () => {
    docs.set('x/y', { n: 1 })
    const seen: number[] = []
    let raced = false
    betweenReadAndCommit = () => {
      if (raced) return
      raced = true
      docs.set('x/y', { n: 7 })
    }
    await fakeFirestore.runTransaction(async (transaction: any) => {
      const snapshot = await transaction.get(makeDocRef('x/y'))
      seen.push(Number(snapshot.get('n')))
      transaction.update({ path: 'x/y' }, { n: 100 })
    })
    // First pass read 1 and was discarded; the retry read the racer's 7.
    expect(seen).toEqual([1, 7])
    expect(docs.get('x/y')?.n).toBe(100)
  })
})

describe('the happy path', () => {
  it('redirects to the file and counts the attempt', async () => {
    const result = await download()
    expect(result.status).toBe(302)
    expect(result.redirectedTo).toBe('https://files.example/prod-pdf.pdf')
    expect(result.headers['Cache-Control']).toBe('no-store')
    expect(storedOrder().downloadAttempts).toEqual({ 'prod-pdf': 1 })
  })

  it('refuses once the limit is spent', async () => {
    await download()
    await download()
    const third = await download()
    expect(third.status).toBe(429)
    expect(storedOrder().downloadAttempts).toEqual({ 'prod-pdf': 2 })
  })

  it('refuses a refunded order before counting anything', async () => {
    docs.set(`hosts/${HOST}/orders/${ORDER}`, {
      ...storedOrder(),
      status: 'refunded',
    })
    const result = await download()
    expect(result.status).toBe(403)
    expect(storedOrder().downloadAttempts).toBeUndefined()
  })

  it('lets an unlimited product download forever', async () => {
    seed({ downloadLimit: null })
    for (let index = 0; index < 5; index += 1) {
      expect((await download()).status).toBe(302)
    }
    expect(storedOrder().downloadAttempts).toEqual({ 'prod-pdf': 5 })
  })
})

/**
 * AGL-2275. The counter was a read-then-write across an await, from a snapshot
 * fetched at handler entry, with the failure swallowed. N parallel requests all
 * read the same count, all passed the limit, and all wrote `attempts + 1` — so
 * the counter advanced by ONE for N downloads and `downloadLimit` was not a
 * limit at all. On a paid digital product that is the merchant's goods given
 * away.
 */
describe('a concurrent second request (AGL-2275)', () => {
  it('does not let two requests share one count', async () => {
    seed({ downloadLimit: 1 })
    // The second request commits between the first's read and its write, which
    // is the exact interleaving the old shape could not survive.
    let raced = false
    betweenReadAndCommit = () => {
      if (raced) return
      raced = true
      applyUpdate(`hosts/${HOST}/orders/${ORDER}`, {
        'downloadAttempts.prod-pdf': 1,
      })
    }

    const result = await download()

    expect(result.status).toBe(429)
    expect(result.redirectedTo).toBe('')
    // One count for one download — not two downloads sharing one.
    expect(storedOrder().downloadAttempts).toEqual({ 'prod-pdf': 1 })
  })

  /**
   * The other half of the same write: the old code rebuilt the WHOLE
   * `downloadAttempts` map from its stale snapshot, so a concurrent download of
   * a different product in the same order had its increment erased.
   */
  it('does not erase a sibling product’s count', async () => {
    seed({ downloadLimit: 5 })
    let raced = false
    betweenReadAndCommit = () => {
      if (raced) return
      raced = true
      applyUpdate(`hosts/${HOST}/orders/${ORDER}`, {
        'downloadAttempts.prod-other': 3,
      })
    }

    const result = await download('prod-pdf')

    expect(result.status).toBe(302)
    expect(storedOrder().downloadAttempts).toEqual({
      'prod-pdf': 1,
      'prod-other': 3,
    })
  })
})
