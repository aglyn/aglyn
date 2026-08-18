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
 * AGL-1476: the signed finalize must land the same document the base64 route
 * lands.
 *
 * Measured on production 2026-08-13, same library, same day, image against
 * image so the only variable is the ROUTE:
 *
 * - signed path, 6,606,921 B PNG — `variants` **absent from the document**,
 *   and `?w=320` answered with 6,606,921 B of `image/png`.
 * - base64 path, 2,168,376 B PNG — `variants: [320, 640]`, and `?w=320`
 *   answered with 31,566 B of `image/webp`.
 *
 * `width`, `height` and `uploadedBy` were absent on the signed path too. All
 * four have one cause: the bytes never pass through the function on that
 * route, so nothing ever looked at them.
 *
 * **Byte count is the assertion, never status.** The broken path returns a
 * perfectly good 200 carrying the original, so `expect(status).toBe(200)`
 * passes identically before and after the fix — which is how this shipped.
 *
 * REAL `sharp`, through the real `generateStoredMediaVariants`, for the reason
 * AGL-1468 gives: a mocked encoder is the one thing guaranteed to be callable,
 * and callability is what broke.
 */

const mockVerifyIdToken = jest.fn()
const mockCounterSet = jest.fn()
const mockMediaSet = jest.fn()

/** Every object the route wrote, keyed by path — variants included. */
const mockSaved = new Map<string, Buffer>()
/** Full-object downloads, by path. A video must never appear here. */
const mockFullDownloads: string[] = []

const mockState: {
  org: Record<string, unknown>
  usedBytes: number
  /** The stored object the finalize is handed. */
  source: Buffer
  contentType: string
  /** Set to reject to simulate a storage failure mid-generation. */
  saveVariantFails: boolean
} = {
  org: {},
  usedBytes: 0,
  source: Buffer.alloc(0),
  contentType: 'image/png',
  saveVariantFails: false,
}

const mockCounterDoc = () => ({
  get: async () => ({
    exists: true,
    get: (field: string) => (field === 'bytes' ? mockState.usedBytes : undefined),
  }),
  set: (...args: unknown[]) => {
    mockCounterSet(...args)
    return Promise.resolve()
  },
})

const mockScopeRef = {
  /**
   * The org's whole media pool, in one round trip (AGL-2075). Ingress no
   * longer checks a scope's own counter against `storagePerHostMb` — it checks
   * every scope the org owns against `hostLimit × storagePerHostMb` — so the
   * double has to answer `getAll` the way a real `Firestore` does. This org
   * has no `hosts` map, so the pool is the org library alone and the
   * arithmetic is what it always was.
   */
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
            ? mockState.usedBytes
            : undefined,
      })),
  },
  collection: (name: string) => ({
    doc: () =>
      name === 'counters'
        ? mockCounterDoc()
        : {
            set: (...args: unknown[]) => {
              mockMediaSet(...args)
              return Promise.resolve()
            },
          },
  }),
}

const mockOriginalPath = 'orgs/org-1/media/media-1'

const mockBucketFile = (path: string) => ({
  exists: async () => [path === mockOriginalPath],
  getMetadata: async () => [
    {
      size: String(mockState.source.length),
      contentType: mockState.contentType,
      md5Hash: 'bWQ1',
    },
  ],
  /**
   * Ranged when the caller asks for a range — which is what lets this assert
   * that reading dimensions does NOT pull the whole object back.
   */
  download: async (options?: { start?: number; end?: number }) => {
    if (options && typeof options.end === 'number') {
      return [mockState.source.subarray(options.start ?? 0, options.end + 1)]
    }
    mockFullDownloads.push(path)
    return [mockState.source]
  },
  save: async (buffer: Buffer) => {
    if (mockState.saveVariantFails && path !== mockOriginalPath) {
      throw new Error('storage said no')
    }
    mockSaved.set(path, buffer)
  },
  setMetadata: async () => undefined,
  delete: async () => undefined,
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  // The REAL variant generator, running REAL sharp. Mocking it would make
  // every byte assertion below a statement about the mock.
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/media-variants',
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
      storage: () => ({
        bucket: () => ({ name: 'bucket', file: mockBucketFile }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  // Nothing is taken down in these fixtures (AGL-1613). The routes now
  // consult the deny list before they write, so the mock has to answer —
  // `null` is "not quarantined", which is what every case here assumes.
  quarantinedUploadRefusal: async () => null,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan rules — a stubbed `checkEntitlement` would make "a free org
  // gets dimensions but no variants" unfalsifiable.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  // The REAL header reader — `width`/`height` are half of what this fixes, and
  // a stub returning `{ width: 1200 }` would prove nothing about whether the
  // route ever looked at the file.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/media-metadata'),
  createResourceUid: () => 'media-1',
  defaultScopeForNewResource: () => ['org'],
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
      scopeRef: mockScopeRef,
      billing: mockState.org,
      cdnScope: 'org:org-1',
      viewerTokens: ['org'],
      viewerOrgWide: true,
    },
  }),
  folderStoragePath: async () => '',
  mediaObjectPath: () => mockOriginalPath,
  mediaCdnPathUpdate: () => '/api/media/cdn/org:org-1/media-1',
}))

import { MEDIA_VARIANT_SOURCE_MAX_BYTES } from '@aglyn/tenant-data-admin'
import { PATCH } from '../app/api/media/upload-url/route'
import { signedUploadMaxBytes } from '../utils/media-upload-limits'

/**
 * A 1200x630 gradient PNG — the shape of the assets that failed in production.
 *
 * A gradient rather than noise: PNG stores high-entropy noise near-raw and
 * lossy WebP re-expands it, so a noise fixture makes the 640px variant LARGER
 * than its source and the size assertions fail for a reason unrelated to the
 * bug.
 */
async function sourcePng(width = 1200, height = 630): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3
      pixels[index] = Math.round((x * 255) / width)
      pixels[index + 1] = Math.round((y * 255) / height)
      pixels[index + 2] = Math.round((((x + y) % 600) * 255) / 600)
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer()
}

const finalize = (): Promise<Response> =>
  PATCH(
    new Request('https://app.aglyn.com/api/media/upload-url', {
      method: 'PATCH',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({
        orgId: 'org-1',
        mediaId: 'media-1',
        fileName: 'agl-1476-verify.png',
      }),
    }),
  )

/** The document the finalize wrote. */
const writtenDocument = (): Record<string, unknown> =>
  (mockMediaSet.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>

describe('the signed finalize lands the same document as the base64 route (AGL-1476)', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    mockSaved.clear()
    mockFullDownloads.length = 0
    mockState.org = { plan: 'pro' }
    mockState.usedBytes = 0
    mockState.contentType = 'image/png'
    mockState.saveVariantFails = false
    mockState.source = await sourcePng()
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-9', email_verified: true })
  })

  it('writes NON-EMPTY variants for an image that arrived through storage', async () => {
    const response = await finalize()
    // Status proves nothing here — the broken route answers 200 too — but a
    // non-200 would mean the suite is measuring the wrong thing.
    expect(response.status).toBe(200)
    expect(writtenDocument()['variants']).toEqual([320, 640])
  })

  it('produces variants that are genuinely SMALLER, in bytes', async () => {
    await finalize()
    const w320 = mockSaved.get(`${mockOriginalPath}__w320.webp`) as Buffer
    const w640 = mockSaved.get(`${mockOriginalPath}__w640.webp`) as Buffer
    expect(w320).toBeInstanceOf(Buffer)
    expect(w640).toBeInstanceOf(Buffer)
    // A real WebP, not the PNG handed back — which is exactly what `?w=320`
    // returned on production.
    expect(w320.toString('ascii', 0, 4)).toBe('RIFF')
    expect(w320.toString('ascii', 8, 12)).toBe('WEBP')
    expect(w320.length).toBeLessThan(mockState.source.length)
    // And narrower is smaller than wider: a resize that ignored its argument
    // would produce two identical buffers and still pass everything above.
    expect(w320.length).toBeLessThan(w640.length)
  })

  it('captures the pixel dimensions the base64 route captures', async () => {
    await finalize()
    expect(writtenDocument()['width']).toBe(1200)
    expect(writtenDocument()['height']).toBe(630)
  })

  it('records who uploaded it', async () => {
    await finalize()
    expect(writtenDocument()['uploadedBy']).toBe('user-9')
  })

  it('reads dimensions from the HEADER, not by pulling the whole object twice', async () => {
    await finalize()
    // One full download for the encoder, and no more. Dimensions come from a
    // ranged read, which is what keeps a free org and a narrow image from
    // paying 15 MB of egress.
    expect(mockFullDownloads).toEqual([mockOriginalPath])
  })
})

describe('the finalize still only pays for what it can use (AGL-1476)', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    mockSaved.clear()
    mockFullDownloads.length = 0
    mockState.org = { plan: 'pro' }
    mockState.usedBytes = 0
    mockState.saveVariantFails = false
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-9', email_verified: true })
  })

  it('never downloads a video — the type this route was built for', async () => {
    // The 200 MB videos this route exists for must not be pulled back into a
    // serverless function to discover they have no variants.
    mockState.contentType = 'video/mp4'
    mockState.source = Buffer.alloc(4096, 7)
    const response = await finalize()
    expect(response.status).toBe(200)
    expect(mockFullDownloads).toEqual([])
    // `[]` by design, exactly as on the base64 route — the three-way split in
    // AGL-1476: same route + image → variants, different route + image → the
    // bug, either route + document → `[]`.
    expect(writtenDocument()['variants']).toEqual([])
    expect(writtenDocument()['variantsError']).toBeUndefined()
  })

  it('can fetch every image the DAM will accept — the two ceilings agree', () => {
    // The upload ceiling and the fetch ceiling are separate numbers in
    // separate libraries answering separate questions ("may this be
    // uploaded" / "may a function afford to fetch it back"). They have to
    // agree, or the largest accepted images silently stop getting variants —
    // which is this issue, verbatim, one ceiling along.
    expect(signedUploadMaxBytes('image/png')).toBeLessThanOrEqual(
      MEDIA_VARIANT_SOURCE_MAX_BYTES,
    )
  })

  it('gives a free org its dimensions and uploader without generating variants', async () => {
    // `mediaCdn` is Starter+. A free workspace serves raw storage URLs, so
    // generating WebP it can never serve would be bytes nobody reads — but
    // `width`/`height`/`uploadedBy` are not CDN features and must still land.
    mockState.org = { plan: 'free' }
    mockState.contentType = 'image/png'
    mockState.source = await sourcePng()
    await finalize()
    expect(writtenDocument()['variants']).toEqual([])
    expect(writtenDocument()['width']).toBe(1200)
    expect(writtenDocument()['uploadedBy']).toBe('user-9')
    expect(mockFullDownloads).toEqual([])
  })
})

describe('a signed-path variant failure is still WRITTEN DOWN (AGL-1468 survives)', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    mockSaved.clear()
    mockFullDownloads.length = 0
    mockState.org = { plan: 'pro' }
    mockState.usedBytes = 0
    mockState.contentType = 'image/png'
    mockState.saveVariantFails = true
    mockState.source = await sourcePng()
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-9', email_verified: true })
  })

  it('never fails the upload for a variant', async () => {
    expect((await finalize()).status).toBe(200)
  })

  it('marks the document, so the next outage is a query and not archaeology', async () => {
    await finalize()
    expect(String(writtenDocument()['variantsError'])).toContain('storage said no')
  })

  it('bumps variantFailures on the counter the route already writes', async () => {
    await finalize()
    const [written] = mockCounterSet.mock.calls[0] as [
      Record<string, { __increment?: number }>,
    ]
    expect(written['variantFailures'].__increment).toBe(1)
  })
})
