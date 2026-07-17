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
export function isCronAuthorized(
  headers: Partial<Record<string, string>>,
): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  if (headers.authorization === `Bearer ${secret}`) return true
  if (headers['x-cron-secret'] === secret) return true
  return false
}
