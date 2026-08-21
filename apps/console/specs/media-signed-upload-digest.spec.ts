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
 * The signed-upload route earns a strong content digest (AGL-1629).
 *
 * `media-strong-digest.spec.ts` proves the digest helper — that it streams,
 * that the ceiling refuses before the read, that a short read is discarded.
 * This file proves the thing that decays: that FINALIZE actually calls it,
 * calls it before the deny-list consult, and writes what it got.
 *
 * The property that matters, and the one that was previously impossible:
 *
 *   **A takedown set from the bytes matches those bytes whichever route
 *   carried them.** `/api/media/upload` keys on sha256 of the buffer it
 *   holds. Signed finalize keyed on a 16-hex truncation of GCS's md5 — a
 *   different algorithm over the same file, so the two keys were unrelated
 *   and quarantine bit within an ingestion path, never across them. A
 *   customer whose malicious PDF was disabled could re-upload it through
 *   the other door.
 *
 * The tests below are written as that customer: take the file down using
 * the digest the DIRECT route would have produced, then push the same bytes
 * through the SIGNED route and require a refusal.
 */

import { createHash } from 'crypto'
import { Readable } from 'stream'

const mockVerifyIdToken = jest.fn()
const mockFileSave = jest.fn()
const mockFileDelete = jest.fn()
const mockMediaSet = jest.fn()
const mockCounterSet = jest.fn()

const mockQuarantineLib = jest.requireActual(
  '../../../libs/aglyn/src/lib/app-utils/media-quarantine',
)

const mockState: {
  org: Record<string, unknown>
  objectMetadata: Record<string, unknown>
  /** The object's real bytes, as the bucket would stream them back. */
  objectBytes: Buffer
  denyList: Record<string, Record<string, unknown>>
  consulted: Array<Record<string, unknown>>
  /** Every ranged/whole read the route performed, in order. */
  reads: Array<{ kind: 'download' | 'stream'; start?: number; end?: number }>
} = {
  org: { plan: 'pro' },
  objectMetadata: {},
  objectBytes: Buffer.alloc(0),
  denyList: {},
  consulted: [],
  reads: [],
}

const counterDoc = () => ({
  get: async () => ({ exists: true, get: () => 0 }),
  set: (...args: unknown[]) => {
    mockCounterSet(...args)
    return Promise.resolve()
  },
})

const mediaDoc = (): Record<string, unknown> => ({
  get: async () => ({
    exists: true,
    get: () => undefined,
    data: () => mockState.org,
  }),
  set: (...args: unknown[]) => {
    mockMediaSet(...args)
    return Promise.resolve()
  },
  delete: async () => undefined,
  collection: () => ({ doc: () => mediaDoc() }),
})

const scopeRef = {
  firestore: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        path: `${name}/${id}`,
        collection: (sub: string) => ({
          doc: (subId: string) => ({ path: `${name}/${id}/${sub}/${subId}` }),
        }),
      }),
      where: () => ({ select: () => ({ get: async () => ({ docs: [] }) }) }),
    }),
    getAll: async (...refs: Array<{ path: string }>) =>
      refs.map((ref) => ({
        get: (field: string) =>
          field === 'bytes' && ref.path === 'orgs/org-1/counters/media'
            ? 0
            : undefined,
      })),
  },
  collection: (name: string) => ({
    doc: () => (name === 'counters' ? counterDoc() : mediaDoc()),
  }),
}

/**
 * The bucket file, modelled with BOTH read shapes the route now uses.
 *
 * `download({start,end})` is AGL-1475's ranged structural inspection;
 * `createReadStream()` is AGL-1629's digest. Both are recorded, because the
 * cost argument this issue turns on is entirely about which of them ran and
 * over how many bytes — a double that collapsed them would make the bound
 * untestable.
 */
const storageFile = () => ({
  name: 'object',
  exists: async () => [true],
  getMetadata: async () => [mockState.objectMetadata],
  download: async (options?: { start?: number; end?: number }) => {
    mockState.reads.push({
      kind: 'download',
      start: options?.start,
      end: options?.end,
    })
    if (!options || typeof options.start !== 'number') {
      return [mockState.objectBytes]
    }
    const end =
      typeof options.end === 'number' ? options.end : mockState.objectBytes.length - 1
    return [mockState.objectBytes.subarray(options.start, end + 1)]
  },
  createReadStream: () => {
    mockState.reads.push({ kind: 'stream' })
    return Readable.from([mockState.objectBytes])
  },
  setMetadata: async () => undefined,
  save: (...args: unknown[]) => {
    mockFileSave(...args)
    return Promise.resolve()
  },
  delete: (...args: unknown[]) => {
    mockFileDelete(...args)
    return Promise.resolve()
  },
  getSignedUrl: async () => ['https://storage.test/put'],
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/media-variants',
  ),
  // The REAL digest helper. Stubbing it would leave this file asserting that
  // a mock was called, which keeps passing after the feature is removed.
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/media-strong-digest',
  ),
  firebaseAdmin: {
    firestore: {
      FieldValue: {
        increment: (by: number) => ({ __increment: by }),
        serverTimestamp: () => ({ __serverTimestamp: true }),
        delete: () => ({ __delete: true }),
      },
    },
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({ collection: () => ({ doc: () => mediaDoc() }) }),
      storage: () => ({
        bucket: () => ({ name: 'bucket', file: storageFile }),
      }),
    }),
  },
  generateMediaVariants: jest.fn(async () => ({ variants: [], error: undefined })),
  isImpersonationSession: () => false,
  resolveOrgMembership: async () => ({ member: { role: 'owner' } }),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  quarantinedUploadRefusal: async (asset: Record<string, unknown>) => {
    mockState.consulted.push(asset)
    const keys = mockQuarantineLib.mediaQuarantineKeys(asset) as string[]
    for (const key of keys) {
      const found = mockQuarantineLib.normalizeMediaQuarantine(
        mockState.denyList[key],
        key,
      )
      if (mockQuarantineLib.isMediaQuarantineActive(found, Date.now())) {
        return Response.json(
          mockQuarantineLib.mediaQuarantineRefusalBody(found),
          {
            status: mockQuarantineLib.MEDIA_QUARANTINE_UPLOAD_STATUS,
            headers: { 'cache-control': 'no-store' },
          },
        )
      }
    }
    return null
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/upload-inspection'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  createResourceUid: () => 'media-1',
  readImageDimensions: () => undefined,
  defaultScopeForNewResource: () => ['org'],
  newResourceScopeFields: (visibleTo: string[] | null) =>
    visibleTo ? { visibleTo } : {},
  orgRoleAtLeast: () => true,
  ORG_SCOPE_TOKEN: 'org',
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

jest.mock('../utils/server/media-scope', () => ({
  __esModule: true,
  resolveMediaScope: async () => ({
    scope: {
      base: 'orgs/org-1',
      collection: 'orgs',
      scopeId: 'org-1',
      orgId: 'org-1',
      scopeRef,
      billing: mockState.org,
      cdnScope: 'org:org-1',
      viewerTokens: ['org'],
      viewerOrgWide: true,
    },
  }),
  folderStoragePath: async () => '',
  mediaObjectPath: () => 'orgs/org-1/media/media-1',
  mediaCdnPathUpdate: () => '/api/media/cdn/org:org-1/media-1',
  scopeAllows: () => true,
}))

import { PATCH as finalize } from '../app/api/media/upload-url/route'

const sha256 = (buffer: Buffer) =>
  createHash('sha256').update(new Uint8Array(buffer)).digest('hex')

const md5Base64 = (buffer: Buffer) =>
  createHash('md5').update(new Uint8Array(buffer)).digest('base64')

/** A real PDF, because structural inspection runs ahead of everything here. */
const PDF = Buffer.from('%PDF-1.7 the document staff took down', 'utf8')

const takenDown = (overrides: Record<string, unknown> = {}) => ({
  reason: 'dmca',
  message: null,
  note: 'internal: notice 8814, rights holder confirmed',
  atMs: 1,
  untilMs: null,
  actorUid: 'staff-1',
  ...overrides,
})

/** Put an object of `size` in the bucket without allocating it. */
const placeObject = (options: {
  bytes: Buffer
  contentType?: string
  /** Overrides the reported size — for the video ceiling case. */
  size?: number
}) => {
  mockState.objectBytes = options.bytes
  mockState.objectMetadata = {
    contentType: options.contentType ?? 'application/pdf',
    size: options.size ?? options.bytes.length,
    md5Hash: md5Base64(options.bytes),
  }
}

const patch = (fileName = 'notice.pdf') =>
  finalize(
    new Request('https://app.aglyn.com/api/media/upload-url', {
      method: 'PATCH',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ orgId: 'org-1', mediaId: 'media-1', fileName }),
    }),
  )

const writtenDocument = () =>
  (mockFileSave.mock.calls.length, mockMediaSet.mock.calls[0]?.[0]) as
    | Record<string, unknown>
    | undefined

beforeEach(() => {
  jest.clearAllMocks()
  mockState.org = { plan: 'pro' }
  mockState.denyList = {}
  mockState.consulted = []
  mockState.reads = []
  placeObject({ bytes: PDF })
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
})

describe('signed finalize · the strong digest (AGL-1629)', () => {
  it('writes contentSha256 for an ordinary document', async () => {
    expect((await patch()).status).toBe(200)
    expect(writtenDocument()?.['contentSha256']).toBe(sha256(PDF))
  })

  it('keeps the legacy md5-derived contentHash beside it', async () => {
    // Never a replacement. `contentHash` is the ETag and the path segment of
    // the pre-AGL-829 immutable URL; rewriting or dropping it 404s embeds
    // and invalidates every stored cache validator at once.
    await patch()
    const document = writtenDocument()
    expect(String(document?.['contentHash'])).toHaveLength(16)
    expect(document?.['contentHash']).not.toBe(document?.['contentSha256'])
  })

  it('takes the digest by STREAMING, not by pulling the object into memory', async () => {
    await patch()
    expect(mockState.reads.some((read) => read.kind === 'stream')).toBe(true)
    // The only whole-object `download()` on this path is the SVG branch and
    // the variant source. Neither applies to a PDF, so an unranged download
    // here would mean the digest went through `file.download()`.
    const unranged = mockState.reads.filter(
      (read) => read.kind === 'download' && typeof read.start !== 'number',
    )
    expect(unranged).toHaveLength(0)
  })

  it('refuses bytes taken down through the OTHER route — the whole point', async () => {
    // The deny-list entry as `/api/media/upload` would have written it:
    // keyed on the sha256 of the buffer that route held. Before this issue
    // the signed route presented an md5 truncation and sailed straight past.
    mockState.denyList = { [`hash--${sha256(PDF)}`]: takenDown() }
    const response = await patch()
    expect(response.status).toBe(403)
    expect(mockMediaSet).not.toHaveBeenCalled()
    expect(mockCounterSet).not.toHaveBeenCalled()
    // Already in the bucket by the time we could look — so it must not stay.
    expect(mockFileDelete).toHaveBeenCalled()
  })

  it('hands the strong digest to the deny-list consult, not just to the document', async () => {
    await patch()
    expect(mockState.consulted[0]?.['contentSha256']).toBe(sha256(PDF))
  })

  it('still honours a takedown written under the legacy key', async () => {
    // A live entry keyed on the md5 truncation predates this change. Gaining
    // a strong digest must never lift it — a takedown that lifts itself is
    // the one failure this subsystem may not have.
    const legacy = createHash('md5')
      .update(new Uint8Array(PDF))
      .digest('hex')
      .slice(0, 16)
    mockState.denyList = { [`hash--${legacy}`]: takenDown({ reason: 'malware' }) }
    expect((await patch()).status).toBe(403)
  })
})

describe('signed finalize · the bound the decision accepted (AGL-1629)', () => {
  it('reads nothing at all for a video above the ceiling', async () => {
    // 200 MB is the video cap. The whole cost objection lives here: this
    // object must finalize without a single byte of digest egress.
    placeObject({
      bytes: Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]),
      contentType: 'video/mp4',
      size: 200 * 1024 * 1024,
    })
    expect((await patch('clip.mp4')).status).toBe(200)
    expect(mockState.reads.some((read) => read.kind === 'stream')).toBe(false)
  })

  it('writes NO contentSha256 rather than a fake one, for such a video', async () => {
    // Absent means "the server never held these bytes", which every
    // quarantine consumer already handles by falling back. A null, or an
    // md5 re-labelled as sha256, would read as a hash and shadow the key
    // that actually matches.
    placeObject({
      bytes: Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]),
      contentType: 'video/mp4',
      size: 200 * 1024 * 1024,
    })
    await patch('clip.mp4')
    const document = writtenDocument()
    expect('contentSha256' in (document ?? {})).toBe(false)
    // …and it degrades exactly as it did before: legacy hash, then asset key.
    expect(String(document?.['contentHash'])).toHaveLength(16)
  })

  it('a video over the ceiling still finalizes — the bound is not a refusal', async () => {
    placeObject({
      bytes: Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]),
      contentType: 'video/mp4',
      size: 200 * 1024 * 1024,
    })
    expect((await patch('clip.mp4')).status).toBe(200)
    expect(mockCounterSet).toHaveBeenCalled()
  })
})
