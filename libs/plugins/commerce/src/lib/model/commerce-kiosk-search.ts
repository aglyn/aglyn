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

import { nameSearchKey, nameSearchToken, nameSearchTokens } from '@aglyn/aglyn/app-utils/name-search'

/*
 * Its own module, not `commerce-pos-kiosk.ts`, which the plugin's eager chunk
 * reaches: only the kiosk route and the kiosk's server read this, and every
 * console screen would otherwise pay for it.
 */

/**
 * Whether a product's name answers the words typed, the way the catalog's
 * search does: every word is the start of a word in the name, whatever the
 * case. The query can hold only the first word, so the rest are asked here.
 */
export function posKioskNameMatches(name: string, typed: string): boolean {
  const key = nameSearchKey(typed)
  if (!key) return true
  const tokens = new Set(nameSearchTokens(name))
  return key.split(' ').every((word) => tokens.has(nameSearchToken(word)))
}
