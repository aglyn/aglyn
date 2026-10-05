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
 * A site icon (AGL-3484) through the real `serveMediaCdn`: the `?icon=`
 * representation sits behind every gate the asset's own bytes do, survives a
 * stale content pin as the same icon, and is drawn from the asset's current
 * bytes rather than served as the full-size original.
 *
 * Firestore and Storage are stubbed exactly as `serve-media-cdn.stale-pin.spec.ts`
 * stubs them; the Storage download hands back a real PNG so the icon is drawn
 * by the real `sharp`.
 */

import { Readable, Writable } from 'node:stream'
import sharp from 'sharp'
import {
  MEDIA_CDN_IMMUTABLE_CACHE_CONTROL,
  mediaCdnForwardedQuery,
  serveMediaCdn,
} from './serve-media-cdn'

const CURRENT = 'abc123def4567890'

const mockState: {
  doc: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  source: Buffer
} = { doc: null, metadata: null, source: Buffer.alloc(0) }

jest.mock('./firebase-admin', () => {
  const snapshot = () => ({
    get exists() {
      return mockState.doc !== null
    },
    get: (field: string) => mockState.doc?.[field],
  })
  const docRef = (): unknown => ({
    collection: () => ({ doc: () => docRef() }),
    get: async () => snapshot(),
    set: async () => undefined,
  })
  const file = () => ({
    getMetadata: async () => {
      if (!mockState.metadata) throw new Error('No such object')
      return [mockState.metadata]
    },
    download: async () => [mockState.source],
    createReadStream: () => Readable.from([Buffer.from('ORIGINAL')]),
  })
  return {
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({ collection: () => ({ doc: () => docRef() }) }),
        storage: () => ({ bucket: () => ({ file }) }),
      }),
      firestore: { FieldValue: { increment: (n: number) => ({ increment: n }) } },
    },
  }
})

class MockRes extends Writable {
  headers: Record<string, string> = {}
  // A body streamed without an explicit status is node's default 200.
  statusCode = 200
  headersSent = false
  chunks: Buffer[] = []

  setHeader(key: string, value: string) {
    this.headers[key.toLowerCase()] = String(value)
    return this
  }
  getHeader(key: string) {
    return this.headers[key.toLowerCase()]
  }
  removeHeader(key: string) {
    delete this.headers[key.toLowerCase()]
  }
  status(code: number) {
    this.statusCode = code
    this.headersSent = true
    return this
  }
  json(payload: unknown) {
    this.end(JSON.stringify(payload))
    return this
  }
  override _write(
    chunk: Buffer | string,
    _encoding: unknown,
    done: (error?: Error) => void,
  ) {
    this.chunks.push(Buffer.from(chunk))
    done()
  }
  get body(): Buffer {
    return Buffer.concat(this.chunks)
  }
}

async function serve(
  path: string[],
  query: Record<string, string> = {},
): Promise<MockRes> {
  const res = new MockRes()
  await serveMediaCdn(
    { method: 'GET', query: { path, ...query }, headers: {} } as never,
    res as never,
  )
  return res
}

beforeEach(async () => {
  mockState.doc = {
    contentType: 'image/png',
    visibleTo: ['org'],
    contentHash: CURRENT,
    fileName: 'favicon.png',
  }
  mockState.metadata = { contentType: 'image/png', size: 4096 }
  mockState.source = await sharp({
    create: { width: 512, height: 512, channels: 4, background: '#f00' },
  })
    .png()
    .toBuffer()
})

describe('a site icon on the media CDN (AGL-3484)', () => {
  it('is drawn at its size from the current bytes, and held for a year', async () => {
    const res = await serve(['org:ORG', 'MEDIA'], { icon: 'png-32', v: CURRENT })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe(MEDIA_CDN_IMMUTABLE_CACHE_CONTROL)
    const meta = await sharp(res.body).metadata()
    expect([meta.width, meta.height]).toEqual([32, 32])
  })

  it('is refused wherever the asset itself is — the gates run first', async () => {
    mockState.doc = { ...mockState.doc, visibleTo: ['host:OTHER'] }
    const res = await serve(['org:ORG:SITE', 'MEDIA'], {
      icon: 'png-32',
      v: CURRENT,
    })
    expect(res.statusCode).toBe(404)
  })

  it('stays the same icon behind a stale content pin', async () => {
    const res = await serve(['org:ORG', 'MEDIA', 'stalehash'], {
      icon: 'flat-180',
      bg: 'fafaf9',
      v: CURRENT,
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe(
      `/api/media/cdn/org:ORG/MEDIA?icon=flat-180&bg=fafaf9&v=${CURRENT}`,
    )
  })

  it('is carried by the forwarded query, with nothing else', () => {
    expect(
      mediaCdnForwardedQuery({
        icon: 'maskable-512',
        bg: '000000',
        v: 'h',
        junk: 'x',
      }),
    ).toBe('?icon=maskable-512&bg=000000&v=h')
  })

  it('leaves an unknown `icon` value to serve the asset as it is', async () => {
    const res = await serve(['org:ORG', 'MEDIA'], { icon: 'png-9999' })
    expect(res.statusCode).toBe(200)
    expect(res.body.toString()).toBe('ORIGINAL')
  })
})
