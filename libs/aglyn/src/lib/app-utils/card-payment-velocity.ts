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

/*==========================================
 * CARD-TESTING VELOCITY ON A VISITOR'S PAYMENT DOOR (AGL-3363).
 *
 * The pure policy; the durable half is `card-payment-velocity.ts` in
 * tenant-data-admin, beside the visitor-write limiter it tightens.
 *
 * A public storefront checkout is the classic card-testing target: a script
 * opens payment after payment from one address, or from many addresses
 * against one shop, to learn which stolen cards still authorize. The
 * dispatcher's visitor-write limit (120 writes a minute per site and
 * address, `plugin-api-rate-limit.ts`) is sized for a shopper typing into a
 * quantity box and never meant to bound payments. So a route that OPENS A
 * CARD PAYMENT — a Checkout Session, a PaymentIntent, a SetupIntent —
 * declares itself (`registerPluginApiRoute(path, handler, { cardPayment:
 * true })`) and meets three more counters in the tenant dispatcher:
 *
 * 1. PER VISITOR, per (site, address): {@link CARD_PAYMENT_VELOCITY}
 *    `perVisitor`. A shopper opens checkout, backs out, changes the cart
 *    and opens it again; ten in ten minutes is several times that, and a
 *    tester wants hundreds. A young workspace's site gets the tighter
 *    `perVisitorYoung`: the 9/26 incident's workspace was days old.
 * 2. PER ADDRESS, across every site: `perAddress`. Testers rotate merchants
 *    so no one shop sees the volume. The visitor-write policy dropped a
 *    platform-wide per-address limiter because it tripled the cost of every
 *    add-to-cart; a payment door is a small share of writes and each one it
 *    admits is a real Stripe object, so the second counter is paid for here.
 * 3. PER SITE, every address together: `perSite`. It REFUSES NOTHING. A
 *    site-wide refusal is a denial of service any stranger can aim at a
 *    merchant (the visitor-write policy's own argument), and a busy shop's
 *    launch looks like this too. Crossing it files one urgent abuse-queue
 *    row for the site, beside the seller-pattern row, so staff see a site
 *    under attack — or a merchant testing cards through their own shop.
 *
 * What it cannot see: the card. Hosted Checkout collects it on Stripe's
 * page, so a per-card-fingerprint velocity is Radar's to enforce (Checkout
 * applies Stripe's card-testing protection by default; see the staff doc).
 *=========================================*/

/** One fixed window. */
export interface CardPaymentVelocityWindow {
  limit: number
  windowMs: number
}

const TEN_MINUTES = 10 * 60_000

export const CARD_PAYMENT_VELOCITY = {
  /** Payment doors one address may open on one site. */
  perVisitor: { limit: 10, windowMs: TEN_MINUTES },
  /** …on a site whose workspace is young (`isYoungWorkspaceAge`). */
  perVisitorYoung: { limit: 5, windowMs: TEN_MINUTES },
  /** Payment doors one address may open across every site. */
  perAddress: { limit: 30, windowMs: TEN_MINUTES },
  /** Payment doors one site may see before staff are told. Refuses nothing. */
  perSite: { limit: 150, windowMs: TEN_MINUTES },
} as const satisfies Record<string, CardPaymentVelocityWindow>

/** The per-visitor key: one bucket per (site, address). */
export function cardPaymentVisitorKey(hostId: string, ip: string): string {
  return `cardpay:visitor:${hostId || '-'}:${ip || 'unknown'}`
}

/** The per-address key, across every site. */
export function cardPaymentAddressKey(ip: string): string {
  return `cardpay:address:${ip || 'unknown'}`
}

/**
 * The per-site key. `''` answers null: a request that named no site has no
 * site to alarm about, and the two counters above still hold it.
 */
export function cardPaymentSiteKey(hostId: string): string | null {
  return hostId ? `cardpay:site:${hostId}` : null
}

/**
 * The abuse-queue row id for a site's alarm: one per site per UTC day, so a
 * sustained attack is one row that counts, not a row per window.
 */
export function cardPaymentAlarmDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10)
}
