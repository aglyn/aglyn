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

import * as Aglyn from '@aglyn/aglyn/server'
import * as CommerceModel from '../model'
import {
  firebaseAdmin,
  getOrgForHost,
  getPluginConfig,
  upsertHostContact,
} from '@aglyn/tenant-data-admin'
import {
  buildRoute,
  claimAttempt,
  Route,
  type AttemptClaim,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { alertLowStockCrossing } from './low-stock'
import { decrementVariantStock } from './reserve-stock'
import { posMaxDiscountPct } from '../plugin-config'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'

/**
 * The settlement claim (AGL-1691) now lives in `@aglyn/aglyn/server`
 * (AGL-1697), because it is the answer for every unkeyed money route and not
 * just this one. Moved whole and unchanged in behaviour — the digest is still
 * `sha256('pos:{hostId}:{key}')`, so keys minted against the local version
 * still resolve. The only difference is the claim document: it carries
 * `scopeId` where this file wrote `hostId`, and no longer writes a
 * `serverTimestamp` sentinel alongside `createdAtMs`, since the shared version
 * takes a plain Firestore-shaped store rather than firebase-admin itself.
 */

/**
 * POS sale (AGL-312): manager-gated, server-priced. Cash sales create a
 * paid `channel: 'pos'` order immediately (with change calculation);
 * card sales mint a Stripe payment link the register shows as a QR
 * (Stripe Terminal hardware can slot in behind the same endpoint
 * later). Inventory decrements per line from the register's location,
 * and sales can post to an open reservation folio instead (AGL-317).
 */
export const posOrderHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  const payment = String(body.payment ?? 'cash') as 'cash' | 'link' | 'folio'
  const cashReceivedCents = Math.round(Number(body.cashReceivedCents ?? 0))
  const customerEmail = String(body.customerEmail ?? '').trim().toLowerCase()
  const reservationId = String(body.reservationId ?? '')
  const registerId = String(body.registerId ?? '')
  const locationId = String(body.locationId ?? '')
  // REFUSED, NOT CLAMPED (AGL-2161). This used to be
  // `Math.min(100, Math.max(0, …))`, so a register asking for `150` rang up a
  // 100% comp and a register asking for `-20` rang up full price — in both
  // cases a sale the operator did not ask for, recorded as though they had,
  // and indistinguishable afterwards from a deliberate one. A clamp is a
  // silent correction of a request nobody can prove was made; the ceiling
  // below is a refusal the register can show its operator.
  //
  // The finiteness test stays and is now also a refusal (AGL-2224 kept its
  // teeth): `discountPct: 'half'` propagated `NaN` through the discount, the
  // platform fee, the tax and `totals.totalCents`, and `NaN` defeats
  // comparison rather than failing it — so the "cash received is short" guard
  // below (`cashReceivedCents < totals.totalCents`) read false and rang up a
  // sale that had taken no money. Answering that with `0` charged full price
  // on a request the route could not read; answering with a 400 says so.
  const rawDiscountPct = Number(body.discountPct ?? 0)
  if (!Number.isFinite(rawDiscountPct) || rawDiscountPct < 0) {
    return res.status(400).json({ error: 'Invalid discount' })
  }
  const discountPct = rawDiscountPct
  const rawLines = Array.isArray(body.lines) ? body.lines : []
  // One settlement attempt, minted by the register (AGL-1691). Node lowercases
  // incoming headers, but read both spellings — the plugin API request type
  // makes no promise about casing.
  const idempotencyKey = String(
    req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'] ?? '',
  ).trim().slice(0, 200)
  if (!hostId || rawLines.length === 0) {
    return res.status(400).json({ error: 'Missing hostId or lines' })
  }

  let claim: AttemptClaim | null = null
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    // AN ALLOWLIST (AGL-2262), matching `cancel-order.ts`, `fulfill-order.ts`
    // and the Firestore rules' own `hostMemberRole(hostId) in
    // ['admin','editor']`. The old `!role || role === 'viewer'` denylist
    // admitted every string that was not literally `viewer` on the route that
    // takes cash, mints a card QR and decrements real inventory.
    // `HostAccessRole` is exactly `admin | editor | viewer`, so this refuses
    // nothing a real projection can produce.
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin' && memberRole !== 'editor') {
      return res.status(403).json({ error: 'Not permitted' })
    }
    // THE `managePos` PERMISSION, actually read (AGL-2474). The allowlist
    // above is a HOST-level fact and stays — it is what the Firestore rules
    // enforce and dropping it would widen this route. This is the org-level
    // half: `managePos` was declared by COMMERCE_PERMISSIONS, resolved into
    // every permission map, displayed nowhere and read by nothing, so the
    // capability was inert. Both must hold, matching the marketplace
    // install/publish routes' resolveOrgPermissions + memberRoles pairing.
    //
    // Behaviour is unchanged for anyone who has not been given an explicit
    // override: `managePos` defaults to true for the admin and editor tiers,
    // which is exactly the set the allowlist already admits. What it adds is
    // the ability to REVOKE POS from one admin without demoting them.
    const membership = await resolveOrgPermissions(decoded.uid, { hostId })
    if (!membership.permissions.managePos) {
      return res.status(403).json({ error: 'Not permitted' })
    }
    const ownerOrg = await getOrgForHost(hostId)
    if (!Aglyn.checkEntitlement(ownerOrg?.org as any, 'pos')) {
      return res
        .status(403)
        .json({ error: 'POS requires the Pro plan or above' })
    }
    // THE DISCOUNT CEILING (AGL-2161), refused rather than clamped.
    //
    // Enforced here and not in the UI: `pos-page.component.tsx` mirrors the
    // same bound on its input, but that field is a plain `TextField` and the
    // number arrives in the request body — a client bound is a courtesy, and
    // the route is where a discount stops being a suggestion.
    //
    // The ceiling defaults to 100 (see `plugin-config.ts` for why that number
    // is the merchant's to lower and not this fix's to invent). What changed
    // is that exceeding it is now an answer instead of a silent rounding.
    const maxDiscountPct = posMaxDiscountPct(
      await getPluginConfig(ownerOrg?.orgId, 'commerce'),
    )
    if (discountPct > maxDiscountPct) {
      return res.status(403).json({
        error:
          `This register may discount up to ${maxDiscountPct}%. Ask a ` +
          'manager to raise the limit in the commerce settings.',
        maxDiscountPct,
      })
    }
    // Register attribution + cap (AGL-472/482): a sale must run through a
    // named register that exists on this host. Creation is quota-gated by
    // the resources route, but that's creation-only — a paid→paid
    // downgrade (e.g. Business 2 → Pro 1) would otherwise keep every
    // existing register transacting. So re-check the cap at sale time:
    // rank the host's registers by creation order and refuse any whose
    // rank is beyond THIS SITE's register cap. Deterministic and
    // self-healing — no data is deleted, and re-upgrading restores them.
    //
    // The cap is per site and so is the check (AGL-1775):
    // `checkHostRegisterQuota` is the plan's cap plus the seats the org has
    // allocated to this host out of the purchased pool. The old
    // `checkQuota(org, 'posRegisters', …)` read the org-level value, which
    // since AGL-1775 carries no pool at all — leaving it here would have
    // stopped sales on registers a merchant is invoiced $89/mo for, which is
    // the expensive direction of getting this wrong.
    if (!registerId) {
      return res.status(400).json({ error: 'Missing registerId' })
    }
    const registerDocs = (
      await hostRef.collection('registers').get()
    ).docs
      .map((doc) => ({
        id: doc.id,
        createdAtMs: doc.get('createdAt')?.toMillis?.() ?? 0,
      }))
      .sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id))
    const rank = registerDocs.findIndex((r) => r.id === registerId)
    if (rank < 0) {
      return res.status(404).json({ error: 'Unknown register' })
    }
    if (
      !Aglyn.checkHostRegisterQuota(ownerOrg?.org as any, hostId, rank).allowed
    ) {
      return res.status(403).json({
        error:
          'This register is over your plan’s limit — remove extra ' +
          'registers or upgrade in Billing to use it.',
      })
    }

    // Server pricing per line.
    const uniqueIds: string[] = [
      ...new Set<string>(rawLines.map((line: any) => String(line.productId))),
    ]
    const productSnapshots = await Promise.all(
      uniqueIds.map((id) => hostRef.collection('products').doc(id).get()),
    )
    const productsById = new Map(
      productSnapshots.map((snapshot) => [
        snapshot.id,
        snapshot.exists ? CommerceModel.liftLegacyProduct(snapshot.data() as any) : null,
      ]),
    )
    const lineItems: CommerceModel.OrderLineItem[] = []
    for (const raw of rawLines) {
      const product = productsById.get(String(raw.productId))
      if (!product) continue
      const variant =
        product.variants.find((item) => item.id === raw.variantId) ??
        product.variants[0]
      const quantity = Math.max(1, Math.min(99, Math.round(Number(raw.quantity ?? 1))))
      lineItems.push({
        productId: String(raw.productId),
        ...(variant.id !== 'default' ? { variantId: variant.id } : {}),
        name: product.name,
        ...(Object.keys(variant.options ?? {}).length
          ? { variantLabel: Object.values(variant.options ?? {}).join(' / ') }
          : {}),
        ...(variant.sku ? { sku: variant.sku } : {}),
        productType: product.type,
        quantity,
        unitAmountCents: Math.round(Number(variant.priceUsd) * 100),
      })
    }
    if (lineItems.length === 0) {
      return res.status(400).json({ error: 'No valid lines' })
    }
    // WHAT THE COUNT SAYS, said out loud (AGL-2357). This handler had no
    // `canPurchase` call at all — every storefront door gates on it and the
    // register did not — so a merchant who chose `oversellPolicy: 'deny'` in
    // the product editor was silently getting `backorder` at the till.
    //
    // The decision (AGL-2357, Zach): WARN, NEVER BLOCK. A till is the wrong
    // place for a stale number to stop a real sale — the cashier is holding
    // the goods — but a merchant who set "deny" is entitled to have the
    // register say something before it sells past zero. So the shortfall is
    // reported and the sale proceeds: there is no refusal anywhere below this
    // line, and adding one is a separate decision (AGL-2358, the
    // manager-override variant).
    //
    // Computed from the SERVER's product documents, not the register's cached
    // grid, and returned on both tenders. The client shows its own warning as
    // the basket is built (`pos-page.component.tsx`), which is the surface the
    // cashier reads; this is the authoritative one, taken at the moment of
    // sale and available to any other register client.
    const stockWarnings: CommerceModel.StockShortfall[] = []
    for (const line of lineItems) {
      const product = productsById.get(line.productId)
      if (!product) continue
      const shortfall = CommerceModel.stockShortfall(
        product,
        line.variantId ?? product.variants[0]?.id,
        line.quantity,
      )
      if (!shortfall) continue
      stockWarnings.push({
        productId: line.productId,
        ...(line.variantId ? { variantId: line.variantId } : {}),
        name: line.name,
        ...(line.variantLabel ? { variantLabel: line.variantLabel } : {}),
        requested: line.quantity,
        available: shortfall.available,
      })
    }
    const itemsCents = lineItems.reduce(
      (sum, line) => sum + line.unitAmountCents * line.quantity,
      0,
    )
    const discountCents = Math.round((itemsCents * discountPct) / 100)
    // THE PLATFORM FEE (AGL-2110), and its absence was a straight loss.
    //
    // A POS card sale opens a DESTINATION charge
    // (`payment_intent_data[transfer_data][destination]`, below) with no
    // `transfer_data[amount]`, so Stripe transfers the whole charge to the
    // merchant while debiting its own processing fee (2.9% + 30¢) from the
    // PLATFORM's balance. Without an `application_fee_amount` beside it,
    // every in-person card sale moved money OUT of Aglyn — the exact shape
    // `plan-entitlements.ts` documents for a 0% rate on a destination charge
    // (AGL-2071). Online sales have carried the fee since AGL-307; the
    // register never did.
    //
    // PER LINE BY PRODUCT TYPE, summed — byte-for-byte the arithmetic
    // `cart-checkout.ts` uses, because a basket can mix a physical good
    // (Starter 2%) with a digital one (Starter 5%) and a single basket-wide
    // rate would price one of them wrong. A missing `type` reads as
    // `physical`, matching `liftLegacyProduct` and the cart.
    //
    // Scaled by the cashier's discount, again like the cart: the fee is a cut
    // of what the shopper actually paid, not of the list basket.
    // WHETHER a rate applies is a separate fact from what it rounds to
    // (AGL-2256). This path rounds TWICE — once per line, then again when the
    // cashier's discount scales the sum — and floored neither, so a small
    // basket on a low rate produced 0 and the emission guard below read that as
    // "this plan charges no fee" and sent none at all. Every other door floors
    // at `Math.max(1, …)` when the rate is above zero.
    let feeApplies = false
    const grossFeeCents = lineItems.reduce((sum, line) => {
      const linePct = Aglyn.resolveTransactionFeePct(
        ownerOrg?.org as any,
        (line.productType ?? 'physical') as 'physical' | 'digital' | 'service',
      )
      if (linePct > 0) feeApplies = true
      return (
        sum +
        Math.round((line.unitAmountCents * line.quantity * linePct) / 100)
      )
    }, 0)
    const chargedItemsCents = Math.max(0, itemsCents - discountCents)
    const scaledFeeCents =
      itemsCents > 0
        ? Math.round((grossFeeCents * chargedItemsCents) / itemsCents)
        : 0
    // Gated on what the shopper actually pays for goods, so a 100% cashier
    // discount still takes nothing — the fee is a cut of the goods, and there
    // are none left to cut.
    const takeFeeCents =
      feeApplies && chargedItemsCents > 0
        ? Math.max(1, scaledFeeCents)
        : scaledFeeCents
    // Origin tax (AGL-285) — in-person sales are origin-based by nature.
    const storeSettings = await hostRef.collection('settings').doc('store').get()
    const taxSettings = (storeSettings.get('tax') ?? {}) as CommerceModel.TaxSettings
    // AGL-1999: an unset tax mode is NOT a decision, and it must not sell.
    // `mode` was `undefined` for every store whose owner never opened the
    // Taxes card — the default state of every new storefront — and each
    // branch below tested for a specific string, so no branch was taken, no
    // tax was computed, and the shopper was charged an untaxed total. See
    // `commerce-tax-decision.ts` for why refusing beats defaulting to either
    // mode. `mode: 'none'` is the explicit opt-out and passes straight
    // through.
    const taxDecision = CommerceModel.storefrontTaxDecision({
      settings: taxSettings,
    })
    if (taxDecision.kind === 'undecided') {
      return res
        .status(409)
        .json({ error: CommerceModel.STOREFRONT_TAX_UNDECIDED_MESSAGE })
    }
    // `inPerson`, and it is the whole reason this argument exists (AGL-2145):
    // a store on Stripe Tax is served correctly ONLINE and must not be
    // refused there, but the register sends the basket as one opaque line and
    // sets no `automatic_tax` — it cannot, there is no customer address at a
    // till — and the cash and folio tenders never reach Stripe at all. Every
    // in-person sale at such a store charged ZERO tax, on both tenders, with
    // no refusal and no log: the AGL-1999 defect, still open at the one place
    // a shopper is standing in front of you.
    const taxMisconfigured = CommerceModel.storefrontTaxMisconfiguration(
      taxSettings,
      { inPerson: true },
    )
    if (taxMisconfigured) {
      return res.status(409).json({ error: taxMisconfigured })
    }
    const rate =
      taxDecision.kind === 'manual'
        ? CommerceModel.resolveTaxRate(taxSettings, taxSettings.origin ?? {})
        : null
    const taxCents =
      rate && !taxSettings.pricesIncludeTax
        ? CommerceModel.computeTaxCents(itemsCents - discountCents, rate.pct)
        : 0
    /*==========================================
     * THE FEE ATTACHES TO THE SALE, NOT TO THE TENDER (AGL-2111).
     *
     * It used to ride the CARD totals only, and the argument was mechanical:
     * cash and folio never touch Stripe, so there is no charge to take an
     * `application_fee_amount` out of, so record nothing. That left a merchant
     * on a non-zero rate one tap away from paying Aglyn nothing forever —
     * ring every in-person sale as cash. Zach's decision, 2026-08-19: close
     * it. The tender is at most an input to the RATE; it is never a switch
     * that zeroes the fee.
     *
     * ## Cash is genuinely different from card, and the difference argues for
     * ## the SAME rate, not a lower one
     *
     * On a card sale the fee becomes `application_fee_amount` on a DESTINATION
     * charge, and Stripe's own processing (2.9% + 30¢) is debited from the
     * PLATFORM's balance beside it (AGL-2071). At the Starter physical rate of
     * 2% the fee does not even cover that processing — Aglyn nets negative on
     * the card leg. So the take rate demonstrably is NOT a processing
     * pass-through with margin on top; there is no processing component in it
     * to strip out for a tender that skips Stripe.
     *
     * What the fee buys is the same on both tenders: the catalogue that priced
     * the basket, the stock that decremented, the tax that computed, the order
     * record, the receipt, the reporting, the register itself. Aglyn's cost
     * basis on a cash sale is LOWER (no Stripe fee at all), so the same
     * percentage is more profitable there, not less justified.
     *
     * And any gap between tenders is itself the defect: a cheaper cash rate
     * would still pay a merchant to steer customers to cash. Parity is the
     * only rate at which the tender stops being a pricing lever.
     *
     * ## What changes is COLLECTION, not the rate
     *
     * There is still no charge to net it from, so the fee is ACCRUED against
     * the org's month (`offlineFees` below) and swept onto the
     * org's own monthly Aglyn invoice by `report-usage` — option 2 on
     * AGL-2111, the `aglyn_metered_usage` meter that already carries every
     * other overage. `feeCollection` on the order says which of the two routes
     * this sale's fee took, so a merchant reconciling a payout can tell "short
     * by the fee" from "billed for it next month".
     *
     * `feeCents` does not enter `totalCents` (see `computeOrderTotals`), so
     * the shopper pays exactly what they paid before — this moves no price at
     * the till, on either tender.
     *=========================================*/
    // STRIPE'S CARD COST, ON THE CARD TENDER ONLY (AGL-2152). `takeFeeCents`
    // above is the platform's advertised take and every tender carries it
    // (AGL-2111). This term is different in kind: it is not a rate, it is the
    // 2.9% + 30¢ Stripe debits from the PLATFORM's balance when a destination
    // charge settles — which the AGL-2111 note beside it already observes the
    // take does not cover. Cash and folio never reach Stripe, so there is no
    // such cost to pass through and adding one would invoice a merchant for a
    // fee nobody paid.
    //
    // The base is exactly what the card runs for: the goods after the
    // cashier's discount, plus the origin tax. A till knows both — there is no
    // shopper-chosen shipping and no Stripe Tax to wait on — so unlike the
    // online doors this one recovers the cost exactly.
    const feeCents =
      payment === 'link'
        ? takeFeeCents +
          Aglyn.storefrontProcessingCostCents(chargedItemsCents + taxCents)
        : takeFeeCents
    const totals = CommerceModel.computeOrderTotals(lineItems, {
      discountCents,
      taxCents,
      feeCents,
    })
    // Kept as a distinct name because the card branch reads it for the Stripe
    // parameters and the metadata witness; the two are now the same figure by
    // construction, which is the point of this change.
    const cardTotals = totals
    // How this sale's fee reaches Aglyn. `payout` = netted from the merchant's
    // Stripe transfer at settlement; `invoice` = accrued here and billed on
    // the org's next Aglyn invoice. Written on every POS order that carries a
    // fee, so the collection route is a recorded fact rather than something a
    // reader has to infer from the tender.
    const feeCollection: 'payout' | 'invoice' =
      payment === 'link' ? 'payout' : 'invoice'
    // WHERE THE INVOICED HALF ACCRUES (AGL-2111): one document per org-month,
    // `orgs/{id}/offlineFees/{YYYY-MM}`, read by `report-usage` and added to
    // the org-month's `billedCents` — the same `aglyn_metered_usage` meter
    // that already carries dataset, API and contact overage. Nothing new has
    // to be minted in Stripe for this to bill.
    //
    // Keyed by ORG, not by host: the org is the billing subject (AGL-238), and
    // a merchant with three storefronts gets one line rather than three.
    //
    // An org with no id is not billable and must not silently accrue into
    // `orgs//offlineFees/…`; the sale still rings, and the fee is forgone
    // rather than written somewhere no invoice will ever find it.
    const offlineFeeMonth = offlineFeeMonthKey()
    const offlineFeeOrgId = String(ownerOrg?.org?.id ?? '')
    const offlineFeeRef = offlineFeeOrgId
      ? firestore
          .collection('orgs')
          .doc(offlineFeeOrgId)
          .collection('offlineFees')
          .doc(offlineFeeMonth)
      : null

    // Deterministic tender rejections run BEFORE the claim is taken, so they
    // never burn the key (AGL-1691): "cash received is short" is a 400 the
    // cashier fixes by taking more cash and pressing the same button, and a
    // claimed key would replay the rejection forever. Hoisted above the card
    // branch so one claim site covers every tender; both are no-ops for `link`.
    if (payment === 'cash' && cashReceivedCents < totals.totalCents) {
      return res.status(400).json({ error: 'Cash received is short' })
    }
    // AGL-1760: the stay must EXIST before the sale is rung, and here is the
    // last place that can still be said. A `folio` tender moves no money at
    // this counter — no card is charged and no cash is taken; the order is
    // written `paid` because the charge is BOOKED against the stay and
    // collected at check-out, at the register, as its own sale. So an unknown
    // reservation is the same class of deterministic, retryable rejection as
    // "cash received is short": the cashier picks the right stay and presses
    // the same button. Sitting above the claim is what keeps the key unburned.
    //
    // The read is not an extra one. AGL-1757 already loaded this document a
    // few lines below, to attribute the sale to its guest; it is HOISTED here
    // rather than added, so a folio sale still costs exactly one reservation
    // read — and that one read now answers both questions.
    //
    // Unlike AGL-1757's, this read is authoritative rather than best-effort:
    // it IS the validation, so a Firestore failure must not be swallowed into
    // "no such stay". It falls to the 500 below — before the claim, before any
    // order — and the cashier retries the same key with nothing taken.
    let folioGuestEmail = ''
    let folioGuestName = ''
    if (payment === 'folio') {
      if (!reservationId) {
        return res.status(400).json({ error: 'Pick a reservation' })
      }
      const reservationSnapshot = await hostRef
        .collection('reservations')
        .doc(reservationId)
        .get()
      if (!reservationSnapshot.exists) {
        return res.status(404).json({ error: 'Unknown reservation' })
      }
      // The one POS tender where the customer is already identified by the
      // system — `reserve.ts` populated these from the guest's own booking
      // (AGL-1757). The console walk-in writes `guestEmail: null`, which
      // leaves them empty and correctly attributes the sale to nobody.
      folioGuestEmail = String(reservationSnapshot.get('guestEmail') ?? '')
        .trim()
        .toLowerCase()
      folioGuestName = String(reservationSnapshot.get('guestName') ?? '')
        .trim()
        .slice(0, 120)
    }

    // Point of no return: everything past here writes an order or moves money.
    const claimed = await claimAttempt(firestore, {
      kind: 'pos',
      scopeId: hostId,
      orgId: String(ownerOrg?.org?.id ?? ''),
      key: idempotencyKey,
      busyMessage: 'This sale is already being processed',
    })
    if ('replay' in claimed) {
      return res.status(claimed.replay.status).json(claimed.replay.body)
    }
    claim = claimed.claim

    if (payment === 'link') {
      // QR payment link on the merchant account, completed by webhook.
      const ownerProfile = await firestore
        .collection('profiles')
        .doc(String(ownerOrg?.org?.ownerUid ?? ''))
        .get()
      const accountId = ownerProfile.get('stripeAccountId')
      if (!accountId || !ownerProfile.get('stripeChargesEnabled')) {
        return res.status(409).json({ error: 'Card payments not set up' })
      }
      const orderRef = hostRef.collection('orders').doc()
      const counterRef = hostRef.collection('counters').doc('orders')
      await firestore.runTransaction(async (transaction) => {
        const counter = await transaction.get(counterRef)
        const number = Number(counter.get('next') ?? 1)
        transaction.set(counterRef, { next: number + 1 }, { merge: true })
        transaction.set(orderRef, {
          number,
          status: 'pending',
          channel: 'pos',
          registerId,
          // WHO COMPED IT (AGL-2161). `totals.discountCents` recorded that
          // a discount happened and nothing recorded who asked for it or on
          // what basis — `decoded.uid` was read once, for the role gate, and
          // written nowhere. A 100% comp was therefore indistinguishable from
          // a correctly-priced sale after the fact, on the one channel where
          // the operator is standing in front of the goods.
          //
          // Written only when there IS a discount, so ordinary sales keep
          // their current shape: `gift-cards.ts` already audits this way
          // (`issuedBy`, `voidedBy`), and this is the same field for the same
          // reason.
          ...(discountPct > 0
            ? { discountPct, discountBy: decoded.uid }
            : {}),
          // The bucket the sale comes out of (AGL-286). The cash write below
          // has stored this since AGL-1808; the card sale needs it MORE — its
          // decrement runs in the webhook (AGL-1825), where the register's
          // chosen location exists nowhere but on this document.
          ...(locationId ? { locationId } : {}),
          lineItems,
          // `feeCents` is what the merchant's payout is short by, and it
          // belongs on the document that records the charge. Every tender
          // carries the fee since AGL-2111; this is the one that is netted
          // from the payout rather than invoiced, and `feeCollection` says so.
          totals: cardTotals,
          ...(feeCents > 0 ? { feeCollection } : {}),
          customerEmail: customerEmail || null,
          timeline: [{ atMs: Date.now(), event: 'pos-card-pending' }],
          createdAtMs: Date.now(),
          createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        })
      })
      // Stripe returns the cashier to the console POS page. This was
      // `/{hostDocId}/pos`, the pre-AGL-621/622 shape, so completing a card
      // sale dropped the register on a 404 (AGL-685). POS is the plugin
      // route keyed by org slug + host SUBDOMAIN; server code cannot call
      // useConsoleHostRoute, so resolve them here, and fall back to the
      // origin root rather than a fabricated dead path.
      const posOrigin = `https://${req.headers.host}`
      const posSubdomain = (
        await firestore.collection('hostIndex').doc(hostId).get()
      ).get('subdomain') as string | undefined
      const posOrgSlug = ownerOrg?.org?.slug as string | undefined
      const posUrl =
        posOrgSlug && posSubdomain
          ? `${posOrigin}${buildRoute(Route.HOST_PLUGIN, {
              orgSlug: posOrgSlug,
              host: posSubdomain,
              pluginSlug: 'pos',
            })}`
          : posOrigin
      const params = new URLSearchParams({
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(totals.totalCents),
        'line_items[0][price_data][product_data][name]': 'In-store purchase',
        'payment_intent_data[transfer_data][destination]': String(accountId),
        // Stripe rejects a zero application fee, so it is omitted rather than
        // sent as '0' — the same conditional `checkout.ts` uses (AGL-2110).
        ...(feeCents > 0
          ? { 'payment_intent_data[application_fee_amount]': String(feeCents) }
          : {}),
        success_url: `${posUrl}?paid=1`,
        cancel_url: `${posUrl}?paid=0`,
        'metadata[type]': 'commerce-draft',
        'metadata[hostId]': hostId,
        'metadata[orderId]': orderRef.id,
        // The tax WITNESS (AGL-1953). The whole sale goes over as one
        // "In-store purchase" line at `totals.totalCents`, so the origin tax
        // computed above is invisible to Stripe: `total_details.amount_tax`
        // is 0 and nothing on the session says any part of the charge was
        // tax. The figure survived on the order document, but no downstream
        // reader of the Stripe object could decompose it — including
        // `recordStorefrontTax`, which reads exactly this key and was
        // therefore recording every POS card sale as `taxMode: 'none'`.
        //
        // A witness only: the `commerce-draft` webhook branch does not
        // rebuild totals from the session (it folds in shipping alone), so
        // this cannot double-count against the stored order.
        'metadata[taxCents]': String(Math.max(0, taxCents)),
        // The fee WITNESS, the twin of the tax one above (AGL-2110): the
        // `commerce-draft` webhook branch that completes this order reads the
        // session, and without this key nothing on the Stripe object says
        // what Aglyn took. Recorded even at zero, so "the plan charges no
        // fee" is legible as a decision rather than as a missing field.
        'metadata[feeCents]': String(Math.max(0, feeCents)),
      })
      const response = await fetch(
        'https://api.stripe.com/v1/checkout/sessions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            // The half that costs real money (AGL-1691). Stripe replays the
            // existing session for a repeated key instead of opening a second
            // one on the merchant's live account, which covers the window
            // where our own claim is written but the response never arrives.
            ...(claim.stripeKey
              ? { 'Idempotency-Key': claim.stripeKey }
              : {}),
          },
          body: params.toString(),
        },
      )
      const session = (await response.json()) as {
        url?: string
        id?: string
        error?: any
      }
      if (!response.ok || !session.url) {
        await orderRef.delete().catch(() => undefined)
        // The sale did not happen — let the same key be tried again rather
        // than locking this basket out over one flaky moment.
        await claim.release()
        return res.status(502).json({ error: 'Payment link failed' })
      }
      // The session id, stored the way `draft-order.ts` has always stored it
      // (AGL-2244). Without it a cancelled QR sale has no handle on the Stripe
      // page still sitting on the customer's phone, so `cancel-order.ts` had
      // nothing to expire and the register could take the money twice.
      await orderRef
        .set({ checkoutSessionId: session.id ?? null }, { merge: true })
        .catch(() => undefined)
      const cardPayload = {
        orderId: orderRef.id,
        url: session.url,
        totals: cardTotals,
        // AGL-2357. Present on both tenders and on the recorded replay, so a
        // cashier who re-submits the same key still sees what they were told
        // the first time.
        ...(stockWarnings.length > 0 ? { stockWarnings } : {}),
      }
      await claim.record(200, cardPayload)
      return res.status(200).json(cardPayload)
    }

    // Cash (or folio) sale: paid immediately. Tender validation for both ran
    // above, before the claim.
    const orderRef = hostRef.collection('orders').doc()
    const counterRef = hostRef.collection('counters').doc('orders')
    // Held in a local so the folio branch below can re-state the timeline with
    // a second event appended rather than blind-writing over this one.
    const paidEvent = {
      atMs: Date.now(),
      event: 'paid',
      detail:
        payment === 'folio'
          ? `Charged to reservation ${reservationId}`
          : `Cash — received $${(cashReceivedCents / 100).toFixed(2)}, ` +
            `change $${((cashReceivedCents - totals.totalCents) / 100).toFixed(2)}`,
    }
    await firestore.runTransaction(async (transaction) => {
      const counter = await transaction.get(counterRef)
      const number = Number(counter.get('next') ?? 1)
      transaction.set(counterRef, { next: number + 1 }, { merge: true })
      transaction.set(orderRef, {
        number,
        status: 'paid',
        channel: 'pos',
        registerId,
        // WHO COMPED IT (AGL-2161). `totals.discountCents` recorded that
        // a discount happened and nothing recorded who asked for it or on
        // what basis — `decoded.uid` was read once, for the role gate, and
        // written nowhere. A 100% comp was therefore indistinguishable from
        // a correctly-priced sale after the fact, on the one channel where
        // the operator is standing in front of the goods.
        //
        // Written only when there IS a discount, so ordinary sales keep
        // their current shape: `gift-cards.ts` already audits this way
        // (`issuedBy`, `voidedBy`), and this is the same field for the same
        // reason.
        ...(discountPct > 0
          ? { discountPct, discountBy: decoded.uid }
          : {}),
        // The bucket the decrement below comes out of (AGL-1808). Without it
        // a cancellation can only put the units back on the flat total, which
        // the next location-aware write recomputes away.
        ...(locationId ? { locationId } : {}),
        lineItems,
        totals,
        // AGL-2111: the fee is on `totals` for this tender too, and this says
        // it will arrive on the org's Aglyn invoice rather than as a short
        // payout — there is no payout, the merchant kept the cash.
        ...(feeCents > 0 ? { feeCollection } : {}),
        customerEmail: customerEmail || null,
        timeline: [paidEvent],
        ...(payment === 'folio' ? { reservationId } : {}),
        createdAtMs: Date.now(),
        createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      // ACCRUED IN THE SAME TRANSACTION AS THE ORDER (AGL-2111), so an order
      // and the fee it owes cannot diverge: either both land or neither does.
      // A separate write after the commit would drop the accrual on any crash
      // in the window and under-bill silently, which is the failure mode this
      // whole issue is about.
      //
      // `increment` rather than read-modify-write: two registers can ring
      // simultaneously, and a lost update here is lost revenue.
      if (feeCents > 0 && offlineFeeRef) {
        transaction.set(
          offlineFeeRef,
          {
            month: offlineFeeMonth,
            feeCents: firebaseAdmin.firestore.FieldValue.increment(feeCents),
            orders: firebaseAdmin.firestore.FieldValue.increment(1),
          },
          { merge: true },
        )
      }
    })

    // Folio (AGL-317): the stay settles the charge at check-out. The guest
    // identity behind `folioGuestEmail`/`folioGuestName` was read above, before
    // the claim (AGL-1757, hoisted by AGL-1760).
    if (payment === 'folio') {
      // AGL-1760: `update()`, never `set(..., { merge: true })`. A merge-set
      // against a missing path CREATES the document, which is how a typo or a
      // stale id used to mint a phantom stay — a `reservations/{id}` doc
      // holding one folio line and nothing else: no guest, no dates, no room,
      // invisible to a picker that filters on `status` and `NaN`-valued to the
      // availability maths that reads `checkInDayMs`. `update()` rejects on a
      // missing document instead of creating it, so the stub is not reachable
      // by any argument. Same defect `a7a2d90df` fixed for bookings; the guard
      // differs because that handler already had a transaction and a status to
      // read, whereas here existence is the only question and `update` IS the
      // check — atomic, and without a second read.
      //
      // The validation above makes a missing stay unreachable in practice.
      // What is left is the race — a manager deleting it in the window between
      // the two — and every other reason a write fails, which the old
      // `.catch(() => undefined)` swallowed indistinguishably. The sale is
      // committed by then, so this cannot refuse; and a paid sale must never be
      // lost, nor an orphaned attribution be silent. So the order stands
      // untouched and says so on its own timeline, which the console order
      // dialog renders. The note claims only what is known — that the line is
      // on no folio — rather than diagnosing why.
      await hostRef
        .collection('reservations')
        .doc(reservationId)
        .update({
          folio: firebaseAdmin.firestore.FieldValue.arrayUnion({
            orderId: orderRef.id,
            amountCents: totals.totalCents,
            note: lineItems
              .map((line) => `${line.quantity}× ${line.name}`)
              .join(', ')
              .slice(0, 120),
            atMs: Date.now(),
          }),
        })
        .catch(async (error) => {
          console.error('Folio append failed', reservationId, error)
          await orderRef
            .set(
              {
                timeline: [
                  paidEvent,
                  {
                    atMs: Date.now(),
                    event: 'folio-unattached',
                    detail:
                      `Not recorded on reservation ${reservationId} — this ` +
                      `$${(totals.totalCents / 100).toFixed(2)} charge is on ` +
                      'no stay’s folio. Collect it at the register.',
                  },
                ],
              },
              { merge: true },
            )
            .catch(() => undefined)
        })
    }

    // Inventory decrement per line (location-aware, AGL-286).
    for (const line of lineItems) {
      const product = productsById.get(line.productId)
      if (!product) continue
      const variantId = line.variantId ?? product.variants[0]?.id
      const tracked = product.variants.some(
        (variant) => variant.id === variantId && variant.inventory != null,
      )
      if (!variantId || !tracked) continue
      // Two lines of one product must COMPOUND (AGL-1828): the next line
      // starts from these variants, not from the product as first read —
      // recomputing from the original would erase this decrement when the
      // sibling line's merge-set landed, while the ledger below recorded
      // both. Same carry-forward as the webhook's POS card loop (AGL-1825).
      //
      // ATOMIC since AGL-2320, and the register is the channel that needed it
      // most: `productsById` was read at the top of this handler, before the
      // register quota check, the pricing pass, the settlement claim, the order
      // transaction and the folio append. A shopper's webhook landing anywhere
      // in that window had its decrement overwritten by this merge-set — two
      // sales, one unit off the shelf, both in the ledger. The transaction's
      // re-read is what compounds the lines now, and it sees the other
      // channel's committed write too.
      //
      // The register still SELLS whatever is rung up. Refusing goods a cashier
      // is physically holding is a product decision, not this fix's (AGL-2320);
      // what the merchant gets instead is the oversold notification the helper
      // fires when the shelf could not cover the sale.
      const moved = await decrementVariantStock({
        firestore,
        hostRef,
        hostId,
        productId: line.productId,
        variantId,
        quantity: line.quantity,
        locationId: locationId || undefined,
        ledger: { reason: 'sale', orderId: orderRef.id },
      })
      if (!moved.before || !moved.after) continue
      productsById.set(line.productId, moved.after)
      // Low-stock crossing alert (AGL-1826): the register — the channel most
      // likely to be selling down the last few units of physical shelf
      // stock — used to cross the threshold silently while the buy-now
      // button alerted. The compounded pair above means two lines of one
      // product cross exactly once, on the line that breaches; the
      // `claimAttempt` bounds a replayed settlement.
      alertLowStockCrossing(hostId, moved.before, moved.after)
    }
    // AGL-1757: the register's email box is optional, and a room charge is
    // exactly the sale nobody stops to re-ask an email for — so a stay's
    // ancillary revenue, the part a guest house most wants to see per guest,
    // was the part most likely to be anonymous. Fall back to the reservation's
    // guest, and prefer a TYPED address when there is one: a cashier
    // correcting the guest's address should beat stale reservation data.
    //
    // The guest's name rides along only when the address we are attributing to
    // IS the reservation's guest — if the cashier redirected the receipt to
    // some other address, that person is not the named guest. Passing it is
    // safe either way: `mergeContactInteraction` keeps an existing name, so
    // this fills a blank and never clobbers a better one.
    //
    // Nothing is invented. A walk-in reservation (`guestEmail: null`) leaves
    // this empty and no contact is created — the right answer, not a gap. The
    // other case AGL-1757 handled here, a `reservationId` pointing at nothing,
    // no longer arrives: AGL-1760 refuses that sale above, before the claim.
    const contactEmail = customerEmail || folioGuestEmail
    const contactName =
      contactEmail && contactEmail === folioGuestEmail ? folioGuestName : ''
    if (contactEmail) {
      // AWAITED, AND ITS FAILURE SWALLOWED (AGL-2473). `void` meant the
      // contact write was a promise nobody held: a serverless container is
      // free to freeze the moment the response is written, so on a cold-ish
      // instance the attribution simply did not happen, silently and
      // unreproducibly. Awaiting is what makes it durable.
      //
      // A BARE `await` would have been worse than the bug. This line sits
      // PAST the point of no return — the order is committed, the cash is in
      // the drawer, the stock is decremented — so letting a rejection reach
      // the `catch` below would answer a completed sale with a 500, release
      // the settlement claim, and invite the cashier to ring the same basket
      // again on the same key. A duplicate paid order is a far larger defect
      // than a missing contact row. So the failure is logged and dropped
      // here, and the sale still returns 200.
      await upsertHostContact({
        hostId,
        email: contactEmail,
        ...(contactName ? { name: contactName } : {}),
        source: 'order',
        // AGL-1748: the amount was formatted into the summary STRING below and
        // never passed to the field that exists to hold it, so `ltvCents`
        // counted online sales only — a shop-counter merchant's best customers
        // all ranked at zero. `totals.totalCents` is what the cashier actually
        // took (items + tax - discount, from `computeOrderTotals` above), not a
        // figure re-derived from the product docs.
        //
        // Gross of the platform fee and gross of refunds, matching the cart,
        // buy-now and subscription call sites; see the module note in
        // `upsert-contact.ts`. Replay safety is the `claimAttempt` above: this
        // line is past the point of no return, so a keyed double-submit never
        // reaches it, and a KEYLESS one already wrote a second order document
        // long before it got here — `purchaseCents` adds no hazard the order
        // write does not already have.
        purchaseCents: totals.totalCents,
        interaction: {
          refId: orderRef.id,
          // `source` stays `'order'` for both (AGL-1757): a folio sale is a
          // shop sale that happens to be settled against a stay, and the
          // reservation's own `'booking'` interaction already exists. Only the
          // human-readable summary distinguishes them, so a merchant reading
          // the timeline can tell a counter sale from a room charge.
          summary:
            payment === 'folio'
              ? `Room charge ($${(totals.totalCents / 100).toFixed(2)})`
              : `In-store purchase ($${(totals.totalCents / 100).toFixed(2)})`,
        },
      }).catch((error) => {
        console.error('[pos-order] contact upsert failed', error)
      })
    }
    const cashPayload = {
      orderId: orderRef.id,
      totals,
      changeCents:
        payment === 'cash' ? cashReceivedCents - totals.totalCents : 0,
      ...(stockWarnings.length > 0 ? { stockWarnings } : {}),
    }
    await claim.record(200, cashPayload)
    return res.status(200).json(cashPayload)
  } catch (error) {
    console.error(error)
    // Release on the way out so a transient failure does not strand the key
    // (AGL-1691). The order write itself may or may not have landed; the
    // cashier reconciles from the orders list, which is the same position
    // they were in before this endpoint had a claim at all.
    await claim?.release()
    return res.status(500).json({ error: 'Sale failed' })
  }
}

/**
 * The billing month a non-card POS fee accrues into (AGL-2111): `YYYY-MM` in
 * **UTC**, byte-identical to the key `apps/console/utils/billing-month.ts`
 * mints and to the twelve other month counters on the platform
 * (`orgs/{id}/apiUsage/*`, `orgs/{id}/assistUsage/*`, the per-host counters).
 *
 * It has to be UTC and it has to be this exact expression: `report-usage`
 * sweeps `previousMonth()` in UTC and reads the accrual document by that key,
 * so a local-time month would strand every sale rung in the offset window on a
 * document no sweep ever looks at — which is uncollected revenue that leaves
 * no trace. `offline-pos-fee-month-key.spec.ts` pins the two against each
 * other rather than trusting the comment.
 *
 * Local rather than imported because `apps/console` is an app: a plugin
 * library cannot import from it, and the repo's other eleven copies of this
 * one-liner are the established shape.
 */
export function offlineFeeMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}
