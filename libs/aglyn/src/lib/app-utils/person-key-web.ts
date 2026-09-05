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

import { normalizeContactEmail } from './contacts'

/**
 * `personKey`, for a browser (AGL-2612).
 *
 * `person-key.ts` is THE derivation of the one address-keyed document id in
 * this product — `sha256(normalizeContactEmail(email))` as full hex — and it
 * is held out of the client barrel because `node:crypto` cannot ship to a
 * published page. A console surface that wants to look a lead up by the
 * address on a contact has the same derivation to make and no `node:crypto`
 * to make it with, which left it reading the whole leads collection to find
 * one document, or not looking at all.
 *
 * So this is the same derivation, to the byte, on WebCrypto: the same
 * normalizer, the same digest, the same hex. Asynchronous because
 * `crypto.subtle` is, and `null` for exactly the inputs the synchronous twin
 * refuses — never a best-guess key, because a lookup keyed on a guess finds
 * somebody else's record or nobody's and cannot tell which.
 *
 * The digest is spelled here rather than borrowed from the plugin manager's
 * `sha256Hex`: that module imports this layer, and a helper reached back up
 * through it would be a cycle for four lines.
 *
 * And `null`, rather than a throw, where there is no WebCrypto to run it —
 * an insecure origin, a test DOM. A lookup that cannot be keyed is a lookup
 * that finds nothing, which is the same answer the caller gets for an
 * address that is not one, and the one it already handles.
 */
export async function personKeyInBrowser(
  email: unknown,
): Promise<string | null> {
  const normalized = normalizeContactEmail(email)
  if (!normalized) return null
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  const digest = await subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalized),
  )
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
