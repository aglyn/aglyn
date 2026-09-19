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
 * AWS Signature Version 4, header-signed, on Web Crypto.
 *
 * R2 speaks the S3 API, and the copy flow needs four of its calls: put,
 * delete, head and list. An S3 SDK would bring a large dependency tree for
 * those four, so this signs them directly, following the published algorithm
 * (the canonical request, the string to sign, the derived signing key). The
 * spec checks it against the worked examples in the S3 documentation.
 *
 * The caller builds the URL with its path already encoded; S3 signs the path
 * as sent and does not encode it a second time. Query parameters are encoded
 * here, strictly, in the order the algorithm requires.
 */

/** The SHA-256 of an empty body, which every bodiless request signs. */
export const EMPTY_PAYLOAD_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/** Signs a streamed body without hashing it first; the transport is TLS. */
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'

export interface SigV4Credentials {
  accessKeyId: string
  secretAccessKey: string
}

export interface SigV4Request {
  method: string
  url: URL
  /** Headers to sign besides `host`, `x-amz-date` and `x-amz-content-sha256`. */
  headers?: Record<string, string>
  /** Hex SHA-256 of the body, or {@link UNSIGNED_PAYLOAD}. */
  payloadHash: string
  region: string
  service: string
  now: Date
}

const encoder = new TextEncoder()

function hex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
}

async function hmac(
  key: Uint8Array<ArrayBuffer> | string,
  text: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const imported = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? encoder.encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(text)))
}

/** RFC 3986 encoding: `encodeURIComponent` plus the four it leaves alone. */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** `20130524T000000Z`. */
function amzDate(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * The headers that authorize `request`: `authorization`, `x-amz-date` and
 * `x-amz-content-sha256`. Send them with the headers named in
 * `request.headers`, exactly as signed. `host` is signed from the URL, which
 * is what `fetch` sends.
 */
export async function signSigV4(
  request: SigV4Request,
  credentials: SigV4Credentials,
): Promise<Record<string, string>> {
  const date = amzDate(request.now)
  const day = date.slice(0, 8)
  const signed: Record<string, string> = {}
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    signed[name.toLowerCase()] = String(value).trim().replace(/\s+/g, ' ')
  }
  signed['host'] = request.url.host
  signed['x-amz-date'] = date
  signed['x-amz-content-sha256'] = request.payloadHash
  const names = Object.keys(signed).sort()
  const canonicalHeaders = names.map((name) => `${name}:${signed[name]}\n`).join('')
  const signedHeaders = names.join(';')
  const query = [...request.url.searchParams.entries()]
    .map(([name, value]) => [encodeRfc3986(name), encodeRfc3986(value)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&')
  const canonicalRequest = [
    request.method.toUpperCase(),
    request.url.pathname || '/',
    query,
    canonicalHeaders,
    signedHeaders,
    request.payloadHash,
  ].join('\n')
  const scope = `${day}/${request.region}/${request.service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    date,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n')
  let key = await hmac(`AWS4${credentials.secretAccessKey}`, day)
  key = await hmac(key, request.region)
  key = await hmac(key, request.service)
  key = await hmac(key, 'aws4_request')
  const signature = hex(await hmac(key, stringToSign))
  return {
    authorization:
      `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'x-amz-date': date,
    'x-amz-content-sha256': request.payloadHash,
  }
}
