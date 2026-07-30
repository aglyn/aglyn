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

export interface SplitDisplayName {
  firstName: string
  lastName: string
}

/**
 * A single `displayName` split into the first/last pair the console profile
 * stores (AGL-1127). Identity providers hand us one string — Google and a
 * SAML assertion both do — while `users/{uid}` and the Basic info form are
 * two fields, so seeding a profile from a provider needs a split.
 *
 * Everything after the first space is the last name, so multi-word family
 * names ("Ada Lovelace King") survive intact. A single word is a first name
 * with no last name rather than a guess, and an empty/absent value yields two
 * empty strings — the caller decides whether that is worth writing.
 *
 * Deliberately naive: this is a SEED for a form the user can edit, not an
 * attempt to parse names correctly, which is not something a splitter can do.
 */
export function splitDisplayName(
  displayName?: string | null,
): SplitDisplayName {
  const cleaned = String(displayName ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return { firstName: '', lastName: '' }
  const boundary = cleaned.indexOf(' ')
  if (boundary === -1) return { firstName: cleaned, lastName: '' }
  return {
    firstName: cleaned.slice(0, boundary),
    lastName: cleaned.slice(boundary + 1),
  }
}

export default splitDisplayName
