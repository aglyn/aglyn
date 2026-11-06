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

import {
  isPosHardwareSkuId,
  parsePosHardwareInPersonConfig,
  POS_HARDWARE_MAX_PER_LINE,
  POS_HARDWARE_MAX_UNITS,
  type PosHardwareSkuId,
} from '../model/pos-hardware'
import {
  POS_HARDWARE_TERMS_REQUIRED,
  posHardwareTermsConfirmed,
  posHardwareTermsFromMetadata,
  type PosHardwareTermsAcceptance,
} from '../model/pos-hardware-terms'

/*==========================================
 * THE MARK A REGISTER SALE OF HARDWARE CARRIES (AGL-4038).
 *
 * Every path that writes a register sale — an open sale, a payment link, a
 * cash or room sale, the kiosk's cart, an offline sale synced later — spreads
 * these fields into the order it writes. On the platform's own store, a sale
 * with a line whose product is a hardware item says `hardwareSalePending`
 * from the moment it exists, and the hardware order is recorded when it is
 * paid. The completion listener clears the mark; one it missed is found by
 * the mark and recorded on the next sweep, so a sale is never lost because a
 * listener failed after the money was taken.
 *
 * Read on every sale of every store, so it costs nothing anywhere but the
 * seller: the environment is read first, and the products are the ones the
 * sale already loaded.
 *=========================================*/

export function posHardwareSaleFields(
  input: {
    hostId: string
    orgId: string | null | undefined
    lineItems: ReadonlyArray<{ productId: string }>
    products: ReadonlyMap<string, { hardwareSku?: unknown } | null | undefined>
  },
  env: Record<string, string | undefined> = process.env,
): { hardwareSalePending?: true } {
  const config = parsePosHardwareInPersonConfig(env)
  if (!config || config.sellerHostId !== input.hostId || config.sellerOrgId !== input.orgId) return {}
  const sellsHardware = input.lineItems.some((line) =>
    isPosHardwareSkuId(input.products.get(line.productId)?.hardwareSku),
  )
  return sellsHardware ? { hardwareSalePending: true } : {}
}

/*==========================================
 * THE PLATFORM'S OWN ONLINE STORE SELLS HARDWARE TOO (AGL-4038).
 *
 * A product on the seller store that names a hardware item sells online
 * through the store's ordinary product page, cart and checkout, and the order
 * becomes a hardware order exactly as a register sale does: marked when it is
 * written ({@link posHardwareSaleFields}, `hardwareSalePending`), recorded
 * by the same recorder the register's completion listener runs
 * ({@link recordSellerStoreSaleHardware}), and found again by the same sweep.
 *
 * At checkout, before anything is held or charged
 * ({@link sellerStoreHardwareCheckout}):
 *   - each hardware line carries the tangible goods tax code;
 *   - the buyer must have ticked the terms of sale and business use, or the
 *     checkout is refused with one plain sentence and `needsHardwareTerms`;
 *   - the online order limits of the terms of sale hold: at most
 *     {@link POS_HARDWARE_MAX_PER_LINE} of an item and
 *     {@link POS_HARDWARE_MAX_UNITS} items of hardware in one order.
 * Every other store, and every other line, is untouched.
 *=========================================*/

/** What a checkout on any store is told about the hardware in it. */
export interface SellerStoreHardwareCheckout {
  /** Whether any line is hardware on the platform's own store. */
  hardware: boolean
  /** The hardware item of each line, by its index in the lines given; null for any other line. */
  skus: Array<PosHardwareSkuId | null>
  /** Why the checkout is refused, before anything is held or charged; null when it is not. */
  refusal: { status: number; error: string; needsHardwareTerms?: true } | null
}

/**
 * Reads a checkout's lines for hardware on the platform's own store. Answers
 * `hardware: false` for every other store, from the environment alone.
 */
export function sellerStoreHardwareCheckout(
  input: {
    hostId: string
    orgId: string | null | undefined
    lines: ReadonlyArray<{ productId: string; quantity: number }>
    products: ReadonlyMap<string, { hardwareSku?: unknown } | null | undefined>
    /** The request's `hardwareTerms`: both boxes ticked, or not. */
    hardwareTerms: unknown
    /** A recurring checkout: hardware is bought once. */
    subscription?: boolean
  },
  env: Record<string, string | undefined> = process.env,
): SellerStoreHardwareCheckout {
  const config = parsePosHardwareInPersonConfig(env)
  const none: SellerStoreHardwareCheckout = { hardware: false, skus: input.lines.map(() => null), refusal: null }
  if (!config || config.sellerHostId !== input.hostId || config.sellerOrgId !== input.orgId) return none
  const skus = input.lines.map((line) => {
    const sku = input.products.get(line.productId)?.hardwareSku
    return isPosHardwareSkuId(sku) ? sku : null
  })
  if (!skus.some(Boolean)) return none
  if (input.subscription) {
    return { hardware: true, skus, refusal: { status: 400, error: 'Card reader hardware is bought once, not by subscription.' } }
  }
  const perItem = new Map<string, number>()
  input.lines.forEach((line, index) => {
    const sku = skus[index]
    if (sku) perItem.set(sku, (perItem.get(sku) ?? 0) + Math.max(0, Math.round(Number(line.quantity) || 0)))
  })
  const units = [...perItem.values()].reduce((sum, quantity) => sum + quantity, 0)
  if ([...perItem.values()].some((quantity) => quantity > POS_HARDWARE_MAX_PER_LINE) || units > POS_HARDWARE_MAX_UNITS) {
    return {
      hardware: true,
      skus,
      refusal: {
        status: 400,
        error: `One order holds at most ${POS_HARDWARE_MAX_PER_LINE} of each card reader or accessory, and ${POS_HARDWARE_MAX_UNITS} in all.`,
      },
    }
  }
  if (!posHardwareTermsConfirmed(input.hardwareTerms)) {
    return { hardware: true, skus, refusal: { status: 400, error: POS_HARDWARE_TERMS_REQUIRED, needsHardwareTerms: true } }
  }
  return { hardware: true, skus, refusal: null }
}

/**
 * The hardware fields a paid online order on the seller store is written
 * with: the mark, and the terms of sale the buyer ticked at checkout, dated
 * when the session was made. Nothing for any other order.
 */
export function storefrontHardwareSaleFields(
  input: {
    hostId: string
    orgId: string | null | undefined
    lineItems: ReadonlyArray<{ productId: string }>
    products: ReadonlyMap<string, { hardwareSku?: unknown } | null | undefined>
    /** The paid Checkout Session's metadata and creation time (Stripe's seconds). */
    metadata: unknown
    createdSeconds: unknown
  },
  env: Record<string, string | undefined> = process.env,
): { hardwareSalePending?: true; hardwareTermsAcceptance?: PosHardwareTermsAcceptance } {
  const mark = posHardwareSaleFields(input, env)
  if (!mark.hardwareSalePending) return {}
  const createdMs = Number(input.createdSeconds) > 0 ? Number(input.createdSeconds) * 1000 : Date.now()
  const acceptance = posHardwareTermsFromMetadata(input.metadata, createdMs)
  return { ...mark, ...(acceptance ? { hardwareTermsAcceptance: acceptance } : {}) }
}

/**
 * {@link storefrontHardwareSaleFields} for the webhook that writes a paid
 * online order: the store's workspace is asked for (`orgIdOf`) only when
 * the store is the configured seller, so every other store's order costs
 * nothing more. Never throws: an unreadable workspace leaves the order
 * unmarked, as any other store's.
 */
export async function sellerStoreOrderHardwareFields(
  input: Omit<Parameters<typeof storefrontHardwareSaleFields>[0], 'orgId'> & {
    orgIdOf: () => Promise<string | null | undefined>
  },
  env: Record<string, string | undefined> = process.env,
): Promise<ReturnType<typeof storefrontHardwareSaleFields>> {
  if (parsePosHardwareInPersonConfig(env)?.sellerHostId !== input.hostId) return {}
  const orgId = await input.orgIdOf().catch(() => null)
  return storefrontHardwareSaleFields(
    {
      hostId: input.hostId,
      orgId,
      lineItems: input.lineItems,
      products: input.products,
      metadata: input.metadata,
      createdSeconds: input.createdSeconds,
    },
    env,
  )
}

/**
 * Records the hardware order of a paid sale on the platform's own store —
 * a register sale or an online order — once, through the one recorder. Every
 * other store's sale is answered from the environment alone, without loading
 * it. Never throws: a sale this misses stays marked, and the sweep records it.
 */
export async function recordSellerStoreSaleHardware(
  event: { hostId: string; orderId: string; offline?: boolean },
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  if (parsePosHardwareInPersonConfig(env)?.sellerHostId !== event.hostId) return
  try {
    await (await import('./pos-hardware-in-person')).recordCompletedSaleHardware(event)
  } catch (error) {
    console.error('[pos-hardware-in-person] recorder not loaded', event.orderId, error)
  }
}
