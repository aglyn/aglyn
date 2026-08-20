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
 * The register's discount is BOUNDED, REFUSED and ATTRIBUTED (AGL-2161).
 *
 * `discountPct` arrived in the request body and was
 * `Math.min(100, Math.max(0, …))`-ed into range. Three things followed:
 *
 * 1. There was no ceiling a merchant could set. Every non-viewer member could
 *    ring a 100% comp on a route that takes cash and decrements real stock.
 * 2. Out-of-range values were CLAMPED rather than refused, so a register
 *    asking for `150` rang up a full comp and one asking for `-20` rang up
 *    full price — in both cases a sale the operator did not ask for, recorded
 *    as though they had.
 * 3. Nothing recorded who applied it. `decoded.uid` was read once, for the
 *    role gate, and written nowhere, so a comp was indistinguishable from a
 *    correctly-priced sale afterwards.
 *
 * ## What this suite does NOT assert
 *
 * That the default ceiling is below 100. It is 100 on purpose — see
 * `plugin-config.ts`. Lowering it would change what merchants charge their own
 * customers on the day it deployed, which is a merchant policy decision and
 * not a bug fix. What is asserted is that a ceiling EXISTS, is read from the
 * merchant's own settings through the real schema, and is refused rather than
 * rounded when exceeded.
 *
 * The double reads the ceiling through the REAL `mergePluginConfig` and the
 * REAL `COMMERCE_CONFIG_SCHEMA`, so a stored value that production would
 * clamp or reject behaves identically here. A hand-written
 * `{ posMaxDiscountPct: n }` would have reported green for a schema that was
 * never registered at all.
 */

import { mergePluginConfig } from '@aglyn/aglyn'
import { posOrderHandler } from './pos-order'
import {
  COMMERCE_CONFIG_SCHEMA,
  POS_MAX_DISCOUNT_PCT_DEFAULT,
  posMaxDiscountPct,
} from '../plugin-config'

/**
 * STATIC imports, aliased behind `mock`-prefixed names so the hoisted
 * `jest.mock` factory below may reference them.
 *
 * A `require('@aglyn/aglyn')` inside the factory would work at runtime and
 * still be wrong: nx reads it as a DYNAMIC edge, reclassifies `aglyn` as a
 * lazy-loaded library, and then fails `@nx/enforce-module-boundaries` on every
 * STATIC import of it across the whole repo — 144 errors from one `require`.
 */
/**
 * The org-permission resolver (AGL-2474), granted by default. `pos-order.ts`
 * now reads `managePos`; the real resolver would fail closed against this
 * file's closed-world `@aglyn/tenant-data-admin` double and 403 every
 * discount case for a reason none of them are about.
 */
const mockResolveOrgPermissions = jest.fn(async () => ({
  orgId: 'org-1',
  role: 'admin',
  isOwner: true,
  permissions: { managePos: true } as Record<string, boolean>,
  orgWide: true,
  hostRole: 'admin',
}))

const mockMergePluginConfig = mergePluginConfig
const mockCommerceSchema = COMMERCE_CONFIG_SCHEMA

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

function makeSnapshot(path: string): any {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => makeSnapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(
        path,
        options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value,
      )
    },
    /**
     * The atomic claim (`claimAttempt`). Firestore's `create()` rejects when
     * the document already exists, and that rejection IS the dedupe
     * primitive — a double without it 409s every sale, which would have made
     * every assertion in this file green for the wrong reason.
     */
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) {
        throw Object.assign(
          new Error(`ALREADY_EXISTS: entity already exists: ${path}`),
          { code: 6 },
        )
      }
      docs.set(path, value)
    },
    update: async (value: Record<string, any>) => {
      if (!docs.has(path)) {
        throw Object.assign(
          new Error(`NOT_FOUND: no entity to update: ${path}`),
          { code: 5 },
        )
      }
      docs.set(path, { ...(docs.get(path) ?? {}), ...value })
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function childPaths(prefix: string): string[] {
  return [...docs.keys()].filter(
    (key) =>
      key.startsWith(`${prefix}/`) && !key.slice(prefix.length + 1).includes('/'),
  )
}

function makeCollectionRef(path: string): any {
  const ref: any = {
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    get: async () => ({
      docs: childPaths(path).map(makeSnapshot),
      size: childPaths(path).length,
    }),
    add: async (value: Record<string, any>) => {
      const created = makeDocRef(`${path}/auto-${++autoIdCounter}`)
      docs.set(created.path, value)
      return created
    },
    where: () => ref,
    orderBy: () => ref,
    limit: () => ref,
  }
  return ref
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction: async (fn: (transaction: any) => Promise<any>) =>
    fn({
      get: (ref: any) => ref.get(),
      set: (ref: any, value: any, options?: any) => {
        void ref.set(value, options)
      },
    }),
}

const CASHIER_UID = 'cashier-1'
let mockPluginSettings: Record<string, unknown> | undefined

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  ...jest.requireActual('@aglyn/tenant-runtime/org-permissions'),
  resolveOrgPermissions: (...args: any[]) =>
    mockResolveOrgPermissions(...(args as [])),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'cashier-1' }),
      }),
      firestore: () => fakeFirestore,
    }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => '<server-timestamp>',
        arrayUnion: (value: any) => ({ __arrayUnion: value }),
      },
    },
  },
  getOrgForHost: async () => ({
    orgId: 'org-1',
    org: { id: 'org-1', plan: 'business', ownerUid: 'owner-1' },
  }),
  // Through the REAL merge and the REAL schema — see the file docblock.
  getPluginConfig: async (_orgId: unknown, pluginId: string) => {
    if (pluginId !== 'commerce') return {}
    return mockMergePluginConfig(mockCommerceSchema, mockPluginSettings)
  },
  notifyHostManagers: async () => undefined,
  upsertHostContact: async () => undefined,
}))

const fetchMock = jest.fn(async (url: any) => {
  throw new Error(`Unexpected fetch to ${String(url)}`)
})

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

/** $8.00 a unit, so 25% is 200¢ and 100% is 800¢ — no two figures collide. */
const PRODUCT = {
  name: 'Coffee',
  type: 'physical',
  status: 'active',
  variants: [{ id: 'default', priceUsd: 8, inventory: 40 }],
}

interface Result {
  status: number
  body: any
}

async function ring(body: Record<string, unknown> = {}): Promise<Result> {
  const result: Result = { status: 0, body: undefined }
  const res: any = {
    status(code: number) {
      result.status = code
      return res
    },
    json(payload: any) {
      result.body = payload
      return res
    },
  }
  await posOrderHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'idempotency-key': `k-${++autoIdCounter}` },
      body: {
        hostId: 'host-1',
        payment: 'cash',
        cashReceivedCents: 10_000,
        registerId: 'register-1',
        lines: [{ productId: 'product-1', variantId: 'default', quantity: 1 }],
        ...body,
      },
    } as any,
    res,
  )
  return result
}

const orders = () =>
  childPaths('hosts/host-1/orders').map((path) => docs.get(path) as any)

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  docs.clear()
  autoIdCounter = 0
  mockPluginSettings = undefined
  fetchMock.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)

  docs.set('hosts/host-1', { memberRoles: { [CASHIER_UID]: 'editor' } })
  docs.set('hosts/host-1/registers/register-1', {
    name: 'Front counter',
    createdAt: { toMillis: () => 1000 },
  })
  docs.set('hosts/host-1/products/product-1', PRODUCT)
  // An UNSET tax mode refuses the sale outright (AGL-1999), which would 409
  // every case in this file and read as a discount refusal. `none` is the
  // explicit opt-out and is the only setting this suite cares about.
  docs.set('hosts/host-1/settings/store', { tax: { mode: 'none' } })
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------

describe('the premise still holds', () => {
  it('the schema declares the key, in range, with the documented default', () => {
    // If the field were renamed or dropped, every ceiling assertion below
    // would fall back to the default and pass while enforcing nothing.
    const field = COMMERCE_CONFIG_SCHEMA.fields.find(
      (entry) => entry.key === 'posMaxDiscountPct',
    )
    expect(field).toBeDefined()
    expect(field?.type).toBe('number')
    expect(field?.min).toBe(0)
    expect(field?.max).toBe(100)
    expect(COMMERCE_CONFIG_SCHEMA.defaults['posMaxDiscountPct']).toBe(
      POS_MAX_DISCOUNT_PCT_DEFAULT,
    )
  })

  it('an ordinary sale rings up, so a refusal below means the DISCOUNT', () => {
    return ring().then((result) => {
      expect(result.status).toBe(200)
      expect(orders()).toHaveLength(1)
    })
  })
})

describe('the ceiling is enforced and REFUSED, not clamped (AGL-2161)', () => {
  it('refuses a discount past the merchant ceiling', async () => {
    mockPluginSettings = { posMaxDiscountPct: 20 }
    const result = await ring({ discountPct: 50 })

    expect(result.status).toBe(403)
    expect(String(result.body.error)).toContain('20%')
    expect(result.body.maxDiscountPct).toBe(20)
    // THE POINT: refused, not rounded down to 20 and rung up anyway.
    expect(orders()).toHaveLength(0)
  })

  it('POSITIVE CONTROL: at the ceiling exactly, the sale goes through', async () => {
    mockPluginSettings = { posMaxDiscountPct: 20 }
    const result = await ring({ discountPct: 20 })

    expect(result.status).toBe(200)
    expect(orders()).toHaveLength(1)
    // 20% of $8.00.
    expect(orders()[0].totals.discountCents).toBe(160)
  })

  it('a ceiling of 0 stops register discounting entirely', async () => {
    mockPluginSettings = { posMaxDiscountPct: 0 }
    expect((await ring({ discountPct: 1 })).status).toBe(403)
    // And an undiscounted sale still rings, so 0 is a discount ceiling and
    // not an accidental kill switch for the register.
    expect((await ring({ discountPct: 0 })).status).toBe(200)
    expect(orders()).toHaveLength(1)
  })

  it('DEFAULTS TO 100, so no merchant loses a comp they already had', async () => {
    // Deliberate and asserted: the mechanism ships enforced, the number ships
    // unchanged. A default below 100 would change what merchants charge
    // without them asking for it.
    const result = await ring({ discountPct: 100 })
    expect(result.status).toBe(200)
    expect(orders()[0].totals.totalCents).toBe(0)
  })

  it('refuses 150, which used to become a silent 100% comp', async () => {
    // 150 is finite and positive, so it passes the malformed check and meets
    // the CEILING — a 403 naming the limit, not a 400. Either way it is an
    // answer rather than a rounded-down sale.
    const result = await ring({ discountPct: 150 })
    expect(result.status).toBe(403)
    expect(result.body.maxDiscountPct).toBe(100)
    expect(orders()).toHaveLength(0)
  })

  it('refuses -20, which used to become a silent full-price sale', async () => {
    const result = await ring({ discountPct: -20 })
    expect(result.status).toBe(400)
    expect(orders()).toHaveLength(0)
  })

  it('refuses a percentage that is not a number at all', async () => {
    const result = await ring({ discountPct: 'half' })
    expect(result.status).toBe(400)
    expect(orders()).toHaveLength(0)
  })

  it('a junk stored ceiling falls back to the default, never to nothing', async () => {
    // The settings doc is manager-writable. A ceiling that read as `0` or
    // `NaN` from junk would refuse every discount on the platform.
    mockPluginSettings = { posMaxDiscountPct: 'lots' }
    expect((await ring({ discountPct: 100 })).status).toBe(200)
  })

  it('an out-of-range stored ceiling is coerced, not honoured', async () => {
    // 250 must not mean "no ceiling", and -5 must not mean "refuse
    // everything by accident". Both go through the schema's own clamp.
    expect(posMaxDiscountPct({ posMaxDiscountPct: 250 })).toBe(100)
    expect(posMaxDiscountPct({ posMaxDiscountPct: -5 })).toBe(0)
    expect(posMaxDiscountPct({})).toBe(POS_MAX_DISCOUNT_PCT_DEFAULT)
    expect(posMaxDiscountPct(null)).toBe(POS_MAX_DISCOUNT_PCT_DEFAULT)
  })
})

describe('the comp is attributable afterwards (AGL-2161)', () => {
  it('records the percentage and the member who applied it', async () => {
    await ring({ discountPct: 25 })

    const order = orders()[0]
    expect(order.discountPct).toBe(25)
    expect(order.discountBy).toBe(CASHIER_UID)
    // And the derived figure still lands, so the audit is an addition rather
    // than a replacement.
    expect(order.totals.discountCents).toBe(200)
  })

  it('refuses a card sale past the ceiling BEFORE any Stripe call', async () => {
    // The ceiling sits above the tender split, so a card sale is refused
    // without minting a payment link — and `global.fetch` throwing on any
    // target is what proves it, because this box carries the LIVE secret key.
    mockPluginSettings = { posMaxDiscountPct: 10 }
    const result = await ring({ payment: 'link', discountPct: 90 })

    expect(result.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(orders()).toHaveLength(0)
  })

  it('leaves an UNDISCOUNTED sale exactly as it was', async () => {
    // Written only when there is a discount, so ordinary sales keep their
    // current document shape.
    await ring()
    const order = orders()[0]
    expect('discountPct' in order).toBe(false)
    expect('discountBy' in order).toBe(false)
  })
})
