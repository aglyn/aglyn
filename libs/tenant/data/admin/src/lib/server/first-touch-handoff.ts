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

import { createHmac } from 'crypto'
import { sanitizeFirstTouch, type FirstTouch } from '@aglyn/shared-util-first-touch'
import { tokenSigningSecret } from './media-signing'
import { safeEqual } from './safe-equal'

/**
 * The sealed hand-off a first touch rides on between two of the platform's
 * own hosts that share no cookie (AGL-3289).
 *
 * `{touch, exp}` HMAC-signed with the shared, fail-closed
 * `TOKEN_SIGNING_SECRET` (docs/COMMERCE_TOKEN_SIGNING.md) — already held by
 * the console and the tenant, which both serve the hand-off endpoint, so no
 * install has a new secret to keep in step. The `first-touch:` context
 * domain-separates the signature from every other token that secret signs.
 *
 * What a valid token proves is narrow: this install produced the record,
 * recently, and nothing edited it since. Not that it is TRUE — a visitor can
 * put any campaign they like on a URL. So a token grants nothing and is worth
 * nothing but a label, and its short life is what keeps a pasted link from
 * handing one visitor's first touch to everyone who opens it.
 */

/** Thirty minutes: long enough to read a page and follow a link from it. */
export const FIRST_TOUCH_HANDOFF_TTL_MS = 30 * 60 * 1000

/** Version tag, so a future shape is refused by name rather than by signature. */
const TOKEN_PREFIX = 'aglyn-ft-v1'

/** The longest token opened; the capture refuses longer ones on the page too. */
const MAX_TOKEN = 4096

function signPayload(payload: string): string {
  return createHmac('sha256', tokenSigningSecret())
    .update(`first-touch:${payload}`)
    .digest('base64url')
}

/** A sealed token and when it stops opening. */
export interface SealedFirstTouch {
  token: string
  exp: number
}

/**
 * Seal a record for a hop, or null when there is nothing valid to seal or no
 * secret to seal it with — refusing, like every other signer of this secret,
 * rather than minting something forgeable.
 */
export function sealFirstTouch(
  value: unknown,
  nowMs: number = Date.now(),
): SealedFirstTouch | null {
  const touch = sanitizeFirstTouch(value, nowMs)
  if (!touch) return null
  const exp = nowMs + FIRST_TOUCH_HANDOFF_TTL_MS
  const payload = Buffer.from(JSON.stringify({ touch, exp }), 'utf8').toString('base64url')
  try {
    return { token: `${TOKEN_PREFIX}.${payload}.${signPayload(payload)}`, exp }
  } catch {
    return null
  }
}

/**
 * The record a token carries, re-scrubbed, or null for anything else —
 * expired, tampered, malformed, another version, or no secret configured.
 */
export function openFirstTouch(token: unknown, nowMs: number = Date.now()): FirstTouch | null {
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN) return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null
  const [, payload, signature] = parts
  let expected: string
  try {
    expected = signPayload(payload)
  } catch {
    return null
  }
  if (!safeEqual(signature, expected)) return null
  let claims: { touch?: unknown; exp?: unknown }
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const exp = Number(claims?.exp)
  if (!Number.isFinite(exp) || exp <= nowMs) return null
  return sanitizeFirstTouch(claims.touch, nowMs)
}
