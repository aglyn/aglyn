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

import { signSigV4 } from '../sigv4'

/**
 * An in-memory R2 bucket behind the S3 API, as a `fetch` a spec hands to the
 * object store. No network is involved.
 *
 * It is strict where R2 is: every request must carry a SigV4 signature that
 * this fake recomputes from what actually arrived — the method, the path, the
 * query, the host and the signed headers — with the secret the spec gave it,
 * so a request altered after signing, or signed for another bucket, fails the
 * way R2 would fail it. A put must send exactly the bytes its
 * `content-length` announced.
 */

export interface FakeR2Object {
  bytes: Uint8Array
  contentType: string
}

export interface FakeR2Endpoint {
  fetch: typeof fetch
  objects: Map<string, FakeR2Object>
  requests: Array<{ method: string; key: string | null; query: string }>
}

async function readBody(body: unknown): Promise<Uint8Array> {
  if (body === undefined || body === null) return new Uint8Array(0)
  if (body instanceof Uint8Array) return body
  const chunks: Uint8Array[] = []
  const reader = (body as ReadableStream<Uint8Array>).getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function createFakeR2Endpoint(options: {
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** Keys per list page, small enough to exercise continuation. */
  pageSize?: number
}): FakeR2Endpoint {
  const objects = new Map<string, FakeR2Object>()
  const requests: FakeR2Endpoint['requests'] = []
  const host = `${options.accountId}.r2.cloudflarestorage.com`
  const pageSize = options.pageSize ?? 1000

  const fakeFetch = async (input: unknown, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input))
    const method = String(init.method ?? 'GET').toUpperCase()
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([name, value]) => [
        name.toLowerCase(),
        value,
      ]),
    )
    if (url.host !== host) return new Response('wrong host', { status: 400 })
    const [, bucket, ...rest] = url.pathname.split('/')
    if (bucket !== options.bucket) return new Response('<Code>NoSuchBucket</Code>', { status: 404 })
    const key = rest.length ? rest.map(decodeURIComponent).join('/') : null
    requests.push({ method, key, query: url.search })

    // The signature, recomputed from what arrived.
    const authorization = headers['authorization'] ?? ''
    const signedNames = /SignedHeaders=([^,]+)/.exec(authorization)?.[1]?.split(';') ?? []
    const date = headers['x-amz-date'] ?? ''
    const extra: Record<string, string> = {}
    for (const name of signedNames) {
      if (name === 'host' || name === 'x-amz-date' || name === 'x-amz-content-sha256') continue
      extra[name] = headers[name] ?? ''
    }
    const expected = await signSigV4(
      {
        method,
        url,
        headers: extra,
        payloadHash: headers['x-amz-content-sha256'] ?? '',
        region: 'auto',
        service: 's3',
        now: new Date(
          `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T` +
            `${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`,
        ),
      },
      { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    )
    if (!authorization || expected['authorization'] !== authorization) {
      return new Response('<Error><Code>SignatureDoesNotMatch</Code></Error>', { status: 403 })
    }

    if (method === 'PUT' && key) {
      const bytes = await readBody(init.body)
      if (String(bytes.length) !== headers['content-length']) {
        return new Response('<Error><Code>IncompleteBody</Code></Error>', { status: 400 })
      }
      objects.set(key, { bytes, contentType: headers['content-type'] ?? '' })
      return new Response(null, { status: 200 })
    }
    if (method === 'DELETE' && key) {
      objects.delete(key)
      return new Response(null, { status: 204 })
    }
    if (method === 'HEAD' && key) {
      const object = objects.get(key)
      if (!object) return new Response(null, { status: 404 })
      return new Response(null, {
        status: 200,
        headers: {
          'content-length': String(object.bytes.length),
          'content-type': object.contentType,
        },
      })
    }
    if (method === 'GET' && !key && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? ''
      const start = Number(url.searchParams.get('continuation-token') ?? 0)
      const keys = [...objects.keys()].filter((candidate) => candidate.startsWith(prefix)).sort()
      const page = keys.slice(start, start + pageSize)
      const truncated = start + pageSize < keys.length
      const xml =
        '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>' +
        `<IsTruncated>${truncated}</IsTruncated>` +
        page.map((each) => `<Contents><Key>${xmlEscape(each)}</Key></Contents>`).join('') +
        (truncated ? `<NextContinuationToken>${start + pageSize}</NextContinuationToken>` : '') +
        '</ListBucketResult>'
      return new Response(xml, { status: 200, headers: { 'content-type': 'application/xml' } })
    }
    return new Response('<Error><Code>NotImplemented</Code></Error>', { status: 501 })
  }

  return { fetch: fakeFetch as unknown as typeof fetch, objects, requests }
}
