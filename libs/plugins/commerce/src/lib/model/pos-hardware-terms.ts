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

import { LEGAL_ORIGIN } from '@aglyn/aglyn/app-utils/published-legal-pages'

/*==========================================
 * THE TERMS OF SALE AT THE BOOTH (AGL-4038).
 *
 * The platform sells card readers in person under its published Terms,
 * Sections 4.26 to 4.32. Section 4.28 says how a buyer agrees: before paying,
 * they accept those terms electronically — on the register tablet handed to
 * them, or on the register's customer display — and where that can't be done
 * (no power, no connection), the receipt and a sign at the booth state that
 * the sale is made under them, and paying is agreeing.
 *
 * So a register sale of hardware carries `hardwareTermsAcceptance`: which
 * version of the Terms, when, how (`tablet`, `display`, or `notice` for the
 * receipt-and-sign route), the register user who handed it over, and the
 * device's address and browser, as a signature's audit does. The hardware
 * order the sale becomes copies it (`termsAcceptance`).
 *
 * `POS_HARDWARE_TERMS_VERSION` is the Terms version whose Sections 4.26–4.32
 * the summary below follows. It moves only when those sections change; a
 * console spec holds it at or below the published version.
 *=========================================*/

/** The published Terms version the summary and every acceptance name. */
export const POS_HARDWARE_TERMS_VERSION = 'v20'

/** The sections of the Terms that are the terms of sale for hardware. */
export const POS_HARDWARE_TERMS_SECTIONS = '4.26–4.32'

/** The published Terms, where the full text is. */
export function posHardwareTermsUrl(): string {
  return `${LEGAL_ORIGIN}/legal/terms`
}

/** The Terms' address as a receipt or a sign prints it: `example.com/legal/terms`. */
export function posHardwareTermsAddress(): string {
  try {
    return `${new URL(LEGAL_ORIGIN).host}/legal/terms`
  } catch {
    return '/legal/terms'
  }
}

/**
 * What the buyer reads before accepting: Sections 4.26–4.32 in short, in the
 * published text's own order and terms, with the link to the whole. Never
 * instead of it: the acceptance is of the Terms, which this summarizes.
 */
export const POS_HARDWARE_TERMS_SUMMARY: readonly string[] = [
  'We are the seller of this hardware. It is for use in a business in the United States, not for personal, family or household use, and you may not resell it.',
  'Ownership and the risk of loss pass to you when the hardware is handed to you. Sales tax is charged at the rate our register charges for this sale.',
  'You may return it within 30 days of buying it, in its original packaging and condition with all its accessories. You pay the return shipping, and any restocking fee Stripe charges us for the return comes off the refund.',
  'For one year we warrant it, other than cables and other accessories, against defects in materials and workmanship under normal use. Repair or replacement is the only remedy.',
  'Its software is Stripe’s, under Stripe’s terms. It needs an internet connection you provide, and its price does not include any internet or cellular data service.',
  'Apart from that warranty, the hardware is provided as is, and our liability for it is limited to the amount you paid for it.',
]

/** How a buyer agreed to the terms of sale. */
export type PosHardwareTermsMethod = 'tablet' | 'display' | 'notice'

/** `hardwareTermsAcceptance` on a register sale, and `termsAcceptance` on the hardware order. */
export interface PosHardwareTermsAcceptance {
  version: string
  sections: string
  method: PosHardwareTermsMethod
  atMs: number
  /** The register user who handed the tablet over or put the terms on the display; null for a notice. */
  staffUid: string | null
  /** The address and browser of the device the buyer accepted on; null for a notice. */
  ip: string | null
  userAgent: string | null
}

const METHODS: readonly PosHardwareTermsMethod[] = ['tablet', 'display', 'notice']

/** An acceptance as stored, or null for anything that is not one. */
export function posHardwareTermsAcceptanceOf(raw: unknown): PosHardwareTermsAcceptance | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const method = String(value['method'] ?? '') as PosHardwareTermsMethod
  const atMs = Number(value['atMs'])
  if (!METHODS.includes(method) || !Number.isFinite(atMs) || atMs <= 0) return null
  const text = (field: string, max: number) =>
    typeof value[field] === 'string' && (value[field] as string) ? (value[field] as string).slice(0, max) : null
  return {
    version: text('version', 20) ?? POS_HARDWARE_TERMS_VERSION,
    sections: text('sections', 40) ?? POS_HARDWARE_TERMS_SECTIONS,
    method,
    atMs,
    staffUid: text('staffUid', 128),
    ip: text('ip', 100),
    userAgent: text('userAgent', 400),
  }
}

/** A fresh acceptance of the current terms of sale. */
export function posHardwareTermsAcceptance(input: {
  method: PosHardwareTermsMethod
  atMs: number
  staffUid?: string | null
  ip?: string | null
  userAgent?: string | null
}): PosHardwareTermsAcceptance {
  return {
    version: POS_HARDWARE_TERMS_VERSION,
    sections: POS_HARDWARE_TERMS_SECTIONS,
    method: input.method,
    atMs: input.atMs,
    staffUid: input.method === 'notice' ? null : (input.staffUid ?? null),
    ip: input.method === 'notice' ? null : (input.ip ?? null)?.slice(0, 100) ?? null,
    userAgent: input.method === 'notice' ? null : (input.userAgent ?? null)?.slice(0, 400) ?? null,
  }
}

/** Whether a register sale sells hardware: marked when rung, or recorded since. */
export function isPosHardwareRegisterSale(order: { hardwareSalePending?: unknown; hardwareOrderId?: unknown } | null | undefined): boolean {
  return order?.hardwareSalePending === true || (typeof order?.hardwareOrderId === 'string' && Boolean(order.hardwareOrderId))
}

/**
 * The line every receipt of a register sale of hardware prints (Section
 * 4.28's fallback, printed whether or not the buyer also accepted
 * electronically): which terms the sale is made under, and that paying is
 * agreeing to them. Null on every other sale.
 */
export function posHardwareReceiptNotice(
  order: { hardwareSalePending?: unknown; hardwareOrderId?: unknown } | null | undefined,
): string | null {
  if (!isPosHardwareRegisterSale(order)) return null
  return (
    `Card reader hardware on this receipt is sold under ${posHardwareTermsAddress()}, ` +
    `Sections ${POS_HARDWARE_TERMS_SECTIONS}. By paying for it you agree to those terms for this purchase.`
  )
}

/** A receipt footer with the terms notice after it, for a sale of hardware. */
export function withPosHardwareReceiptNotice(
  footer: string | null | undefined,
  order: { hardwareSalePending?: unknown; hardwareOrderId?: unknown } | null | undefined,
): string {
  return [String(footer ?? '').trim(), posHardwareReceiptNotice(order)].filter(Boolean).join('\n')
}
