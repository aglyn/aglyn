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
 * The one predicate for "this string is a path on MY origin" (AGL-1881).
 *
 * ## Why this exists rather than a sixth hand-rolled shape test
 *
 * Six call sites independently implemented the same guard, and every one of
 * them was written as a list of tricks to reject:
 *
 * ```ts
 * value.startsWith('/') && !value.startsWith('//')   // and later, sometimes:
 * !value.includes('\\')
 * ```
 *
 * AGL-2486 discovered the backslash and added it to four of the six lists. The
 * list was still incomplete, because the list can never be complete: the
 * WHATWG URL parser **removes every ASCII tab, LF and CR from the input before
 * it parses anything**, so a tab sitting between the two slashes hides the
 * protocol-relative form from any test that reads the raw characters.
 * Measured in node 20 and in the browser alike:
 *
 *     new URL('/\t/evil.example', 'https://console.acme.com').href
 *     // → 'https://evil.example/'
 *
 * and `window.location.assign` — which is what these call sites go on to do —
 * resolves it exactly the same way. `\n` and `\r` do it too. So does the
 * combination `'/\t\\evil.example'`, which slips past even the
 * backslash-aware version because the character it checks for is no longer in
 * the authority position when the parser is done.
 *
 * ## The shape of the fix
 *
 * Stop enumerating. **Ask the same parser the browser will ask**, and accept
 * only when it agrees the result stayed on the origin we started from. A trick
 * that the parser does not honor cannot hurt us, and a trick it does honor is
 * caught by construction — including the ones nobody has thought of yet.
 *
 * That is the difference between a check that happens to pass today and a
 * check that cannot silently stop working, which is the property a redirect
 * guard needs: these values land the user somewhere immediately after signing
 * them in, and one that has survived a round trip through an external identity
 * provider is fully attacker-chosen.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, so the probe
 * origin cannot collide with a real host and the comparison means only what it
 * says.
 */
const PROBE_ORIGIN = 'https://redirect-probe.aglyn.invalid'

/**
 * True when `candidate` is a relative path that resolves onto its own origin.
 *
 * Answers `false` for absent, non-string and unparseable input rather than
 * throwing: `strictNullChecks` is off repo-wide, so an absent query parameter
 * reaches this as an empty string or `null` at runtime however the types read,
 * and a `TypeError` escaping into a sign-in render is a worse outage than the
 * redirect bug this guards.
 *
 * Absolute URLs are refused here even when they name our own host. A caller
 * that must accept a same-site absolute (the workspace-domain return in
 * `use-continue-url`) checks that separately, against the parsed hostname —
 * for an absolute input the parser's verdict is already ground truth, so that
 * branch never had this bug.
 */
export function isSameOriginPath(
  candidate: string | null | undefined,
): boolean {
  if (typeof candidate !== 'string') return false
  const value = candidate.trim()
  if (!value.startsWith('/')) return false
  try {
    // Resolve-and-compare. `origin` is what a navigation would actually reach,
    // so any input the parser rewrites into a different authority — `//host`,
    // `/\host`, `/<TAB>/host`, and whatever comes next — fails right here.
    return new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN
  } catch {
    return false
  }
}

/**
 * The trimmed path when it stays on this origin, otherwise `fallback`.
 *
 * The trimmed value is returned, not the raw one, so what was validated is
 * what the caller navigates to. Handing back the original would reintroduce
 * the whole bug class: a guard is only worth anything if the string it
 * approved is the string that gets used.
 */
export function safeSameOriginPath(
  candidate: string | null | undefined,
  fallback = '/',
): string {
  if (!isSameOriginPath(candidate)) return fallback
  return (candidate as string).trim()
}
