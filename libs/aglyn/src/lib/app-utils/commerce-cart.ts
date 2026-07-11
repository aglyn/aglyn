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
 * Adds/merges a line (quantities accumulate), clamped to per-line and
 * line-count caps. Quantity ≤ 0 removes the line.
 */
export function upsertCartLine(
  cart: Pick<HostCart, 'lines'>,
  line: CartLine,
  mode: 'add' | 'set' = 'add',
): CartLine[] {
  const quantity = Math.round(line.quantity)
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
  const nextQuantity =
    mode === 'add' ? existing.quantity + quantity : quantity
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
  return (cart?.lines ?? []).reduce((sum, line) => sum + line.quantity, 0)
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
