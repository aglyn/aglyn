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
 * THE MONTH A MONTHLY COUNTER IS KEYED BY.
 *
 * Every counter the platform keeps per month — a door's refusals and catches,
 * a site's visitor records, an organization's usage — is keyed by the UTC
 * `YYYY-MM` of the moment it counts, and a reader that derived the key any
 * other way would read zero on exactly the sites the counter is about. A
 * monthly ceiling lifts at the boundary that key rolls over on, which is the
 * one moment a notice may promise.
 */

/** The UTC `YYYY-MM` a monthly counter is keyed by. */
export function utcMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}

/**
 * 00:00 UTC on the first of next month: when a monthly counter's key rolls
 * over, and with it when a monthly ceiling lifts.
 */
export function nextUtcMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}
