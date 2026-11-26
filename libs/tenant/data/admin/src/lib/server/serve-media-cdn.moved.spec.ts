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
 * A file moved to the other library (AGL-4254) answers at its new address.
 * Its old address is in pages cached before the move, in emails already sent
 * and in links people copied, so the CDN follows the record the move left.
 */

import { Readable, Writable } from 'node:stream'
import { serveMediaCdn } from './serve-media-cdn'

const mockState: {
  /** Documents by path, `orgs/acme/mediaMoves/m1`. */
  docs: Record<string, Record<string, unknown>>
  metadata: Record<string, unknown> | null
} = { docs: {}, metadata: null }

jest.mock('./firebase-admin', () => {
  const snapshot = (path: string) => ({
    get exists() {
      return path in mockState.docs
    },
    get: (field: string) => mockState.docs[path]?.[field],
  })
  const docRef = (path: string): unknown => ({
    collection: (name: string) => ({ doc: (id: string) => docRef(`${path}/${name}/${id}`) }),
    get: async () => snapshot(path),
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
        firestore: () => ({ collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }) }),
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

beforeEach(() => {
  mockState.docs = {}
  mockState.metadata = { contentType: 'image/png', size: 4 }
})

describe('media CDN: a file moved to the other library', () => {
  it('forwards the old organization address to the site, carrying the width', async () => {
    mockState.docs['orgs/acme/mediaMoves/m1'] = { toScope: 'site1' }
    const res = await serve(['org:acme', 'm1'], { w: '640' })
    expect(res.statusCode).toBe(308)
    expect(res.headers['location']).toBe('/api/media/cdn/site1/m1?w=640')
  })

  it('forwards a site-qualified organization address too', async () => {
    mockState.docs['orgs/acme/mediaMoves/m1'] = { toScope: 'site1' }
    const res = await serve(['org:acme:site1', 'm1'])
    expect(res.statusCode).toBe(308)
    expect(res.headers['location']).toBe('/api/media/cdn/site1/m1')
  })

  it('forwards the old site address to the organization', async () => {
    mockState.docs['hosts/site1/mediaMoves/m1'] = { toScope: 'org:acme' }
    const res = await serve(['site1', 'm1'])
    expect(res.statusCode).toBe(308)
    expect(res.headers['location']).toBe('/api/media/cdn/org:acme/m1')
  })

  it('is still a 404 for a file that was never moved, and ignores a malformed record', async () => {
    expect((await serve(['org:acme', 'm2'])).statusCode).toBe(404)
    mockState.docs['orgs/acme/mediaMoves/m3'] = { toScope: 'https://evil.example' }
    expect((await serve(['org:acme', 'm3'])).statusCode).toBe(404)
  })
})
