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
 * Reads one cookie from a request, preferring a NON-EMPTY value when the jar
 * holds more than one of the same name (AGL-1259).
 *
 * A browser will happily send two cookies with the same name at different
 * scopes — one `Domain=.aglyn.com`, one host-only — and the `Cookie` header
 * gives no way to tell them apart. Taking the first match meant an empty
 * duplicate permanently shadowed the real value:
 *
 * ```
 * Cookie: __session=; __session=<real>   → 401 {"reason":"absent"}
 * Cookie: __session=<real>               → 200
 * ```
 *
 * That is not hypothetical — it reproduced against production, and for the
 * session cookie it was a DEADLOCK rather than a hiccup: `useSessionCookie`
 * reads `absent`, correctly re-mints, the mint sets its own scope, the empty
 * duplicate still sorts first, and the next read says `absent` again.
 *
 * Preferring a non-empty value is the smallest change that breaks that, and
 * it is right on its own terms: an empty cookie carries no value, so there is
 * never a reason to choose it over one that does. A jar holding ONLY empties
 * still reads as empty, which is correct.
 *
 * ## Why this lives in one module
 *
 * It was fixed once, in the session route, while an unfixed copy stayed in
 * the activity route — where the same shadowing silently disables the AGL-697
 * idle-logout control rather than deadlocking anything visible. Any route
 * setting a cookie whose `Domain` is conditional on the request host has the
 * same exposure, so the reader is shared rather than pasted.
 */
export function readCookie(
  request: Request,
  name: string,
): string | undefined {
  const raw = request.headers.get('cookie')
  if (!raw) return undefined
  let empty: string | undefined
  for (const pair of raw.split(';')) {
    const index = pair.indexOf('=')
    if (index < 0) continue
    if (pair.slice(0, index).trim() !== name) continue
    const value = decodeURIComponent(pair.slice(index + 1).trim())
    if (value) return value
    // Remember it, so a jar holding ONLY empties still behaves as before.
    empty = value
  }
  return empty
}

/**
 * EVERY value the jar holds for one cookie name (AGL-1902).
 *
 * `readCookie` above answers "what is this cookie's value", which is the right
 * question when a duplicate is an accident to be tolerated. The handoff
 * verifier asks a different one: a duplicate there may be an ATTACK — a
 * compromised sibling host under the customer's own apex setting
 * `Domain=.acme-agency.com` on a cookie we set host-only, which shadows ours
 * in the `Cookie` header with no way to tell them apart.
 *
 * Picking one value would let the attacker's choice decide whether a
 * legitimate redemption succeeds, which is a denial of service handed to
 * anyone who can write a cookie on a sibling name. Returning all of them lets
 * the caller hash each and accept if ANY matches, which is safe by
 * construction — only the real verifier hashes to the stored digest — and
 * turns the hijack attempt into a no-op.
 *
 * Empty values are dropped: they cannot match a digest and would only make the
 * caller hash the empty string.
 */
export function readCookieValues(request: Request, name: string): string[] {
  const raw = request.headers.get('cookie')
  if (!raw) return []
  const values: string[] = []
  for (const pair of raw.split(';')) {
    const index = pair.indexOf('=')
    if (index < 0) continue
    if (pair.slice(0, index).trim() !== name) continue
    const value = decodeURIComponent(pair.slice(index + 1).trim())
    if (value) values.push(value)
  }
  return values
}

/**
 * Is this request actually on HTTPS?
 *
 * Behind Vercel's proxy the runtime sees the forwarded header; the URL is the
 * fallback for a direct connection and for local dev. A comma-joined list is
 * possible through more than one proxy — the first entry is the client's leg,
 * which is the one `Secure` is about.
 *
 * Shared for the same reason `readCookie` above is (AGL-1881). It lived as a
 * private function in the session route, and the activity route answered the
 * question a different way — by folding `Secure` into the same ternary as
 * `Domain`, so a custom console domain got the cookie over HTTPS with no
 * `Secure` at all. That is the second time this pair has drifted: the note on
 * `readCookie` records the first. Two callers, one definition.
 */
export function requestIsHttps(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')
  if (forwarded) return forwarded.split(',')[0].trim().toLowerCase() === 'https'
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}
