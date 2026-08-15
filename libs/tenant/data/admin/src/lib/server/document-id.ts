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
 * `isDocumentId(value)` — may this value be handed to `.doc()` as ONE opaque
 * document id (AGL-1771)?
 *
 * WHY THE QUESTION EXISTS. `CollectionReference.doc()` appends a
 * SLASH-SEPARATED path and refuses it only when the resulting component count
 * comes out odd (`@google-cloud/firestore`, `collection-reference.js`,
 * measured in `842e72576`). It never treats its argument as one opaque id. So
 * an unvalidated value taken from a request, a webhook tag, a cookie or a
 * stored field gives three distinct failures, none of which is "not found":
 *
 *  * an ODD component count (`a/b/c`) is a perfectly legal path, so the read
 *    or write lands beneath a document that does not exist — invisible to
 *    every console list, because they resolve the parent first;
 *  * an EVEN one (`half/path`) throws SYNCHRONOUSLY at the line building the
 *    ref, which is a different failure from a rejected promise and escapes
 *    any `.catch()` on one. Whether that becomes a clean 500 or rejects out
 *    of the handler depends entirely on whether the ref is built inside or
 *    outside the handler's `try`;
 *  * a reserved `__…__` id answers `INVALID_ARGUMENT` rather than an absent
 *    snapshot — the trap `542b1023f` hit with `products/__missing__`.
 *
 * WHY IT LIVES HERE. This is the third and fourth call site. AGL-1769 wrote
 * the rule as `isCartId` in `libs/plugins/commerce/src/lib/server/cart-cookie.ts`
 * and AGL-1768 copied it as a local `isDocumentId` in
 * `libs/plugins/marketing/src/lib/server/email-events.ts`; AGL-1771's sweep
 * then found two more handlers that need it. Duplication was the cheaper wait
 * at two copies and stops being cheaper at four.
 *
 * A CORRECTION, since the second copy was made for a stated reason that turns
 * out to be false: `@nx/enforce-module-boundaries` does NOT refuse an edge
 * between two feature plugins. Every plugin carries only `aglyn:addons`, and
 * that tag's rule lists `aglyn:addons` among its permitted targets — indeed
 * `campaign-send.ts` already imports `@aglyn/plugins-commerce/model` today. The
 * real objection to marketing importing commerce's cart-cookie module is not
 * lint but sense: the predicate is not about carts, and reaching it through
 * `@aglyn/plugins-commerce/server` would pull the whole commerce server graph
 * — Stripe, the billing webhook — into the marketing plugin for six lines.
 *
 * `tenant-data-admin` is the right home instead because it is where Firestore
 * paths are BUILT, and because {@link updateExisting} — the sibling primitive
 * answering the same class of question, "must this document already exist?" —
 * already lives beside it. Both plugins already depend on this library, so no
 * new edge is created, and this module imports nothing, so none is created
 * downstream either.
 *
 * IMPORT IT FROM THIS ENTRY POINT — `@aglyn/tenant-data-admin/server/document-id`
 * — and not from the library barrel, which is exported there only for
 * discoverability beside its siblings. Two reasons, both load-bearing:
 *
 *  * this module imports NOTHING, and reaching it through `tenancy.ts` would
 *    pull ~35 server modules (media CDN, erasure, Next render-cache) into
 *    callers that today have no such graph. `cart-cookie.ts` imports only
 *    `crypto`; it should stay that way;
 *  * nearly every spec touching those callers already does
 *    `jest.mock('@aglyn/tenant-data-admin', …)` precisely because that graph
 *    will not load under jest. A barrel import would resolve to whatever the
 *    mock object happens to contain — `undefined` at best, and at worst a
 *    permissive stub that turns every path-shaped test value into a false
 *    green. A leaf entry point is not intercepted, so the predicate under test
 *    is always the real one.
 *
 * WHAT THIS IS NOT. Not an authorization check and not a claim that the
 * document exists. It bounds a value to one path COMPONENT; whether that
 * component names anything, and whether this caller may touch it, are separate
 * questions that only the read, the write, or a gate can answer.
 */

/**
 * Firestore reserves ids matching `__…__` and rejects them with
 * `INVALID_ARGUMENT` rather than returning an absent snapshot.
 */
const RESERVED_DOCUMENT_ID = /^__.*__$/

/** Firestore's document id ceiling, which the service counts in BYTES. */
export const MAX_DOCUMENT_ID_BYTES = 1500

/**
 * Whether `value` is usable as ONE opaque Firestore document id.
 *
 * Every clause is a path escape rather than a style preference: `/` is both
 * the nesting hazard and the synchronous `.doc()` throw; `.` and `..` are
 * traversal that Firestore rejects outright; the reserved form throws instead
 * of reporting absence; and the length is Firestore's own limit, measured in
 * UTF-8 bytes because that is what the limit counts — 376 emoji are 1504
 * bytes and would sail through a `.length` check.
 */
export function isDocumentId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('/') &&
    value !== '.' &&
    value !== '..' &&
    !RESERVED_DOCUMENT_ID.test(value) &&
    Buffer.byteLength(value, 'utf8') <= MAX_DOCUMENT_ID_BYTES
  )
}
