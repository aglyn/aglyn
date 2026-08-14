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
 * AGL-1402: `siteSizeMb` must describe the SITE, not how the site was last
 * saved.
 *
 * `nodes` has three storage forms and `report-usage` used to measure them in
 * two different units — `byteLength` for msgpack bytes, `JSON.stringify().length`
 * for a plain map — so the same page read ~20-45% smaller purely because the
 * besigner had compressed it. A truncated figure announces itself
 * (`siteSizeTruncated`); a figure in the wrong unit does not.
 *
 * So the assertion is a COMPARISON, not a magic number: four orgs, one host
 * each, every host holding the byte-for-byte identical node trees in a
 * different storage form. Whatever unit the rollup settles on, the four
 * `siteSizeMb` figures have to agree — that is the whole property, and it is
 * the one thing a single-form test could never see.
 *
 * The envelope form is not hypothetical: `{type:'Buffer',data:[…]}` is what
 * `JSON.stringify` makes of a Node `Buffer`, and site-export bundles carried it
 * before AGL-1391. It is also the worst case for the old code — a plain object,
 * so it took the JSON arm and every byte was counted as its DECIMAL DIGITS.
 */

import { encode } from '@msgpack/msgpack'

/** Version payloads by ref path, so `getAll` can answer for any of them. */
let mockVersions: Record<string, unknown>
/** What each org's `usage/<month>` doc was written with. */
let mockUsageWrites: Record<string, Record<string, unknown>>

interface SeededHost {
  id: string
  orgId: string
  /** Screen ids; each screen points at a single version, `v1`. */
  screenIds: string[]
}
let mockHosts: SeededHost[]

const MONTH = '2026-07'
const CRON_SECRET = 'test-cron-secret'

const snapshotOf = (id: string, data: Record<string, unknown> | null) => ({
  id,
  exists: data !== null,
  data: () => data ?? undefined,
  get: (field: string) => (data ?? {})[field],
})

/** An empty collection that still answers every shape the route asks for. */
function emptyCollection() {
  const api: any = {
    select: () => api,
    where: () => api,
    limit: () => api,
    orderBy: () => api,
    startAfter: () => api,
    count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    get: async () => ({ docs: [], size: 0, empty: true }),
    doc: (id: string) => ({
      id,
      get: async () => snapshotOf(id, null),
      collection: () => emptyCollection(),
    }),
  }
  return api
}

/**
 * A host's `screens` (or `layouts`) collection as the site-size sweep reads it:
 * ordered by document id, projected to `versionId`, paged. Every seeded host
 * stays well under one page, so the sweep ends on a short page and never
 * reports truncation.
 */
function fakeResourceCollection(host: SeededHost, name: string) {
  const ids = name === 'screens' ? host.screenIds : []
  const api: any = {
    select: () => api,
    where: () => api,
    limit: () => api,
    orderBy: () => api,
    startAfter: () => api,
    get: async () => ({
      docs: ids.map((id) => ({
        id,
        get: (field: string) => (field === 'versionId' ? 'v1' : undefined),
        ref: {
          id,
          collection: () => ({
            doc: (versionId: string) => ({
              id: versionId,
              path: `hosts/${host.id}/${name}/${id}/versions/${versionId}`,
            }),
          }),
        },
      })),
      size: ids.length,
      empty: !ids.length,
    }),
  }
  return api
}

function fakeHostRef(host: SeededHost) {
  return {
    id: host.id,
    collection: (name: string) =>
      name === 'screens' || name === 'layouts'
        ? fakeResourceCollection(host, name)
        : emptyCollection(),
  }
}

function fakeOrgRef(orgId: string) {
  return {
    id: orgId,
    get: async () => snapshotOf(orgId, { plan: 'business' }),
    collection: (name: string) =>
      name === 'usage'
        ? {
            doc: (id: string) => ({
              id,
              get: async () => snapshotOf(id, null),
              set: async (payload: Record<string, unknown>) => {
                mockUsageWrites[orgId] = payload
              },
            }),
          }
        : emptyCollection(),
  }
}

const fakeFirestore = {
  collection: (name: string) => {
    if (name === 'hosts') {
      const api: any = {
        limit: () => api,
        get: async () => ({
          docs: mockHosts.map((host) => ({
            id: host.id,
            get: (field: string) =>
              field === 'orgId' ? host.orgId : field === 'screens' ? {} : undefined,
            ref: fakeHostRef(host),
          })),
          size: mockHosts.length,
        }),
      }
      return api
    }
    if (name === 'orgs') return { doc: (id: string) => fakeOrgRef(id) }
    return emptyCollection()
  },
  getAll: async (...refs: Array<{ path: string }>) =>
    refs.map((ref) => ({
      id: ref.path,
      get: (field: string) =>
        field === 'nodes' ? mockVersions[ref.path] : undefined,
    })),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: {
      FieldPath: { documentId: () => '__name__' },
      FieldValue: { serverTimestamp: () => '__server_timestamp__' },
    },
  },
  readOrgBilling: async () => ({}),
  // The real arithmetic (AGL-1438) — it is pure, and a stub returning 0 would
  // let a rollup that miscounts the overage pass this suite.
  emailSendsOverage: jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/email-metering',
  ).emailSendsOverage,
  // Inert here: this suite measures SITE SIZE. The contacts release gate
  // (AGL-1604) has its own suite, and these orgs hold no contacts.
  getServerReleaseFlagValues: async () => ({}),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan entitlements and the REAL stored-nodes/measurement helpers.
  // Stubbing the decode is how a suite passes against a rollup that still
  // measures two units, so none of it is stubbed.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/stored-nodes'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/measure-node-map'),
  isReleaseFlagOn: () => false,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: {
      'x-cron-secret': request.headers.get('x-cron-secret') ?? undefined,
    },
  }),
}))

// Screen-cap reconciliation (AGL-1390) reads its own documents and has its own
// suite; site size is what is under test here.
jest.mock('../utils/screen-cap-reconciliation', () => ({
  __esModule: true,
  measureScreenCaps: async () => ({ maxBillable: 0, overCapHostIds: [] }),
}))

import { POST } from '../app/api/billing/report-usage/route'

/**
 * A node map with the shape that actually makes the two units diverge: many
 * short repeated keys, numeric and boolean props, and non-ASCII copy.
 *
 * The copy is deliberate. `String.length` counts UTF-16 code units, so accented
 * text UNDERCOUNTS its UTF-8 size on the JSON arm while the JSON punctuation
 * pushes the same arm the other way — the two errors do not cancel, they just
 * make the number unattributable.
 */
function marketingTree(screenId: string): Record<string, unknown> {
  const nodes: Record<string, unknown> = {}
  for (let index = 0; index < 800; index += 1) {
    nodes[`${screenId}-n${index}`] = {
      component: index % 3 === 0 ? 'aglyn-text' : 'aglyn-container',
      parentId: `${screenId}-n${Math.max(0, index - 1)}`,
      props: {
        text: `Prêt à créer — bloc ${index} • réponse en français`,
        align: 'center',
        maxWidth: 1328,
        spacing: index % 7,
        order: index,
        visible: index % 5 !== 0,
        sticky: false,
      },
      children: [],
    }
  }
  return nodes
}

/** The identical trees every seeded host holds, one per screen. */
const SCREEN_IDS = ['s1', 's2', 's3', 's4', 's5', 's6']
const TREES = Object.fromEntries(
  SCREEN_IDS.map((id) => [id, marketingTree(id)]),
) as Record<string, Record<string, unknown>>

/** The three live storage forms, plus the plain map they all decode to. */
const FORMS: Record<string, (tree: Record<string, unknown>) => unknown> = {
  // A plain Firestore map — what an `updateDoc` that bypassed the converter
  // leaves behind.
  plain: (tree) => tree,
  // What the Admin SDK materialises a msgpack `Bytes` field as.
  buffer: (tree) => Buffer.from(encode(tree)),
  // The client SDK's `Bytes` wrapper — NOT an `ArrayBuffer` view (AGL-1397).
  bytes: (tree) => ({ toUint8Array: () => encode(tree) }),
  // `JSON.stringify` of a Node `Buffer` — carried by pre-AGL-1391 exports.
  envelope: (tree) => ({ type: 'Buffer', data: Array.from(encode(tree)) }),
}

function seed() {
  mockVersions = {}
  mockUsageWrites = {}
  mockHosts = Object.keys(FORMS).map((form) => {
    const host: SeededHost = {
      id: `host-${form}`,
      orgId: `org-${form}`,
      screenIds: SCREEN_IDS,
    }
    for (const screenId of SCREEN_IDS) {
      mockVersions[`hosts/${host.id}/screens/${screenId}/versions/v1`] =
        FORMS[form](TREES[screenId])
    }
    return host
  })
}

async function rollUp() {
  const response = await POST(
    new Request('https://app.aglyn.com/api/billing/report-usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': CRON_SECRET,
      },
      body: JSON.stringify({ month: MONTH }),
    }),
  )
  expect(response.status).toBe(200)
  return Object.fromEntries(
    Object.keys(FORMS).map((form) => [
      form,
      mockUsageWrites[`org-${form}`]?.siteSizeMb as number,
    ]),
  )
}

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
  delete process.env.STRIPE_SECRET_KEY
  seed()
})

describe('siteSizeMb across the three stored `nodes` forms', () => {
  it('reports the same size for identical trees however they are stored', async () => {
    const sizes = await rollUp()

    // Guard against a vacuous pass: `siteSizeMb` rounds to one decimal, so
    // four zeroes would "agree" while measuring nothing. These trees are
    // ~1 MB per host precisely so the units cannot hide behind the rounding.
    expect(sizes.plain).toBeGreaterThan(0.5)

    expect(sizes.buffer).toBeCloseTo(sizes.plain, 5)
    expect(sizes.bytes).toBeCloseTo(sizes.plain, 5)
    expect(sizes.envelope).toBeCloseTo(sizes.plain, 5)
  })

  it('does not report truncation for a site well under the ceiling', async () => {
    await rollUp()
    for (const form of Object.keys(FORMS)) {
      expect(mockUsageWrites[`org-${form}`].siteSizeTruncated).toBe(false)
    }
  })
})
