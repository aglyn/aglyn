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
 * Replace works on every family the DAM accepts (AGL-2732).
 *
 * ## Why this file exists at all
 *
 * The capability shipped in AGL-184 and was then reported MISSING twice, by
 * two separate audits of the live console, because it was gated on
 * `image/` at THREE layers — the card's overflow item, the drawer's button,
 * and the route's 415 — and both audits were run against a PDF. Every gate
 * hid it, so an exhaustive inventory of a PDF's menus was an accurate
 * inventory and a false conclusion about the product.
 *
 * That is the shape this suite defends against, and it is why the source
 * assertions at the bottom are not redundant with the behavioral ones
 * above: lifting the route's gate alone makes replace *work* while leaving
 * it *invisible*, and lifting the UI's alone makes it visible and broken.
 * A regression in either half reads as "the feature does not exist".
 *
 * ## And why the family rule is the part worth keeping
 *
 * Replace deliberately keeps the id and the published `cdnPath`, so the
 * references it preserves were written for a particular kind of thing. An
 * `<img>` that now resolves to a PDF is a broken page rather than an updated
 * one — so the gate is not removed, it is narrowed from "images only" to
 * "the same family", which is what makes a corrected PDF, a re-cut film and
 * a reissued deck all one upload.
 */

import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'

import { code } from './source-text'

const mockVerifyIdToken = jest.fn()

/** Every Storage operation the route performed, in order. */
const mockOps: {
  saved: Array<{ path: string; bytes: Buffer; contentType?: string }>
  deleted: string[]
  moved: Array<{ from: string; to: string }>
  signed: string[]
  metadata: Array<{ path: string; value: Record<string, unknown> }>
} = { saved: [], deleted: [], moved: [], signed: [], metadata: [] }

const mockMediaSet = jest.fn()
const mockCounterSet = jest.fn()

const mockState: {
  org: Record<string, unknown>
  /** The media document the route reads. */
  existing: Record<string, unknown>
  /** What `getMetadata()` reports for the MOCK_STAGED object on the signed leg. */
  stagedMetadata: Record<string, unknown>
  /** The staged object's bytes, served to both the ranged reads and the digest. */
  stagedBytes: Buffer
  stagedExists: boolean
} = {
  org: { plan: 'pro' },
  existing: {},
  stagedMetadata: {},
  stagedBytes: Buffer.alloc(0),
  stagedExists: true,
}

const MOCK_MASTER = 'orgs/org-1/media/media-1'
const MOCK_STAGED = `${MOCK_MASTER}__incoming`

const mockCounterDoc = () => ({
  get: async () => ({ exists: true, get: () => 0 }),
  set: (...args: unknown[]) => {
    mockCounterSet(...args)
    return Promise.resolve()
  },
})

const mockMediaDoc = (): Record<string, unknown> => ({
  get: async () => ({
    exists: true,
    id: 'media-1',
    get: (field: string) => mockState.existing[field],
    data: () => mockState.org,
  }),
  set: (...args: unknown[]) => {
    mockMediaSet(...args)
    return Promise.resolve()
  },
  delete: async () => undefined,
  collection: () => ({ doc: () => mockMediaDoc() }),
})

const mockScopeRef = {
  // One org-wide media pool in one round trip (AGL-2075) — the double answers
  // `getAll` the way a real `Firestore` does, and reads zero bytes used.
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
      refs.map(() => ({ get: () => 0 })),
  },
  collection: (name: string) => ({
    doc: () => (name === 'counters' ? mockCounterDoc() : mockMediaDoc()),
  }),
}

/**
 * A Storage file double that REMEMBERS ITS PATH.
 *
 * Which object was written, deleted or moved is the whole subject of the
 * propagation half of this suite — a poster left behind under a replaced film
 * is exactly the failure being tested for — so a double that answered every
 * path identically could not see it.
 */
const mockStorageFile = (path: string) => ({
  name: path,
  exists: async () => [path === MOCK_STAGED ? mockState.stagedExists : true],
  getMetadata: async () => [
    path === MOCK_STAGED ? mockState.stagedMetadata : { contentType: 'application/pdf' },
  ],
  setMetadata: async (value: Record<string, unknown>) => {
    mockOps.metadata.push({ path, value })
  },
  // Ranged reads, modeled: the route inspects a staged object through small
  // windows rather than pulling a 200 MB film back into the function.
  download: async (options?: { start?: number; end?: number }) => {
    const whole = mockState.stagedBytes
    if (!options || typeof options.start !== 'number') return [whole]
    const end = typeof options.end === 'number' ? options.end : whole.length - 1
    return [whole.subarray(options.start, end + 1)]
  },
  createReadStream: () => Readable.from([mockState.stagedBytes]),
  save: (bytes: Buffer, options?: { contentType?: string }) => {
    mockOps.saved.push({ path, bytes, contentType: options?.contentType })
    return Promise.resolve()
  },
  delete: () => {
    mockOps.deleted.push(path)
    return Promise.resolve()
  },
  move: (destination: { name: string }) => {
    mockOps.moved.push({ from: path, to: destination.name })
    return Promise.resolve()
  },
  getSignedUrl: async () => {
    mockOps.signed.push(path)
    return ['https://storage.test/put']
  },
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  // The REAL variant generator and poster bounds (AGL-1468/AGL-2742): what
  // makes a PDF and a film return `{ variants: [] }` without reading a byte
  // is the generator's own width rule, and restating it in a stub would test
  // the stub.
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/media-variants',
  ),
  // The REAL bounded digest (AGL-1629) — the signed leg calls it on every
  // non-SVG object, and an omitted export in a wholesale barrel fake is
  // `undefined` at the call site and a 500 that reads as a route bug.
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/media-strong-digest',
  ),
  mediaStoragePathInScope: (o: { base: string; mediaId: string }) =>
    `${o.base}/media/${o.mediaId}`,
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
      storage: () => ({ bucket: () => ({ name: 'bucket', file: mockStorageFile }) }),
    }),
  },
  // Stubbed AFTER the real module is spread, so this wins: the encoder itself
  // is `media-variants`' subject, and running `sharp` here would test the
  // machine rather than the route's wiring.
  generateMediaPoster: async () => ({
    poster: { width: 1280, height: 720, variants: [640] },
  }),
  isImpersonationSession: () => false,
  // The release-flag verdict the video gate reads (AGL-2830). Recorded, so a
  // case can assert WHICH flag and WHICH org were asked; `mockVideoUploads`
  // is declared with the cases that close it, at the bottom of the file.
  isServerReleaseFlagOnForOrg: async (key: string, orgId: unknown) => {
    mockVideoUploads.calls.push([key, orgId])
    return mockVideoUploads.open
  },
  quarantinedUploadRefusal: async () => null,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The real metadata bounds and the real structural inspector — this fake
  // replaces the WHOLE barrel, so anything the route calls and the fake omits
  // 500s the request while the suite reads green.
  // The REAL variant widths and media-path grammar. `mediaVariantWidthsFor`
  // reads `MEDIA_CDN_VARIANT_WIDTHS` through this barrel, so a fake that
  // omitted it would make an IMAGE replace 500 while every other case
  // stayed green — the widths are the rule that decides which families
  // have variants at all.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/media-ref'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/media-metadata'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/upload-inspection'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  readImageDimensions: () => ({ width: 800, height: 600 }),
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
  mediaObjectPath: () => MOCK_MASTER,
  mediaCdnPathUpdate: () => '/api/media/cdn/org:org-1/media-1',
  scopeAllows: () => true,
}))

import {
  PATCH as replacePatch,
  POST as replacePost,
  PUT as replacePut,
} from '../app/api/media/replace/route'

const PDF = Buffer.concat([
  Buffer.from('%PDF-1.7\n', 'ascii'),
  Buffer.from('corrected brand guidelines, with the CRM lockup', 'ascii'),
])
/** A real 1×1 PNG: the variant generator is the genuine `sharp`, not a stub. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGA' +
    'hKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
/** ISO base media: four bytes of box size, then `ftyp`. */
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypmp42', 'ascii'),
  Buffer.alloc(64, 3),
])

const json = (body: unknown) => JSON.stringify(body)

const call = (
  handler: (request: Request) => Promise<Response>,
  method: string,
  body: Record<string, unknown>,
) =>
  handler(
    new Request('https://app.aglyn.com/api/media/replace', {
      method,
      headers: { authorization: 'Bearer tok' },
      body: json({ orgId: 'org-1', mediaId: 'media-1', ...body }),
    }),
  )

const replace = (bytes: Buffer, contentType: string, extra = {}) =>
  call(replacePost, 'POST', {
    contentType,
    data: bytes.toString('base64'),
    ...extra,
  })

/** The single merge write the route makes onto the media document. */
const savedDoc = () =>
  (mockMediaSet.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>

beforeEach(() => {
  jest.clearAllMocks()
  mockOps.saved = []
  mockOps.deleted = []
  mockOps.moved = []
  mockOps.signed = []
  mockOps.metadata = []
  mockState.org = { plan: 'pro' }
  mockState.existing = { contentType: 'application/pdf', visibleTo: ['org'] }
  mockState.stagedExists = true
  mockState.stagedBytes = PDF
  mockState.stagedMetadata = {
    contentType: 'application/pdf',
    size: PDF.length,
    md5Hash: Buffer.from('0123456789abcdef0123', 'hex').toString('base64'),
  }
  mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: true })
})

describe('the 415 is gone for every family the DAM accepts (AGL-2732)', () => {
  it('replaces a PDF with a PDF — the case both audits were run against', async () => {
    expect((await replace(PDF, 'application/pdf')).status).toBe(200)
    expect(mockOps.saved[0]?.path).toBe(MOCK_MASTER)
    expect(mockOps.saved[0]?.contentType).toBe('application/pdf')
    expect(savedDoc()['contentType']).toBe('application/pdf')
    expect(savedDoc()['sizeBytes']).toBe(PDF.length)
  })

  it('keeps the published cdnPath, which is the whole point of replacing', async () => {
    await replace(PDF, 'application/pdf')
    expect(savedDoc()['cdnPath']).toBe('/api/media/cdn/org:org-1/media-1')
  })

  it('CLEARS pixel dimensions rather than leaving an image’s behind', async () => {
    // `readImageDimensions` is stubbed to answer for anything, so a route that
    // read it unconditionally would file 800×600 against a PDF. A merge write
    // makes "don't set it" insufficient — the old pair would simply survive.
    await replace(PDF, 'application/pdf')
    expect(savedDoc()['width']).toEqual({ __delete: true })
    expect(savedDoc()['height']).toEqual({ __delete: true })
  })

  it('still reads dimensions for an image, which never regressed', async () => {
    mockState.existing = { contentType: 'image/png', visibleTo: ['org'] }
    expect((await replace(PNG, 'image/png')).status).toBe(200)
    expect(savedDoc()['width']).toBe(800)
  })

  it('infers the type from the file name when the browser reports none', async () => {
    // A `.zip` on macOS drag-drop and a `.md` almost everywhere arrive with an
    // empty type. The route shares `normalizeUploadContentType` with both
    // upload routes rather than testing a prefix.
    mockState.existing = { contentType: 'application/zip', visibleTo: ['org'] }
    const zip = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(32, 1),
    ])
    const response = await replace(zip, '', { fileName: 'brand-kit.zip' })
    expect(response.status).toBe(200)
    expect(savedDoc()['contentType']).toBe('application/zip')
  })
})

describe('the family is the gate now, and it still refuses (AGL-2732)', () => {
  it('refuses a picture for a document — the link would stop being one', async () => {
    const response = await replace(PNG, 'image/png')
    expect(response.status).toBe(415)
    expect(String((await response.json()).error)).toContain('an image')
    expect(mockOps.saved).toEqual([])
    expect(mockMediaSet).not.toHaveBeenCalled()
    expect(mockCounterSet).not.toHaveBeenCalled()
  })

  it('refuses a document for a film', async () => {
    mockState.existing = { contentType: 'video/mp4', visibleTo: ['org'] }
    expect((await replace(PDF, 'application/pdf')).status).toBe(415)
  })

  it('allows a Word file to be reissued as a PDF — one family', async () => {
    mockState.existing = {
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      visibleTo: ['org'],
    }
    expect((await replace(PDF, 'application/pdf')).status).toBe(200)
  })

  it('replaces a LEGACY asset that records no type at all', async () => {
    // Refusing here would make an asset with no stored type permanently
    // un-replaceable — this issue's own failure, arrived at from the other
    // side.
    mockState.existing = { visibleTo: ['org'] }
    expect((await replace(PDF, 'application/pdf')).status).toBe(200)
  })

  it('refuses a type media ingress does not accept anywhere', async () => {
    const response = await replace(PDF, 'application/x-msdownload')
    expect(response.status).toBe(415)
    expect(String((await response.json()).error)).toContain('Supported uploads')
  })

  it('charges a non-image replace to the videoMedia entitlement', async () => {
    // The upload routes have always enforced it; this one did not need to
    // while it was image-only, and a free workspace could otherwise acquire a
    // PDF by replacing the bytes of an image it is allowed to have.
    mockState.org = { plan: 'free' }
    const response = await replace(PDF, 'application/pdf')
    expect(response.status).toBe(403)
    expect(mockOps.saved).toEqual([])
  })

  it('leaves an IMAGE replace on every plan, as it has always been', async () => {
    mockState.org = { plan: 'free' }
    mockState.existing = { contentType: 'image/png', visibleTo: ['org'] }
    expect((await replace(PNG, 'image/png')).status).toBe(200)
  })
})

describe('a replaced film leaves nothing of the old one behind (AGL-2732)', () => {
  beforeEach(() => {
    mockState.existing = {
      contentType: 'video/mp4',
      visibleTo: ['org'],
      variants: [],
      poster: { width: 1280, height: 720, variants: [640] },
      videoRenditions: [
        {
          key: '720p',
          contentType: 'video/mp4',
          ext: 'mp4',
          width: 1280,
          height: 720,
          sizeBytes: 12_000_000,
        },
      ],
    }
  })

  it('deletes the previous poster, its widths and every rendition object', async () => {
    // The genuinely dangerous outcome: `?r=720p` answering with a transcode of
    // the film that was just replaced, under the URL of the film that replaced
    // it. `?poster=1` is the same failure, quieter.
    const response = await replace(MP4, 'video/mp4', {
      video: { durationMs: 12_000, width: 1920, height: 1080 },
      poster: PNG.toString('base64'),
    })
    expect(response.status).toBe(200)
    expect(mockOps.deleted).toEqual(
      expect.arrayContaining([
        `${MOCK_MASTER}__poster.webp`,
        `${MOCK_MASTER}__poster__w640.webp`,
        `${MOCK_MASTER}__r720p.mp4`,
      ]),
    )
  })

  it('clears videoRenditions on the document — none exist for these bytes yet', async () => {
    await replace(MP4, 'video/mp4', {
      video: { durationMs: 12_000, width: 1920, height: 1080 },
    })
    expect(savedDoc()['videoRenditions']).toEqual({ __delete: true })
  })

  it('records the new film’s own metadata and poster', async () => {
    await replace(MP4, 'video/mp4', {
      video: { durationMs: 12_000, width: 1920, height: 1080 },
      poster: PNG.toString('base64'),
    })
    expect(savedDoc()['video']).toMatchObject({ durationMs: 12_000 })
    expect(savedDoc()['poster']).toMatchObject({ variants: [640] })
  })

  it('CLEARS the old duration when the new bytes arrive unprobed', async () => {
    // A film swapped from a scripted caller, or a browser that could not
    // decode it: keeping the previous `video` would report the old film's
    // length under the new one, and keeping `poster` would show its face.
    await replace(MP4, 'video/mp4')
    expect(savedDoc()['video']).toEqual({ __delete: true })
    expect(savedDoc()['poster']).toEqual({ __delete: true })
  })
})

describe('the signed leg, because a 7 MB PDF cannot ride a JSON body', () => {
  it('mints the PUT against a STAGING object, never the master', async () => {
    // Signing the master would publish un-inspected bytes the instant the PUT
    // landed, under a cdnPath already embedded in published pages — and a
    // finalize that then refused them would have destroyed the original to do
    // it.
    const response = await call(replacePut, 'PUT', {
      contentType: 'application/pdf',
      fileName: 'brand-guidelines.pdf',
      sizeBytes: 6_999_965,
    })
    expect(response.status).toBe(200)
    expect((await response.json()).uploadUrl).toBe('https://storage.test/put')
    expect(mockOps.signed).toEqual([MOCK_STAGED])
  })

  it('refuses to mint past the type’s ceiling', async () => {
    const response = await call(replacePut, 'PUT', {
      contentType: 'application/pdf',
      sizeBytes: 40 * 1024 * 1024,
    })
    expect(response.status).toBe(413)
    expect(mockOps.signed).toEqual([])
  })

  it('finalizes by MOVING the staged object over the master', async () => {
    const response = await call(replacePatch, 'PATCH', {
      fileName: 'brand-guidelines.pdf',
    })
    expect(response.status).toBe(200)
    expect(mockOps.moved).toEqual([{ from: MOCK_STAGED, to: MOCK_MASTER }])
    expect(savedDoc()['sizeBytes']).toBe(PDF.length)
    // The token rotates with the content, so the raw storage URL changes even
    // though the CDN path does not.
    expect(mockOps.metadata[0]?.path).toBe(MOCK_MASTER)
  })

  it('a refused finalize deletes the staging object and touches nothing else', async () => {
    mockState.stagedMetadata = { ...mockState.stagedMetadata, contentType: 'image/png' }
    mockState.stagedBytes = PNG
    const response = await call(replacePatch, 'PATCH', {})
    expect(response.status).toBe(415)
    expect(mockOps.deleted).toEqual([MOCK_STAGED])
    expect(mockOps.moved).toEqual([])
    expect(mockMediaSet).not.toHaveBeenCalled()
    expect(mockCounterSet).not.toHaveBeenCalled()
  })

  it('refuses bytes whose structure disagrees with the declared type', async () => {
    // The signed leg never holds the file, so this is a ranged read of the
    // head — the same verdict the in-process branch reaches, for a rounding
    // error in egress.
    mockState.stagedBytes = Buffer.concat([
      Buffer.from('MZ', 'ascii'),
      Buffer.alloc(64, 0),
    ])
    mockState.stagedMetadata = {
      ...mockState.stagedMetadata,
      size: mockState.stagedBytes.length,
    }
    const response = await call(replacePatch, 'PATCH', {})
    expect(response.status).toBe(415)
    expect(mockOps.deleted).toEqual([MOCK_STAGED])
  })

  it('answers 409 when the staged object is not there to finalize', async () => {
    mockState.stagedExists = false
    expect((await call(replacePatch, 'PATCH', {})).status).toBe(409)
  })

  it('files the digest of the bytes that are actually in the bucket', async () => {
    await call(replacePatch, 'PATCH', {})
    expect(savedDoc()['contentSha256']).toBe(
      createHash('sha256').update(new Uint8Array(PDF)).digest('hex'),
    )
  })
})

/**
 * The other two layers.
 *
 * A route that accepts a PDF is worth nothing while the menu item that would
 * send one is hidden — which is precisely the mockState this issue was filed
 * from, twice. These read the component's own source because the alternative
 * is mounting a media library, and the property being defended is a one-line
 * conditional that has already been wrong for a year.
 */
describe('the UI offers it for every family too (AGL-2732)', () => {
  const component = code(
    readFileSync(
      join(__dirname, '..', 'components', 'media', 'media-library.component.tsx'),
      'utf8',
    ),
    'media-library.component.tsx',
  )
  const route = code(
    readFileSync(
      join(__dirname, '..', 'app', 'api', 'media', 'replace', 'route.ts'),
      'utf8',
    ),
    'app/api/media/replace/route.ts',
  )

  it('passes onReplace unconditionally from the card', () => {
    expect(component).toContain('onReplace={() => requestCardReplace(media)}')
  })

  it('does not narrow either replace chooser to images', () => {
    expect(component).not.toContain('accept="image/*"')
    expect(component).not.toContain("file.type.startsWith('image/')")
  })

  it('keeps the image TRANSFORMS image-only — they are not part of this', () => {
    // There is nothing to crop or rotate about a PDF. Lifting this one too
    // would be the opposite mistake.
    expect(component).toContain('setImageEditorOpen(true)')
    expect(component).toMatch(
      /startsWith\('image\/'\)[\s\S]{0,200}setImageEditorOpen/,
    )
  })

  it('leaves no image-only refusal in the route', () => {
    expect(route).not.toContain('Only images can be replaced')
    expect(route).toContain('isAllowedUploadType(contentType)')
  })
})

/**
 * Replace is a door onto video ingress too (AGL-2830): it stores a new film
 * under a `cdnPath` that pages already embed. OPEN by default in this file,
 * because the cases above are about what a replace does with a film it
 * accepts; the cases below close it.
 *
 * Every refusal is paired with the replace that must still succeed on the
 * same closed flag — an image and a PDF — so a route that refused everything
 * could not pass.
 */
const mockVideoUploads: { open: boolean; calls: Array<[string, unknown]> } = {
  open: true,
  calls: [],
}

describe('a paused video cannot be swapped in either (AGL-2830)', () => {
  beforeEach(() => {
    mockVideoUploads.open = false
    mockVideoUploads.calls = []
    mockState.existing = {
      contentType: 'video/mp4',
      visibleTo: ['org'],
      poster: { width: 1280, height: 720, variants: [640] },
    }
  })

  afterEach(() => {
    mockVideoUploads.open = true
  })

  it('refuses the base64 leg with the code the console renders, and touches nothing', async () => {
    const response = await replace(MP4, 'video/mp4', {
      video: { durationMs: 12_000, width: 1920, height: 1080 },
    })
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.code).toBe('video_uploads_paused')
    expect(String(body.error)).toMatch(/^Video uploads are paused\./)
    // The film already there is untouched: nothing saved, no poster dropped,
    // no document write, no counter delta.
    expect(mockOps.saved).toEqual([])
    expect(mockOps.deleted).toEqual([])
    expect(mockMediaSet).not.toHaveBeenCalled()
    expect(mockCounterSet).not.toHaveBeenCalled()
  })

  it('asks the video flag for the org that owns the asset', async () => {
    await replace(MP4, 'video/mp4')
    expect(mockVideoUploads.calls).toEqual([['release_video_uploads', 'org-1']])
  })

  it('refuses to mint a signed URL for a video', async () => {
    const response = await call(replacePut, 'PUT', {
      contentType: 'video/mp4',
      fileName: 'recut.mp4',
      sizeBytes: 40 * 1024 * 1024,
    })
    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe('video_uploads_paused')
    expect(mockOps.signed).toEqual([])
  })

  it('refuses a staged video at finalize, deletes the staged object and keeps the master', async () => {
    mockState.stagedBytes = MP4
    mockState.stagedMetadata = { contentType: 'video/mp4', size: MP4.length }
    const response = await call(replacePatch, 'PATCH', {})
    expect(response.status).toBe(403)
    expect(mockOps.deleted).toEqual([MOCK_STAGED])
    expect(mockOps.moved).toEqual([])
    expect(mockMediaSet).not.toHaveBeenCalled()
    expect(mockCounterSet).not.toHaveBeenCalled()
  })

  it('still replaces an IMAGE while video is paused, without reading the flag', async () => {
    mockState.existing = { contentType: 'image/png', visibleTo: ['org'] }
    expect((await replace(PNG, 'image/png')).status).toBe(200)
    expect(mockVideoUploads.calls).toEqual([])
  })

  it('still replaces a PDF while video is paused', async () => {
    mockState.existing = { contentType: 'application/pdf', visibleTo: ['org'] }
    expect((await replace(PDF, 'application/pdf')).status).toBe(200)
    expect(mockVideoUploads.calls).toEqual([])
  })

  it('replaces the film once the flag opens for the org', async () => {
    mockVideoUploads.open = true
    const response = await replace(MP4, 'video/mp4', {
      video: { durationMs: 12_000, width: 1920, height: 1080 },
    })
    expect(response.status).toBe(200)
    expect(mockOps.saved[0]?.path).toBe(MOCK_MASTER)
  })
})
