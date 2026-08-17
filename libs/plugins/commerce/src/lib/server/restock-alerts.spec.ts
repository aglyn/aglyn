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
 * What a back-in-stock signup may STORE, and what the cron may do with it
 * (AGL-1774, found by AGL-1771's sweep).
 *
 * The two handlers are specced together because the defect only exists across
 * the pair: `notify-restock.ts` writes `productId` as a FIELD off an
 * unauthenticated POST, and `process-restock.ts` — days later, in a
 * platform-wide cron — makes that field a PATH COMPONENT. Neither file is
 * wrong on its own reading; the value simply changes kind between them.
 *
 * THE DOUBLE MODELS THE `.doc()` BEHAVIOUR THE DEFECT TURNS ON. `.doc()`
 * appends a SLASH-SEPARATED path and refuses it only when the resulting
 * component count comes out odd, and that refusal is a SYNCHRONOUS throw — not
 * a rejected promise — which is exactly why it escaped the cron's per-alert
 * handling and killed the run. A double treating `.doc()`'s argument as one
 * opaque key would turn the whole defect into a harmless map entry and pass
 * against the broken code.
 *
 * TWO CORRECTIONS to the model `cart-cookie.spec.ts` (`f053417fa`) and
 * `email-events.spec.ts` (`d51e23df4`) used, measured directly against the
 * installed `@google-cloud/firestore` rather than reasoned about:
 *
 *  1. a RESERVED `__…__` id does NOT throw out of `.doc()`. The client accepts
 *     it and builds the reference; `INVALID_ARGUMENT` comes back from the
 *     SERVICE when the read or write is issued. Both earlier doubles throw at
 *     ref construction. Their conclusions are unaffected — their guards run
 *     before `.doc()` either way — but the failure lands somewhere else, and a
 *     spec that models the wrong line can pin the wrong behaviour;
 *  2. `.doc('')` DOES throw, synchronously: "Path must be a non-empty string".
 *     Neither earlier double modelled it, so an empty id read as a legal
 *     even-count path.
 *
 * `.` and `..` behave like the reserved form: accepted by the client, refused
 * by the service.
 *
 * No Stripe path exists in either handler and none is reachable from them.
 */

import type { PluginApiResponse } from '@aglyn/aglyn/server'

// ---------------------------------------------------------------------------
// In-memory Firestore, keyed by document path
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

/** Auto-ids for `.add()`, so assertions can name the document deterministically. */
let nextAutoId = 0

/**
 * What the SERVICE refuses once an RPC is actually issued, as opposed to what
 * the client refuses while building the reference. Reserved `__…__` ids and
 * the `.`/`..` traversal forms are legal to `.doc()` and fail here instead.
 */
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

function makeDocRef(path: string): any {
  const reject = () => {
    const failure = serviceRejection(path)
    if (failure) throw failure
  }
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => {
      reject()
      return {
        id: path.split('/').pop() as string,
        exists: docs.has(path),
        data: () => docs.get(path),
        get: (field: string) => docs.get(path)?.[field],
      }
    },
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      reject()
      docs.set(
        path,
        options?.merge ? { ...(docs.get(path) ?? {}), ...value } : { ...value },
      )
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
    get parent() {
      return makeCollectionRef(path.split('/').slice(0, -1).join('/'))
    },
  }
}

function makeCollectionRef(path: string): any {
  const ref: any = {
    path,
    doc: (id: string) => {
      // Measured against the installed client: an empty id is refused before
      // anything else, and SYNCHRONOUSLY.
      if (id === '') {
        throw new Error(
          `Value for argument "documentPath" is not a valid resource path. ` +
            `Path must be a non-empty string.`,
        )
      }
      const full = `${path}/${id}`
      // A document path has an EVEN component count; `.doc()` throws outright
      // — and SYNCHRONOUSLY — when the argument makes it odd.
      if (full.split('/').length % 2 !== 0) {
        throw new Error(
          `Value for argument "documentPath" must point to a document, ` +
            `but was "${id}".`,
        )
      }
      return makeDocRef(full)
    },
    add: async (value: Record<string, any>) => {
      const failure = serviceRejection(path)
      if (failure) throw failure
      const id = `auto-${(nextAutoId += 1)}`
      docs.set(`${path}/${id}`, { ...value })
      return makeDocRef(`${path}/${id}`)
    },
    get parent() {
      const parts = path.split('/').slice(0, -1)
      return parts.length ? makeDocRef(parts.join('/')) : null
    },
  }
  return ref
}

/** A `collectionGroup` scan across every host, as the cron runs it. */
function makeCollectionGroupRef(name: string): any {
  const ref: any = {
    where: (field: string, _op: string, value: unknown) => {
      ref.filters.push([field, value])
      return ref
    },
    limit: () => ref,
    filters: [] as Array<[string, unknown]>,
    get: async () => {
      const matched = [...docs.entries()]
        .filter(([path]) => path.split('/').slice(-2, -1)[0] === name)
        .filter(([, data]) =>
          ref.filters.every(
            ([field, value]: [string, unknown]) => data[field] === value,
          ),
        )
        // Default `__name__` ordering, which is what makes one poisoned
        // document able to shadow every alert sorted after it.
        .sort(([a], [b]) => a.localeCompare(b))
      return {
        size: matched.length,
        docs: matched.map(([path, data]) => ({
          id: path.split('/').pop() as string,
          ref: makeDocRef(path),
          data: () => data,
          get: (field: string) => data[field],
        })),
      }
    },
  }
  return ref
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  collectionGroup: (name: string) => makeCollectionGroupRef(name),
}

const meterHostEmail = jest.fn<Promise<undefined>, [string]>(
  async () => undefined,
)

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore }) },
  getOrgForHost: async () => ({ org: {} }),
  meterHostEmail: (...args: unknown[]) => meterHostEmail(...(args as [string])),
}))

// Typed by signature rather than by an unused parameter, so `mock.calls[0][0]`
// is the delivered message and not `never`.
const sendEmail = jest.fn<
  Promise<{ sent: boolean }>,
  [Record<string, unknown>]
>(async () => ({ sent: true }))

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => true,
  loadHostEmail: async () => null,
  renderLoadedHostEmail: () => null,
  sendEmail: (...args: unknown[]) =>
    sendEmail(...(args as [Record<string, unknown>])),
}))

import { notifyRestockHandler } from './notify-restock'
import { processRestockHandler } from './process-restock'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CRON_SECRET = 'cron-secret'
const HOST = 'host-1'
const PRODUCT = 'product-7'

/** A product with stock, so an alert for it is genuinely owed an email. */
const IN_STOCK = {
  name: 'Kettle',
  slug: 'kettle',
  status: 'active',
  variants: [{ id: 'v1', priceUsd: 30, inventory: 5 }],
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

/** An alert as `notify-restock` writes it, placed at a chosen id. */
function seedAlert(id: string, productId: string) {
  docs.set(`hosts/${HOST}/restockAlerts/${id}`, {
    productId,
    email: `${id}@example.com`,
    notifiedAtMs: null,
    createdAtMs: 1799000000000,
  })
}

async function signup(body: Record<string, unknown>) {
  const { res, result } = makeResponse()
  await notifyRestockHandler(
    { method: 'POST', query: {}, body, cookies: {}, headers: {} } as any,
    res,
  )
  return result
}

async function runCron() {
  const { res, result } = makeResponse()
  await processRestockHandler(
    {
      method: 'POST',
      query: {},
      body: {},
      cookies: {},
      headers: { 'x-cron-secret': CRON_SECRET },
    } as any,
    res,
  )
  return result
}

/** Every alert path still awaiting notification. */
function pendingAlerts(): string[] {
  return [...docs.entries()]
    .filter(
      ([path, data]) =>
        path.includes('/restockAlerts/') && data.notifiedAtMs === null,
    )
    .map(([path]) => path)
    .sort()
}

let consoleErrorSpy: jest.SpyInstance

beforeEach(() => {
  docs.clear()
  nextAutoId = 0
  sendEmail.mockClear()
  meterHostEmail.mockClear()
  process.env.CRON_SECRET = CRON_SECRET
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {
    // The cron logs before its 500; keep the run quiet.
  })
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

// ---------------------------------------------------------------------------
// The defect: one stored id must not be able to stop the run
// ---------------------------------------------------------------------------

describe('a stored productId that names a path (AGL-1774)', () => {
  it('does not abort the platform-wide run', async () => {
    // `hosts/{h}/products/a/b` is FIVE components — odd — so `.doc()` threw
    // synchronously, out of the loop and out of the whole cron. `bbb` sorts
    // after `aaa`, so a real alert behind the poisoned one never got its
    // email, on this run or any later one.
    seedAlert('aaa-poison', 'a/b')
    seedAlert('bbb-real', PRODUCT)
    docs.set(`hosts/${HOST}/products/${PRODUCT}`, { ...IN_STOCK })

    const result = await runCron()

    expect(result.status).toBe(200)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      to: 'bbb-real@example.com',
    })
  })

  it('retires the poisoned alert instead of re-scanning it forever', async () => {
    // The half that made it permanent: the alert was never stamped, so it came
    // back on the next run, and the next.
    seedAlert('aaa-poison', 'a/b')

    await runCron()

    expect(pendingAlerts()).toEqual([])
    expect(docs.get(`hosts/${HOST}/restockAlerts/aaa-poison`)?.skipped).toBe(
      true,
    )
  })

  it('is not reported as an outage', async () => {
    seedAlert('aaa-poison', 'a/b')

    await runCron()

    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('writes and reads nothing at a nested productId', async () => {
    // `a/b/c` is the quieter half: a legal path that resolves nowhere.
    seedAlert('aaa-nested', 'a/b/c')

    await runCron()

    expect(
      [...docs.keys()].filter((path) => path.includes('/products/')),
    ).toEqual([])
    expect(sendEmail).not.toHaveBeenCalled()
    expect(pendingAlerts()).toEqual([])
  })

  it('retires a reserved `__…__` productId rather than throwing', async () => {
    seedAlert('aaa-reserved', '__missing__')

    await runCron()

    expect(pendingAlerts()).toEqual([])
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// The door: nothing new may be stored in that shape
// ---------------------------------------------------------------------------

describe('the signup that stores the id (AGL-1771)', () => {
  it.each([
    ['an even-component path', 'a/b'],
    ['a nested path', 'a/b/c'],
    ['a reserved id', '__missing__'],
    ['self', '.'],
    ['parent', '..'],
  ])('stores nothing for %s as the productId', async (_label, productId) => {
    const result = await signup({
      hostId: HOST,
      productId,
      email: 'dana@example.com',
    })

    expect(result.status).toBe(400)
    expect([...docs.keys()]).toEqual([])
  })

  it('creates nothing beneath a hostId that names a path', async () => {
    // `hosts/a/b/c/restockAlerts/…` is a legal path, so this used to create an
    // alert under a host document that does not exist — invisible to every
    // console list, since they resolve the host first.
    const result = await signup({
      hostId: 'a/b/c',
      productId: PRODUCT,
      email: 'dana@example.com',
    })

    expect(result.status).toBe(400)
    expect([...docs.keys()]).toEqual([])
  })

  it('names the ids rather than blaming the email', async () => {
    const result = await signup({
      hostId: HOST,
      productId: 'a/b/c',
      email: 'dana@example.com',
    })

    expect(result.body.error).toMatch(/hostId or productId/)
  })

  it('still answers the email complaint for a bad email', async () => {
    const result = await signup({
      hostId: HOST,
      productId: PRODUCT,
      email: 'not-an-email',
    })

    expect(result.body).toEqual({ error: 'Enter a valid email' })
    expect([...docs.keys()]).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The behaviour the refusal must not have been bought with
// ---------------------------------------------------------------------------

describe('the ordinary restock alert still works', () => {
  // Guards, not fixes: each passes before and after.
  it('stores a signup with ordinary ids', async () => {
    const result = await signup({
      hostId: HOST,
      productId: PRODUCT,
      email: 'dana@example.com',
    })

    expect(result.status).toBe(200)
    expect(docs.get(`hosts/${HOST}/restockAlerts/auto-1`)).toMatchObject({
      productId: PRODUCT,
      email: 'dana@example.com',
      notifiedAtMs: null,
    })
  })

  it('emails and stamps an alert whose product has stock again', async () => {
    seedAlert('alert-1', PRODUCT)
    docs.set(`hosts/${HOST}/products/${PRODUCT}`, { ...IN_STOCK })

    const result = await runCron()

    expect(result.body).toMatchObject({ sent: 1 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(meterHostEmail).toHaveBeenCalledWith(HOST)
    expect(pendingAlerts()).toEqual([])
  })

  it('leaves an alert pending while the product is still sold out', async () => {
    seedAlert('alert-1', PRODUCT)
    docs.set(`hosts/${HOST}/products/${PRODUCT}`, {
      ...IN_STOCK,
      variants: [{ id: 'v1', priceUsd: 30, inventory: 0 }],
    })

    await runCron()

    expect(sendEmail).not.toHaveBeenCalled()
    expect(pendingAlerts()).toEqual([`hosts/${HOST}/restockAlerts/alert-1`])
  })

  it('skips an alert whose product was deleted', async () => {
    seedAlert('alert-1', PRODUCT)

    await runCron()

    expect(sendEmail).not.toHaveBeenCalled()
    expect(pendingAlerts()).toEqual([])
    expect(docs.get(`hosts/${HOST}/restockAlerts/alert-1`)?.skipped).toBe(true)
  })

  it('rejects a run without the cron secret before reading anything', async () => {
    seedAlert('alert-1', PRODUCT)
    const { res, result } = makeResponse()
    await processRestockHandler(
      {
        method: 'POST',
        query: {},
        body: {},
        cookies: {},
        headers: { 'x-cron-secret': 'wrong' },
      } as any,
      res,
    )

    expect(result.status).toBe(401)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
