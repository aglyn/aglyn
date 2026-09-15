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
 * The document id of an address on the organization's Outreach
 * do-not-contact list (AGL-2979).
 *
 * `personKey` — `sha256` of the normalized address, as full hex — which is
 * exactly how `emailSuppressions/{key}`, `hosts/{hostId}/suppressions/{key}`
 * and `hosts/{hostId}/topicOptOuts/{key}` are keyed, so the runtime reads all
 * four lists for one person with one key and a document id never carries the
 * address itself.
 *
 * SERVER ONLY, and so not in the engine's barrel: `personKey` hashes with
 * `node:crypto`, which cannot ship to a browser. Import it by its own path,
 * `@aglyn/plugins-outreach/engine/do-not-contact`.
 */

import { personKey } from '@aglyn/aglyn/app-utils/person-key'

/** The key, or `null` for anything that is not a usable address. */
export function outreachDoNotContactKey(email: unknown): string | null {
  return personKey(email)
}
