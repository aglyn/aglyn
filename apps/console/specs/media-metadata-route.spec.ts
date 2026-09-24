/**
 * @jest-environment node
 */

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
 * `/api/media/metadata` end to end (AGL-3331), over the REAL readers and
 * writers and a fake bucket and document.
 *
 * The promises it pins:
 *  - a read fills the record without touching `updatedAt`, and a current
 *    record costs no Storage call at all;
 *  - a write changes the file's metadata and not one byte of its image
 *    data, carries every piece of object metadata over but the token, and
 *    lands the new digests with the record read back from the new bytes;
 *  - a stale digest, a lost generation race, a field the format cannot
 *    take and a read-only format all refuse without writing anything.
 */

import { createHash } from 'crypto'
import { writeJpegBlocks } from '@aglyn/aglyn/app-utils/media-embedded-metadata/jpeg'

const mockRemoveCopies = jest.fn(async () => undefined)
const mockScheduleCopies = jest.fn()
const mockQuarantine = jest.fn(async () => null as Response | null)

/** The stored object, the document and every write either one saw. */
const mockState = {
  bytes: Buffer.alloc(0),
  generation: 7,
  objectMeta: {} as Record<string, unknown>,
  doc: {} as Record<string, unknown>,
  saves: [] as Array<{ bytes: Buffer; options: any }>,
  ranged: [] as Array<{ start: number; end: number }>,
  wholeDownloads: 0,
  updates: [] as Array<Record<string, unknown>>,
  counters: [] as unknown[],
  saveError: null as null | { code: number },
}

const mockFile = {
  name: 'orgs/org-1/media/m1',
  exists: async () => [true],
  getMetadata: async () => [
    {
      size: String(mockState.bytes.length),
      generation: String(mockState.generation),
      ...mockState.objectMeta,
    },
  ],
  download: async (options?: { start: number; end: number }) => {
    if (!options) {
      mockState.wholeDownloads++
      return [mockState.bytes]
    }
    mockState.ranged.push(options)
    return [mockState.bytes.subarray(options.start, options.end + 1)]
  },
  save: async (bytes: Buffer, options: unknown) => {
    if (mockState.saveError) throw mockState.saveError
    mockState.saves.push({ bytes, options })
  },
}

const mockMediaRef = {
  get: async () => ({
    id: 'm1',
    exists: true,
    get: (field: string) => mockState.doc[field],
  }),
  update: async (data: Record<string, unknown>) => {
    mockState.updates.push(data)
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'u1', email_verified: true }),
      }),
      storage: () => ({ bucket: () => ({ name: 'bucket', file: () => mockFile }) }),
    }),
    firestore: {
      FieldValue: {
        delete: () => '<delete>',
        serverTimestamp: () => '<now>',
        increment: (n: number) => ({ increment: n }),
      },
    },
  },
  emailUnverifiedResponse: () => Response.json({}, { status: 403 }),
  isImpersonationSession: () => false,
  quarantinedUploadRefusal: (...args: unknown[]) => mockQuarantine(...(args as [])),
}))
jest.mock('../utils/server/media-scope', () => ({
  resolveMediaScope: async () => ({
    scope: {
      scopeRef: {
        firestore: {},
        collection: (name: string) => ({
          doc: () =>
            name === 'media'
              ? mockMediaRef
              : { set: async (data: unknown) => mockState.counters.push(data) },
        }),
      },
      base: 'orgs/org-1',
      cdnScope: 'org-1',
      orgId: 'org-1',
      collection: 'orgs',
      scopeId: 'org-1',
      billing: {},
    },
  }),
  scopeAllows: () => true,
  mediaObjectPath: () => 'orgs/org-1/media/m1',
}))
jest.mock('../utils/server/media-storage-band', () => ({
  resolveOrgMediaBand: async () => ({ usedBytes: 0, allowanceMb: 1024 }),
}))
jest.mock('../utils/storage-overage', () => ({
  mediaStorageGate: () => ({ allowed: true }),
  scopeBillsStorageOverage: () => false,
}))
jest.mock('../utils/server/media-delivery-copies', () => ({
  removeAssetDeliveryCopies: (...args: unknown[]) => mockRemoveCopies(...(args as [])),
  scheduleMediaDeliveryCopies: (...args: unknown[]) => mockScheduleCopies(...args),
}))

import { POST } from '../app/api/media/metadata/route'

/**
 * A structurally real baseline JPEG: SOI, a quantization table, a frame
 * header, a Huffman table stub, a scan header and "entropy-coded" bytes that
 * the metadata writers must carry through untouched, then EOI.
 */
function baseJpeg(): Uint8Array {
  const segment = (marker: number, payload: number[]) => [
    0xff,
    marker,
    (payload.length + 2) >> 8,
    (payload.length + 2) & 0xff,
    ...payload,
  ]
  const scan = Array.from({ length: 64 }, (_, i) => (i * 37) & 0x7f)
  return new Uint8Array([
    0xff, 0xd8,
    ...segment(0xdb, [0x00, ...Array.from({ length: 64 }, () => 1)]),
    ...segment(0xc0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]),
    ...segment(0xc4, [0x00, ...Array.from({ length: 16 }, () => 0)]),
    ...segment(0xda, [1, 1, 0, 0, 63, 0]),
    ...scan,
    0xff, 0xd9,
  ])
}

const XMP = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Harbor</rdf:li></rdf:Alt></dc:title>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`

const sha = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')

/** Everything from the scan header on — the part no edit may touch. */
const imageData = (bytes: Uint8Array) => {
  const buffer = Buffer.from(bytes)
  return buffer.subarray(buffer.indexOf(Buffer.from([0xff, 0xda])))
}

const call = (body: Record<string, unknown>) =>
  POST(
    new Request('http://console.test/api/media/metadata', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ orgId: 'org-1', mediaId: 'm1', ...body }),
    }),
  )

beforeEach(() => {
  const bytes = writeJpegBlocks(baseJpeg(), { xmp: XMP })
  mockState.bytes = Buffer.from(bytes)
  mockState.generation = 7
  mockState.objectMeta = {
    contentType: 'image/jpeg',
    cacheControl: 'public, max-age=31536000, immutable',
    metadata: { firebaseStorageDownloadTokens: 'old-token', campaign: 'q3' },
  }
  mockState.doc = {
    contentType: 'image/jpeg',
    fileName: 'harbor.jpg',
    contentSha256: sha(bytes),
    contentHash: sha(bytes).slice(0, 16),
    sizeBytes: bytes.length,
  }
  mockState.saves = []
  mockState.ranged = []
  mockState.wholeDownloads = 0
  mockState.updates = []
  mockState.counters = []
  mockState.saveError = null
  mockRemoveCopies.mockClear()
  mockScheduleCopies.mockClear()
  mockQuarantine.mockClear()
})

describe('read', () => {
  it('reads the file, stores the record, and leaves updatedAt alone', async () => {
    const response = await call({ action: 'read' })
    expect(response.status).toBe(200)
    const { embeddedMetadata } = await response.json()
    expect(embeddedMetadata.format).toBe('jpeg')
    expect(embeddedMetadata.writable).toBe(true)
    expect(embeddedMetadata.contentSha256).toBe(mockState.doc['contentSha256'])
    expect(embeddedMetadata.fields).toContainEqual(
      expect.objectContaining({ key: 'title', value: 'Harbor', editable: true }),
    )
    expect(mockState.updates).toHaveLength(1)
    expect(Object.keys(mockState.updates[0] ?? {})).toEqual(['embeddedMetadata'])
    expect(mockState.wholeDownloads).toBe(0)
  })

  it('answers a current record without touching Storage', async () => {
    mockState.doc['embeddedMetadata'] = {
      version: 1,
      format: 'jpeg',
      fields: [],
      writable: true,
      contentSha256: mockState.doc['contentSha256'],
    }
    const response = await call({ action: 'read' })
    expect(response.status).toBe(200)
    expect(mockState.ranged).toEqual([])
    expect(mockState.updates).toEqual([])
  })
})

describe('write', () => {
  it('writes the edit into the file and nothing but the edit', async () => {
    const before = Buffer.from(mockState.bytes)
    const response = await call({
      action: 'write',
      patch: { title: 'Harbor at dusk', credit: 'Aglyn' },
      expectedSha256: mockState.doc['contentSha256'],
    })
    expect(response.status).toBe(200)
    const payload = await response.json()

    expect(mockState.saves).toHaveLength(1)
    const saved = mockState.saves[0]!
    expect(imageData(saved.bytes).equals(imageData(before))).toBe(true)
    expect(saved.bytes.toString('latin1')).toContain('Harbor at dusk')
    expect(saved.options.preconditionOpts).toEqual({ ifGenerationMatch: 7 })
    expect(saved.options.metadata.cacheControl).toBe(
      'public, max-age=31536000, immutable',
    )
    expect(saved.options.metadata.metadata.campaign).toBe('q3')
    expect(saved.options.metadata.metadata.firebaseStorageDownloadTokens).not.toBe(
      'old-token',
    )

    expect(payload.contentSha256).toBe(sha(saved.bytes))
    const update = mockState.updates[0]!
    expect(update).toMatchObject({
      contentSha256: sha(saved.bytes),
      contentHash: sha(saved.bytes).slice(0, 16),
      sizeBytes: saved.bytes.length,
      updatedAt: '<now>',
    })
    const fields = (update['embeddedMetadata'] as any).fields
    expect(fields).toContainEqual(
      expect.objectContaining({ key: 'title', value: 'Harbor at dusk' }),
    )
    expect(fields).toContainEqual(
      expect.objectContaining({ key: 'credit', value: 'Aglyn' }),
    )
    expect(mockRemoveCopies).toHaveBeenCalled()
    expect(mockScheduleCopies).toHaveBeenCalled()
  })

  it('refuses a stale digest before reading anything', async () => {
    const response = await call({
      action: 'write',
      patch: { title: 'x' },
      expectedSha256: 'not-the-current-digest',
    })
    expect(response.status).toBe(409)
    expect(mockState.wholeDownloads).toBe(0)
    expect(mockState.saves).toEqual([])
  })

  it('answers a lost generation race as a 409, and writes no document', async () => {
    mockState.saveError = { code: 412 }
    const response = await call({
      action: 'write',
      patch: { title: 'x' },
      expectedSha256: mockState.doc['contentSha256'],
    })
    expect(response.status).toBe(409)
    expect(mockState.updates).toEqual([])
  })

  it('refuses a field the format cannot take, by name', async () => {
    const response = await call({
      action: 'write',
      patch: { exposure: '1/8000 s' },
      expectedSha256: mockState.doc['contentSha256'],
    })
    expect(response.status).toBe(422)
    expect((await response.json()).error).toBe(
      'Exposure cannot be written into this file.',
    )
    expect(mockState.saves).toEqual([])
  })

  it('leaves a quarantined asset exactly as staff left it', async () => {
    mockQuarantine.mockResolvedValueOnce(Response.json({}, { status: 410 }))
    const response = await call({
      action: 'write',
      patch: { title: 'x' },
      expectedSha256: mockState.doc['contentSha256'],
    })
    expect(response.status).toBe(410)
    expect(mockState.saves).toEqual([])
  })
})
