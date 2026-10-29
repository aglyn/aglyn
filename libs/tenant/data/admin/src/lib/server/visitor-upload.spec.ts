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
 * @jest-environment node
 */

import { Readable, Writable } from 'node:stream'
import {
  deleteVisitorUploads,
  finalizeVisitorUpload,
  mintVisitorUploadTicket,
  readVisitorUpload,
  sendVisitorUploadFile,
  visitorUploadResponseHeaders,
  VISITOR_UPLOAD_LIMITS,
  type VisitorUploadBucket,
  type VisitorUploadDeps,
  type VisitorUploadObject,
} from './visitor-upload'

jest.mock('./firebase-admin', () => ({ __esModule: true, default: {} }))
jest.mock('./lockdown', () => ({ featureLockdownRefusal: jest.fn() }))
jest.mock('./rate-limit-store', () => ({ consumeRateLimit: jest.fn() }))

/**
 * The visitor upload pipeline (AGL-4096) over an in-memory bucket: what a
 * ticket signs, what finalize keeps and refuses, and how a kept file is read
 * back and served.
 */

interface Stored {
  bytes: Buffer
  contentType: string
  metadata: Record<string, unknown>
}

const objects = new Map<string, Stored>()
const policies: Array<{ path: string; options: Record<string, any> }> = []
const deletedPrefixes: string[] = []

function fileOf(path: string): VisitorUploadObject {
  return {
    generateSignedPostPolicyV4: async (options) => {
      policies.push({ path, options })
      return [{ url: 'https://storage.example/bucket/', fields: { ...(options.fields ?? {}), key: path, policy: 'signed' } }]
    },
    exists: async () => [objects.has(path)],
    getMetadata: async () => {
      const stored = objects.get(path)
      if (!stored) throw new Error('No such object')
      return [{ size: String(stored.bytes.length), contentType: stored.contentType, metadata: stored.metadata['metadata'] as never }]
    },
    download: async (options) => {
      const stored = objects.get(path)
      if (!stored) throw new Error('No such object')
      const end = options?.end ?? stored.bytes.length - 1
      return [stored.bytes.subarray(options?.start ?? 0, end + 1)]
    },
    save: async (data, options) => {
      objects.set(path, {
        bytes: Buffer.from(data),
        contentType: String(options['contentType']),
        metadata: (options['metadata'] ?? {}) as Record<string, unknown>,
      })
    },
    move: async (destination) => {
      const stored = objects.get(path)
      if (!stored) throw new Error('No such object')
      objects.set(destination, { ...stored })
      objects.delete(path)
    },
    setMetadata: async (metadata) => {
      const stored = objects.get(path)
      if (!stored) throw new Error('No such object')
      stored.metadata = { ...stored.metadata, ...metadata }
    },
    delete: async () => {
      objects.delete(path)
    },
    createReadStream: () => Readable.from([objects.get(path)?.bytes ?? Buffer.alloc(0)]),
  }
}

const bucket: VisitorUploadBucket = {
  file: fileOf,
  deleteFiles: async ({ prefix }) => {
    deletedPrefixes.push(prefix)
    for (const path of [...objects.keys()]) if (path.startsWith(prefix)) objects.delete(path)
  },
}

let nowMs = 1_000_000
let paused = false
let ids = 0
const spent: Array<{ key: string; limit: number }> = []
let allow: (key: string) => boolean = () => true

const deps: VisitorUploadDeps = {
  bucket: () => bucket,
  consumeRateLimit: async (key, options) => {
    spent.push({ key, limit: options.limit })
    return { allowed: allow(key), resetMs: nowMs + 30_000 }
  },
  uploadsPaused: async () => paused,
  secret: () => 'visitor-upload-spec-secret',
  now: () => nowMs,
  newId: () => `upload${++ids}`,
}

const SCOPE = { hostId: 'site1', purpose: 'quote-artwork', purposeId: 'q-1' }
const VISITOR = { ip: '203.0.113.9' }
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)])

beforeEach(() => {
  objects.clear()
  policies.length = 0
  deletedPrefixes.length = 0
  spent.length = 0
  nowMs = 1_000_000
  paused = false
  ids = 0
  allow = () => true
})

async function ticketFor(name: string, contentType: string, size: number) {
  const minted = await mintVisitorUploadTicket(deps, { scope: SCOPE, request: { name, contentType, size }, caller: VISITOR })
  if (!('ticket' in minted)) throw new Error(`refused: ${minted.error}`)
  return minted
}

/** What the browser's signed form post does: the bytes land at the pending path. */
function arrive(path: string, bytes: Buffer, contentType: string) {
  objects.set(path, { bytes, contentType, metadata: {} })
}

describe('a ticket', () => {
  it('signs one upload of the declared type and size to a pending path, scoped to the site and record', async () => {
    const minted = await ticketFor('Logo.png', 'image/png', PNG.length)
    expect(minted.file).toEqual({ id: 'upload1', name: 'Logo.png', contentType: 'image/png', size: PNG.length })
    expect(minted.upload).toEqual({
      url: 'https://storage.example/bucket/',
      fields: { 'Content-Type': 'image/png', key: 'visitor-uploads-pending/site1/quote-artwork/q-1/upload1', policy: 'signed' },
    })
    expect(policies).toEqual([
      {
        path: 'visitor-uploads-pending/site1/quote-artwork/q-1/upload1',
        options: {
          expires: nowMs + 15 * 60_000,
          conditions: [['content-length-range', 1, PNG.length]],
          fields: { 'Content-Type': 'image/png' },
        },
      },
    ])
  })

  it('spends a limit per caller on the site and one for the site', async () => {
    await ticketFor('a.png', 'image/png', 10)
    expect(spent).toEqual([
      { key: 'visitor-upload:site1:ip:203.0.113.9', limit: VISITOR_UPLOAD_LIMITS.perCaller.limit },
      { key: 'visitor-upload-site:site1', limit: VISITOR_UPLOAD_LIMITS.perSite.limit },
    ])
    await mintVisitorUploadTicket(deps, { scope: SCOPE, request: { name: 'a.png', contentType: 'image/png', size: 10 }, caller: { uid: 'u1' } })
    expect(spent[2].key).toBe('visitor-upload:site1:uid:u1')
  })

  it.each([
    ['a caller over their limit', (key: string) => !key.startsWith('visitor-upload:')],
    ['a site over its limit', (key: string) => !key.startsWith('visitor-upload-site:')],
  ])('refuses %s with 429 and signs nothing', async (_label, rule) => {
    allow = rule
    const refused = await mintVisitorUploadTicket(deps, { scope: SCOPE, request: { name: 'a.png', contentType: 'image/png', size: 10 }, caller: VISITOR })
    expect(refused).toMatchObject({ ok: false, status: 429, code: 'rate', retryAfterSeconds: 30 })
    expect(policies).toEqual([])
  })

  it('refuses the wrong type, too big a file and a bad scope before any limit is spent', async () => {
    const mint = (request: unknown, scope = SCOPE) => mintVisitorUploadTicket(deps, { scope, request, caller: VISITOR })
    expect(await mint({ name: 'run.exe', contentType: 'application/octet-stream', size: 10 })).toMatchObject({ status: 400, code: 'type' })
    expect(await mint({ name: 'a.pdf', contentType: 'application/pdf', size: 25 * 1024 * 1024 + 1 })).toMatchObject({ status: 413, code: 'size' })
    expect(await mint({ name: 'a.pdf', contentType: 'application/pdf', size: 10 }, { ...SCOPE, purposeId: '../q-2' })).toMatchObject({
      status: 400,
      code: 'scope',
    })
    expect(spent).toEqual([])
    expect(policies).toEqual([])
  })

  it('is refused while the platform’s uploads are paused', async () => {
    paused = true
    expect(
      await mintVisitorUploadTicket(deps, { scope: SCOPE, request: { name: 'a.png', contentType: 'image/png', size: 10 }, caller: VISITOR }),
    ).toMatchObject({ status: 423, code: 'paused' })
    expect(policies).toEqual([])
  })
})

describe('finalize', () => {
  it('checks the bytes and moves them to the record’s private folder, with no download token', async () => {
    const minted = await ticketFor('Logo.png', 'image/png', PNG.length)
    arrive('visitor-uploads-pending/site1/quote-artwork/q-1/upload1', PNG, 'image/png')
    nowMs += 60_000
    const kept = await finalizeVisitorUpload(deps, { scope: SCOPE, ticket: minted.ticket, caller: VISITOR })
    expect(kept).toEqual({
      ok: true,
      file: {
        id: 'upload1',
        name: 'Logo.png',
        contentType: 'image/png',
        size: PNG.length,
        path: 'hosts/site1/private/uploads/quote-artwork/q-1/upload1',
        uploadedAtMs: nowMs,
      },
    })
    expect(objects.has('visitor-uploads-pending/site1/quote-artwork/q-1/upload1')).toBe(false)
    const stored = objects.get('hosts/site1/private/uploads/quote-artwork/q-1/upload1')
    expect(stored?.metadata).toMatchObject({
      cacheControl: 'private, no-store',
      contentDisposition: 'inline; filename="Logo.png"; filename*=UTF-8\'\'Logo.png',
      metadata: { name: 'Logo.png', uploadedAtMs: String(nowMs), firebaseStorageDownloadTokens: null },
    })
  })

  it('answers a retried finalize with the file it already kept', async () => {
    const minted = await ticketFor('Logo.png', 'image/png', PNG.length)
    arrive('visitor-uploads-pending/site1/quote-artwork/q-1/upload1', PNG, 'image/png')
    const first = await finalizeVisitorUpload(deps, { scope: SCOPE, ticket: minted.ticket, caller: VISITOR })
    const again = await finalizeVisitorUpload(deps, { scope: SCOPE, ticket: minted.ticket, caller: VISITOR })
    expect(again).toEqual(first)
  })

  it('refuses bytes that are not what the file says it is, and deletes them', async () => {
    const minted = await ticketFor('Logo.png', 'image/png', 300)
    arrive('visitor-uploads-pending/site1/quote-artwork/q-1/upload1', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]), 'image/png')
    const refused = await finalizeVisitorUpload(deps, { scope: SCOPE, ticket: minted.ticket, caller: VISITOR })
    expect(refused).toMatchObject({ ok: false, status: 415, code: 'inspection' })
    expect(objects.size).toBe(0)
  })

  it('refuses the EICAR test file', async () => {
    const minted = await ticketFor('art.pdf', 'application/pdf', 300)
    const eicar = Buffer.from('%PDF-1.4 X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*', 'ascii')
    arrive('visitor-uploads-pending/site1/quote-artwork/q-1/upload1', eicar, 'application/pdf')
    expect(await finalizeVisitorUpload(deps, { scope: SCOPE, ticket: minted.ticket, caller: VISITOR })).toMatchObject({
      status: 415,
      code: 'inspection',
    })
    expect(objects.size).toBe(0)
  })

  it('refuses a file larger than it was declared, or of another type, and deletes it', async () => {
    const big = await ticketFor('Logo.png', 'image/png', 100)
    arrive('visitor-uploads-pending/site1/quote-artwork/q-1/upload1', PNG, 'image/png')
    expect(await finalizeVisitorUpload(deps, { scope: SCOPE, ticket: big.ticket, caller: VISITOR })).toMatchObject({ status: 413, code: 'size' })
    const other = await ticketFor('Logo.png', 'image/png', PNG.length)
    arrive('visitor-uploads-pending/site1/quote-artwork/q-1/upload2', PNG, 'text/html')
    expect(await finalizeVisitorUpload(deps, { scope: SCOPE, ticket: other.ticket, caller: VISITOR })).toMatchObject({ status: 415, code: 'type' })
    expect(objects.size).toBe(0)
  })

  it('says so when nothing arrived', async () => {
    const minted = await ticketFor('Logo.png', 'image/png', PNG.length)
    expect(await finalizeVisitorUpload(deps, { scope: SCOPE, ticket: minted.ticket, caller: VISITOR })).toEqual({
      ok: false,
      status: 409,
      code: 'missing',
      error: 'We didn’t receive Logo.png. Try sending it again.',
    })
  })

  it('refuses a ticket for another record, a forged one and one long lapsed', async () => {
    const minted = await ticketFor('Logo.png', 'image/png', PNG.length)
    arrive('visitor-uploads-pending/site1/quote-artwork/q-1/upload1', PNG, 'image/png')
    expect(await finalizeVisitorUpload(deps, { scope: { ...SCOPE, purposeId: 'q-2' }, ticket: minted.ticket, caller: VISITOR })).toMatchObject({
      status: 400,
      code: 'ticket',
    })
    const [payload, signature] = minted.ticket.split('.')
    const forged = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), s: 99_999_999 })).toString('base64url')}.${signature}`
    expect(await finalizeVisitorUpload(deps, { scope: SCOPE, ticket: forged, caller: VISITOR })).toMatchObject({ status: 400, code: 'ticket' })
    nowMs += 15 * 60_000 + 60 * 60_000 + 1
    expect(await finalizeVisitorUpload(deps, { scope: SCOPE, ticket: minted.ticket, caller: VISITOR })).toMatchObject({ status: 410, code: 'ticket' })
    // Nothing kept; the abandoned upload is the bucket lifecycle's to reap.
    expect([...objects.keys()]).toEqual(['visitor-uploads-pending/site1/quote-artwork/q-1/upload1'])
  })

  it('strips script from an SVG and keeps it as a download', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="1" height="1"/></svg>')
    const minted = await ticketFor('mark.svg', 'image/svg+xml', svg.length)
    arrive('visitor-uploads-pending/site1/quote-artwork/q-1/upload1', svg, 'image/svg+xml')
    const kept = await finalizeVisitorUpload(deps, { scope: SCOPE, ticket: minted.ticket, caller: VISITOR })
    expect(kept).toMatchObject({ ok: true, file: { contentType: 'image/svg+xml' } })
    const stored = objects.get('hosts/site1/private/uploads/quote-artwork/q-1/upload1')
    expect(stored?.bytes.toString()).not.toContain('<script')
    expect(String(stored?.metadata['contentDisposition'])).toMatch(/^attachment;/)
    expect(objects.has('visitor-uploads-pending/site1/quote-artwork/q-1/upload1')).toBe(false)
  })
})

describe('a kept file', () => {
  async function keep(name: string, contentType: string, bytes: Buffer) {
    const minted = await ticketFor(name, contentType, bytes.length)
    arrive(`visitor-uploads-pending/site1/quote-artwork/q-1/${minted.file.id}`, bytes, contentType)
    const kept = await finalizeVisitorUpload(deps, { scope: SCOPE, ticket: minted.ticket, caller: VISITOR })
    if (!('file' in kept)) throw new Error('not kept')
    return kept.file
  }

  it('is read back by id within its scope only', async () => {
    const file = await keep('Logo.png', 'image/png', PNG)
    expect(await readVisitorUpload(deps, SCOPE, file.id)).toEqual(file)
    expect(await readVisitorUpload(deps, { ...SCOPE, purposeId: 'q-2' }, file.id)).toBeNull()
    expect(await readVisitorUpload(deps, SCOPE, '../upload1')).toBeNull()
  })

  it('is served with nosniff, a sandbox, no caching, and as a download unless it is a raster image', () => {
    expect(visitorUploadResponseHeaders({ name: 'Logo.png', contentType: 'image/png' })).toMatchObject({
      'Content-Type': 'image/png',
      'Content-Disposition': 'inline; filename="Logo.png"; filename*=UTF-8\'\'Logo.png',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    })
    expect(visitorUploadResponseHeaders({ name: 'Plan é.pdf', contentType: 'application/pdf' })['Content-Disposition']).toBe(
      'attachment; filename="Plan _.pdf"; filename*=UTF-8\'\'Plan%20%C3%A9.pdf',
    )
    expect(visitorUploadResponseHeaders({ name: 'mark.svg', contentType: 'image/svg+xml' })['Content-Security-Policy']).toContain('sandbox')
  })

  it('streams to the response', async () => {
    const file = await keep('Logo.png', 'image/png', PNG)
    const chunks: Buffer[] = []
    const headers: Record<string, string> = {}
    let status = 0
    const res = Object.assign(
      new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk))
          callback()
        },
      }),
      { setHeader: (name: string, value: string) => void (headers[name] = value), status: (code: number) => void (status = code) },
    )
    await sendVisitorUploadFile(deps, res, file)
    expect(status).toBe(200)
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(Buffer.concat(chunks).equals(PNG)).toBe(true)
  })

  it('goes with its record', async () => {
    await keep('Logo.png', 'image/png', PNG)
    await deleteVisitorUploads(deps, SCOPE)
    expect(deletedPrefixes).toEqual(['hosts/site1/private/uploads/quote-artwork/q-1/'])
    expect(objects.size).toBe(0)
  })
})
