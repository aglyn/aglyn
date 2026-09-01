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
 * A scope refusal that can be read from the logs.
 *
 * `serveMediaCdn` reads the media document by id through the Admin SDK, so
 * neither of the layers that fail closed underneath the sharing model is in
 * play here: `array-contains-any` is never issued and the security rules are
 * never evaluated. `mediaCdnAllows` IS the enforcement on this path, and
 * with a missing `visibleTo` read as "visible to nobody" the consequence of
 * an unscoped document is a public 404 — a broken image on a live customer
 * site, indistinguishable on the wire from an asset that was deleted.
 *
 * That indistinguishability is correct facing the caller and useless facing
 * us. So the route separates the refusal that means "wrong URL" from the two
 * that mean "this document cannot be served under any URL", and says only
 * the latter out loud:
 *
 *  1. `restricted` stays SILENT. It is the gate working as designed, any
 *     anonymous request can provoke it by guessing a scope segment, and a
 *     line per request would turn a public image route into a log amplifier.
 *  2. `unscoped` and `no-sites` are LOGGED. Neither can be provoked from
 *     outside — they are properties of the document — and neither leaves any
 *     other trace until the weekly drift detector runs, or until somebody
 *     notices a picture stopped rendering.
 *
 * Driven through the real `serveMediaCdn` with Firestore and Storage stubbed
 * (the harness `serve-media-cdn.etag.spec.ts` and `.csp.spec.ts` use), so
 * what is pinned is the response AND the log the response leaves behind.
 */

import { Readable, Writable } from 'node:stream'
import { serveMediaCdn } from './serve-media-cdn'

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
      firestore: {
        FieldValue: { increment: (n: number) => ({ increment: n }) },
      },
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

async function serve(path: string[]): Promise<MockRes> {
  const res = new MockRes()
  await serveMediaCdn(
    { method: 'GET', query: { path }, headers: {} } as never,
    res as never,
  )
  return res
}

const BASE = {
  fileName: 'logo.png',
  contentType: 'image/png',
  sizeBytes: 8,
  storagePath: 'orgs/acme/media/m1',
  contentHash: '0123456789abcdef',
}

/** Lines this route emitted about the scope decision, and nothing else. */
let logged: string[] = []
let errorSpy: jest.SpyInstance

beforeEach(() => {
  mockState.metadata = { contentType: 'image/png', size: 8 }
  logged = []
  errorSpy = jest
    .spyOn(console, 'error')
    .mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => String(arg)).join(' '))
    })
})

afterEach(() => {
  errorSpy.mockRestore()
})

const scopeLines = () =>
  logged.filter((line) => line.includes('no site it can be served to'))

describe('an undeliverable asset says so in the logs', () => {
  it('names a document carrying no scope at all', async () => {
    mockState.doc = { ...BASE }
    const res = await serve(['org:acme', 'm1'])
    expect(res.statusCode).toBe(404)
    // The ids are the whole value: without them the line says a document is
    // dark without saying which, and the next step is the same guesswork
    // that found AGL-1466.
    expect(scopeLines()).toHaveLength(1)
    expect(scopeLines()[0]).toContain('"scopeId":"acme"')
    expect(scopeLines()[0]).toContain('"mediaId":"m1"')
    expect(scopeLines()[0]).toContain('"refusal":"unscoped"')
  })

  it('separates a stored empty scope from an absent one', async () => {
    // Both are dark; only `unscoped` is repairable by the scope backfill,
    // which leaves `[]` alone rather than widening a resource unasked. The
    // reader has to know which of the two they are looking at, because it
    // decides whether the fix is a stamp or a conversation.
    mockState.doc = { ...BASE, visibleTo: [] }
    const res = await serve(['org:acme', 'm1'])
    expect(res.statusCode).toBe(404)
    expect(scopeLines()).toHaveLength(1)
    expect(scopeLines()[0]).toContain('"refusal":"no-sites"')
  })

  it('is dark under the host-qualified URL too, and says so there', async () => {
    // An unscoped asset is not a URL problem, and re-requesting it through
    // the form that names the site does not make it one.
    mockState.doc = { ...BASE }
    const res = await serve(['org:acme:site-a', 'm1'])
    expect(res.statusCode).toBe(404)
    expect(scopeLines()[0]).toContain('"refusal":"unscoped"')
  })
})

describe('a working refusal stays quiet', () => {
  it('logs NOTHING when a restricted asset is refused the bare org URL', async () => {
    // This is the leak the gate exists to close, firing correctly. It is
    // reachable by anyone who can guess a scope segment, so a log line here
    // would let an anonymous caller drive our log spend.
    mockState.doc = { ...BASE, visibleTo: ['host:site-b'] }
    const res = await serve(['org:acme', 'm1'])
    expect(res.statusCode).toBe(404)
    expect(scopeLines()).toEqual([])
  })

  it('logs nothing when a restricted asset is refused another site', async () => {
    mockState.doc = { ...BASE, visibleTo: ['host:site-b'] }
    const res = await serve(['org:acme:site-a', 'm1'])
    expect(res.statusCode).toBe(404)
    expect(scopeLines()).toEqual([])
  })

  it('logs nothing on the assets that actually serve', async () => {
    // The control: the silence above is the restricted case being skipped,
    // not the log line having been removed altogether.
    mockState.doc = { ...BASE, visibleTo: ['org'] }
    const served = await serve(['org:acme', 'm1'])
    expect(served.body).toBe('PNGBYTES')
    mockState.doc = { ...BASE, visibleTo: ['host:site-a'] }
    const scoped = await serve(['org:acme:site-a', 'm1'])
    expect(scoped.body).toBe('PNGBYTES')
    expect(scopeLines()).toEqual([])
  })

  it('never gates — or reports — a host library asset', async () => {
    // `hosts/{hostId}/media` is private by construction and carries no
    // `visibleTo`, so an absent field there is the normal shape and must not
    // read as drift.
    mockState.doc = { ...BASE, storagePath: 'hosts/site-a/media/m1' }
    const res = await serve(['site-a', 'm1'])
    expect(res.body).toBe('PNGBYTES')
    expect(scopeLines()).toEqual([])
  })
})
