/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
 *
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
 * AGL-2276 — contact writes over `/v1`, and the money half of them.
 *
 * `/v1` is metered (`apiRequestsPerMonth`) and gated (`apiAccess`), and
 * AGL-2253 had just found `POST /v1/datasets/{id}/records` enforcing neither
 * `recordsPerDataset` nor `dataStorageMbPerOrg`. So a new write on this
 * surface is not done when it works; it is done when the band refuses, the
 * meter counts, and the key deduplicates.
 *
 * ## What each block has to prove, and what would make it lie
 *
 * - **The band.** A quota suite that only shows a refusal is satisfied by a
 *   route that refuses everything. So the negative control leads (a metered
 *   plan a thousandfold past its band still creates) and every refusal pins
 *   BOTH sides: the last permitted contact lands, the next is refused.
 * - **The meter.** A metering assertion that only checks "a usage row exists"
 *   is satisfied by a route recording a constant. So the counter is read after
 *   a KNOWN number of requests, and again on top of a pre-existing value —
 *   `set({ count: 1 })` in place of `increment(1)` has to go red.
 * - **The projection.** A view that omits a field `PATCH` accepts leaves a
 *   client unable to tell a dropped write from a narrow view. So the writable
 *   set and the published view are asserted against each other rather than
 *   field by field.
 * - **The key.** A replay must return the ORIGINAL result *and* write nothing
 *   the second time — asserting only the status lets a double-write pass.
 */

const mockDocs = new Map<string, Record<string, unknown>>()
let mockOrg: Record<string, unknown> = { plan: 'business' }
let mockScopes: string[] = ['contacts:read', 'contacts:write']
let mockUidSeq = 0

const mockMonth = new Date().toISOString().slice(0, 7)

/**
 * Firestore's `FieldValue.increment` as a SENTINEL the mock `set` resolves,
 * not as `(n) => n`. The identity fake would make every increment an
 * overwrite, so a route that wrote `{ count: 1 }` on every request would
 * report the same number as one that increments — and the metering assertion
 * below, the whole point of the block, could never fail.
 */
class MockIncrement {
  mockBy = 0
}
const mockIncrement = (by: number) => {
  const sentinel = new MockIncrement()
  sentinel.mockBy = by
  return sentinel
}

function mockResolveWrite(
  existing: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    out[key] =
      value instanceof MockIncrement
        ? Number(existing?.[key] ?? 0) + value.mockBy
        : value
  }
  return out
}

function mockDocRef(path: string) {
  const id = path.slice(path.lastIndexOf('/') + 1)
  const snapshot = () => ({
    id,
    ref: mockDocRef(path),
    exists: mockDocs.has(path),
    data: () => mockDocs.get(path),
    get: (field: string) => mockDocs.get(path)?.[field],
  })
  return {
    path,
    id,
    collection: (name: string) => mockCollectionRef(`${path}/${name}`),
    get: async () => snapshot(),
    create: async (data: Record<string, unknown>) => {
      // `create` is not an upsert. Modelled exactly, because Firestore's
      // rejection on an existing document IS the idempotency primitive.
      if (mockDocs.has(path)) throw new Error('ALREADY_EXISTS')
      mockDocs.set(path, mockResolveWrite(undefined, data))
    },
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      const existing = mockDocs.get(path)
      mockDocs.set(path, {
        ...(options?.merge ? (existing ?? {}) : {}),
        ...mockResolveWrite(existing, data),
      })
    },
    update: async (data: Record<string, unknown>) => {
      const existing = mockDocs.get(path)
      mockDocs.set(path, { ...(existing ?? {}), ...mockResolveWrite(existing, data) })
    },
    delete: async () => {
      mockDocs.delete(path)
    },
  }
}

/** Immediate children of a collection path — not grandchildren. */
function mockChildPaths(collectionPath: string): string[] {
  const prefix = `${collectionPath}/`
  return [...mockDocs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

interface MockFilter {
  field: string
  value: unknown
}

function mockQuery(collectionPath: string, filters: MockFilter[], take: number) {
  const run = () => {
    const paths = mockChildPaths(collectionPath)
      .filter((path) =>
        filters.every((filter) => mockDocs.get(path)?.[filter.field] === filter.value),
      )
      .sort()
    const docs = (take > 0 ? paths.slice(0, take) : paths).map((path) => {
      const id = path.slice(path.lastIndexOf('/') + 1)
      return {
        id,
        ref: mockDocRef(path),
        exists: true,
        data: () => mockDocs.get(path),
        get: (field: string) => mockDocs.get(path)?.[field],
      }
    })
    return { empty: docs.length === 0, docs, size: docs.length }
  }
  const self: Record<string, unknown> = {
    where: (field: string, _op: string, value: unknown) =>
      mockQuery(collectionPath, [...filters, { field, value }], take),
    orderBy: () => self,
    startAfter: () => self,
    limit: (n: number) => mockQuery(collectionPath, filters, n),
    get: async () => run(),
    count: () => ({
      get: async () => ({ data: () => ({ count: run().docs.length }) }),
    }),
  }
  return self as never as {
    where: (field: string, op: string, value: unknown) => ReturnType<typeof mockQuery>
    orderBy: () => ReturnType<typeof mockQuery>
    startAfter: () => ReturnType<typeof mockQuery>
    limit: (n: number) => ReturnType<typeof mockQuery>
    get: () => Promise<{ empty: boolean; docs: unknown[]; size: number }>
    count: () => { get: () => Promise<{ data: () => { count: number } }> }
  }
}

function mockCollectionRef(path: string) {
  const query = mockQuery(path, [], 0)
  return {
    ...query,
    path,
    doc: (id: string) => mockDocRef(`${path}/${id}`),
  }
}

const mockFirestore = { collection: (name: string) => mockCollectionRef(name) }

jest.mock('@aglyn/tenant-data-admin', () => {
  const apiHttp = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/api-http',
  )
  return {
    __esModule: true,
    ...apiHttp,
    verifyApiKey: async () => ({
      orgId: 'org-1',
      keyId: 'key-1',
      scopes: mockScopes,
    }),
    getOrgDoc: async () => mockOrg,
    lockdownRefusal: async () => null,
    // The per-minute limiter is not under test; always allow, with the real
    // header shape, so no refusal below can be it in disguise.
    consumeRateLimit: async () => ({
      allowed: true,
      limit: 120,
      remaining: 119,
      resetMs: Date.now() + 60_000,
      degraded: false,
    }),
    firebaseAdmin: {
      app: () => ({ firestore: () => mockFirestore }),
      firestore: {
        FieldValue: {
          increment: (n: number) => mockIncrement(n),
          serverTimestamp: () => 'NOW',
        },
      },
    },
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL idempotency claim, the REAL plan table, the REAL contact
  // normalizer and the REAL scope token. Stubbing any of them would make
  // every assertion below a statement about the stub — and the audience band
  // is exactly what is under test.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/api-idempotency'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/contacts'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/scope-tokens'),
  effectiveDatasetModel: () => ({ fields: [] }),
  coerceDocumentValues: (_model: unknown, values: Record<string, unknown>) => values,
  validateDocument: () => ({}),
  createResourceUid: () => `con_${++mockUidSeq}`,
}))

jest.mock('firebase-admin/firestore', () => {
  // A CLASS, not an object literal: `serialize` narrows with
  // `value instanceof Timestamp`, and a plain object there throws
  // "Right-hand side of 'instanceof' is not callable" — which the route's
  // outer handler turns into a 500 that looks exactly like a refusal working.
  class MockTimestamp {
    mockMs = 0
    toDate() {
      return new Date(this.mockMs)
    }
    toMillis() {
      return this.mockMs
    }
    static now() {
      return new MockTimestamp()
    }
    static fromMillis(mockMillis: number) {
      const stamp = new MockTimestamp()
      stamp.mockMs = mockMillis
      return stamp
    }
  }
  return {
    __esModule: true,
    FieldPath: { documentId: () => '__name__' },
    Timestamp: MockTimestamp,
  }
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DELETE, GET, PATCH, POST } from '../app/api/v1/[[...route]]/route'
import { checkContactQuota, PLAN_ENTITLEMENTS } from '@aglyn/aglyn/app-utils/plan-entitlements'

/**
 * Read as SOURCE, not imported. `@aglyn/tenant-data-admin` is wholesale-mocked
 * above — a closed world — so an import of `API_SCOPES` here would resolve to
 * the mock and assert nothing about the real constant.
 */
const readSource = (...parts: string[]) =>
  readFileSync(join(__dirname, '..', '..', '..', ...parts), 'utf8')

const CONTACTS_PATH = 'orgs/org-1/contacts'

const request = (
  path: string,
  method: string,
  body?: unknown,
  idempotencyKey?: string,
) =>
  new Request(`https://app.aglyn.com/api/v1/${path}`, {
    method,
    headers: {
      authorization: 'Bearer k',
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const routeContext = (segments: string[]) => ({
  params: Promise.resolve({ route: segments }),
})

const postContact = (body: unknown, idempotencyKey?: string) =>
  POST(request('contacts', 'POST', body, idempotencyKey), routeContext(['contacts']))

const patchContact = (id: string, body: unknown) =>
  PATCH(request(`contacts/${id}`, 'PATCH', body), routeContext(['contacts', id]))

const deleteContact = (id: string, idempotencyKey?: string) =>
  DELETE(
    request(`contacts/${id}`, 'DELETE', undefined, idempotencyKey),
    routeContext(['contacts', id]),
  )

const getContact = (id: string) =>
  GET(request(`contacts/${id}`, 'GET'), routeContext(['contacts', id]))

const contactCount = () => mockChildPaths(CONTACTS_PATH).length

/** `n` pre-existing contacts, as capture points would have left them. */
const seedContacts = (n: number) => {
  for (let index = 0; index < n; index += 1) {
    mockDocs.set(`${CONTACTS_PATH}/seed-${index}`, {
      email: `seed-${index}@example.com`,
      sources: { form: true },
      tags: [],
    })
  }
}

/**
 * An org whose API access is a STAFF OVERRIDE on a plan that meters no
 * audience overage — the only shape that can reach `/v1` and still be refused
 * by the band, and therefore the only shape the band can be observed through.
 * This is not a hypothetical: it is exactly the shape AGL-2163 found running
 * unbounded on the request meter.
 */
const overriddenOrg = (contactsPerHost: number) => ({
  plan: 'free',
  entitlements: {
    features: { apiAccess: true },
    apiRequestsPerMonth: 1_000_000,
    contactsPerHost,
  },
})

/** The live monthly API-request meter this surface bills from. */
const meteredRequests = () =>
  Number(mockDocs.get(`orgs/org-1/apiUsage/${mockMonth}`)?.count ?? 0)

/** `recordApiRequest` is fire-and-forget; let its microtasks settle. */
const settleMeter = () => new Promise((resolve) => setImmediate(resolve))

beforeEach(() => {
  mockDocs.clear()
  mockUidSeq = 0
  mockScopes = ['contacts:read', 'contacts:write']
  mockOrg = { plan: 'business', subscription: { status: 'active' } }
})

describe('the premise', () => {
  it('business meters the audience band, so it may never be refused', () => {
    expect(PLAN_ENTITLEMENTS.business.features.apiAccess).toBe(true)
    // Metered: `allowed` is true at any usage, so no refusal in this suite can
    // be business's own band wearing a different coat.
    expect(checkContactQuota({ plan: 'business' } as never, 10_000_000).allowed).toBe(
      true,
    )
    expect(checkContactQuota({ plan: 'free' } as never, 10_000_000).allowed).toBe(
      false,
    )
  })

  it('contacts:write is both mintable and enforced — AGL-899s condition', () => {
    // The scope and the endpoints ship together or neither ships. A scope no
    // endpoint enforces is a broken permission (why AGL-899 removed this one);
    // an endpoint whose scope cannot be minted is closed to every customer.
    // Both halves, from source, so neither can drift alone.
    expect(
      readSource('libs/tenant/data/admin/src/lib/server/api-keys.ts'),
    ).toContain("'contacts:write'")
    expect(readSource('apps/console/utils/api-v1-resources.ts')).toContain(
      "requireScope(ctx, 'contacts:write')",
    )
    // And it is offered in the console picker, without which nobody can grant
    // it. `api-scope-picker-coverage.spec.ts` owns this rule; asserted here
    // too because a scope that exists on both sides of the wire and cannot be
    // selected is the same closed endpoint by another route.
    expect(
      readSource('apps/console/components/org-api-keys-card.component.tsx'),
    ).toContain("scope: 'contacts:write'")
  })
})

describe('NEGATIVE CONTROL: a paying customer is never refused by the band', () => {
  it('creates a contact with the audience a thousandfold past the band', async () => {
    seedContacts(20)
    const response = await postContact({ email: 'new@example.com' })
    expect(response.status).toBe(201)
    expect(contactCount()).toBe(21)
    // And the band it was measured against really is the metered one.
    expect(checkContactQuota(mockOrg as never, 100_000_000).allowed).toBe(true)
  })
})

describe('the audience band (AGL-890) is enforced on create', () => {
  beforeEach(() => {
    mockOrg = overriddenOrg(5)
  })

  it('creates the LAST contact inside the band', async () => {
    seedContacts(4)
    const response = await postContact({ email: 'fifth@example.com' })
    expect(response.status).toBe(201)
    expect(contactCount()).toBe(5)
  })

  it('refuses the NEXT one and writes nothing', async () => {
    seedContacts(5)
    const response = await postContact({ email: 'sixth@example.com' })
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error.type).toBe('plan_required')
    expect(body.error.code).toBe('contact_quota')
    expect(String(body.error.message)).toContain('5')
    // Refused AND unwritten. "403 with the contact created anyway" is the same
    // defect with a status code in front of it.
    expect(contactCount()).toBe(5)
  })

  it('does not BURN the idempotency key on the quota refusal', async () => {
    // The rule `createDataset` states: a plan refusal is the most retried
    // failure there is — it clears when somebody upgrades — so the retry that
    // finally should succeed must not replay the refusal forever.
    seedContacts(5)
    expect((await postContact({ email: 'sixth@example.com' }, 'k-1')).status).toBe(403)
    mockOrg = overriddenOrg(50)
    const retried = await postContact({ email: 'sixth@example.com' }, 'k-1')
    expect(retried.status).toBe(201)
    expect(contactCount()).toBe(6)
  })

  it('a create that exactly FILLS the band still replays on retry', async () => {
    // The hole in `createRecord`/`createDataset`'s quota-then-claim ordering,
    // pinned here (AGL-2278 applies the fix to those two). The first call
    // consumes the last slot; the retry re-counts, is now AT the band, and
    // under that ordering answers 403 instead of the replay `conventions.md`
    // promises — leaving the integrator unable to tell whether the contact
    // exists. Claiming above the refusals is what makes this 200.
    seedContacts(4)
    const first = await postContact({ email: 'fifth@example.com' }, 'k-band')
    expect(first.status).toBe(201)
    const created = await first.json()
    expect(contactCount()).toBe(5)

    const retried = await postContact({ email: 'fifth@example.com' }, 'k-band')
    expect(retried.status).toBe(200)
    expect(await retried.json()).toEqual(created)
    expect(contactCount()).toBe(5)
  })

  it('the PATCH is not banded — a full audience can still be corrected', async () => {
    // An edit does not grow the audience. Charging a plan refusal for renaming
    // somebody would leave a downgraded org unable to fix its own data.
    seedContacts(5)
    const response = await patchContact('seed-0', { name: 'Corrected' })
    expect(response.status).toBe(200)
    expect((await response.json()).name).toBe('Corrected')
  })
})

describe('a contact created through the API enters the billed count', () => {
  it('moves the aggregate the monthly rollup prices the audience from', async () => {
    // `report-usage` bills the audience band off `orgs/{orgId}/contacts`
    // `count()`, without caring who wrote each row. This is the assertion that
    // the API is not a free door: the count it moves is the billed count, and
    // the overage computed from it grows accordingly.
    mockOrg = overriddenOrg(2)
    expect(checkContactQuota(mockOrg as never, contactCount()).used).toBe(0)
    await postContact({ email: 'one@example.com' })
    await postContact({ email: 'two@example.com' })
    expect(contactCount()).toBe(2)
    expect(checkContactQuota(mockOrg as never, contactCount()).used).toBe(2)
    expect(checkContactQuota(mockOrg as never, contactCount()).remaining).toBe(0)

    // On a metered plan the same two rows are priced rather than refused.
    const metered = checkContactQuota({ plan: 'starter' } as never, 1_002)
    expect(metered.allowed).toBe(true)
    expect(metered.overageContacts).toBe(2)
  })
})

describe('the request meter counts what happened, not a constant', () => {
  it('records one increment per request, from zero', async () => {
    await postContact({ email: 'a@example.com' })
    await postContact({ email: 'b@example.com' })
    await postContact({ email: 'c@example.com' })
    await settleMeter()
    // Three requests, three. A route recording a CONSTANT — `set({ count: 1 })`
    // in place of `increment(1)` — reports 1 here and is red.
    expect(meteredRequests()).toBe(3)
  })

  it('accumulates ON TOP of the month already spent', async () => {
    // The case a constant survives if the counter merely starts at zero: seed
    // a month in progress and require the endpoint to add to it.
    mockDocs.set(`orgs/org-1/apiUsage/${mockMonth}`, { count: 41, month: mockMonth })
    await postContact({ email: 'a@example.com' })
    await getContact('con_1')
    await settleMeter()
    expect(meteredRequests()).toBe(43)
  })

  it('meters the reads and the refusals that got past auth too', async () => {
    mockOrg = overriddenOrg(0)
    const refused = await postContact({ email: 'a@example.com' })
    expect(refused.status).toBe(403)
    await settleMeter()
    // Metered: the request was authenticated, rate-limited and served. Only
    // 401/403-at-the-door and 429 escape the meter, by construction — the
    // quota refusal happens downstream of it.
    expect(meteredRequests()).toBe(1)
  })
})

describe('idempotency on POST /v1/contacts', () => {
  it('replays the ORIGINAL result and does not double-write', async () => {
    const first = await postContact({ email: 'dup@example.com' }, 'k-9')
    expect(first.status).toBe(201)
    const created = await first.json()
    expect(contactCount()).toBe(1)

    const replay = await postContact({ email: 'dup@example.com' }, 'k-9')
    // 200, not 201 — the documented way a client tells a replay from a fresh
    // create.
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(created)
    // The half an assertion on status alone would miss.
    expect(contactCount()).toBe(1)
  })

  it('a second create for the same email without a key is a 409, not a twin', async () => {
    await postContact({ email: 'dup@example.com' })
    const second = await postContact({ email: 'dup@example.com' })
    expect(second.status).toBe(409)
    const body = await second.json()
    expect(body.error.code).toBe('contact_exists')
    expect(String(body.error.message)).toContain('con_1')
    expect(contactCount()).toBe(1)
  })

  it('the delete replays its receipt, and a wrong id still 404s', async () => {
    await postContact({ email: 'gone@example.com' })
    const first = await deleteContact('con_1', 'k-del')
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({
      id: 'con_1',
      object: 'contact',
      deleted: true,
    })
    expect(contactCount()).toBe(0)

    const replay = await deleteContact('con_1', 'k-del')
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual({
      id: 'con_1',
      object: 'contact',
      deleted: true,
    })

    // A different key against an id that was never there: the 404 survives, so
    // a typo is still distinguishable from a completed erasure.
    const missing = await deleteContact('con_404', 'k-other')
    expect(missing.status).toBe(404)
  })

  it("a create's key never replays into a delete", async () => {
    await postContact({ email: 'kept@example.com' }, 'shared')
    const deleted = await deleteContact('con_1', 'shared')
    // Two operations, not one: the `kind` is hashed into the digest, so the
    // delete does its own work rather than replaying the create's body — which
    // a client would parse as a successful deletion that never happened.
    expect(deleted.status).toBe(200)
    expect((await deleted.json()).deleted).toBe(true)
    expect(contactCount()).toBe(0)
  })
})

describe('the projection carries every field the resource accepts', () => {
  it('reads back exactly what PATCH wrote', async () => {
    // The AGL-2216 shape: a view that omits a writable field leaves a client
    // unable to tell a dropped write from a narrow projection. Asserted as a
    // property of the pair — write all of them, read all of them.
    await postContact({ email: 'full@example.com' })
    const patched = await patchContact('con_1', {
      name: 'Robin Wholesale',
      tags: ['b2b', 'vip'],
      notes: 'Renews in March.',
      marketingConsent: true,
    })
    expect(patched.status).toBe(200)
    const view = await patched.json()
    expect(view).toMatchObject({
      id: 'con_1',
      object: 'contact',
      email: 'full@example.com',
      name: 'Robin Wholesale',
      tags: ['b2b', 'vip'],
      notes: 'Renews in March.',
      marketingConsent: true,
      sources: ['api'],
    })
    // And a fresh GET agrees — the PATCH response is not a local echo.
    expect(await (await getContact('con_1')).json()).toMatchObject({
      notes: 'Renews in March.',
      marketingConsent: true,
      tags: ['b2b', 'vip'],
    })
  })

  it('an empty tags array clears the tags rather than being ignored', async () => {
    await postContact({ email: 'full@example.com', tags: ['old'] })
    const cleared = await patchContact('con_1', { tags: [] })
    expect((await cleared.json()).tags).toEqual([])
  })
})

describe('what a contact write may NOT do', () => {
  it('refuses to rewrite the email a contact is identified by', async () => {
    await postContact({ email: 'keyed@example.com' })
    const response = await patchContact('con_1', { email: 'other@example.com' })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe('validation_failed')
    expect(body.error.fields.email).toContain('Not writable')
    // Named, not dropped — and unchanged.
    expect(mockDocs.get(`${CONTACTS_PATH}/con_1`)?.email).toBe('keyed@example.com')
  })

  it('refuses to rewrite provenance', async () => {
    await postContact({ email: 'keyed@example.com' })
    const response = await patchContact('con_1', { sources: { order: true } })
    expect(response.status).toBe(400)
    expect((await response.json()).error.fields.sources).toContain('Not writable')
    expect(mockDocs.get(`${CONTACTS_PATH}/con_1`)?.sources).toEqual({ api: true })
  })

  it('refuses a create with no usable email, and writes nothing', async () => {
    const response = await postContact({ name: 'No Email' })
    expect(response.status).toBe(400)
    expect((await response.json()).error.fields.email).toBeTruthy()
    expect(contactCount()).toBe(0)
  })

  it('normalizes the email with the SAME rule every capture point uses', async () => {
    await postContact({ email: '  MiXeD@Example.COM  ' })
    expect(mockDocs.get(`${CONTACTS_PATH}/con_1`)?.email).toBe('mixed@example.com')
    // Which is what makes the duplicate check work across casings — the whole
    // reason the normalizer is shared rather than re-implemented here.
    const second = await postContact({ email: 'MIXED@EXAMPLE.COM' })
    expect(second.status).toBe(409)
  })
})

describe('the created contact is actually visible (AGL-1044)', () => {
  it('stamps visibleTo, without which it renders on no site at all', async () => {
    await postContact({ email: 'seen@example.com' })
    // A contact written without this matches no `array-contains-any`, so the
    // API would be creating data nobody can read — worse than refusing.
    expect(mockDocs.get(`${CONTACTS_PATH}/con_1`)?.visibleTo).toEqual(['org'])
  })
})

describe('scope', () => {
  beforeEach(() => {
    mockScopes = ['contacts:read']
  })

  it('a read-only key cannot create, edit or delete', async () => {
    seedContacts(1)
    for (const response of [
      await postContact({ email: 'a@example.com' }),
      await patchContact('seed-0', { name: 'x' }),
      await deleteContact('seed-0'),
    ]) {
      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error.type).toBe('insufficient_scope')
      expect(body.error.code).toBe('contacts:write')
    }
    // Nothing moved.
    expect(contactCount()).toBe(1)
    expect(mockDocs.get(`${CONTACTS_PATH}/seed-0`)?.name).toBeUndefined()
  })

  it('but can still read', async () => {
    seedContacts(1)
    const response = await GET(request('contacts', 'GET'), routeContext(['contacts']))
    expect(response.status).toBe(200)
    expect((await response.json()).data).toHaveLength(1)
  })
})
