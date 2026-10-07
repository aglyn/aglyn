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

import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { consumeOnce } from '@aglyn/tenant-data-admin/server/consume-once'
import { tokenSigningSecret } from '@aglyn/tenant-data-admin/server/media-signing'
import { safeEqual } from '@aglyn/tenant-data-admin/server/safe-equal'
import { SALES_CHANNELS_API_ROUTES } from '../../constants/bundle-common'
import { channelsCollection, firestore } from '../feed-store'
import { CONNECT_PROVIDERS, type ConnectProvider } from './config'

/**
 * THE OAUTH `state` FOR A CHANNEL CONNECT (AGL-3637, phase 2): signed,
 * short-lived, single-use, and bound to one member of one site.
 *
 * ## Signed
 *
 * `sc1.<payload>.<signature>`: the payload names the site, its organization,
 * the member, the provider, a nonce, the expiry and the console page to come
 * back to; the signature is an HMAC under the shared, fail-closed
 * `TOKEN_SIGNING_SECRET` with its own context, so no other signed token here
 * verifies as one. Google and Meta hand the state back verbatim, so a state
 * that verifies says whose connect it was — which is how the callback, a
 * redirect with no bearer token, knows its site and the release gate knows
 * its organization.
 *
 * ## Single-use
 *
 * Starting a connect also writes one pending record per member per site and
 * provider on `hosts/{hostId}/salesChannels/oauth-…`, holding the SHA-256 of
 * the nonce, the expiry and the redirect address the code is issued for. The
 * callback consumes it in a transaction, so a replayed state finds nothing,
 * and a later start replaces it, retiring every earlier state.
 *
 * ## Coming back
 *
 * The page to return to is checked against the console's own origin when
 * the connect starts, signed into the state, and checked again on the way
 * back; the redirect carries only its path, so it can only ever land on the
 * console that served the callback.
 */

/** How long a member has to finish the provider's consent screen. */
export const CONNECT_STATE_TTL_MS = 15 * 60 * 1000

const STATE_VERSION = 'sc1'
const STATE_CONTEXT = 'sales-channels-oauth-state:v1'
const STATE_MAX_CHARS = 2048
const RETURN_TO_MAX_CHARS = 512

export const CONNECT_CALLBACK_PATH = `/api/${SALES_CHANNELS_API_ROUTES.connectCallback}`


export interface ConnectStateClaims {
  hostId: string
  orgId: string
  uid: string
  provider: ConnectProvider
  nonce: string
  /** Expiry, epoch ms. */
  exp: number
  /** The console path (with its query) to return to. */
  returnTo: string
}

interface WireClaims {
  h: string
  o: string
  u: string
  p: string
  n: string
  e: number
  r: string
}

const hmac = (value: string): string =>
  createHmac('sha256', tokenSigningSecret()).update(`${STATE_CONTEXT}:${value}`).digest('base64url')

/** Mints a state. Throws when `TOKEN_SIGNING_SECRET` is not configured. */
export function mintConnectState(input: Omit<ConnectStateClaims, 'nonce' | 'exp'> & { nowMs: number; nonce?: string }): {
  state: string
  claims: ConnectStateClaims
} {
  const claims: ConnectStateClaims = {
    hostId: input.hostId,
    orgId: input.orgId,
    uid: input.uid,
    provider: input.provider,
    nonce: input.nonce ?? randomBytes(32).toString('base64url'),
    exp: input.nowMs + CONNECT_STATE_TTL_MS,
    returnTo: input.returnTo,
  }
  const wire: WireClaims = {
    h: claims.hostId,
    o: claims.orgId,
    u: claims.uid,
    p: claims.provider,
    n: claims.nonce,
    e: claims.exp,
    r: claims.returnTo,
  }
  const payload = Buffer.from(JSON.stringify(wire), 'utf8').toString('base64url')
  return { state: `${STATE_VERSION}.${payload}.${hmac(payload)}`, claims }
}

export type ConnectStateRead =
  | { ok: true; claims: ConnectStateClaims }
  /** Authentic and past its expiry: the claims still say whose it was. */
  | { ok: false; refusal: 'state-expired'; claims: ConnectStateClaims }
  /** Tampered, truncated, another version, or no secret to check it with. */
  | { ok: false; refusal: 'state-invalid' }

/** Verifies a state's signature and expiry. Never throws. */
export function readConnectState(state: unknown, nowMs: number): ConnectStateRead {
  const invalid = { ok: false, refusal: 'state-invalid' } as const
  if (typeof state !== 'string' || !state || state.length > STATE_MAX_CHARS) return invalid
  const parts = state.split('.')
  if (parts.length !== 3 || parts[0] !== STATE_VERSION) return invalid
  const [, payload, signature] = parts
  let expected: string
  try {
    expected = hmac(payload)
  } catch {
    return invalid
  }
  if (!safeEqual(signature, expected)) return invalid
  let wire: Partial<WireClaims>
  try {
    wire = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<WireClaims>
  } catch {
    return invalid
  }
  const provider = CONNECT_PROVIDERS.find((candidate) => candidate === wire?.p)
  if (!provider) return invalid
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const claims: ConnectStateClaims = {
    hostId: text(wire.h),
    orgId: text(wire.o),
    uid: text(wire.u),
    provider,
    nonce: text(wire.n),
    exp: Number(wire.e),
    returnTo: text(wire.r),
  }
  if (!claims.hostId || !claims.orgId || !claims.uid || !claims.nonce || !Number.isFinite(claims.exp)) return invalid
  if (claims.exp <= nowMs) return { ok: false, refusal: 'state-expired', claims }
  return { ok: true, claims }
}

/** The pending record's document: one per member per site and provider. */
export function connectStateRef(hostId: string, uid: string, provider: ConnectProvider) {
  return channelsCollection(hostId).doc(connectStateDocId(uid, provider))
}

/** The pending record's id: the member and provider hashed, so a uid never names a document. */
export function connectStateDocId(uid: string, provider: ConnectProvider): string {
  return `oauth-${createHash('sha256').update(`${provider}\n${uid}`).digest('hex').slice(0, 40)}`
}

const digest = (nonce: string) => createHash('sha256').update(nonce).digest('base64url')

/** Writes the pending record for a freshly minted state, replacing any earlier one. */
export async function recordConnectState(input: {
  claims: ConnectStateClaims
  redirectUri: string
  nowMs: number
}): Promise<void> {
  const { claims } = input
  await connectStateRef(claims.hostId, claims.uid, claims.provider).set({
    kind: 'oauth-state',
    uid: claims.uid,
    provider: claims.provider,
    nonceDigest: digest(claims.nonce),
    redirectUri: input.redirectUri,
    expiresAtMs: claims.exp,
    createdAtMs: input.nowMs,
  })
}

export type ConnectStateConsumed =
  | { ok: true; redirectUri: string }
  | { ok: false; refusal: 'state-replayed' | 'state-superseded' | 'state-expired' }

/** Consumes the pending record a verified state names — once. */
export async function consumeConnectState(input: {
  claims: ConnectStateClaims
  nowMs: number
}): Promise<ConnectStateConsumed> {
  const { claims } = input
  const ref = connectStateRef(claims.hostId, claims.uid, claims.provider)
  const result = await consumeOnce<string>(firestore(), ref, (data) => {
    if (data['uid'] !== claims.uid || data['provider'] !== claims.provider) {
      return { accept: false, reason: 'state-superseded' }
    }
    if (!safeEqual(String(data['nonceDigest'] ?? ''), digest(claims.nonce))) {
      return { accept: false, reason: 'state-superseded' }
    }
    if (Number(data['expiresAtMs']) <= input.nowMs) {
      return { accept: false, reason: 'state-expired', remove: true }
    }
    return { accept: true, value: String(data['redirectUri'] ?? ''), remove: true }
  })
  if (result.ok && result.value) return { ok: true, redirectUri: result.value }
  if (result.reason === 'state-superseded') return { ok: false, refusal: 'state-superseded' }
  if (result.reason === 'state-expired') return { ok: false, refusal: 'state-expired' }
  return { ok: false, refusal: 'state-replayed' }
}

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '')

/** The canonical console origin, or `null` when it is set to something that is not http(s). */
export function canonicalConsoleOrigin(): string | null {
  const raw = stripTrailingSlash(platformConsoleOrigin())
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

/**
 * The console origin a connect started by `requestUrl` comes back to: the
 * canonical one — the address an operator registers on the Google and Meta
 * apps — except in development, where a request from `http://localhost` or
 * `127.0.0.1` comes back to itself. Nothing else a request claims about its
 * origin is believed.
 */
export function consoleOriginFor(requestUrl: string): string | null {
  if (process.env['NODE_ENV'] !== 'production') {
    try {
      const url = new URL(requestUrl)
      if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return url.origin
    } catch {
      // Not a URL: the canonical origin below.
    }
  }
  return canonicalConsoleOrigin()
}

/** Where the provider sends the member back to, or `null` when no origin is usable. */
export function connectRedirectUri(requestUrl: string): string | null {
  const origin = consoleOriginFor(requestUrl)
  return origin ? `${origin}${CONNECT_CALLBACK_PATH}` : null
}

/**
 * The page to return to as a console path with its query, or `null` when
 * `returnTo` is not on `origin`. Accepts an absolute URL on the origin or a
 * single-slash path; anything else — another host, a protocol-relative
 * `//host`, a `javascript:` URL — is refused.
 */
export function consolePath(returnTo: unknown, origin: string): string | null {
  if (typeof returnTo !== 'string' || !returnTo || returnTo.length > RETURN_TO_MAX_CHARS) return null
  if (returnTo.startsWith('/') && (returnTo.startsWith('//') || returnTo.startsWith('/\\'))) return null
  let url: URL
  try {
    url = new URL(returnTo, origin)
  } catch {
    return null
  }
  if (url.origin !== origin) return null
  if (url.pathname.startsWith(CONNECT_CALLBACK_PATH)) return null
  return `${url.pathname}${url.search}`
}
