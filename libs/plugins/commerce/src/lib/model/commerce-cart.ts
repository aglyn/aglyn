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
 * Cart v1 (AGL-293): a server-backed cart doc at
 * `hosts/{hostId}/carts/{cartId}`, keyed by an httpOnly cookie. Lines
 * store only ids + quantity — display data and prices resolve from the
 * product docs at read/checkout time, so a stale cart can never charge
 * a stale price. Pure helpers; the cart API owns I/O.
 */

export interface CartLine {
  productId: string
  /** Absent = the product's default variant. */
  variantId?: string
  quantity: number
}

/** `hosts/{hostId}/carts/{cartId}` doc. */
export interface HostCart {
  lines: CartLine[]
  /** Storefront customer once signed in (AGL-294 merge). */
  customerId?: string
  updatedAtMs?: number
  createdAtMs?: number
}

export const CART_MAX_LINES = 50
export const CART_MAX_QUANTITY = 99

function lineKey(line: Pick<CartLine, 'productId' | 'variantId'>): string {
  return `${line.productId}:${line.variantId ?? ''}`
}

/**
 * A line quantity, coerced to a whole finite number (AGL-2285).
 *
 * `Math.round(line.quantity)` was the whole sanitiser, and `Math.round(NaN)` is
 * `NaN` — which then walked past the guard below, because `NaN <= 0` is
 * `false`. A cart line with `quantity: NaN` (a legal Firestore double) was
 * stored, and from there `cartCount` reported `NaN` in the mini-cart badge and
 * `cart-checkout.ts` computed `itemsCents`, the platform fee and the Stripe
 * `line_items[n][quantity]` as `NaN` too — so Stripe 400s and the shopper
 * cannot check out AT ALL until they find the poisoned line and remove it.
 *
 * Answering 0 is what makes the existing `<= 0` guard do its job: an
 * unusable quantity removes the line (or refuses to add one) rather than
 * writing a value nothing downstream can compare against. The same lesson as
 * AGL-2229 one collection over — `Math.max`/`Math.min`/`Math.round` propagate
 * `NaN`, they do not discard it.
 */
function wholeQuantity(value: unknown): number {
  const quantity = Math.round(Number(value ?? 0))
  return Number.isFinite(quantity) ? quantity : 0
}

/**
 * Adds/merges a line (quantities accumulate), clamped to per-line and
 * line-count caps. Quantity ≤ 0 removes the line.
 */
export function upsertCartLine(
  cart: Pick<HostCart, 'lines'>,
  line: CartLine,
  mode: 'add' | 'set' = 'add',
): CartLine[] {
  const quantity = wholeQuantity(line.quantity)
  const key = lineKey(line)
  const existing = cart.lines.find((item) => lineKey(item) === key)
  if (!existing) {
    if (quantity <= 0) return cart.lines
    if (cart.lines.length >= CART_MAX_LINES) return cart.lines
    return [
      ...cart.lines,
      { ...line, quantity: Math.min(CART_MAX_QUANTITY, quantity) },
    ]
  }
  // The STORED side is coerced too (AGL-2285): a line written before this
  // guard, or by any other writer, can still hold a non-finite quantity, and
  // adding to it would carry that forward forever.
  const nextQuantity =
    mode === 'add' ? wholeQuantity(existing.quantity) + quantity : quantity
  if (nextQuantity <= 0) {
    return cart.lines.filter((item) => lineKey(item) !== key)
  }
  return cart.lines.map((item) =>
    lineKey(item) === key
      ? { ...item, quantity: Math.min(CART_MAX_QUANTITY, nextQuantity) }
      : item,
  )
}

export function removeCartLine(
  cart: Pick<HostCart, 'lines'>,
  line: Pick<CartLine, 'productId' | 'variantId'>,
): CartLine[] {
  const key = lineKey(line)
  return cart.lines.filter((item) => lineKey(item) !== key)
}

/** Total units across lines (the mini-cart badge). */
export function cartCount(cart: Pick<HostCart, 'lines'> | undefined): number {
  // Coerced per line (AGL-2285) so one stored `NaN` cannot make the badge read
  // `NaN` for a cart that otherwise has real items in it.
  return (cart?.lines ?? []).reduce(
    (sum, line) => sum + wholeQuantity(line?.quantity),
    0,
  )
}

/**
 * Merges a guest cart into a customer cart on sign-in (AGL-294):
 * quantities accumulate per line, capped as usual.
 */
export function mergeCarts(
  customerCart: Pick<HostCart, 'lines'>,
  guestCart: Pick<HostCart, 'lines'>,
): CartLine[] {
  let lines = [...customerCart.lines]
  for (const line of guestCart.lines) {
    lines = upsertCartLine({ lines }, line, 'add')
  }
  return lines
}
