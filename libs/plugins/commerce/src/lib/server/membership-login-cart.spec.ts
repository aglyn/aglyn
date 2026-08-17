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

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { hashMemberPassword } from './membership'
import { membershipLoginHandler } from './membership-login'

/**
 * Cart linkage on member sign-in (AGL-294), and the phantom cart it used to
 * mint (AGL-1763).
 *
 * A separate file from `membership-login.spec.ts` deliberately: that spec's
 * Firestore double is a chainable stub that ignores every argument, which
 * cannot answer the only question here — WHICH DOCUMENT PATHS EXIST after the
 * handler ran. So this one keys an in-memory store by path and asserts on the
 * store, never on the handler's response.
 *
 * The double's `update()` REJECTS on a missing document, the way Firestore's
 * does, because that rejection IS the fix (AGL-1760). A double that merged
 * into a missing path would pass against the stub-creating code as happily as
 * against the guard, and prove nothing.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => {
      const data = docs.get(path)
      return {
        id: path.split('/').pop() as string,
        exists: data !== undefined,
        data: () => data,
        get: (field: string) => data?.[field],
      }
    },
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(
        path,
        options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value,
      )
    },
    /**
     * Firestore rejects an update against a document that is not there, with
     * gRPC `NOT_FOUND` (code 5). Reproduced faithfully — it is the guard.
     */
    update: async (value: Record<string, any>) => {
      if (!docs.has(path)) {
        const error: any = new Error(`NOT_FOUND: no entity to update: ${path}`)
        error.code = 5
        throw error
      }
      docs.set(path, { ...(docs.get(path) as Record<string, any>), ...value })
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  const ref: any = {
    /**
     * `CollectionReference.doc()` appends a SLASH-SEPARATED path and throws
     * when the resulting component count is odd — it does not treat the
     * argument as one opaque id. Reproduced because a cookie containing
     * slashes is exactly how the caller reaches a nested path, and because the
     * synchronous throw on an odd one is what used to 500 a sign-in.
     */
    doc: (id: string) => {
      const full = `${path}/${id}`
      if (full.split('/').length % 2 !== 0) {
        throw new Error(
          `Value for argument "documentPath" must point to a document, ` +
            `but was "${id}".`,
        )
      }
      return makeDocRef(full)
    },
    where: () => ref,
    limit: () => ref,
    get: async () => ({
      docs: [
        {
          id: 'member-1',
          get: (field: string) => memberFields[field],
        },
      ],
    }),
  }
  return ref
}

const memberFields: Record<string, unknown> = {}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
  },
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  emitHostEvent: jest.fn(async () => undefined),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PASSWORD = 'correct horse battery'
const HOST = 'host-1'
const CART_PATH = 'hosts/host-1/carts/cart-1'

/**
 * A real cart, as `cart.ts` writes it on the first add-to-cart. No two figures
 * coincide — the quantity is not either timestamp and `createdAtMs` is not
 * `updatedAtMs` — so an assertion cannot pass on the wrong field.
 */
const REAL_CART = {
  lines: [{ productId: 'product-7', variantId: 'small', quantity: 3 }],
  createdAtMs: 1799000000000,
  updatedAtMs: 1799000044000,
}

let ipCounter = 0

function makeRequest(cookies: Record<string, string>): PluginApiRequest {
  // A distinct IP per call keeps the module-level rate limiter quiet across
  // the whole file (10 attempts per 60s per IP, and the map is module state).
  return {
    method: 'POST',
    query: {},
    body: { hostId: HOST, email: 'user@example.com', password: PASSWORD },
    headers: { 'x-forwarded-for': `10.9.0.${++ipCounter}` },
    cookies,
    socket: {},
  } as any
}

function makeResponse() {
  const result = { status: 0, body: undefined as any, headers: {} as any }
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
    setHeader(name, value) {
      result.headers[name] = value
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

async function signIn(cookies: Record<string, string>) {
  const { res, result } = makeResponse()
  await membershipLoginHandler(makeRequest(cookies), res)
  return result
}

/** Every path under this host's `carts`, at any depth. */
function cartPaths(): string[] {
  return [...docs.keys()].filter((key) => key.startsWith('hosts/host-1/carts/'))
}

let consoleErrorSpy: jest.SpyInstance

beforeEach(() => {
  docs.clear()
  ipCounter = 0
  memberFields['passwordScrypt'] = hashMemberPassword(PASSWORD)
  delete memberFields['suspended']
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {
    // The handler logs the swallowed linkage failure; keep the run quiet.
  })
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

// ---------------------------------------------------------------------------

describe('member sign-in cart linkage (AGL-294)', () => {
  it('stamps the member onto a cart that exists, leaving its lines intact', async () => {
    docs.set(CART_PATH, { ...REAL_CART })

    const result = await signIn({ [`aglyn_cart_${HOST}`]: 'cart-1' })

    expect(result.status).toBe(200)
    const stored = docs.get(CART_PATH) as any
    expect(stored.customerId).toBe('member-1')
    // Each surviving field asserted individually (AGL-1711) — an `update()`
    // that clobbered the basket would be a worse bug than the one being fixed.
    expect(stored.lines).toEqual([
      { productId: 'product-7', variantId: 'small', quantity: 3 },
    ])
    expect(stored.createdAtMs).toBe(1799000000000)
    expect(stored.updatedAtMs).toBe(1799000044000)
    expect(cartPaths()).toEqual([CART_PATH])
  })

  it('signs in without a cart cookie and writes no cart at all', async () => {
    const result = await signIn({})

    expect(result.status).toBe(200)
    expect(cartPaths()).toEqual([])
  })
})

describe('a cookie-named cart that does not exist (AGL-1763)', () => {
  /**
   * THE DEFECT. `cartId` is the `aglyn_cart_{hostId}` cookie verbatim, and the
   * old `set({ customerId }, { merge: true })` CREATED the document — one
   * phantom cart per sign-in, at any id the client cared to name.
   */
  it('creates no cart document for an id the client invented', async () => {
    await signIn({ [`aglyn_cart_${HOST}`]: 'not-a-real-cart' })

    expect(cartPaths()).toEqual([])
    expect(docs.has('hosts/host-1/carts/not-a-real-cart')).toBe(false)
  })

  it('still signs the member in when the cart is missing', async () => {
    const result = await signIn({ [`aglyn_cart_${HOST}`]: 'not-a-real-cart' })

    // The linkage is best-effort attribution and always was: a member whose
    // cart went missing must not be locked out because of it.
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true })
    expect(String(result.headers['Set-Cookie'])).toContain(
      'aglyn_member_host-1=',
    )
  })

  it('reports the missing cart instead of swallowing it silently', async () => {
    await signIn({ [`aglyn_cart_${HOST}`]: 'not-a-real-cart' })

    // The old `.catch(() => undefined)` could not tell an absent cart from an
    // outage, and said nothing about either.
    expect(consoleErrorSpy).toHaveBeenCalled()
    expect(String(consoleErrorSpy.mock.calls[0][0])).toContain('Cart linkage')
  })

  it('mints nothing when the same invented id is replayed', async () => {
    await signIn({ [`aglyn_cart_${HOST}`]: 'sweep-1' })
    await signIn({ [`aglyn_cart_${HOST}`]: 'sweep-2' })
    await signIn({ [`aglyn_cart_${HOST}`]: 'sweep-3' })

    // The unbounded-growth shape: one document per sign-in, forever.
    expect(cartPaths()).toEqual([])
  })
})

describe('a cookie that names a nested path (AGL-1763)', () => {
  /**
   * `CollectionReference.doc()` appends a slash-separated PATH, so the cookie
   * was never confined to one document — `a/b/c` reached `carts/a/b/c`.
   */
  it('writes nothing at a caller-chosen nesting', async () => {
    const result = await signIn({
      [`aglyn_cart_${HOST}`]: 'decoy/deeper/deepest',
    })

    expect(result.status).toBe(200)
    expect(docs.has('hosts/host-1/carts/decoy/deeper/deepest')).toBe(false)
    expect(cartPaths()).toEqual([])
  })

  it('does not fail the sign-in on a cookie `doc()` refuses outright', async () => {
    // An even component count makes `.doc()` throw SYNCHRONOUSLY, outside the
    // promise the old `.catch()` covered — so a mangled cookie used to 500 the
    // member's own sign-in.
    const result = await signIn({ [`aglyn_cart_${HOST}`]: 'half/path' })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true })
    expect(cartPaths()).toEqual([])
  })
})
