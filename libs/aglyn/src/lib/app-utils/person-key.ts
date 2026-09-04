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
 * The one address-derived document id in this product.
 *
 * `docs/specs/email-overhaul.md` §3d names this derivation for a list
 * membership's `memberKey`; `docs/specs/reusable-forms.md` §4 names the same
 * one for a lead's `personKey`. Both specs say in as many words that whichever
 * ships second imports the first's helper rather than adding a third copy, so
 * there is exactly one function and both meanings are the same value.
 *
 * ## Why this file, and not `contacts.ts` where the specs put it
 *
 * `node:crypto` cannot go into `contacts.ts`. That module is re-exported by
 * `app-utils/server`, which `app-utils/index` re-exports, which the full
 * `@aglyn/aglyn` barrel re-exports — the barrel client code bundles. Three
 * modules next door (`api-adapter`, `api-idempotency`, `plugin-bundle-checks`)
 * are held out of that barrel and exposed only through `@aglyn/aglyn/server`
 * for exactly this reason; the third was measured at 39 KB gzipped off every
 * published customer page. A hashing helper in `contacts.ts` would put a Node
 * builtin on the same path.
 *
 * So the derivation is the specs', to the byte, and only the file is
 * different. `normalizeContactEmail` still comes from `contacts.ts` — this
 * composes the existing normalizer rather than restating it, which is how
 * `emailSuppressionKey` and `suppressionId` came to disagree.
 */

import { createHash } from 'node:crypto'
import { normalizeContactEmail } from './contacts'

/**
 * `sha256` of the normalized address, as full hex.
 *
 * Normalizing first is what stops `Bob@x.com` and `bob@x.com` keying two
 * documents, and it is why the input is the raw value rather than an
 * already-trimmed one: a caller that has to remember to normalize is a caller
 * that can forget.
 *
 * The digest is never truncated. Truncating it is one of the three reasons the
 * two list-member derivations this replaces were incompatible.
 *
 * @returns the key, or `null` for anything that is not a usable address.
 *          Never a best-guess key: two people sharing one document is worse
 *          than refusing to key an unusable value.
 */
export function personKey(email: unknown): string | null {
  const normalized = normalizeContactEmail(email)
  if (!normalized) return null
  return createHash('sha256').update(normalized).digest('hex')
}
