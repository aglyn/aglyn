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

import { nameSearchTokens } from './name-search'

/**
 * The `array-contains` search tokens for an address (AGL-3321).
 *
 * Every prefix, up to `NAME_TOKEN_MAX_PREFIX` characters, of each of: the
 * whole address, the domain, the domain behind an `@`, and each piece of the
 * local part and of the domain. So `jane.doe@mail.example.com` is found by
 * `jane`, `doe`, `jane.doe@ma`, `example`, `mail.example` and `@mail`, and
 * `dana@example.com` by `example.com`. A query becomes one token through
 * `nameSearchToken`, which caps it at the same length, so a typed address
 * longer than that narrows by its first twelve characters rather than
 * matching nothing.
 *
 * Pure and SDK-free, so a browser list and a server writer stamp the same
 * array: the staff suppressions list (`emailTokens`) and the commerce orders
 * list (`customerEmailTokens`) both search an address through it. Each has a
 * backfill that restates it for the documents written before its field —
 * `tools/scripts/backfill-email-suppression-filters.mjs` and
 * `tools/scripts/backfill-orders-list-fields.mjs` — held to shared fixtures.
 */
export function emailSearchTokens(email: string | null | undefined): string[] {
  const address = String(email ?? '')
    .trim()
    .toLowerCase()
  if (!address) return []
  const at = address.lastIndexOf('@')
  const local = at === -1 ? address : address.slice(0, at)
  const domain = at === -1 ? '' : address.slice(at + 1)
  const words = [
    address,
    ...(domain ? [domain, `@${domain}`] : []),
    ...local.split(/[._+-]+/),
    ...domain.split('.'),
  ]
  return nameSearchTokens(words.filter(Boolean).join(' '))
}
