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

import type { PluginApiResponse } from '@aglyn/aglyn/server'
import { cartHandler } from './cart'
import { isCartId, mintCartId, readCartId } from './cart-cookie'

/**
 * The unauthenticated cart write (AGL-1769).
 *
 * `cart.ts` builds `hosts/{hostId}/carts/{cartId}` out of two values the
 * caller supplies — the body's `hostId` and the `aglyn_cart_{hostId}` cookie —
 * and creates the document with a merge-set. Every assertion here is about
 * WHICH DOCUMENT PATHS EXIST when the handler returns, so the store is keyed
 * by path and the tests read the store, never the response body alone.
 *
 * The double has to model three Firestore behaviours or it proves nothing:
 *
 *  1. `.doc()` appends a SLASH-SEPARATED path — the nesting hazard itself. A
 *     double that treated the argument as one opaque id would make
 *     `a/b/c` land at `carts/a%2Fb%2Fc` and quietly turn the defect into a
 *     harmless key.
 *  2. `.doc()` throws SYNCHRONOUSLY on an even component count, which is a
 *     different failure from a rejected promise and escapes a `.catch()`.
 *  3. Reserved `__…__` ids are rejected rather than reported absent — the trap
 *     `542b1023f` hit with `products/__missing__`.
 *
 * No network is reachable from this handler and no Stripe path exists on it.
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
    doc: (id: string) => {
      const full = `${path}/${id}`
      // A document path has an EVEN component count; `.doc()` throws outright
      // when the argument makes it odd.
      if (full.split('/').length % 2 !== 0) {
        throw new Error(
          `Value for argument "documentPath" must point to a document, ` +
            `but was "${id}".`,
        )
      }
      // Firestore reserves `__…__` and answers INVALID_ARGUMENT, never an
      // absent snapshot.
      if (full.split('/').some((part) => /^__.*__$/.test(part))) {
        const error: any = new Error(
          `INVALID_ARGUMENT: Document name "${full}" is reserved.`,
        )
        error.code = 3
        throw error
      }
      return makeDocRef(full)
    },
    where: () => ref,
    limit: () => ref,
    get: async () => ({ docs: [] }),
  }
  return ref
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
  },
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HOST = 'host-1'
const REAL_CART_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const REAL_CART_PATH = `hosts/${HOST}/carts/${REAL_CART_ID}`

/** A cart as `cart.ts` writes it on the first add. */
const REAL_CART = {
  lines: [{ productId: 'product-7', quantity: 3 }],
  createdAtMs: 1799000000000,
  updatedAtMs: 1799000044000,
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

async function post(
  body: Record<string, unknown>,
  cookies: Record<string, string> = {},
) {
  const { res, result } = makeResponse()
  await cartHandler(
    { method: 'POST', query: {}, body, cookies, headers: {} } as any,
    res,
  )
  return result
}

async function get(
  query: Record<string, unknown>,
  cookies: Record<string, string> = {},
) {
  const { res, result } = makeResponse()
  await cartHandler(
    { method: 'GET', query, body: {}, cookies, headers: {} } as any,
    res,
  )
  return result
}

/** Every document path in the store, at any depth. */
function allPaths(): string[] {
  return [...docs.keys()].sort()
}

let consoleErrorSpy: jest.SpyInstance

beforeEach(() => {
  docs.clear()
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {
    // The handler logs before its 500; keep the run quiet.
  })
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

// ---------------------------------------------------------------------------

describe('an empty cart is never minted (AGL-1769)', () => {
  /**
   * THE DEFECT, at its cheapest. `clear` returns before the `!productId`
   * check, so this request carries no credentials, no session and no product —
   * and used to create one document per call.
   */
  it('creates nothing when `clear` names a cart that does not exist', async () => {
    const result = await post(
      { hostId: HOST, action: 'clear' },
      { [`aglyn_cart_${HOST}`]: 'invented-by-the-caller' },
    )

    expect(result.status).toBe(200)
    expect(allPaths()).toEqual([])
  })

  it('creates nothing when `clear` arrives with no cookie at all', async () => {
    const result = await post({ hostId: HOST, action: 'clear' })

    // The cookie is still issued — the next add lands on it and writes a real
    // cart — but no document is created for a basket that holds nothing.
    expect(result.status).toBe(200)
    expect(String(result.headers['Set-Cookie'])).toContain(
      `aglyn_cart_${HOST}=`,
    )
    expect(allPaths()).toEqual([])
  })

  it('creates nothing when a `remove` empties a cart that does not exist', async () => {
    await post(
      { hostId: HOST, action: 'remove', productId: 'product-7', quantity: 1 },
      { [`aglyn_cart_${HOST}`]: 'invented-by-the-caller' },
    )

    expect(allPaths()).toEqual([])
  })

  it('mints one document per call for a repeated invented id', async () => {
    await post(
      { hostId: HOST, action: 'clear' },
      { [`aglyn_cart_${HOST}`]: 'spam-1' },
    )
    await post(
      { hostId: HOST, action: 'clear' },
      { [`aglyn_cart_${HOST}`]: 'spam-2' },
    )
    await post(
      { hostId: HOST, action: 'clear' },
      { [`aglyn_cart_${HOST}`]: 'spam-3' },
    )

    // The unbounded-growth shape the issue describes.
    expect(allPaths()).toEqual([])
  })
})

describe('a cookie that names a PATH rather than an id (AGL-1769)', () => {
  it('writes nothing at a caller-chosen nesting', async () => {
    const result = await post(
      { hostId: HOST, productId: 'product-7', quantity: 1 },
      { [`aglyn_cart_${HOST}`]: 'decoy/deeper/deepest' },
    )

    expect(result.status).toBe(200)
    expect(docs.has(`hosts/${HOST}/carts/decoy/deeper/deepest`)).toBe(false)
    // The add is honoured — at a freshly minted id, not the caller's path.
    const written = allPaths()
    expect(written).toHaveLength(1)
    expect(written[0]).toMatch(new RegExp(`^hosts/${HOST}/carts/[0-9a-f]{32}$`))
    expect(String(result.headers['Set-Cookie'])).toContain(
      `aglyn_cart_${HOST}=`,
    )
  })

  it('does not 500 on a cookie `doc()` refuses outright', async () => {
    // An even component count throws SYNCHRONOUSLY out of `.doc()`. It landed
    // inside the handler's `try`, so a mangled cookie turned every cart read on
    // that browser into "Cart unavailable" until the cookie expired.
    const result = await get(
      { hostId: HOST },
      { [`aglyn_cart_${HOST}`]: 'half/path' },
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ lines: [], count: 0 })
  })

  it('treats a reserved `__…__` cookie as no cart', async () => {
    // Firestore answers INVALID_ARGUMENT for a reserved id rather than an
    // absent snapshot, so this was a 500 rather than a stray document.
    const result = await get(
      { hostId: HOST },
      { [`aglyn_cart_${HOST}`]: '__missing__' },
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ lines: [], count: 0 })
    expect(allPaths()).toEqual([])
  })
})

describe('a hostId that names a PATH rather than an id (AGL-1769)', () => {
  it('refuses a nested hostId instead of writing beneath a missing host', async () => {
    const result = await post(
      { hostId: 'a/b/c', action: 'clear' },
      { 'aglyn_cart_a/b/c': 'cart-1' },
    )

    // `hosts/a/b/c` is a legal document path, so this wrote a cart under a host
    // document that does not exist — invisible to every console list, since
    // they resolve the host doc first.
    expect(result.status).toBe(400)
    expect(allPaths()).toEqual([])
  })

  it('refuses a hostId `doc()` throws on, rather than throwing out of the handler', async () => {
    // `hosts/half/path` has an odd component count, and `hostRef` is built
    // BEFORE the handler's `try` — so this escaped the handler entirely.
    const { res, result } = makeResponse()
    await expect(
      cartHandler(
        {
          method: 'POST',
          query: {},
          body: { hostId: 'half/path', action: 'clear' },
          cookies: {},
          headers: {},
        } as any,
        res,
      ),
    ).resolves.toBeUndefined()

    expect(result.status).toBe(400)
    expect(allPaths()).toEqual([])
  })
})

describe('the ordinary cart still works', () => {
  // Guards, not fixes: each passes before and after, pinned so the refusal
  // cannot be bought by breaking the feature it protects.
  it('writes a real cart on the first add and stamps both timestamps', async () => {
    const result = await post({
      hostId: HOST,
      productId: 'product-7',
      quantity: 2,
    })

    expect(result.status).toBe(200)
    const written = allPaths()
    expect(written).toHaveLength(1)
    const stored = docs.get(written[0]) as any
    expect(stored.lines).toEqual([{ productId: 'product-7', quantity: 2 }])
    expect(typeof stored.createdAtMs).toBe('number')
    expect(typeof stored.updatedAtMs).toBe('number')
  })

  it('clears a cart that DOES exist, keeping the document', async () => {
    docs.set(REAL_CART_PATH, { ...REAL_CART })

    const result = await post(
      { hostId: HOST, action: 'clear' },
      { [`aglyn_cart_${HOST}`]: REAL_CART_ID },
    )

    expect(result.status).toBe(200)
    const stored = docs.get(REAL_CART_PATH) as any
    expect(stored.lines).toEqual([])
    // `createdAtMs` is not restamped on a cart that already existed.
    expect(stored.createdAtMs).toBe(1799000000000)
    expect(allPaths()).toEqual([REAL_CART_PATH])
  })

  it('reads a real cart back through its cookie', async () => {
    docs.set(REAL_CART_PATH, { ...REAL_CART })
    docs.set(`hosts/${HOST}/products/product-7`, {
      name: 'Kettle',
      status: 'active',
      variants: [{ id: 'v1', priceUsd: 30 }],
    })

    const result = await get(
      { hostId: HOST },
      { [`aglyn_cart_${HOST}`]: REAL_CART_ID },
    )

    expect(result.status).toBe(200)
    expect(result.body.count).toBe(3)
    expect(result.body.subtotalCents).toBe(9000)
  })
})

describe('isCartId', () => {
  it('accepts the ids Aglyn mints', () => {
    expect(isCartId(mintCartId())).toBe(true)
    expect(mintCartId()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('accepts any other single opaque component, so no live cart is orphaned', () => {
    // Deliberately looser than the minted format — see the module comment.
    expect(isCartId('cart-1')).toBe(true)
    expect(isCartId('AbC_123.xyz')).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['a nested path', 'a/b/c'],
    ['an even-component path', 'half/path'],
    ['a leading slash', '/cart-1'],
    ['self', '.'],
    ['parent', '..'],
    ['a reserved id', '__missing__'],
    ['not a string', 42],
    ['absent', undefined],
  ])('rejects %s', (_label, value) => {
    expect(isCartId(value)).toBe(false)
  })

  it('rejects an id past Firestore’s 1500-byte ceiling, counting BYTES', () => {
    expect(isCartId('a'.repeat(1500))).toBe(true)
    expect(isCartId('a'.repeat(1501))).toBe(false)
    // 4 bytes each in UTF-8 — a length check would have let this through.
    expect(isCartId('😀'.repeat(376))).toBe(false)
  })
})

describe('readCartId', () => {
  it('reports a mangled cookie as absent rather than raising', () => {
    expect(readCartId({ [`aglyn_cart_${HOST}`]: 'a/b/c' }, HOST)).toBe('')
    expect(readCartId({}, HOST)).toBe('')
    expect(readCartId(undefined, HOST)).toBe('')
  })

  it('reads the cookie for THIS host only', () => {
    const cookies = {
      [`aglyn_cart_${HOST}`]: 'cart-1',
      aglyn_cart_other: 'cart-2',
    }
    expect(readCartId(cookies, HOST)).toBe('cart-1')
    expect(readCartId(cookies, 'other')).toBe('cart-2')
  })
})
