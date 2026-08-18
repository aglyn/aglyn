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
