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

import { resolveEffectivePlan } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  readClientIp,
  type ClientIpHeaders,
} from '@aglyn/aglyn/app-utils/request-ip'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { checkRateLimit, type RateLimitResult } from '@aglyn/tenant-data-admin/server/api-http'

/**
 * The request-level rungs the Free AI taste adds to every AI door
 * (AGL-2925): a per-address limiter and a minimum account age. Both are
 * small helpers a door calls from its ladder rather than rungs written
 * into each ladder, so the three doors and the shared gate cannot drift
 * into three limits.
 *
 * Neither touches Firestore. The limiter is the same per-instance window
 * as the per-uid one and carries the same caveat — it smooths bursts and is
 * not the spend bound; the reservation is. The account-age rung reads one
 * Auth record, cached per instance, and applies only to a Free workspace.
 */

/** Requests one client address may make against the AI doors a minute. */
export const AI_IP_RATE_LIMIT = 60
export const AI_IP_RATE_WINDOW_MS = 60_000

/**
 * The per-address window shared by every AI door.
 *
 * Keyed on the TRUSTED-HOP client address (`readClientIp`), never on a
 * header a caller can write, for the reason that module exists: on an
 * appending proxy the leftmost `x-forwarded-for` hop is whatever the caller
 * typed, and a limiter keyed on it hands out a fresh budget per request.
 * `null` when no address is readable — the caller skips the rung, because
 * keying every anonymous request under one placeholder caps the whole
 * install at sixty requests a minute.
 *
 * Sixty a minute is three times the per-uid window (20/min at each door):
 * an office NAT signing in a team of three fits under it, and a farm
 * rotating accounts behind one address does not.
 */
export function checkAiClientIpRateLimit(
  headers: ClientIpHeaders,
): RateLimitResult | null {
  const ip = readClientIp(headers)
  if (!ip) return null
  return checkRateLimit(`ai-ip:${ip}`, {
    limit: AI_IP_RATE_LIMIT,
    windowMs: AI_IP_RATE_WINDOW_MS,
  })
}

/**
 * How old an account must be before a Free workspace it belongs to may
 * generate (`AI_FREE_MIN_ACCOUNT_AGE_HOURS`, default 24).
 *
 * The signup surface already costs a working inbox per account; a day of
 * age costs a day, which is the one thing a script minting accounts cannot
 * buy in bulk. Paid workspaces never consult it. Zero switches the rung
 * off, which a self-hoster running an invite-only deployment may
 * reasonably want; junk and an empty value take the default.
 */
export function aiFreeMinAccountAgeHours(): number {
  const raw = process.env.AI_FREE_MIN_ACCOUNT_AGE_HOURS
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 24
}

/** How long one account's creation time is remembered per instance. */
export const ACCOUNT_AGE_CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Entries the cache holds before it is dropped whole. A creation time is a
 * few bytes, but a limiter that can be made to remember every uid ever
 * seen is a memory leak with a use case, so the map is bounded and simply
 * forgets everything when it fills — the next request re-reads.
 */
export const ACCOUNT_AGE_CACHE_MAX_ENTRIES = 5_000

let accountAgeCache = new Map<string, { creationTimeMs: number; at: number }>()

/** Test seam — drops the per-instance cache. */
export function resetAccountAgeCache(): void {
  accountAgeCache = new Map()
}

/** The one thing this rung reads off an Auth record. */
export interface AccountAgeLookup {
  (uid: string): Promise<{ metadata: { creationTime?: string | null } }>
}

/**
 * When the account was created, in epoch milliseconds, or `null` when the
 * record carries no usable creation time.
 *
 * Read through the caller's `getUser` — the Auth pool the token was minted
 * in — because the decoded token carries `auth_time` (this sign-in) and
 * not the account's creation, and a fresh account can sign in as often as
 * it likes. Cached per instance for a few minutes: the value never changes,
 * and the doors are called far more often than once per account.
 */
export async function accountCreationTimeMs(
  uid: string,
  getUser: AccountAgeLookup,
  now = Date.now(),
): Promise<number | null> {
  const cached = accountAgeCache.get(uid)
  if (cached && now - cached.at < ACCOUNT_AGE_CACHE_TTL_MS) {
    return cached.creationTimeMs
  }
  const record = await getUser(uid)
  const creationTimeMs = Date.parse(record.metadata?.creationTime ?? '')
  if (!Number.isFinite(creationTimeMs)) return null
  if (accountAgeCache.size >= ACCOUNT_AGE_CACHE_MAX_ENTRIES) resetAccountAgeCache()
  accountAgeCache.set(uid, { creationTimeMs, at: now })
  return creationTimeMs
}

/**
 * The account-age rung: the `Response` to send, or `null` to climb on.
 *
 * Applies to a FREE workspace only — `resolveEffectivePlan`, so a dead
 * subscription is Free here as everywhere — and never to staff, who are
 * the ones verifying the fix during an incident. An account younger than
 * the minimum is a 403 with `reason: 'account-age'`, and the sentence says
 * when to come back rather than hinting at a way around it.
 *
 * Fails CLOSED for a Free workspace: a record that cannot be read is a
 * 503, not an admission. The verifier just accepted this token from the
 * same Auth service, so the read failing is rare, and the rung exists
 * precisely for the request whose age cannot be vouched for. A paid
 * workspace never reaches the read.
 */
export async function freeAccountAgeRefusal(input: {
  uid: string
  org: Partial<AglynOrgBilling> | null | undefined
  staff: boolean
  getUser: AccountAgeLookup
  now?: Date
}): Promise<Response | null> {
  if (input.staff) return null
  if (resolveEffectivePlan(input.org) !== 'free') return null
  const hours = aiFreeMinAccountAgeHours()
  if (hours <= 0) return null
  const now = input.now ?? new Date()
  let createdMs: number | null
  try {
    createdMs = await accountCreationTimeMs(input.uid, input.getUser, now.getTime())
  } catch (error) {
    console.error('[ai-abuse-guards] account age unavailable', error)
    return Response.json(
      { error: 'This feature is temporarily unavailable' },
      { status: 503 },
    )
  }
  const ageMs = createdMs === null ? 0 : now.getTime() - createdMs
  if (ageMs >= hours * 60 * 60 * 1000) return null
  const label = hours === 1 ? '1 hour' : `${hours} hours`
  return Response.json(
    {
      error:
        `AI generation opens ${label} after an account is created — ` +
        'come back then, or upgrade this workspace to use it now.',
      reason: 'account-age',
    },
    { status: 403 },
  )
}
