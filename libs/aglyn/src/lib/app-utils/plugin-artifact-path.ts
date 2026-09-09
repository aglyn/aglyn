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
 * Where a plugin build's bundle lives in the artifacts bucket.
 *
 * Its own module because a published page's client bundle reads this one
 * function — `realm-plugins.ts` builds a trusted-realm bundle URL from it —
 * while `plugin-manifest.ts` around it is the marketplace's publishing and
 * revocation logic: manifest validation, offered and installable versions,
 * revocation state, prop and element resolution. None of that runs on a
 * customer site, and a bundler cannot drop it around a single named import.
 */

/**
 * Content-addressed artifact object path in the isolated artifacts bucket.
 * Immutable per `{listingId}/{version}/{sha256}` — a new build is a new
 * path, so a consumer's pinned install can never be swapped underneath it.
 */
export function pluginArtifactPath(
  listingId: string,
  version: string,
  sha256: string,
): string {
  return `artifacts/${listingId}/${version}/${sha256}.bundle`
}
