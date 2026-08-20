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

import { uploadFixtureBase64 } from './upload-fixture-bytes'

/**
 * AGL-2463 — media writes over `/v1`.
 *
 * `media:read` was the only media scope, so an agency onboarding a client site
 * could automate everything about it except putting its images in it.
 *
 * ## What each block has to prove, and what would make it lie
 *
 * - **The money.** Storage is a CHARGED dimension, so an upload path that
 *   skipped the band would be a free-tier escape through the paid API. The
 *   negative control leads — an org inside its band uploads — and the refusal
 *   then pins the other side, asserting that the bytes did NOT land and that
 *   the counter did NOT move. A quota suite showing only a refusal is
 *   satisfied by a route that refuses everything.
 * - **The counter.** `report-usage` bills from `counters/media.bytes`, so an
 *   assertion that "a counter exists" is satisfied by a route recording a
 *   constant. The counter is asserted to have moved by the file's EXACT byte
 *   length, and again on top of a pre-existing value — `set({ bytes: n })` in
 *   place of `increment(n)` has to go red.
 * - **The key.** A quota refusal must RELEASE the idempotency key
 *   (`createContact`'s rule): an upload that exactly fills the band must stay
 *   retryable, or the integrator cannot tell whether the file landed. So the
 *   retry after a refusal is asserted to genuinely re-run, not replay the 403.
 * - **The validation.** Each refusal names the thing it refused, and each is
 *   paired with the case that must still succeed, so a handler that rejects
 *   everything cannot pass.
 */

const mockDocs = new Map<string, Record<string, unknown>>()
let mockOrg: Record<string, unknown> = { plan: 'business', hosts: { 'host-1': true } }
let mockScopes: string[] = ['media:read', 'media:write']
let mockUidSeq = 0
/** Objects written to the storage bucket, by path. */
let mockObjects = new Map<string, { bytes: number; contentType: string }>()
let mockQuarantined = false

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

function mockSnapshot(path: string) {
  const id = path.slice(path.lastIndexOf('/') + 1)
  return {
    id,
    ref: mockDocRef(path),
    exists: mockDocs.has(path),
    data: () => mockDocs.get(path),
    get: (field: string) => mockDocs.get(path)?.[field],
  }
}

function mockDocRef(path: string) {
  return {
    path,
    id: path.slice(path.lastIndexOf('/') + 1),
    collection: (name: string) => mockCollectionRef(`${path}/${name}`),
    get: async () => mockSnapshot(path),
    create: async (data: Record<string, unknown>) => {
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
      mockDocs.set(path, {
        ...(mockDocs.get(path) ?? {}),
        ...mockResolveWrite(mockDocs.get(path), data),
      })
    },
    delete: async () => {
      mockDocs.delete(path)
    },
  }
}

function mockChildPaths(collectionPath: string): string[] {
  const prefix = `${collectionPath}/`
  return [...mockDocs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function mockQuery(collectionPath: string, filters: Array<{ field: string; value: unknown }>, take: number) {
  const run = () => {
    const paths = mockChildPaths(collectionPath)
      .filter((path) => filters.every((f) => mockDocs.get(path)?.[f.field] === f.value))
      .sort()
    const docs = (take > 0 ? paths.slice(0, take) : paths).map((path) => mockSnapshot(path))
    return { empty: docs.length === 0, docs, size: docs.length }
  }
  const self: Record<string, unknown> = {
    where: (field: string, _op: string, value: unknown) =>
      mockQuery(collectionPath, [...filters, { field, value }], take),
    orderBy: () => self,
    startAfter: () => self,
    select: () => self,
    limit: (n: number) => mockQuery(collectionPath, filters, n),
    get: async () => run(),
    count: () => ({ get: async () => ({ data: () => ({ count: run().docs.length }) }) }),
  }
  return self as never
}

function mockCollectionRef(path: string) {
  return {
    ...(mockQuery(path, [], 0) as object),
    path,
    doc: (id: string) => mockDocRef(`${path}/${id}`),
  } as never as ReturnType<typeof mockQuery> & {
    path: string
    doc: (id: string) => ReturnType<typeof mockDocRef>
  }
}

const mockFirestore = {
  collection: (name: string) => mockCollectionRef(name),
  // `resolveOrgMediaBand` reads every media counter in ONE getAll.
  getAll: async (...refs: Array<{ path: string }>) =>
    refs.map((ref) => mockSnapshot(ref.path)),
}

const mockBucket = {
  name: 'test-bucket',
  file: (path: string) => ({
    name: path,
    save: async (buffer: Buffer | Uint8Array, options?: { contentType?: string }) => {
      mockObjects.set(path, {
        bytes: buffer.length,
        contentType: options?.contentType ?? '',
      })
    },
    setMetadata: async () => undefined,
    delete: async () => {
      mockObjects.delete(path)
    },
    exists: async () => [mockObjects.has(path)],
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => {
  const apiHttp = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/api-http',
  )
  return {
    __esModule: true,
    ...apiHttp,
    verifyApiKey: async () => ({ orgId: 'org-1', keyId: 'key-1', scopes: mockScopes }),
    getOrgDoc: async () => mockOrg,
    lockdownRefusal: async () => null,
    consumeRateLimit: async () => ({
      allowed: true,
      limit: 120,
      remaining: 119,
      resetMs: Date.now() + 60_000,
      degraded: false,
      contended: false,
    }),
    // The takedown ledger. Real semantics: a hash on the list refuses.
    getMediaQuarantine: async () =>
      mockQuarantined ? { reason: 'malware', status: 'active' } : null,
    // Models the REAL `MediaVariantOutcome` — `{ variants: number[] }`, and a
    // `saveVariant(path, webp)` of exactly two arguments. An approximate fake
    // here fabricated a green over a route reading `.widths` off a field that
    // does not exist, which would have stored `variants: []` on every asset.
    generateMediaVariants: async (options: {
      objectPath: string
      saveVariant: (path: string, webp: Buffer) => Promise<void>
    }) => {
      await options.saveVariant(`${options.objectPath}__w320.webp`, Buffer.alloc(16))
      return { variants: [320] }
    },
    firebaseAdmin: {
      app: () => ({
        firestore: () => mockFirestore,
        storage: () => ({ bucket: () => mockBucket }),
      }),
      firestore: {
        FieldValue: {
          increment: (n: number) => mockIncrement(n),
          serverTimestamp: () => 'NOW',
          delete: () => 'DELETE',
        },
      },
    },
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The real structural inspector (AGL-1475), not a stub. This mock replaces
  // the WHOLE barrel, so an export the route calls but the fake omits is
  // `undefined` at the call site and 500s the request. Requiring the actual
  // module also keeps these specs honest: the upload paths below are checked
  // against the control that really runs, not against a permissive stand-in.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/upload-inspection'),
  // The REAL idempotency claim, the REAL plan table and the REAL scope token:
  // the storage band is exactly what is under test, so a stubbed plan table
  // would make every assertion below a statement about the stub.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/api-idempotency'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/scope-tokens'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/screen-route'),
  createResourceUid: () => `med_${++mockUidSeq}`,
  readImageDimensions: () => ({ width: 800, height: 600 }),
  effectiveDatasetModel: () => ({ fields: [] }),
  coerceDocumentValues: (_m: unknown, v: Record<string, unknown>) => v,
  validateDocument: () => ({}),
  PLATFORM_BRAND_NAME: 'Aglyn',
}))

jest.mock('../utils/server/media-scope', () => ({
  __esModule: true,
  folderStoragePath: async () => '',
  // The real helper takes ONE options object and decides the path itself from
  // the plan and the private flag. Modelled with that signature so a call site
  // passing positional arguments cannot pass here and fail in production.
  mediaCdnPathUpdate: (options: {
    cdnScope: string
    mediaId: string
    isPrivate: boolean
  }) =>
    options.isPrivate
      ? 'DELETE'
      : `/api/media/cdn/${options.cdnScope}/${options.mediaId}`,
}))

jest.mock('firebase-admin/firestore', () => {
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
    static fromMillis(ms: number) {
      const t = new MockTimestamp()
      t.mockMs = ms
      return t
    }
  }
  return { __esModule: true, FieldPath: { documentId: () => '__name__' }, Timestamp: MockTimestamp }
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GET, POST } from '../app/api/v1/[[...route]]/route'
import { resolveOrgEntitlements } from '@aglyn/aglyn/app-utils/plan-entitlements'

const readSource = (...parts: string[]) =>
  readFileSync(join(__dirname, '..', '..', '..', ...parts), 'utf8')

const MB = 1024 * 1024
const ORG_MEDIA = 'orgs/org-1/media'
const ORG_COUNTER = 'orgs/org-1/counters/media'

/** The org-wide band `resolveOrgMediaBand` computes, in bytes. */
function bandBytes(): number {
  const entitlements = resolveOrgEntitlements(mockOrg as never)
  return Math.max(1, entitlements.hostLimit) * entitlements.storagePerHostMb * MB
}

/**
 * `n` bytes that are genuinely `contentType` (AGL-1475). Filler alone is
 * refused by structural inspection for every type that has a container
 * header, so a fixture has to carry one to reach the code these specs test.
 */
const bytes = (n: number, contentType = 'image/png') =>
  uploadFixtureBase64(contentType, n)

/**
 * Stored ORIGINALS. Generated variants (`…__w320.webp`) are real objects too,
 * so a bare `mockObjects.size` would count them and make "exactly one file"
 * assertions wrong for every image.
 */
const originals = () => [...mockObjects.keys()].filter((p) => !p.includes('__w'))

const upload = (
  body: Record<string, unknown>,
  path = 'media',
  idempotencyKey?: string,
) =>
  POST(
    new Request(`https://app.aglyn.com/api/v1/${path}`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer k',
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ route: path.split('/') }) },
  )

const png = (sizeBytes = 1024) => ({
  fileName: 'hero.png',
  contentType: 'image/png',
  data: bytes(sizeBytes),
})

beforeEach(() => {
  mockDocs.clear()
  mockObjects = new Map()
  mockOrg = { plan: 'business', hosts: { 'host-1': true } }
  mockScopes = ['media:read', 'media:write']
  mockUidSeq = 0
  mockQuarantined = false
  process.env['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'] = 'test-bucket'
})

describe('POST /v1/media (AGL-2463)', () => {
  it('uploads to the organization library, stores the bytes, and publishes the media object', async () => {
    const response = await upload(png(2048))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.object).toBe('media')
    expect(body.fileName).toBe('hero.png')
    expect(body.contentType).toBe('image/png')
    expect(body.sizeBytes).toBe(2048)

    // The bytes actually reached storage, under the org library's path.
    const [objectPath] = originals()
    expect(objectPath).toContain('orgs/org-1/media/')
    expect(mockObjects.get(objectPath)?.bytes).toBe(2048)

    // And the Firestore document the read side serves.
    const doc = mockDocs.get(`${ORG_MEDIA}/${body.id}`)
    expect(doc?.sizeBytes).toBe(2048)
    expect(doc?.contentType).toBe('image/png')
    // A strong digest, computed from the bytes we actually received. The
    // signed-URL handshake cannot produce one (AGL-1629); this path can, so
    // it does — it is what makes the quarantine check below meaningful.
    expect(String(doc?.contentSha256 ?? '')).toHaveLength(64)
    // The generated widths, read off `MediaVariantOutcome.variants`. Asserted
    // because the first cut of this route read `.widths` — a field that does
    // not exist — and would have stamped `variants: []` on every asset while
    // the CDN served the resized files it claimed were absent.
    expect(doc?.variants).toEqual([320])
  })

  it('meters the storage the upload consumed, by increment and not by overwrite', async () => {
    // A pre-existing value: an overwrite would report 4096 rather than 5120.
    mockDocs.set(ORG_COUNTER, { bytes: 1024, count: 1 })

    await upload(png(4096))

    expect(mockDocs.get(ORG_COUNTER)?.bytes).toBe(1024 + 4096)
    expect(mockDocs.get(ORG_COUNTER)?.count).toBe(2)
  })

  it('writes a site library through /v1/sites/{siteId}/media', async () => {
    const response = await upload(png(512), 'sites/host-1/media')
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(mockDocs.get(`hosts/host-1/media/${body.id}`)).toBeTruthy()
    expect(originals()[0]).toContain('hosts/host-1/media/')
    expect(mockDocs.get('hosts/host-1/counters/media')?.bytes).toBe(512)
  })

  it('still serves the read side it always did', async () => {
    mockDocs.set(`${ORG_MEDIA}/m1`, { fileName: 'a.png', sizeBytes: 10 })
    const response = await GET(
      new Request('https://app.aglyn.com/api/v1/media', {
        headers: { authorization: 'Bearer k' },
      }),
      { params: Promise.resolve({ route: ['media'] }) },
    )
    expect(response.status).toBe(200)
  })
})

describe('the storage band is enforced on the API path (AGL-2463)', () => {
  it('refuses an upload that would cross the band, and nothing lands', async () => {
    // Park the counter exactly at the org-wide band.
    mockDocs.set(ORG_COUNTER, { bytes: bandBytes(), count: 1 })

    const response = await upload(png(4096))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('storage_quota')

    // The refusal is real: no object, no document, and — the money assertion
    // — the billed counter did not move.
    expect(mockObjects.size).toBe(0)
    expect([...mockDocs.keys()].filter((k) => k.startsWith(ORG_MEDIA))).toHaveLength(0)
    expect(mockDocs.get(ORG_COUNTER)?.bytes).toBe(bandBytes())
  })

  it('allows the upload that fits, so the refusal above is not a route that refuses everything', async () => {
    // One MB short of the band: the same code path, the other verdict.
    mockDocs.set(ORG_COUNTER, { bytes: bandBytes() - 2 * MB, count: 1 })

    const response = await upload(png(1024))

    expect(response.status).toBe(201)
    expect(originals()).toHaveLength(1)
  })

  it('releases the idempotency key on a quota refusal, so the retry that should succeed can', async () => {
    mockDocs.set(ORG_COUNTER, { bytes: bandBytes(), count: 1 })

    const refused = await upload(png(4096), 'media', 'key-abc')
    expect(refused.status).toBe(403)

    // The band is raised (an add-on bought, a file deleted). The SAME key must
    // genuinely re-run rather than replay the 403 — otherwise an integrator
    // whose create exactly filled the band can never tell whether it landed.
    mockDocs.set(ORG_COUNTER, { bytes: 0, count: 0 })
    const retried = await upload(png(4096), 'media', 'key-abc')

    expect(retried.status).toBe(201)
    expect(originals()).toHaveLength(1)
  })

  it('replays a settled key instead of storing the file twice', async () => {
    const first = await upload(png(1024), 'media', 'key-dup')
    const second = await upload(png(1024), 'media', 'key-dup')

    expect(first.status).toBe(201)
    // 200, not 201: a replay is distinguishable from a fresh create.
    expect(second.status).toBe(200)
    expect((await first.json()).id).toBe((await second.json()).id)
    // The assertion a status-only check would miss: exactly one file exists.
    expect(originals()).toHaveLength(1)
    expect([...mockDocs.keys()].filter((k) => k.startsWith(ORG_MEDIA))).toHaveLength(1)
  })
})

describe('what an uploaded file is checked for (AGL-2463)', () => {
  it('refuses a content type outside the allowlist', async () => {
    const response = await upload({
      fileName: 'payload.exe',
      contentType: 'application/x-msdownload',
      data: bytes(64),
    })
    const body = await response.json()

    expect(response.status).toBe(415)
    expect(body.error.code).toBe('unsupported_media_type')
    expect(mockObjects.size).toBe(0)
  })

  it('refuses a file past the per-type size ceiling, measured on the real bytes', async () => {
    const response = await upload({
      fileName: 'huge.png',
      contentType: 'image/png',
      data: bytes(20 * MB),
    })
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error.code).toBe('file_too_large')
    expect(mockObjects.size).toBe(0)
  })

  it('refuses a hash on the takedown list', async () => {
    mockQuarantined = true
    const response = await upload(png(1024))

    expect(response.status).toBe(451)
    expect(mockObjects.size).toBe(0)
  })

  it('refuses a body that is not valid base64 rather than storing garbage', async () => {
    const response = await upload({
      fileName: 'a.png',
      contentType: 'image/png',
      data: 'not base64 !!!!',
    })
    expect(response.status).toBe(400)
    expect(mockObjects.size).toBe(0)
  })
})

describe('the media:write gate (AGL-2463)', () => {
  it('refuses a key without media:write, and media:read is not enough', async () => {
    mockScopes = ['media:read']
    const response = await upload(png(1024))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.type).toBe('insufficient_scope')
    expect(body.error.code).toBe('media:write')
    expect(mockObjects.size).toBe(0)
  })

  it('404s a site the organization does not own', async () => {
    const response = await upload(png(1024), 'sites/host-9/media')
    expect(response.status).toBe(404)
    expect(mockObjects.size).toBe(0)
  })

  it('is enforced by API_SCOPES and offered by the console picker', () => {
    const scopes = readSource('libs/tenant/data/admin/src/lib/server/api-keys.ts')
    const picker = readSource('apps/console/components/org-api-keys-card.component.tsx')
    expect(scopes).toContain("'media:write'")
    expect(picker).toContain("scope: 'media:write'")
  })
})
