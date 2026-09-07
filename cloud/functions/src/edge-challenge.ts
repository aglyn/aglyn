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
 * Telling the edge's CHALLENGE from a route's own refusal (AGL-2642).
 *
 * The Vercel firewall answers an automated client it does not recognise with
 * its Security Checkpoint page — a 403 or 429 whose body is HTML — before the
 * request reaches the console at all. `postConsoleCron` reports that as
 * `console cron refused`, which is right (the route did not run) and, with
 * `retryCount: 0`, also final: nothing tries again until the next day, and a
 * job that would have passed a minute later shows up as a silent job on
 * `/api/health/crons` and reds its monitor.
 *
 * A challenge is worth ONE retry because it is transient by construction. It
 * is the edge's verdict on the client, not the route's verdict on the
 * request, and that verdict changes from one attempt to the next. A route's
 * own 401 (wrong secret), 501 (secret unset) or 500 is none of those things
 * and must not be retried: repeating it repeats the refusal, and for a sweep
 * that meters into Stripe a blind repeat is worse than a miss.
 *
 * So the decision is deliberately narrow — the two statuses the checkpoint
 * page is known to carry AND a body that is a page rather than the JSON every
 * cron route speaks. Neither signal alone is enough: a 403 with a JSON body is
 * the route's own answer, and an HTML body on any other status is something
 * else (a 3xx is a redirect page this caller already refuses to follow).
 *
 * Pure, and its own module, so `node --test` can exercise it without loading
 * firebase-functions.
 */

/** The statuses the Vercel Security Checkpoint page is known to carry. */
const CHALLENGE_STATUSES: ReadonlySet<number> = new Set([403, 429])

/**
 * How long the one retry waits, in milliseconds. Long enough for the edge's
 * per-attempt verdict to change; short enough that a chunked sweep whose
 * every chunk is challenged still finishes inside the function's budget.
 */
export const EDGE_CHALLENGE_RETRY_DELAY_MS = 7_000

/**
 * Whether a response is the edge's challenge page rather than the route's
 * own answer. `contentType` is the raw header value, or null when absent;
 * `body` is whatever text arrived, or nothing.
 */
export function isEdgeChallenge(
  status: number,
  contentType: string | null | undefined,
  body: string | null | undefined,
): boolean {
  if (!CHALLENGE_STATUSES.has(status)) return false
  if (/^\s*text\/html\b/i.test(contentType ?? '')) return true
  // A byte-order mark or leading whitespace ahead of the doctype is still a
  // page; a JSON body starts with `{` and never reaches the test.
  const head = (body ?? '')
    .replace(/^\uFEFF/, '')
    .trimStart()
    .slice(0, 8)
    .toLowerCase()
  return head.startsWith('<!') || head.startsWith('<html')
}
