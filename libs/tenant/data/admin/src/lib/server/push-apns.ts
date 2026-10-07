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
 * Apple Push Notification service, sent directly (AGL-3651): HTTP/2 to
 * `api.push.apple.com` (or `api.sandbox.push.apple.com` for a development
 * build's token), authenticated with a provider token, an ES256 JWT signed
 * with the team's APNs key.
 *
 *   APNS_KEY_P8   the `.p8` key: PEM text, or that PEM (or its DER) base64-encoded
 *   APNS_KEY_ID   the key's 10-character id
 *   APNS_TEAM_ID  the Apple Developer team id
 *
 * Without all three the transport is off: a device on APNs is skipped and
 * that is logged once per process. A provider token is reused for up to 50
 * minutes (Apple refuses one older than an hour, and one refreshed more often
 * than every 20). A `410`, `BadDeviceToken` or `Unregistered` answer means the
 * token is gone, and the row is pruned.
 *
 * Server-only, imported by `push-delivery.ts` only when a device is on APNs.
 */

import { createPrivateKey, sign, type KeyObject } from 'node:crypto'
import { connect, type ClientHttp2Session } from 'node:http2'
import type { PushMessage, PushOutcome, PushTarget, PushTransport } from './push-delivery'

export const APNS_HOSTS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
} as const

/** A provider token is reused for at most this long. */
export const APNS_TOKEN_TTL_MS = 50 * 60 * 1000

/** Requests in flight at once on one connection. */
const CONCURRENCY = 20

export interface ApnsCredentials {
  key: KeyObject
  keyId: string
  teamId: string
}

export interface ApnsResponse {
  status: number
  body: string
}

/** One HTTP/2 POST to an APNs origin; injectable for tests. */
export type ApnsRequest = (origin: string, headers: Record<string, string>, body: string) => Promise<ApnsResponse>

const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url')

/** The `.p8` key from `APNS_KEY_P8`: PEM, base64 of the PEM, or base64 of the DER. */
export function parseApnsKey(raw: string): KeyObject {
  const text = raw.trim().replace(/\\n/g, '\n')
  if (text.includes('-----BEGIN')) return createPrivateKey(text)
  const decoded = Buffer.from(text, 'base64')
  const asText = decoded.toString('utf8')
  if (asText.includes('-----BEGIN')) return createPrivateKey(asText)
  return createPrivateKey({ key: decoded, format: 'der', type: 'pkcs8' })
}

export function apnsCredentials(env: Record<string, string | undefined>): ApnsCredentials | null {
  const raw = env['APNS_KEY_P8']?.trim()
  const keyId = env['APNS_KEY_ID']?.trim()
  const teamId = env['APNS_TEAM_ID']?.trim()
  if (!raw || !keyId || !teamId) return null
  return { key: parseApnsKey(raw), keyId, teamId }
}

/** An ES256 provider token: `{alg, kid}.{iss, iat}`, signed raw (r‖s), as APNs requires. */
export function apnsProviderToken(credentials: ApnsCredentials, nowMs: number): string {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: credentials.keyId }))
  const claims = base64url(JSON.stringify({ iss: credentials.teamId, iat: Math.floor(nowMs / 1000) }))
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    key: credentials.key,
    dsaEncoding: 'ieee-p1363',
  })
  return `${header}.${claims}.${base64url(signature)}`
}

/** The APNs payload: the alert, the default sound, and the tap data beside `aps`. */
export function apnsPayload(message: PushMessage): string {
  return JSON.stringify({
    aps: {
      alert: { title: message.title, ...(message.body ? { body: message.body } : {}) },
      sound: 'default',
    },
    ...message.data,
  })
}

const GONE = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'])

export function apnsOutcome(response: ApnsResponse): PushOutcome {
  if (response.status === 200) return 'sent'
  if (response.status === 410) return 'prune'
  let reason = ''
  try {
    reason = String(JSON.parse(response.body)?.reason ?? '')
  } catch {
    // An unreadable body is a failure, not a verdict on the token.
  }
  return GONE.has(reason) ? 'prune' : 'failed'
}

/** The default request: one HTTP/2 session per origin for the life of a send. */
function http2Requester(): { request: ApnsRequest; close: () => void } {
  const sessions = new Map<string, ClientHttp2Session>()
  const session = (origin: string) => {
    let open = sessions.get(origin)
    if (!open || open.closed || open.destroyed) {
      open = connect(origin)
      open.on('error', () => undefined)
      sessions.set(origin, open)
    }
    return open
  }
  const request: ApnsRequest = (origin, headers, body) =>
    new Promise((resolve, reject) => {
      const stream = session(origin).request({ ':method': 'POST', ...headers })
      let status = 0
      let text = ''
      stream.setEncoding('utf8')
      stream.setTimeout(15_000, () => stream.close())
      stream.on('response', (head) => {
        status = Number(head[':status'] ?? 0)
      })
      stream.on('data', (chunk: string) => {
        text += chunk
      })
      stream.on('end', () => resolve({ status, body: text }))
      stream.on('error', reject)
      stream.end(body)
    })
  return {
    request,
    close: () => {
      for (const open of sessions.values()) open.close()
      sessions.clear()
    },
  }
}

export interface ApnsTransportOptions {
  credentials: ApnsCredentials
  /** Injected in tests; the default opens HTTP/2 sessions per send. */
  request?: ApnsRequest
  now?: () => number
}

export function createApnsTransport(options: ApnsTransportOptions): PushTransport {
  const now = options.now ?? Date.now
  let cached: { token: string; at: number } | null = null
  const providerToken = () => {
    const at = now()
    if (!cached || at - cached.at >= APNS_TOKEN_TTL_MS) cached = { token: apnsProviderToken(options.credentials, at), at }
    return cached.token
  }
  return {
    async send(targets: readonly PushTarget[], message: PushMessage): Promise<PushOutcome[]> {
      const { request, close } = options.request
        ? { request: options.request, close: () => undefined }
        : http2Requester()
      const body = apnsPayload(message)
      const outcomes: PushOutcome[] = new Array(targets.length).fill('failed')
      try {
        for (let start = 0; start < targets.length; start += CONCURRENCY) {
          const batch = targets.slice(start, start + CONCURRENCY)
          await Promise.all(
            batch.map(async (target, offset) => {
              try {
                const response = await request(
                  APNS_HOSTS[target.apnsEnvironment ?? 'production'],
                  {
                    ':path': `/3/device/${target.token}`,
                    authorization: `bearer ${providerToken()}`,
                    'apns-topic': target.topic,
                    'apns-push-type': 'alert',
                    'apns-priority': message.urgent ? '10' : '5',
                    'content-type': 'application/json',
                  },
                  body,
                )
                // An expired or refused provider token is ours to mint again, not the device's fault.
                if (response.status === 403) cached = null
                outcomes[start + offset] = apnsOutcome(response)
              } catch {
                outcomes[start + offset] = 'failed'
              }
            }),
          )
        }
      } finally {
        close()
      }
      return outcomes
    },
  }
}

let warnedMissingKey = false
let configured: { transport: PushTransport } | null = null

/**
 * The deployment's APNs transport from `APNS_*`, or null — logged once —
 * when they are not set.
 */
export function apnsTransport(env: Record<string, string | undefined> = process.env): PushTransport | null {
  if (configured) return configured.transport
  const credentials = apnsCredentials(env)
  if (!credentials) {
    if (!warnedMissingKey) {
      warnedMissingKey = true
      console.warn('push: APNS_KEY_P8, APNS_KEY_ID and APNS_TEAM_ID are not all set; iOS and macOS devices are skipped')
    }
    return null
  }
  configured = { transport: createApnsTransport({ credentials }) }
  return configured.transport
}
