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

/*==========================================
 * A FILE'S MARKETING CHOICE (AGL-4245).
 *
 * A store's customer export records whether each person agreed to marketing
 * email: Shopify's `Accepts Email Marketing` (`yes`/`no`), Wix's `Email
 * subscriber status` (`Subscribed`, `Unsubscribed`, `Never subscribed`,
 * `Pending`), Squarespace's `Accepts Marketing` (`true`/`false`). Both
 * importers that take such a file read the cell through this one reader, so
 * a `no` means the same thing in the CRM's contact import and in an email
 * list import: a refusal that is always kept.
 *
 * A word none of the lists names reads as no choice — never as an opt-in.
 *=========================================*/

/** What a file's marketing cell records. */
export type MarketingChoice = 'optIn' | 'optOut' | 'none'

const OPT_IN_WORDS = ['yes', 'y', 'true', '1', 'subscribed', 'opted in', 'opt in', 'opted-in', 'opt-in']
const OPT_OUT_WORDS = ['no', 'n', 'false', '0', 'unsubscribed', 'opted out', 'opt out', 'opted-out', 'opt-out']
const NO_CHOICE_WORDS = ['', 'never subscribed', 'not subscribed', 'pending', 'none', 'n/a', '-', 'not set']

/**
 * A marketing cell as a choice, case-insensitively. `read` is false for a
 * word none of the lists names, which counts as no choice — never as an
 * opt-in.
 */
export function readMarketingChoice(value: unknown): { choice: MarketingChoice; read: boolean } {
  if (typeof value === 'boolean') return { choice: value ? 'optIn' : 'optOut', read: true }
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  if (OPT_OUT_WORDS.includes(text)) return { choice: 'optOut', read: true }
  if (OPT_IN_WORDS.includes(text)) return { choice: 'optIn', read: true }
  return { choice: 'none', read: NO_CHOICE_WORDS.includes(text) }
}
