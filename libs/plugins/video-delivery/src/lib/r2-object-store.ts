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

import {
  EMPTY_PAYLOAD_SHA256,
  encodeRfc3986,
  type SigV4Credentials,
  signSigV4,
  UNSIGNED_PAYLOAD,
} from './sigv4'

/**
 * The four S3 calls the copy flow makes against a Cloudflare R2 bucket, over
 * `fetch` with SigV4 (AGL-2824).
 *
 * R2's S3 endpoint is per account, `{accountId}.r2.cloudflarestorage.com`,
 * and its region is `auto`. Requests are path-style: the bucket is the first
 * path segment. A put streams its body with `UNSIGNED-PAYLOAD` and an exact
 * `content-length`, so a 200 MB film is never held in memory; every other
 * call has no body.
 *
 * `fetch` is injectable, which is how the specs exercise every call with no
 * network at all.
 */

export interface R2Credentials extends SigV4Credentials {
  accountId: string
  bucket: string
}

export interface R2PutRequest {
  key: string
  body: ReadableStream<Uint8Array> | Uint8Array
  contentLength: number
  contentType: string
}

export interface R2ObjectStore {
  putObject(request: R2PutRequest): Promise<void>
  /** Resolves whether or not the key existed. */
  deleteObject(key: string): Promise<void>
  /** Null when the key does not exist. */
  headObject(key: string): Promise<{ size: number; contentType: string | null } | null>
  /** One page of keys under `prefix`, and the token for the next page. */
  listKeys(
    prefix: string,
    continuationToken?: string,
  ): Promise<{ keys: string[]; next: string | null }>
}

/** A Cloudflare account id: 32 hex characters. It becomes part of a hostname. */
const ACCOUNT_ID = /^[a-f0-9]{32}$/i
/** An R2 bucket name. */
const BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/

/** Whether `credentials` could address a bucket at all. */
export function r2CredentialsUsable(credentials: Partial<R2Credentials>): boolean {
  return (
    ACCOUNT_ID.test(String(credentials.accountId ?? '')) &&
    BUCKET.test(String(credentials.bucket ?? '')) &&
    Boolean(credentials.accessKeyId) &&
    Boolean(credentials.secretAccessKey)
  )
}

/** An object key as a path: each segment encoded, the separators kept. */
function encodeKeyPath(key: string): string {
  return key.split('/').map(encodeRfc3986).join('/')
}

/** The text between `<Tag>` and `</Tag>` for every occurrence, XML-unescaped. */
function xmlValues(xml: string, tag: string): string[] {
  const values: string[] = []
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g')
  for (const match of xml.matchAll(pattern)) {
    values.push(
      (match[1] ?? '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&'),
    )
  }
  return values
}

export function createR2ObjectStore(
  credentials: R2Credentials,
  options: { fetch?: typeof fetch; now?: () => Date } = {},
): R2ObjectStore {
  if (!r2CredentialsUsable(credentials)) {
    throw new Error('The R2 account id, bucket or access key is missing or malformed')
  }
  const send = options.fetch ?? fetch
  const now = options.now ?? (() => new Date())
  const origin = `https://${credentials.accountId.toLowerCase()}.r2.cloudflarestorage.com`

  const request = async (
    method: string,
    path: string,
    query: Array<[string, string]>,
    init: {
      headers?: Record<string, string>
      body?: ReadableStream<Uint8Array> | Uint8Array
      payloadHash?: string
    } = {},
  ): Promise<Response> => {
    const search = query
      .map(([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`)
      .join('&')
    const url = new URL(`${origin}/${credentials.bucket}${path}${search ? `?${search}` : ''}`)
    const payloadHash = init.payloadHash ?? EMPTY_PAYLOAD_SHA256
    const authorization = await signSigV4(
      {
        method,
        url,
        headers: init.headers ?? {},
        payloadHash,
        region: 'auto',
        service: 's3',
        now: now(),
      },
      credentials,
    )
    return send(url.toString(), {
      method,
      headers: { ...(init.headers ?? {}), ...authorization },
      ...(init.body !== undefined
        ? {
            body: init.body,
            // Node's fetch sends a stream body only in half-duplex mode.
            ...(init.body instanceof Uint8Array ? {} : { duplex: 'half' }),
          }
        : {}),
    } as RequestInit)
  }

  const fail = async (what: string, response: Response): Promise<never> => {
    const detail = await response.text().catch(() => '')
    const code = xmlValues(detail, 'Code')[0]
    throw new Error(`R2 ${what} failed: ${response.status}${code ? ` ${code}` : ''}`)
  }

  return {
    async putObject({ key, body, contentLength, contentType }) {
      if (!key) throw new Error('An R2 put needs a key')
      if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
        throw new Error('An R2 put needs an exact content length')
      }
      const response = await request('PUT', `/${encodeKeyPath(key)}`, [], {
        headers: {
          'content-length': String(contentLength),
          'content-type': contentType,
        },
        body,
        payloadHash: UNSIGNED_PAYLOAD,
      })
      if (!response.ok) await fail('put', response)
      await response.body?.cancel().catch(() => undefined)
    },

    async deleteObject(key) {
      if (!key) throw new Error('An R2 delete needs a key')
      const response = await request('DELETE', `/${encodeKeyPath(key)}`, [])
      // S3 answers 204 for a delete whether or not the key existed.
      if (!response.ok && response.status !== 404) await fail('delete', response)
      await response.body?.cancel().catch(() => undefined)
    },

    async headObject(key) {
      if (!key) throw new Error('An R2 head needs a key')
      const response = await request('HEAD', `/${encodeKeyPath(key)}`, [])
      if (response.status === 404) return null
      if (!response.ok) await fail('head', response)
      return {
        size: Number(response.headers.get('content-length') ?? 0),
        contentType: response.headers.get('content-type'),
      }
    },

    async listKeys(prefix, continuationToken) {
      const query: Array<[string, string]> = [
        ['list-type', '2'],
        ['prefix', prefix],
        ['max-keys', '1000'],
      ]
      if (continuationToken) query.push(['continuation-token', continuationToken])
      const response = await request('GET', '', query)
      if (!response.ok) await fail('list', response)
      const xml = await response.text()
      const truncated = xmlValues(xml, 'IsTruncated')[0] === 'true'
      const next = xmlValues(xml, 'NextContinuationToken')[0] ?? null
      return { keys: xmlValues(xml, 'Key'), next: truncated && next ? next : null }
    },
  }
}

/**
 * Deletes every key under `prefix`, page by page, and answers how many it
 * deleted. The prefix is required to end in `/` and hold at least two
 * segments, so no caller can empty the bucket by passing `''`.
 */
export async function deleteR2Prefix(
  store: R2ObjectStore,
  prefix: string,
): Promise<number> {
  if (!/^[^/]+\/[^/]+\/(?:.+\/)?$/.test(prefix)) {
    throw new Error(`Refusing to delete under the prefix "${prefix}"`)
  }
  let deleted = 0
  let token: string | undefined
  // The listing is read to its end before anything is deleted from a page,
  // so a deletion never shifts a page still to be read.
  const keys: string[] = []
  do {
    const page = await store.listKeys(prefix, token)
    keys.push(...page.keys.filter((key) => key.startsWith(prefix)))
    token = page.next ?? undefined
  } while (token)
  for (const key of keys) {
    await store.deleteObject(key)
    deleted += 1
  }
  return deleted
}
