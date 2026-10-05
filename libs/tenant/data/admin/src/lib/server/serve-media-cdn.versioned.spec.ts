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
 * The versioned stable URL (AGL-3485).
 *
 * A published page names `/api/media/cdn/{scope}/{id}?v={contentHash}.{encoder}`
 * when its composition read the asset's document, and the CDN answers it with
 * a year-long `immutable` browser policy — but ONLY while the token names the
 * bytes and the variants actually being served. Everything else gets the
 * stable URL's short policy, so a stale page shows the new picture and no
 * cache is ever told to keep the wrong one.
 *
 * Driven through the real `serveMediaCdn` with Firestore and Storage stubbed,
 * the harness `serve-media-cdn.etag.spec.ts` uses.
 */

import { Readable, Writable } from 'node:stream'
import { MEDIA_VARIANT_ENCODER_VERSION } from '@aglyn/aglyn/server'
import {
  MEDIA_CDN_STABLE_CACHE_CONTROL,
  MEDIA_CDN_VERSIONED_CACHE_CONTROL,
  mediaCdnVariantFor,
  mediaCdnVersionIsCurrent,
  serveMediaCdn,
} from './serve-media-cdn'

const mockState: {
  doc: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
} = { doc: null, metadata: null }

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
    createReadStream: () => Readable.from([Buffer.from('PNGBYTES')]),
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
  statusCode = 0
  headersSent = false
  body = ''

  setHeader(key: string, value: string) {
    this.headers[key.toLowerCase()] = String(value)
    return this
  }
  getHeader(key: string) {
    return this.headers[key.toLowerCase()]
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
  send(payload: unknown) {
    this.end(String(payload))
    return this
  }
  override _write(
    chunk: Buffer | string,
    _encoding: unknown,
    done: (error?: Error) => void,
  ) {
    this.body += String(chunk)
    done()
  }
}

async function serve(
  path: string[],
  query: Record<string, string> = {},
  headers: Record<string, string> = {},
): Promise<MockRes> {
  const res = new MockRes()
  await serveMediaCdn(
    { method: 'GET', query: { path, ...query }, headers } as never,
    res as never,
  )
  return res
}

const DOC = {
  fileName: 'hero.png',
  contentType: 'image/png',
  sizeBytes: 8,
  storagePath: 'orgs/acme/media/m1',
  contentHash: '0123456789abcdef',
  variants: [320, 640],
  // Made by the encoder this code runs (AGL-3486); the cases below that are
  // about an older or newer generation say so.
  variantEncoderVersion: MEDIA_VARIANT_ENCODER_VERSION,
  visibleTo: ['org'],
}

const CURRENT = `0123456789abcdef.${MEDIA_VARIANT_ENCODER_VERSION}`

beforeEach(() => {
  mockState.doc = { ...DOC }
  mockState.metadata = { contentType: 'image/png', size: 8 }
})

describe('AGL-3485 · a versioned image URL is kept for a year', () => {
  it('pins the original when the token names the current bytes', async () => {
    const res = await serve(['org:acme', 'm1'], { v: CURRENT })
    expect(res.headers['cache-control']).toBe(MEDIA_CDN_VERSIONED_CACHE_CONTROL)
    expect(res.headers['cache-control']).toContain('max-age=31536000')
    expect(res.headers['cache-control']).toContain('immutable')
    expect(res.headers['cache-control']).toContain('s-maxage=')
  })

  it('pins a generated variant made by the encoder the token names', async () => {
    const res = await serve(['org:acme', 'm1'], { v: CURRENT, w: '640' })
    expect(res.headers['cache-control']).toBe(MEDIA_CDN_VERSIONED_CACHE_CONTROL)
  })

  it('keeps an unversioned request on the short policy', async () => {
    const res = await serve(['org:acme', 'm1'], { w: '640' })
    expect(res.headers['cache-control']).toBe(MEDIA_CDN_STABLE_CACHE_CONTROL)
  })

  it('serves a stale token the CURRENT bytes on the short policy', async () => {
    // A page rendered before a replace still names the old hash. It must get
    // the new picture, and no cache may keep it under that URL for a year.
    const res = await serve(['org:acme', 'm1'], {
      v: `fedcba9876543210.${MEDIA_VARIANT_ENCODER_VERSION}`,
    })
    expect(res.body).toBe('PNGBYTES')
    expect(res.headers['cache-control']).toBe(MEDIA_CDN_STABLE_CACHE_CONTROL)
  })

  it('does not pin a width that fell back to the original', async () => {
    const res = await serve(['org:acme', 'm1'], { v: CURRENT, w: '1280' })
    expect(res.headers['cache-control']).toBe(MEDIA_CDN_STABLE_CACHE_CONTROL)
  })

  it('does not pin a larger variant standing in for a width the asset lacks', async () => {
    // 480 is answered by the 640 variant until a regeneration makes a 480;
    // a year-long pin would keep the stand-in after the real width exists.
    const res = await serve(['org:acme', 'm1'], { v: CURRENT, w: '480' })
    expect(res.headers['cache-control']).toBe(MEDIA_CDN_STABLE_CACHE_CONTROL)
  })

  it('does not pin variants another encoder generation made', async () => {
    // The page names the encoder the code runs; the document says its
    // variants were made by a different one. Pinning them would hide the
    // regeneration that brings them in line.
    mockState.doc = {
      ...DOC,
      variantEncoderVersion: MEDIA_VARIANT_ENCODER_VERSION + 1,
    }
    const res = await serve(['org:acme', 'm1'], { v: CURRENT, w: '640' })
    expect(res.headers['cache-control']).toBe(MEDIA_CDN_STABLE_CACHE_CONTROL)
  })

  it('does not pin the bare URL while the encoder generation is behind', async () => {
    mockState.doc = { ...DOC, variantEncoderVersion: 0.5 }
    const res = await serve(['org:acme', 'm1'], {
      v: `0123456789abcdef.${MEDIA_VARIANT_ENCODER_VERSION + 1}`,
    })
    expect(res.headers['cache-control']).toBe(MEDIA_CDN_STABLE_CACHE_CONTROL)
  })

  it('never pins a private asset, versioned or not', async () => {
    mockState.doc = { ...DOC, private: true }
    const res = await serve(['org:acme', 'm1'], { v: CURRENT })
    expect(res.headers['cache-control']).toBe('private, no-store')
  })

  it('keeps a non-image on its edge-bypassing policy', async () => {
    mockState.doc = { ...DOC, contentType: 'application/pdf', variants: [] }
    mockState.metadata = { contentType: 'application/pdf', size: 8 }
    const res = await serve(['org:acme', 'm1'], { v: CURRENT })
    expect(res.headers['cache-control']).toMatch(/^private, max-age=60/)
  })
})

describe('mediaCdnVersionIsCurrent', () => {
  const base = {
    token: { contentHash: 'abc', encoderVersion: MEDIA_VARIANT_ENCODER_VERSION },
    currentHash: 'abc',
    widthRequested: false,
    variantServed: false,
    otherRepresentation: false,
    documentEncoderVersion: undefined,
  }

  it('reads an absent encoder field as the first generation', () => {
    const token = { contentHash: 'abc', encoderVersion: 1 }
    expect(mediaCdnVersionIsCurrent({ ...base, token })).toBe(
      (MEDIA_VARIANT_ENCODER_VERSION as number) === 1,
    )
  })

  it('pins only what the encoder this code runs made', () => {
    const current = {
      ...base,
      widthRequested: true,
      variantServed: true,
      documentEncoderVersion: MEDIA_VARIANT_ENCODER_VERSION,
    }
    expect(mediaCdnVersionIsCurrent(current)).toBe(true)
    expect(
      mediaCdnVersionIsCurrent({
        ...current,
        documentEncoderVersion: MEDIA_VARIANT_ENCODER_VERSION + 1,
      }),
    ).toBe(false)
    expect(
      mediaCdnVersionIsCurrent({
        ...current,
        token: { contentHash: 'abc', encoderVersion: MEDIA_VARIANT_ENCODER_VERSION + 1 },
        documentEncoderVersion: MEDIA_VARIANT_ENCODER_VERSION + 1,
      }),
    ).toBe(false)
  })

  it('refuses no token, an empty hash and a poster or rendition', () => {
    expect(mediaCdnVersionIsCurrent({ ...base, token: null })).toBe(false)
    expect(mediaCdnVersionIsCurrent({ ...base, currentHash: '' })).toBe(false)
    expect(
      mediaCdnVersionIsCurrent({ ...base, otherRepresentation: true }),
    ).toBe(false)
  })
})

describe('mediaCdnVariantFor (AGL-3486)', () => {
  it('answers the width itself when the asset has it', () => {
    expect(mediaCdnVariantFor([320, 640, 1280], 640)).toBe(640)
  })

  it('answers the smallest larger width when it does not', () => {
    expect(mediaCdnVariantFor([320, 640, 1280, 1920], 768)).toBe(1280)
    expect(mediaCdnVariantFor([1920, 320, 1280, 640], 384)).toBe(640)
  })

  it('answers nothing when every variant is narrower, or nothing was asked', () => {
    expect(mediaCdnVariantFor([320, 640], 1280)).toBeNull()
    expect(mediaCdnVariantFor([], 640)).toBeNull()
    expect(mediaCdnVariantFor([320, 640], 0)).toBeNull()
  })

  it('ignores entries that are not whole widths', () => {
    expect(mediaCdnVariantFor(['1280', 960.5, null, 1600], 768)).toBe(1600)
  })
})
