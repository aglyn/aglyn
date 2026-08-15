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
 * The guest cart cookie (AGL-293) and the one rule its value must satisfy
 * before it may be used as a Firestore path component (AGL-1769).
 *
 * `aglyn_cart_{hostId}` is the one value on a storefront cart request the
 * client picks, and four handlers read it — `cart.ts`, `cart-checkout.ts`,
 * `membership-login.ts`, and, one hop later through Stripe metadata,
 * `billing-webhook.ts`. Each built the cookie's name by hand and passed the
 * value straight to `.doc()`. So the cookie had no owner: its NAME and its
 * VALIDITY RULE lived at four call sites, and the rule was "anything".
 *
 * WHY A RAW COOKIE IS NOT AN ID. `CollectionReference.doc()` appends a
 * SLASH-SEPARATED path and refuses it only when the resulting component count
 * comes out odd (`@google-cloud/firestore`, `collection-reference.js:179-191`,
 * measured in `842e72576`). It never treats its argument as one opaque id. So
 * a cookie of `a/b/c` reached `carts/a/b/c` — a document at a nesting of the
 * caller's choosing — and a cookie of `half/path` threw SYNCHRONOUSLY, which
 * is a different failure from a rejected promise and escapes a `.catch()`.
 *
 * WHY THE LOOSE RULE AND NOT THE MINTED FORMAT. Every cart id Aglyn has ever
 * issued is `randomBytes(16).toString('hex')` — 32 lowercase hex characters,
 * unchanged since AGL-293 (`92b860569`) — so `/^[0-9a-f]{32}$/` would be
 * enforceable without orphaning a single live cart. It is deliberately not
 * used. The hazard is the PATH, not the alphabet: a caller who must supply a
 * well-formed id simply generates one, and creates exactly the same number of
 * documents they would have created by sending no cookie at all and letting
 * the server mint. Tightening to the minted format would buy no bound that
 * matters and would silently empty the basket of anyone holding a cookie from
 * a format this file does not know about. What must be impossible is naming a
 * path; that is what {@link isCartId} decides.
 *
 * WHAT THIS IS NOT. Not a repo-wide Firestore id validator. That belongs
 * beside `updateExisting` in `tenant-data-admin`, and is its own change; this
 * one owns a single cookie whose every reader is in this directory.
 */

import { randomBytes } from 'crypto'

/**
 * Firestore reserves ids of the form `__…__` and rejects them with
 * `INVALID_ARGUMENT` rather than returning an absent snapshot — the same trap
 * `542b1023f` hit with `products/__missing__`.
 */
const RESERVED_DOCUMENT_ID = /^__.*__$/

/** Firestore's document id limit. */
const MAX_DOCUMENT_ID_BYTES = 1500

/** The `aglyn_cart_{hostId}` cookie name, in one place. */
export function cartCookieName(hostId: string): string {
  return `aglyn_cart_${hostId}`
}

/** A fresh cart id: 128 bits of randomness, hex. `cart.ts` is the only minter. */
export function mintCartId(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Whether `value` is usable as ONE opaque Firestore document id.
 *
 * Every clause is a path escape, not a style preference: `/` is the nesting
 * hazard and the synchronous `.doc()` throw; `.` and `..` are path traversal
 * that Firestore rejects; the reserved form throws instead of missing; and the
 * length is Firestore's own ceiling, measured in UTF-8 bytes because that is
 * what the limit counts.
 */
export function isCartId(value: unknown): value is string {
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

/**
 * The cart id this request carries, or `''` when it carries none Aglyn is
 * willing to treat as one.
 *
 * A cookie that fails {@link isCartId} is reported as ABSENT rather than as an
 * error, and that is the whole design: every caller already has a correct
 * branch for "this visitor has no cart" — mint one, return an empty cart, skip
 * the linkage — and none of them has anything to say to a visitor whose cookie
 * was mangled. Refusing loses nothing either, since a path that is not a cart
 * id was never a cart anyone filled.
 */
export function readCartId(
  cookies: Record<string, string | undefined> | undefined,
  hostId: string,
): string {
  const raw = cookies?.[cartCookieName(hostId)]
  return isCartId(raw) ? raw : ''
}
