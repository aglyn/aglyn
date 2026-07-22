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
 * Server-authoritative last-activity for idle expiry (AGL-697). Kept
 * dependency-free (no Admin SDK) so it is unit testable and shared by the
 * activity route and — in spirit — the client hook.
 *
 * Why the server holds this: `useIdleLogout` retires the SHARED
 * cross-subdomain `__session` cookie on expiry (AGL-236/AGL-464). Deciding
 * "idle" from a single tab's `localStorage`/host-only cookie let one
 * untouched tab sign the user out of every `.aglyn.io` subdomain, because
 * activity on a sibling tab or subdomain was invisible to it. The server is
 * the one place every `.aglyn.io` origin's requests converge, so an
 * HttpOnly parent-domain heartbeat cookie set here is an authoritative,
 * unspoofable "last-seen across the whole session" that a tab must consult
 * before performing that global sign-out.
 */

/** HttpOnly parent-domain cookie holding the session-wide last-seen (epoch ms). */
export const ACTIVITY_COOKIE = 'aglyn_session_activity'

/**
 * Lifetime of the activity cookie. A day comfortably outlives any idle
 * window, so a fresh heartbeat always refreshes it long before it lapses,
 * and a stale one reads as idle rather than lingering forever.
 */
export const ACTIVITY_COOKIE_MAX_AGE_S = 24 * 60 * 60

/** Encodes a last-activity timestamp for the cookie value. */
export function encodeActivity(nowMs: number): string {
  return String(nowMs)
}

/**
 * Parses the cookie value into an epoch-ms timestamp, or 0 when it is
 * absent or malformed (a missing record must read as "unknown", never as
 * "active since epoch").
 */
export function parseActivity(cookieValue: string | undefined): number {
  if (!cookieValue) return 0
  const at = Number.parseInt(cookieValue, 10)
  return Number.isFinite(at) && at > 0 ? at : 0
}

/**
 * Session-wide idle decision, evaluated against the server-authoritative
 * last-seen. A timeout of `<= 0` disables expiry (AGL-464). A `lastSeenMs`
 * of 0 (no record yet) is treated as NOT idle: the caller has no evidence
 * of a genuinely idle session and must not perform the global sign-out on a
 * hunch — fail open to staying signed in.
 */
export function isSessionIdle(
  lastSeenMs: number,
  nowMs: number,
  timeoutMs: number,
): boolean {
  if (timeoutMs <= 0) return false
  if (!Number.isFinite(lastSeenMs) || lastSeenMs <= 0) return false
  return nowMs - lastSeenMs > timeoutMs
}
