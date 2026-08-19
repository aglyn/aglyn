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

import type { OrgPlan } from '@aglyn/aglyn/server'
import {
  addonKindFromPriceId,
  addonPriceId,
  findPlanItem,
  isMeteredPriceId,
  type AddonKind,
  type BillingInterval,
} from './billing-addons'

/** One item as a `subscription_schedules` phase wants it. */
export interface PhaseItem {
  price: string
  quantity?: number
}

export interface TargetItemPlan {
  /** The item list, plan item first, metered item last. */
  items: PhaseItem[]
  /** Recognised add-on kinds the target plan does not sell. */
  droppedAddons: AddonKind[]
  /**
   * Price ids on the subscription that are neither the plan item, the metered
   * item, nor a recognised add-on — carried through verbatim, and REPORTED so
   * the carry-through is visible rather than assumed.
   */
  unrecognizedPriceIds: string[]
}

/**
 * The item list a subscription's items become on a TARGET plan/interval — the
 * absolute list a schedule phase needs (AGL-2150).
 *
 * The instant-switch path builds a DELTA (`items[n][id]` + a new price) and so
 * leaves anything it does not recognise exactly where it is. A schedule phase
 * is an ABSOLUTE list: whatever is not written is gone at the flip. Building
 * it from the recognised kinds alone therefore deleted, silently and at
 * renewal, every item `addonKindFromPriceId` cannot classify — and that
 * function resolves purely by comparing against the CURRENT env values, so it
 * misses a legacy add-on whose env var was rotated or unset, a price attached
 * by hand in the Stripe dashboard, a negotiated line item, and the POS-register
 * / event-calendar flat add-ons in any environment where those env names are
 * not configured. Every one of those is recurring revenue.
 *
 * So unknown items pass through VERBATIM, which is the instant path's posture,
 * and they come back named so the caller can log and report them.
 *
 * The plan item is identified positively by `findPlanItem` (AGL-1340) and
 * replaced by `targetPlanPrice`; the metered item is excluded here and
 * re-attached from `meteredPrice` so it follows the target interval
 * (AGL-635/1340).
 */
export function buildTargetItems(
  items: readonly any[] | null | undefined,
  options: {
    targetPlan: OrgPlan
    targetInterval: BillingInterval
    targetPlanPrice: string
    meteredPrice: string | null
  },
): TargetItemPlan {
  const list = items ?? []
  const planItem = findPlanItem<any>(list)
  const result: PhaseItem[] = [{ price: options.targetPlanPrice, quantity: 1 }]
  const droppedAddons: AddonKind[] = []
  const unrecognizedPriceIds: string[] = []
  for (const item of list) {
    if (planItem && item === planItem) continue
    const priceId = item?.price?.id
    if (isMeteredPriceId(priceId)) continue
    const kind = addonKindFromPriceId(priceId)
    if (kind) {
      const target = addonPriceId(kind, options.targetPlan, options.targetInterval)
      if (target) result.push({ price: target, quantity: item?.quantity ?? 1 })
      else droppedAddons.push(kind)
      continue
    }
    // An item with no price id cannot be restated at all — Stripe would reject
    // the phase. Reported, never invented.
    if (!priceId) continue
    unrecognizedPriceIds.push(String(priceId))
    result.push({
      price: String(priceId),
      ...(item?.quantity != null ? { quantity: Number(item.quantity) } : {}),
    })
  }
  if (options.meteredPrice) result.push({ price: options.meteredPrice })
  return { items: result, droppedAddons, unrecognizedPriceIds }
}

/** A live subscription's items, as phase items. */
export function subscriptionItemsAsPhaseItems(
  items: readonly any[] | null | undefined,
): PhaseItem[] {
  const phaseItems: PhaseItem[] = []
  for (const item of items ?? []) {
    const priceId = item?.price?.id
    if (!priceId) continue
    phaseItems.push({
      price: String(priceId),
      ...(item?.quantity != null ? { quantity: Number(item.quantity) } : {}),
    })
  }
  return phaseItems
}

/** A schedule phase's own items (phase items carry `price` as an id). */
export function phaseItemsOf(phase: any): PhaseItem[] {
  const phaseItems: PhaseItem[] = []
  for (const item of phase?.items ?? []) {
    const priceId =
      typeof item?.price === 'string' ? item.price : item?.price?.id
    if (!priceId) continue
    phaseItems.push({
      price: String(priceId),
      ...(item?.quantity != null ? { quantity: Number(item.quantity) } : {}),
    })
  }
  return phaseItems
}

/** Writes `phases[index][items][…]` for an absolute item list. */
export function writePhaseItems(
  params: URLSearchParams,
  index: number,
  items: readonly PhaseItem[],
): void {
  items.forEach((item, itemIndex) => {
    params.set(`phases[${index}][items][${itemIndex}][price]`, item.price)
    if (item.quantity != null) {
      params.set(
        `phases[${index}][items][${itemIndex}][quantity]`,
        String(item.quantity),
      )
    }
  })
}

/**
 * Restates the terms Stripe put on the schedule's current phase but that a
 * phase-list replacement would otherwise drop (AGL-2146).
 *
 * `subscription_schedules` update REPLACES the whole phase list, so anything
 * not written back is gone. The original restatement covered price, quantity
 * and the phase window — which meant a downgrade silently ended the customer's
 * coupon, their trial, and the tax/collection configuration.
 *
 * The discount is the one that costs money in both directions: an org holding
 * a staff coupon, a checkout promotion code, or the winback the retention
 * funnel just minted lost it at the flip, having been told nothing. An instant
 * UPGRADE never touches subscription discounts, so a downgrade must not
 * either — which is why the discount is restated on the target phase too and a
 * time-boxed coupon keeps running its remaining months across the change.
 *
 * `trial_end` and `automatic_tax` are restated only when `current`: on the
 * CREATE path the target phase is derived from phase 0 and a trial must not
 * restart at the flip, while the target phase sets its own tax flag
 * explicitly. Restating an EXISTING phase passes `current: true` for it too —
 * there the values are the phase's own.
 */
export function preservePhaseTerms(
  params: URLSearchParams,
  index: number,
  phase: any,
  options: { current: boolean },
): void {
  const prefix = `phases[${index}]`
  // Both shapes: `discounts` is the current list-valued field, `coupon` the
  // singular legacy one older API versions still return.
  const discounts: any[] = Array.isArray(phase?.discounts) ? phase.discounts : []
  let written = 0
  for (const entry of discounts) {
    const coupon =
      typeof entry?.coupon === 'string' ? entry.coupon : entry?.coupon?.id
    const promotionCode =
      typeof entry?.promotion_code === 'string'
        ? entry.promotion_code
        : entry?.promotion_code?.id
    if (coupon) {
      params.set(`${prefix}[discounts][${written}][coupon]`, String(coupon))
      written += 1
    } else if (promotionCode) {
      params.set(
        `${prefix}[discounts][${written}][promotion_code]`,
        String(promotionCode),
      )
      written += 1
    }
  }
  if (written === 0 && phase?.coupon) {
    const legacy =
      typeof phase.coupon === 'string' ? phase.coupon : phase.coupon?.id
    if (legacy) params.set(`${prefix}[coupon]`, String(legacy))
  }
  if (phase?.collection_method) {
    params.set(`${prefix}[collection_method]`, String(phase.collection_method))
  }
  const paymentMethod =
    typeof phase?.default_payment_method === 'string'
      ? phase.default_payment_method
      : phase?.default_payment_method?.id
  if (paymentMethod) {
    params.set(`${prefix}[default_payment_method]`, String(paymentMethod))
  }
  if (!options.current) return
  if (phase?.trial_end) {
    params.set(`${prefix}[trial_end]`, String(phase.trial_end))
  }
  if (phase?.automatic_tax?.enabled != null) {
    params.set(
      `${prefix}[automatic_tax][enabled]`,
      phase.automatic_tax.enabled ? 'true' : 'false',
    )
  }
}

/**
 * Restates an EXISTING phase of a schedule read back from Stripe, optionally
 * replacing its item list.
 *
 * Used when a schedule has to be rewritten for a reason unrelated to its
 * phases — an add-on purchase changing the subscription's items (AGL-2150).
 * The update replaces the whole phase list, so every phase has to be written
 * back, and everything on it that is not restated is dropped: the window, the
 * `metadata[plan]` the webhook mirror reads at the flip, the discount, the
 * trial and the tax posture.
 */
export function restateExistingPhase(
  params: URLSearchParams,
  index: number,
  phase: any,
  overrideItems?: readonly PhaseItem[],
): void {
  const prefix = `phases[${index}]`
  writePhaseItems(params, index, overrideItems ?? phaseItemsOf(phase))
  if (phase?.start_date) {
    params.set(`${prefix}[start_date]`, String(phase.start_date))
  }
  if (phase?.end_date) {
    params.set(`${prefix}[end_date]`, String(phase.end_date))
  }
  for (const [key, value] of Object.entries(phase?.metadata ?? {})) {
    if (value != null) {
      params.set(`${prefix}[metadata][${key}]`, String(value))
    }
  }
  preservePhaseTerms(params, index, phase, { current: true })
}
