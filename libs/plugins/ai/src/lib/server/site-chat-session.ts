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

import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { siteChatCookieName } from '../model/site-chat'

/**
 * The site chat's visitor session (AGL-4250): who is asking, for a door that
 * has no signed-in user. A visitor is a random id, signed with the platform's
 * token secret and bound to ONE site, carried in an HttpOnly cookie of that
 * site. It is what the per-session rate limit counts, what a conversation is
 * stored under, and the only thing that lets a visitor read their own
 * conversation back. It proves nothing about who the visitor is.
 *
 * Bound to the site because a token minted on one site must never open a
 * conversation, or spend the limits, of another. Thirty days, then a new
 * visitor: the conversation it names expires on its own.
 */

const TOKEN_PREFIX = 'sc1'
export const SITE_CHAT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface SiteChatSession {
  /** The visitor's id: 32 hex characters, a Firestore document id. */
  sid: string
  hostId: string
  exp: number
}

const SESSION_ID = /^[0-9a-f]{32}$/

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`site-chat:${payload}`).digest('base64url')
}

export function mintSiteChatSession(
  hostId: string,
  secret: string,
  nowMs: number = Date.now(),
): { session: SiteChatSession; token: string } {
  const session: SiteChatSession = {
    sid: randomBytes(16).toString('hex'),
    hostId,
    exp: nowMs + SITE_CHAT_SESSION_TTL_MS,
  }
  const payload = Buffer.from(JSON.stringify({ s: session.sid, h: hostId, e: session.exp }), 'utf8').toString(
    'base64url',
  )
  return { session, token: `${TOKEN_PREFIX}.${payload}.${sign(secret, payload)}` }
}

/** The session a token carries for `hostId`, or `null` for any other token. */
export function verifySiteChatSession(
  token: unknown,
  hostId: string,
  secret: string,
  nowMs: number = Date.now(),
): SiteChatSession | null {
  if (typeof token !== 'string' || !token || token.length > 512) return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null
  const [, payload, signature] = parts
  const expected = sign(secret, payload)
  if (signature.length !== expected.length) return null
  if (!timingSafeEqual(new Uint8Array(Buffer.from(signature)), new Uint8Array(Buffer.from(expected)))) {
    return null
  }
  let claims: { s?: unknown; h?: unknown; e?: unknown }
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const exp = Number(claims.e)
  if (!Number.isFinite(exp) || exp <= nowMs) return null
  if (claims.h !== hostId || typeof claims.s !== 'string' || !SESSION_ID.test(claims.s)) return null
  return { sid: claims.s, hostId, exp }
}

/** A request's cookies, read from its `Cookie` header. */
export function readRequestCookie(request: Request, name: string): string {
  const header = request.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim())
      } catch {
        return ''
      }
    }
  }
  return ''
}

/** The `Set-Cookie` value that keeps a visitor's session on this site. */
export function siteChatSessionCookie(hostId: string, token: string, secure: boolean): string {
  return [
    `${siteChatCookieName(hostId)}=${encodeURIComponent(token)}`,
    'Path=/api/ai/site-chat',
    `Max-Age=${Math.floor(SITE_CHAT_SESSION_TTL_MS / 1000)}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ')
}
