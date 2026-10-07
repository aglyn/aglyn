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

import type { PluginConfigSchema } from '@aglyn/aglyn'
import { posTipPercentages } from './model/commerce-pos'

/**
 * The ceiling a register may discount to, when the merchant has not set one
 * (AGL-2161).
 *
 * 100, i.e. today's behaviour exactly. That is deliberate and is the one
 * number in this fix that is NOT a safety judgement:
 *
 * - A full comp is a legitimate register operation — a damaged item, a
 *   goodwill gesture, a staff meal — and every merchant on the platform has
 *   had it since POS shipped.
 * - Any lower default would change what merchants charge their own customers
 *   on the day it deployed, without them asking. Picking that number is a
 *   merchant policy decision, not a bug fix, and inventing one here would be
 *   the same class of mistake as inventing a billing rate.
 *
 * What AGL-2161 actually fixes is that there was no ceiling to set and no
 * refusal when one was exceeded: the request body's `discountPct` was clamped
 * into range and rung up, so a register sending `150` silently comped the
 * whole sale. The ceiling is now real, enforced server-side, refused rather
 * than clamped, and one config value away from being lower.
 */
export const POS_MAX_DISCOUNT_PCT_DEFAULT = 100

/**
 * Commerce plugin config schema (AGL-428 framework, AGL-2161 adopter).
 *
 * PURE DATA (type-only aglyn import), the same shape as bookings': the client
 * barrel registers it via '@aglyn/aglyn' and the /server entry via
 * '@aglyn/aglyn/server', so neither bundle drags in the other's barrel.
 *
 * `min`/`max` are not decoration — `mergePluginConfig` coerces a stored value
 * into the declared range and falls back to the default on junk, so the
 * ceiling itself cannot be forged out of bounds by a manager editing the
 * settings doc directly.
 */
export const COMMERCE_CONFIG_SCHEMA: PluginConfigSchema = {
  pluginId: 'commerce',
  fields: [
    {
      key: 'posMaxDiscountPct',
      label: 'Maximum register discount (%)',
      type: 'number',
      min: 0,
      max: 100,
      description:
        'The largest discount the point of sale will accept on a sale. ' +
        'A register that asks for more is refused, and the sale is not rung ' +
        'up. Set to 0 to stop staff discounting at the register entirely.',
    },
    // THE REGISTER'S TIPS, RECEIPTS AND CUSTOMER DISPLAY (AGL-3607, AGL-3608).
    // Off by default: a store that never asked for tips does not start
    // asking its customers for one on the day this ships.
    {
      key: 'posTippingEnabled',
      label: 'Ask for tips at the register',
      type: 'boolean',
      description:
        'Offers the customer a tip on the card reader and on the customer ' +
        'display. Tips are yours: they are not counted as sales and carry no ' +
        'platform fee.',
    },
    {
      key: 'posTipPercentages',
      label: 'Tip choices (%)',
      type: 'string',
      description:
        'Up to four percentages, separated by commas, shown to the customer ' +
        'as tip buttons. The customer can also enter an amount or choose no tip.',
    },
    {
      key: 'posReceiptDefault',
      label: 'Receipts at the register',
      type: 'select',
      options: [
        { value: 'ask', label: 'Ask the customer' },
        { value: 'print', label: 'Always print' },
        { value: 'none', label: 'No receipt unless asked' },
      ],
      description:
        'With a customer display paired, "Ask the customer" lets them choose ' +
        'email, print or no receipt on their own screen.',
    },
    {
      key: 'posDisplayMessage',
      label: 'Customer display welcome',
      type: 'string',
      description:
        'The line the customer display shows under your store name between ' +
        'sales. Leave blank for "Welcome".',
    },
    {
      key: 'posDisplayMarketingOptIn',
      label: 'Offer email sign-up on the customer display',
      type: 'boolean',
      description:
        'Shows an unticked "Email me news and offers" box when a customer ' +
        'asks for an email receipt. Only a ticked box adds them to your ' +
        'marketing audience.',
    },
  ],
  defaults: {
    posMaxDiscountPct: POS_MAX_DISCOUNT_PCT_DEFAULT,
    posTippingEnabled: false,
    posTipPercentages: '15, 18, 20, 25',
    posReceiptDefault: 'ask',
    posDisplayMessage: '',
    posDisplayMarketingOptIn: true,
  },
}

/** The register's tip, receipt and display settings, resolved for one site. */
export interface PosRegisterSettings {
  tippingEnabled: boolean
  tipPercentages: number[]
  receiptDefault: 'ask' | 'print' | 'none'
  displayMessage: string
  displayMarketingOptIn: boolean
}

/**
 * The register settings out of a merged commerce config, with every value
 * typed and bounded so the register, the display and the server agree.
 */
export function posRegisterSettings(
  config: Record<string, unknown> | null | undefined,
): PosRegisterSettings {
  const receipt = String(config?.['posReceiptDefault'] ?? 'ask')
  return {
    tippingEnabled: config?.['posTippingEnabled'] === true,
    tipPercentages: posTipPercentages(config?.['posTipPercentages']),
    receiptDefault:
      receipt === 'print' || receipt === 'none' ? receipt : 'ask',
    displayMessage: String(config?.['posDisplayMessage'] ?? '').trim().slice(0, 120),
    displayMarketingOptIn: config?.['posDisplayMarketingOptIn'] !== false,
  }
}

/**
 * The ceiling for one org, read defensively (AGL-2161).
 *
 * Spelled here rather than at the call site so the POS route and any later
 * reader cannot disagree about what a missing or malformed value means. The
 * framework has already clamped and defaulted by the time this runs; the
 * second `Number.isFinite` guard is for the schema-less case, where
 * `getPluginConfig` returns the raw doc untouched.
 */
export function posMaxDiscountPct(
  config: Record<string, unknown> | null | undefined,
): number {
  const raw = Number(config?.['posMaxDiscountPct'])
  if (!Number.isFinite(raw)) return POS_MAX_DISCOUNT_PCT_DEFAULT
  return Math.min(100, Math.max(0, raw))
}
