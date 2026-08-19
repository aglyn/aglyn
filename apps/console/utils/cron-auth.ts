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
 * Authorizes a scheduled-route invocation (AGL-489). Accepts either
 * caller:
 *   - **Vercel Cron** — invokes the path with a GET and an auto-injected
 *     `Authorization: Bearer $CRON_SECRET` header (set when CRON_SECRET is
 *     configured on the project). This is how `apps/console/vercel.json`
 *     drives these routes in production.
 *   - **External scheduler** — a POST carrying `x-cron-secret: $CRON_SECRET`
 *     (the original contract, kept for GitHub Actions / manual runs).
 *
 * Returns false when CRON_SECRET is unset so an unconfigured deploy can't be
 * triggered.
 */
import { timingSafeEqual } from 'crypto'

// Constant-time string equality (AGL-512) so secret checks don't leak via
// response-timing. Length is compared first (not itself secret).
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(new Uint8Array(ab), new Uint8Array(bb))
}

export function isCronAuthorized(
  headers: Partial<Record<string, string>>,
): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  if (safeEqual(headers.authorization ?? '', `Bearer ${secret}`)) return true
  if (safeEqual(headers['x-cron-secret'] ?? '', secret)) return true
  return false
}

/**
 * Is this scheduled-route invocation a DRY RUN? (AGL-2084)
 *
 * `reap-plugin-artifacts` and `reverify-plugin-versions` each chose this rule
 * deliberately and each spelled it out again inline, and `audit-archive` — the
 * route that DELETES Firestore audit rows — was the copy that never got
 * written. Four transcriptions of four lines is how the guard goes missing, so
 * it lives here once and the routes call it.
 *
 * The rule:
 *   - An explicit `dryRun` wins, from the body or the query string, in BOTH
 *     directions: `?dryRun=0` on a GET writes, `{ dryRun: true }` on a POST
 *     does not. `'0'`, `'false'` and `false` are the only ways to turn it off,
 *     matching what the two original routes accepted.
 *   - With no `dryRun` at all the METHOD decides: a GET reports, a POST acts.
 *
 * Keying the default on the method rather than on the body being absent is the
 * load-bearing half. `scheduled-crons.yml` fires every one of these routes with
 * a bodyless POST, so defaulting an absent `dryRun` to true would silently stop
 * the archival, the reaping and the re-verification — a worse failure than the
 * one this guard exists to prevent, and an invisible one.
 */
export function isCronDryRun(request: {
  method: string
  body?: unknown
  query?: Record<string, string | string[] | undefined>
}): boolean {
  const requested =
    (request.body as { dryRun?: unknown } | undefined)?.dryRun ??
    request.query?.['dryRun']
  if (requested === undefined) return request.method === 'GET'
  return requested !== '0' && requested !== 'false' && requested !== false
}
