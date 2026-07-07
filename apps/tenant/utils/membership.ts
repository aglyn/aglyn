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
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'crypto'
import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Site membership primitives (AGL-109): visitor accounts per host with
 * scrypt-hashed passwords and an HMAC-signed httpOnly session cookie.
 * Per-site Firebase Auth is a future infra decision (AGL-45 class); this
 * keeps member content out of static HTML the same way AGL-87 does.
 */

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

// A per-boot fallback keeps dev working; production must set the env so
// sessions survive deploys and instances agree.
const SESSION_SECRET =
  process.env.MEMBER_SESSION_SECRET ?? randomBytes(32).toString('hex')

export function hashMemberPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyMemberPassword(
  password: string,
  stored: string | undefined,
): boolean {
  const [salt, hash] = String(stored ?? '').split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return (
    candidate.length === expected.length &&
    timingSafeEqual(candidate, expected)
  )
}

function sign(payload: string): string {
  return createHmac('sha256', SESSION_SECRET).update(payload).digest('hex')
}

export function mintMemberSession(hostId: string, memberId: string): string {
  const payload = `${hostId}.${memberId}.${Date.now() + SESSION_TTL_MS}`
  return `${payload}.${sign(payload)}`
}

/** Returns the memberId when the cookie verifies for this host. */
export function verifyMemberSession(
  hostId: string,
  token: string | undefined,
): string | null {
  const parts = String(token ?? '').split('.')
  if (parts.length !== 4) return null
  const [tokenHost, memberId, expires, signature] = parts
  if (tokenHost !== hostId) return null
  if (Number(expires) < Date.now()) return null
  const payload = `${tokenHost}.${memberId}.${expires}`
  const expected = sign(payload)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return memberId
}

export function memberCookieName(hostId: string): string {
  return `aglyn_member_${hostId.replace(/[^A-Za-z0-9_-]/g, '')}`
}

export function setMemberCookie(
  res: NextApiResponse,
  hostId: string,
  token: string | null,
): void {
  const name = memberCookieName(hostId)
  const base = `${name}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax`
  res.setHeader(
    'Set-Cookie',
    token ? `${base}; Max-Age=${30 * 24 * 60 * 60}` : `${base}; Max-Age=0`,
  )
}

export function readMemberSession(
  req: NextApiRequest,
  hostId: string,
): string | null {
  const raw = req.cookies?.[memberCookieName(hostId)]
  return verifyMemberSession(hostId, raw)
}
