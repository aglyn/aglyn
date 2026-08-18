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
 * The GA4 parameter/value pair, and the browser-pinned opt-in that rides
 * alongside the claims predicate below.
 *
 * These MOVED to `@aglyn/aglyn/app-utils/internal-traffic` (AGL-2064) when the
 * tenant runtime and the docs site started stamping the same parameter — the
 * strings have to agree with a setting in the GA UI that nothing here can
 * typecheck against, so having three surfaces spell them independently is how
 * one of them quietly becomes a different dimension. Re-exported rather than
 * repointed at every call site so this module stays the console's one door to
 * the subject.
 *
 * `isInternalTrafficSession` stays here: it reads Firebase ID-token claims,
 * which is console-only knowledge.
 */
export {
  INTERNAL_TRAFFIC_PARAM,
  INTERNAL_TRAFFIC_VALUE,
  INTERNAL_TRAFFIC_STORAGE_KEY,
  INTERNAL_TRAFFIC_QUERY_PARAM,
  readInternalTrafficOverride,
} from '@aglyn/aglyn/app-utils/internal-traffic'

/**
 * Whether a signed-in console session is OURS rather than a customer's
 * (AGL-1582), decided from the ID token's custom claims.
 *
 * ## Why two claims and not just `staff`
 *
 * The flag has to follow the **actor**, not the subject. Staff impersonation
 * (AGL-246) mints a short-lived custom token for the TARGET account carrying
 * an `impersonatedBy` claim, and the endpoint refuses to impersonate a staff
 * account at all — so for the entire duration of an impersonation session
 * `staff` is `false` and the token is, by construction, a customer's.
 *
 * Keying on `staff` alone would therefore flag none of that traffic, and
 * impersonation is precisely the traffic AGL-1582 most wants excluded: it is
 * staff clicking through a customer's workspace, generating exactly the
 * activation events (`host_created`, `site_published`) the launch metrics are
 * read from.
 *
 * Getting it backwards is the expensive direction. Keying on the SUBJECT would
 * exclude a real customer's sessions while including ours, which is worse than
 * doing nothing — so the two claims are OR'd, and neither is a proxy for the
 * other.
 *
 * ## Not a security boundary
 *
 * This decides which bucket a hit is reported in, nothing else. It reads
 * whatever the token says without forcing a refresh, so a claim can be up to
 * an hour stale; the cost is one mis-bucketed session, and `useIsStaff` is
 * where the forced refresh is paid for because there the answer gates UI.
 */
export function isInternalTrafficSession(
  claims: Record<string, unknown> | null | undefined,
): boolean {
  if (!claims) return false
  return Boolean(claims['staff']) || Boolean(claims['impersonatedBy'])
}

export default isInternalTrafficSession
