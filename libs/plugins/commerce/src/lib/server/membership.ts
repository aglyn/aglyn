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
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'crypto'
import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

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
    timingSafeEqual(new Uint8Array(candidate), new Uint8Array(expected))
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
  if (a.length !== b.length) return null
  if (!timingSafeEqual(new Uint8Array(a), new Uint8Array(b))) return null
  return memberId
}

/** Password-reset links live for one hour (AGL-552). */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000

/**
 * Fingerprint of the member's CURRENT scrypt hash, folded into the reset
 * token signature (AGL-552): completing a reset rewrites `passwordScrypt`,
 * so every token minted before it stops verifying — single-use without any
 * server-side token storage.
 */
function passwordFingerprint(passwordScrypt: string | undefined): string {
  return createHash('sha256')
    .update(String(passwordScrypt ?? ''))
    .digest('hex')
}

/**
 * Single-use, time-boxed password-reset token (AGL-552):
 * `hostId.memberId.expiry.HMAC(payload + password-fingerprint)`. Same
 * secret as sessions; the fingerprint binding is what makes it one-shot.
 */
export function mintPasswordResetToken(
  hostId: string,
  memberId: string,
  passwordScrypt: string | undefined,
): string {
  const payload = `${hostId}.${memberId}.${Date.now() + RESET_TOKEN_TTL_MS}`
  return `${payload}.${sign(
    `${payload}.${passwordFingerprint(passwordScrypt)}`,
  )}`
}

/**
 * First step of reset verification: extract the memberId from a
 * well-formed, unexpired token for THIS host. The signature is NOT checked
 * here (it binds to the member's current password hash, which the caller
 * has to load first) — never trust the result without a follow-up
 * {@link verifyPasswordResetToken}.
 */
export function passwordResetTokenMemberId(
  hostId: string,
  token: string | undefined,
): string | null {
  const parts = String(token ?? '').split('.')
  if (parts.length !== 4) return null
  const [tokenHost, memberId, expires] = parts
  if (tokenHost !== hostId) return null
  if (!memberId) return null
  if (Number(expires) < Date.now()) return null
  return memberId
}

/** Full reset-token check: host, expiry, and password-hash binding. */
export function verifyPasswordResetToken(
  hostId: string,
  token: string | undefined,
  currentPasswordScrypt: string | undefined,
): boolean {
  const parts = String(token ?? '').split('.')
  if (parts.length !== 4) return false
  const [tokenHost, memberId, expires, signature] = parts
  if (tokenHost !== hostId || !memberId) return false
  if (Number(expires) < Date.now()) return false
  const payload = `${tokenHost}.${memberId}.${expires}`
  const expected = sign(
    `${payload}.${passwordFingerprint(currentPasswordScrypt)}`,
  )
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b))
}

export function memberCookieName(hostId: string): string {
  return `aglyn_member_${hostId.replace(/[^A-Za-z0-9_-]/g, '')}`
}

export function setMemberCookie(
  res: PluginApiResponse,
  hostId: string,
  token: string | null,
): void {
  const name = memberCookieName(hostId)
  // Secure in production (AGL-500): the member session is an HMAC-signed
  // credential, so it must never travel over plaintext HTTP on a tenant
  // custom domain. Omit only in local dev (http://localhost), matching the
  // console __session cookie.
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  const base = `${name}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax${secure}`
  res.setHeader(
    'Set-Cookie',
    token ? `${base}; Max-Age=${30 * 24 * 60 * 60}` : `${base}; Max-Age=0`,
  )
}

export function readMemberSession(
  req: PluginApiRequest,
  hostId: string,
): string | null {
  const raw = req.cookies?.[memberCookieName(hostId)]
  return verifyMemberSession(hostId, raw)
}

/** Suspension rejection body — matches the login flow's AGL-546 message. */
export const MEMBER_SUSPENDED_ERROR =
  'This account has been suspended. Contact the site owner.'

/** Resolved member-session state, see {@link readActiveMemberSession}. */
export type MemberSessionCheck =
  | { status: 'anonymous' }
  | { status: 'suspended'; memberId: string }
  | {
      status: 'active'
      memberId: string
      member: FirebaseFirestore.DocumentSnapshot
    }

/**
 * Session + member-doc resolution for cookie-authenticated endpoints
 * (AGL-550). A verified cookie alone stopped being enough once console
 * suspension (AGL-546) landed: the HMAC session outlives the member's
 * standing, so every endpoint must also load the doc and check
 * `suspended`. That is one doc read per request — acceptable, and most
 * endpoints needed the member doc anyway. A deleted member doc reads as
 * `anonymous` (same as no cookie).
 */
export async function readActiveMemberSession(
  req: PluginApiRequest,
  hostId: string,
): Promise<MemberSessionCheck> {
  const memberId = readMemberSession(req, hostId)
  if (!memberId) return { status: 'anonymous' }
  const member = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('siteMembers')
    .doc(memberId)
    .get()
  if (!member.exists) return { status: 'anonymous' }
  if (member.get('suspended') === true) {
    return { status: 'suspended', memberId }
  }
  return { status: 'active', memberId, member }
}

/**
 * Guard for cookie-authenticated member endpoints (AGL-550): resolves
 * the session AND the member doc, writing the rejection itself — 401
 * (`signInError`) when there is no usable session, 403 with the session
 * cookie cleared (mirroring membership-account's AGL-546 handling, so
 * the site stops presenting a signed-in shell) when the member is
 * suspended. Returns null after responding; handlers `if (!auth) return`.
 */
export async function requireActiveMember(
  req: PluginApiRequest,
  res: PluginApiResponse,
  hostId: string,
  signInError = 'Not signed in',
): Promise<{
  memberId: string
  member: FirebaseFirestore.DocumentSnapshot
} | null> {
  const session = await readActiveMemberSession(req, hostId)
  if (session.status === 'suspended') {
    setMemberCookie(res, hostId, null)
    res.status(403).json({ error: MEMBER_SUSPENDED_ERROR })
    return null
  }
  if (session.status !== 'active') {
    res.status(401).json({ error: signInError })
    return null
  }
  return { memberId: session.memberId, member: session.member }
}
