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
 * The forced-download parameter on the media CDN (AGL-1411), driven through
 * the real `serveMediaCdn` rather than a pure helper — the header is only
 * worth anything if it is actually SET, and only safe if the refusals in
 * front of it still refuse when the parameter is present.
 *
 * Firestore and Storage are stubbed (no emulator), so this runs in the
 * default sweep. The emulator spec next door covers the scope/private gates
 * against a real Firestore; what is asserted here is the delivery contract:
 * disposition, filename encoding, cache identity, and — the one that
 * matters — that `?download=1` reaches none of it on a denied asset.
 */

import { Readable, Writable } from 'node:stream'
import {
  mediaContentDisposition,
  mediaDownloadName,
  serveMediaCdn,
  wantsMediaDownload,
} from './serve-media-cdn'

const ORG_WIDE = { contentType: 'image/png', visibleTo: ['org'], contentHash: 'hash1' }

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
    createReadStream: () => Readable.from([Buffer.from('PNG.')]),
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

/** Minimal `NextApiResponse` that is also a real `Writable`, so the
 *  handler's `stream.pipe(res)` runs exactly as it does in production. */
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
  method: 'GET' | 'HEAD' = 'GET',
): Promise<MockRes> {
  const res = new MockRes()
  await serveMediaCdn(
    { method, query: { path, ...query }, headers: {} } as never,
    res as never,
  )
  return res
}

const disposition = (res: MockRes) => res.headers['content-disposition']

beforeEach(() => {
  mockState.doc = { ...ORG_WIDE, fileName: 'aglyn-logo-mark-blue.png' }
  mockState.metadata = { contentType: 'image/png', size: 4 }
})

describe('media CDN content-disposition (AGL-1411)', () => {
  it('DEFAULTS to inline — every existing <img src> is untouched', () => {
    return serve(['org:acme', 'm1']).then((res) => {
      expect(disposition(res)).toBe('inline; filename="aglyn-logo-mark-blue.png"')
      expect(res.headers['content-type']).toBe('image/png')
    })
  })

  it('?download=1 serves the asset as an attachment under its real name', async () => {
    const res = await serve(['org:acme', 'm1'], { download: '1' })
    expect(disposition(res)).toBe(
      'attachment; filename="aglyn-logo-mark-blue.png"',
    )
    // The bytes and the type are the same asset — only the disposition moves.
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.body).toBe('PNG.')
  })

  it('accepts download=true as well, and nothing else', async () => {
    expect(disposition(await serve(['org:acme', 'm1'], { download: 'true' })))
      .toContain('attachment')
    for (const value of ['0', 'false', '', 'yes-please']) {
      expect(
        disposition(await serve(['org:acme', 'm1'], { download: value })),
      ).toContain('inline')
    }
  })

  it('falls back to the media id when the doc carries no fileName', async () => {
    mockState.doc = { ...ORG_WIDE }
    const res = await serve(['org:acme', 'm1'], { download: '1' })
    expect(disposition(res)).toBe('attachment; filename="m1"')
  })

  it('sets the header on HEAD too — a press link is probed before it is followed', async () => {
    const res = await serve(['org:acme', 'm1'], { download: '1' }, 'HEAD')
    expect(res.statusCode).toBe(200)
    expect(disposition(res)).toContain('attachment')
  })
})

describe('media CDN download cache identity (AGL-1411)', () => {
  it('gives the two dispositions DISTINCT ETags', async () => {
    // The query string is part of the CDN cache key, so the two variants
    // occupy different entries. The ETag is the second half of that: a
    // conditional GET carrying the inline validator must not be answered
    // 304 for the download URL, or the client reuses the stored INLINE
    // headers and the file opens in a tab anyway.
    const inline = await serve(['org:acme', 'm1'])
    const download = await serve(['org:acme', 'm1'], { download: '1' })
    expect(inline.headers['etag']).toBeTruthy()
    expect(download.headers['etag']).toBeTruthy()
    expect(download.headers['etag']).not.toBe(inline.headers['etag'])
  })

  it('leaves the cache-control contract alone', async () => {
    const download = await serve(['org:acme', 'm1'], { download: '1' })
    expect(download.headers['cache-control']).toBe(
      'public, max-age=3600, stale-while-revalidate=86400',
    )
  })
})

describe('media CDN filename encoding (AGL-1411)', () => {
  /** RFC 7230 field-value: visible ASCII plus space. Anything else in a
   *  header is either mojibake or an injection. */
  const ASCII_FIELD_VALUE = /^[\x20-\x7e]*$/

  it('encodes a non-ASCII name with filename*, keeping an ASCII fallback', async () => {
    mockState.doc = { ...ORG_WIDE, fileName: 'Añil — Logotipo.png' }
    const res = await serve(['org:acme', 'm1'], { download: '1' })
    const value = disposition(res)
    expect(value).toMatch(ASCII_FIELD_VALUE)
    expect(value).toContain(
      "filename*=UTF-8''A%C3%B1il%20%E2%80%94%20Logotipo.png",
    )
    // And still a plain `filename=` for anything that ignores RFC 5987.
    expect(value).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=/)
    expect(value).toContain('.png')
  })

  it('cannot be used to inject a header', async () => {
    mockState.doc = {
      ...ORG_WIDE,
      fileName: 're"port\r\nX-Injected: yes é.png',
    }
    const res = await serve(['org:acme', 'm1'], { download: '1' })
    const value = disposition(res)
    expect(value).toMatch(ASCII_FIELD_VALUE)
    expect(value).not.toContain('\r')
    expect(value).not.toContain('\n')
    // The quoted-string must contain no bare quote or backslash to close on.
    const quoted = /filename="([^"]*)"/.exec(value)?.[1]
    expect(quoted).toBeDefined()
    expect(quoted).not.toContain('\\')
    expect(res.headers['x-injected']).toBeUndefined()
  })

  it('takes the basename — a stored path never escapes into the header', async () => {
    mockState.doc = { ...ORG_WIDE, fileName: '../../etc/passwd' }
    const res = await serve(['org:acme', 'm1'], { download: '1' })
    expect(disposition(res)).toBe('attachment; filename="passwd"')
  })
})

describe('THE ONE THAT MATTERS: ?download=1 widens nothing (AGL-1411)', () => {
  const bothWays = async (path: string[]) => ({
    plain: await serve(path),
    download: await serve(path, { download: '1' }),
  })

  it('refuses an out-of-scope asset identically with and without the parameter', async () => {
    mockState.doc = {
      contentType: 'image/png',
      fileName: 'rates.png',
      visibleTo: ['host:other-site'],
      contentHash: 'hash1',
    }
    const { plain, download } = await bothWays(['org:acme', 'm1'])
    expect(plain.statusCode).toBe(404)
    expect(download.statusCode).toBe(404)
    expect(download.headers['cache-control']).toBe(plain.headers['cache-control'])
    // Never leak the name of an asset the caller may not have.
    expect(disposition(download)).toBeUndefined()
    expect(download.body).not.toContain('rates')
  })

  it('refuses a PRIVATE asset identically with and without the parameter', async () => {
    // The obvious way a download flag goes wrong: it looks like a delivery
    // detail, so it gets read early and short-circuits the signature gate.
    mockState.doc = {
      ...ORG_WIDE,
      fileName: 'unreleased.pdf',
      private: true,
    }
    const { plain, download } = await bothWays(['org:acme', 'm1'])
    expect(plain.statusCode).toBe(404)
    expect(download.statusCode).toBe(404)
    expect(plain.headers['cache-control']).toBe('private, no-store')
    expect(download.headers['cache-control']).toBe('private, no-store')
    expect(disposition(download)).toBeUndefined()
  })

  it('refuses a missing and a deleted asset identically', async () => {
    mockState.doc = null
    expect((await serve(['org:acme', 'gone'], { download: '1' })).statusCode).toBe(404)
    mockState.doc = { ...ORG_WIDE, deletedAt: 1 }
    const { plain, download } = await bothWays(['org:acme', 'm1'])
    expect(plain.statusCode).toBe(404)
    expect(download.statusCode).toBe(404)
  })

  it('does not make a malformed URL legal', async () => {
    expect((await serve(['org:', 'm1'], { download: '1' })).statusCode).toBe(400)
    expect((await serve(['org:acme'], { download: '1' })).statusCode).toBe(400)
  })

  it('does not survive a stale content hash on the immutable URL', async () => {
    const res = await serve(['org:acme', 'm1', 'stalehash'], { download: '1' })
    expect(res.statusCode).toBe(404)
  })
})

describe('mediaContentDisposition / mediaDownloadName (AGL-1411)', () => {
  it('emits only the quoted form when the name is already ASCII', () => {
    expect(
      mediaContentDisposition('aglyn-logo-mark-blue.png', { download: true }),
    ).toBe('attachment; filename="aglyn-logo-mark-blue.png"')
    expect(
      mediaContentDisposition('aglyn-logo-mark-blue.png', { download: false }),
    ).toBe('inline; filename="aglyn-logo-mark-blue.png"')
  })

  it('REPLACES rather than drops, so the extension survives', () => {
    // Dropping shortens `写真.png` to `.png`; replacing keeps a name shaped
    // like the original for the clients that only read the quoted form.
    expect(mediaContentDisposition('写真.png', { download: true })).toBe(
      "attachment; filename=\"__.png\"; filename*=UTF-8''%E5%86%99%E7%9C%9F.png",
    )
  })

  it('neutralizes the quoted-string terminators AND keeps the true name', () => {
    // The quote can't survive in the fallback, but `filename*` still carries
    // the real one — the old code just deleted it from both.
    expect(mediaContentDisposition('re"port\\v2.png', { download: true })).toBe(
      'attachment; filename="re_port_v2.png"; ' +
        "filename*=UTF-8''re%22port%5Cv2.png",
    )
  })

  it('percent-encodes the attr-chars encodeURIComponent leaves behind', () => {
    // A bare `'` would be read as the charset/language delimiter and split
    // the parameter; `(`, `)` and `*` are not attr-char either.
    const value = mediaContentDisposition("it's (a) *star* — v2.png", {
      download: true,
    })
    const encoded = value.split("filename*=UTF-8''")[1]
    expect(encoded).toBe('it%27s%20%28a%29%20%2Astar%2A%20%E2%80%94%20v2.png')
    expect(decodeURIComponent(encoded)).toBe("it's (a) *star* — v2.png")
  })

  it('never produces a value that is illegal in a header', () => {
    const nasty = [
      'a\r\nSet-Cookie: x=1.png',
      'nul\u0000byte.png',
      '\u2028line-sep.png',
      'del\u007f.png',
      '"'.repeat(20),
      'é'.repeat(300),
    ]
    for (const name of nasty) {
      const value = mediaContentDisposition(name, { download: true })
      expect(value).toMatch(/^[\x20-\x7e]*$/)
      expect(value).toMatch(/^attachment; filename="[^"]*"(; filename\*=UTF-8''\S*)?$/)
    }
  })

  it('takes a basename and falls back to the media id', () => {
    expect(mediaDownloadName('folder/sub/logo.png', 'm1')).toBe('logo.png')
    expect(mediaDownloadName('C:\\Users\\z\\logo.png', 'm1')).toBe('logo.png')
    expect(mediaDownloadName(undefined, 'm1')).toBe('m1')
    expect(mediaDownloadName('   ', 'm1')).toBe('m1')
    expect(mediaDownloadName('trailing/', 'm1')).toBe('m1')
    // Truncated by code point, so a surrogate pair is never split in half.
    expect(Array.from(mediaDownloadName('🎨'.repeat(400), 'm1'))).toHaveLength(200)
  })

  it('opts in on 1 and true only', () => {
    expect(wantsMediaDownload('1')).toBe(true)
    expect(wantsMediaDownload('true')).toBe(true)
    expect(wantsMediaDownload('TRUE')).toBe(true)
    expect(wantsMediaDownload(['1', '0'])).toBe(true)
    for (const value of [undefined, '', '0', 'false', 'attachment', 'yes', 2]) {
      expect(wantsMediaDownload(value)).toBe(false)
    }
  })
})
