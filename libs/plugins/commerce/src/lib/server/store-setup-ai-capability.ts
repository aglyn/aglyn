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
  registerPluginAiCapability,
  type PluginAiCapability,
  type PluginAiCapabilityArgs,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { BUNDLE_ID } from '../constants/bundle-common'
import { COMMERCE_MAX_PRICE_USD } from '../model/commerce'
import {
  LOCAL_DELIVERY_POSTCODES_MAX,
  PICKUP_HOURS_MAX,
  PICKUP_INSTRUCTIONS_MAX,
} from '../model/local-fulfillment-settings'
import {
  STORE_SETUP_COUNTRIES_MAX,
  STORE_SETUP_LOCATION_MAX,
  STORE_SETUP_MAX_MINUTES,
  STORE_SETUP_NAME_MAX,
  STORE_SETUP_RESOURCE,
  STORE_SHIPPING_ACTIONS,
  STORE_SHIPPING_AI_KINDS,
  STORE_SHIPPING_TIERS_MAX,
  STORE_TAX_LABEL_MAX,
  STORE_TAX_MODES,
  type StoreSetupSection,
} from '../model/store-setup-content'

/**
 * WHAT AN AI BUILD CAN SET UP IN A STORE (AGL-3749): shipping zones and
 * rates, local pickup, local delivery and sales tax — "free shipping over $50,
 * otherwise $5 flat in the US", "offer local pickup at our Austin shop",
 * "charge 8.25% Texas sales tax".
 *
 * Four operations the AI plugin's build planner offers, all written by this
 * plugin's `store-settings` writer (`store-setup-ai-writer.ts`), so every
 * change is the console cards' own: the role that may save them, the plan's
 * `commerce` feature, lockdown, and the cards' normalizers and checks. No
 * model runs: the planner fills the arguments and they ARE the change, so an
 * item costs no credits.
 *
 * NEVER A NUMBER THE PERSON DID NOT GIVE. A blank flat rate charges nothing
 * and a tax rate is the merchant's legal call, so every amount and
 * percentage is "only when the request states it", and the writer refuses a
 * rate without one. A request to "set up tax" that says neither how nor what
 * rate is left out of the plan rather than guessed at.
 *
 * NEVER AN ACCOUNT. Carrier rates, label services and outside tax services
 * need a person to connect an account; none of them is offered here.
 *
 * Settings are live once written: the cards save them live, and a store
 * setting has no draft. `live` tells the build step so (it lands with the
 * shared contract from AGL-3745; until then the field is carried and unread).
 * Free has no commerce, so a Free workspace's build is never offered one.
 */

type LiveCapability = PluginAiCapability & { live?: boolean }

export const STORE_SHIPPING_AI_OP = 'store-shipping'
export const STORE_PICKUP_AI_OP = 'store-pickup'
export const STORE_DELIVERY_AI_OP = 'store-delivery'
export const STORE_TAX_AI_OP = 'store-tax'

/** Where a person finds what the build set. */
const WHERE = 'Products → Settings'

/** The writer's content for an item: its arguments, tagged with the section its op changes. */
export function storeSetupContentFromArgs(
  section: StoreSetupSection,
  args: PluginAiCapabilityArgs,
): Readonly<Record<string, unknown>> {
  const content: Record<string, unknown> = { section }
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || value === '') continue
    content[key] = value
  }
  return content
}

const STATED = 'ONLY when the request states it; never a typical or suggested amount.'

/** What every store-setup operation shares. */
function storeSetupCapability(
  op: string,
  section: StoreSetupSection,
  rest: Pick<PluginAiCapability, 'noun' | 'intents' | 'argsSchema' | 'maxPerPlan'>,
): LiveCapability {
  return {
    op,
    where: WHERE,
    ...rest,
    // Free includes no commerce.
    freeAllowed: false,
    feature: 'commerce',
    draftResource: STORE_SETUP_RESOURCE,
    live: true,
    // Written without a model: the planner already filled the arguments.
    estimateCredits: () => 0,
    degrade: 'omit',
    draftContent: (item) => storeSetupContentFromArgs(section, item.args),
  }
}

export const storeShippingAiCapability = storeSetupCapability(STORE_SHIPPING_AI_OP, 'shipping', {
  noun: 'shipping rate',
  intents: [
    'store shipping: a shipping zone (countries) and its rate — flat, free over an order total, or tiered by order total or weight; change or remove a rate or zone. Live once the build runs. Amounts only as the request states them',
  ],
  argsSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'set (the default) adds or replaces the rate named rateName in the zone; remove deletes that rate, or the whole zone and its rates when rateName is left out.',
        enum: STORE_SHIPPING_ACTIONS,
      },
      zoneName: {
        type: 'string',
        description: 'The shipping zone, e.g. "United States" or "Rest of world". An existing zone is matched by this name or by the same countries.',
        maxLength: STORE_SETUP_NAME_MAX,
      },
      countries: {
        type: 'array',
        description: 'Two-letter country codes the zone ships to (["US"], ["US","CA"]), or ["*"] for everywhere no other zone names. Required for a new zone.',
        items: { type: 'string', maxLength: 2 },
        maxItems: STORE_SETUP_COUNTRIES_MAX,
      },
      rateName: {
        type: 'string',
        description: 'What the shopper sees at checkout, e.g. "Standard". Required for set.',
        maxLength: STORE_SETUP_NAME_MAX,
      },
      kind: {
        type: 'string',
        description:
          'flat: one price. free_over: free at or above an order subtotal, otherwise amountUsd. price_tiers: priced by order subtotal. weight_tiers: priced by parcel weight in grams. Required for set.',
        enum: STORE_SHIPPING_AI_KINDS,
      },
      amountUsd: {
        type: 'number',
        description: `flat: the price; free_over: the price below the threshold. In dollars, 0 for free. ${STATED}`,
        minimum: 0,
        maximum: COMMERCE_MAX_PRICE_USD,
      },
      freeOverUsd: {
        type: 'number',
        description: `free_over: the order subtotal in dollars at which shipping becomes free. ${STATED}`,
        minimum: 0,
        maximum: COMMERCE_MAX_PRICE_USD,
      },
      tiers: {
        type: 'array',
        description: `price_tiers and weight_tiers: "upTo:price" entries — upTo is the subtotal in dollars (price_tiers) or grams (weight_tiers), price in dollars, e.g. ["50:5", "100:8"]. A larger order than the last tier gets no rate from it. ${STATED}`,
        items: { type: 'string', maxLength: 24 },
        maxItems: STORE_SHIPPING_TIERS_MAX,
      },
    },
    required: ['zoneName'],
    additionalProperties: false,
  },
  maxPerPlan: 10,
})

export const storePickupAiCapability = storeSetupCapability(STORE_PICKUP_AI_OP, 'pickup', {
  noun: 'pickup setting',
  intents: [
    'store local pickup: let buyers collect orders free, at the store or at a named store location with its pickup hours and arrival instructions; switch pickup off. Live once the build runs',
  ],
  argsSchema: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description:
          'The store location buyers collect from — its name, city or street, e.g. "Austin" — which must already be one of the store’s inventory locations. Leave out for a plain "Local pickup" choice at checkout with no location.',
        maxLength: STORE_SETUP_LOCATION_MAX,
      },
      enabled: { type: 'boolean', description: 'false to stop offering pickup; leave out to offer it.' },
      hours: {
        type: 'string',
        description: 'With location: pickup hours as the request gives them, one set of days per line or separated by ";", e.g. "Mo-Fr 09:00-17:00; Sa 10:00-14:00".',
        maxLength: PICKUP_HOURS_MAX,
      },
      instructions: {
        type: 'string',
        description: 'With location: what the buyer does on arrival, as the request says it.',
        maxLength: PICKUP_INSTRUCTIONS_MAX,
      },
      readyWithinMinutes: {
        type: 'integer',
        description: 'With location: how long an order usually takes to prepare, in minutes, when the request says.',
        minimum: 0,
        maximum: STORE_SETUP_MAX_MINUTES,
      },
    },
    additionalProperties: false,
  },
  maxPerPlan: 5,
})

export const storeDeliveryAiCapability = storeSetupCapability(STORE_DELIVERY_AI_OP, 'local-delivery', {
  noun: 'local delivery setting',
  intents: [
    'store local delivery the merchant does themselves: delivery zones by postal code with a fee, a minimum and a free-over amount, delivery windows and instructions; switch it off. Live once the build runs. Fees only as the request states them',
  ],
  argsSchema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', description: 'false to stop offering local delivery; leave out to offer it.' },
      country: { type: 'string', description: 'The two-letter country the store delivers within, e.g. US.', maxLength: 2 },
      location: {
        type: 'string',
        description: 'The inventory location orders leave from, by name or city, when the request names one.',
        maxLength: STORE_SETUP_LOCATION_MAX,
      },
      zoneName: {
        type: 'string',
        description: 'The delivery zone to add, change or remove, e.g. "Downtown".',
        maxLength: STORE_SETUP_NAME_MAX,
      },
      postcodes: {
        type: 'array',
        description: 'The zone’s postal codes: exact ("78701"), a prefix ("787*") or a range ("78701-78705"). Required for a new zone.',
        items: { type: 'string', maxLength: 24 },
        maxItems: LOCAL_DELIVERY_POSTCODES_MAX,
      },
      feeUsd: {
        type: 'number',
        description: `The zone’s delivery fee in dollars, 0 for free. Required for a new zone. ${STATED}`,
        minimum: 0,
        maximum: COMMERCE_MAX_PRICE_USD,
      },
      minimumUsd: { type: 'number', description: `The smallest order the zone delivers, in dollars. ${STATED}`, minimum: 0, maximum: COMMERCE_MAX_PRICE_USD },
      freeOverUsd: { type: 'number', description: `Order total in dollars at which delivery is free. ${STATED}`, minimum: 0, maximum: COMMERCE_MAX_PRICE_USD },
      removeZone: { type: 'boolean', description: 'true to remove the zone named zoneName.' },
      windows: {
        type: 'string',
        description: 'Delivery windows as the request gives them, e.g. "Mo-Fr 09:00-12:00; Sa 10:00-14:00". Delivery is offered only with at least one window.',
        maxLength: PICKUP_HOURS_MAX,
      },
      leadTimeMinutes: {
        type: 'integer',
        description: 'How long before a window an order must be placed, in minutes, when the request says.',
        minimum: 0,
        maximum: STORE_SETUP_MAX_MINUTES,
      },
      daysAhead: { type: 'integer', description: 'How many days ahead a window can be booked (1 to 30), when the request says.', minimum: 1, maximum: 30 },
      instructions: { type: 'string', description: 'What the buyer is told about delivery, as the request says it.', maxLength: PICKUP_INSTRUCTIONS_MAX },
    },
    additionalProperties: false,
  },
  maxPerPlan: 5,
})

export const storeTaxAiCapability = storeSetupCapability(STORE_TAX_AI_OP, 'tax', {
  noun: 'tax setting',
  intents: [
    'store sales tax: collect it at the manual rate the request states for a country or state, calculate it automatically, or not collect it; whether prices include tax; where the store sells from. Live once the build runs. Never a rate the request does not state — "set up tax" alone is a question back, not an item',
  ],
  argsSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        description:
          'manual: the rates the merchant states. stripe: automatic calculation per buyer location, ONLY when the request asks for automatic tax. none: the store does not collect sales tax, ONLY when the request says so. Leave out to keep the store’s choice.',
        enum: STORE_TAX_MODES,
      },
      pricesIncludeTax: {
        type: 'boolean',
        description: 'true when the request says prices already include tax (VAT-style); false when it says tax is added on top.',
      },
      originCountry: {
        type: 'string',
        description: 'The two-letter country the store sells from, e.g. US. Manual rates need it.',
        maxLength: 2,
      },
      originState: { type: 'string', description: 'The state or region the store sells from, e.g. TX.', maxLength: 3 },
      rateCountry: { type: 'string', description: 'The two-letter country a tax rate applies to.', maxLength: 2 },
      rateState: {
        type: 'string',
        description: 'The state or region a tax rate applies to, e.g. TX; leave out for the whole country.',
        maxLength: 3,
      },
      ratePercent: {
        type: 'number',
        description: `The tax rate in percent, e.g. 8.25. ${STATED}`,
        minimum: 0,
        maximum: 100,
      },
      rateLabel: { type: 'string', description: 'The receipt label, e.g. "TX sales tax".', maxLength: STORE_TAX_LABEL_MAX },
      removeRate: { type: 'boolean', description: 'true to remove the rate for rateCountry (and rateState).' },
    },
    additionalProperties: false,
  },
  maxPerPlan: 6,
})

export const STORE_SETUP_AI_CAPABILITIES: readonly LiveCapability[] = [
  storeShippingAiCapability,
  storePickupAiCapability,
  storeDeliveryAiCapability,
  storeTaxAiCapability,
]

/**
 * Registers the four operations; the console surface calls it beside the
 * writer, since only the console runs AI jobs (AGL-3026). Idempotent.
 */
export function registerStoreSetupAiCapabilities(): void {
  for (const capability of STORE_SETUP_AI_CAPABILITIES) {
    registerPluginAiCapability(capability, { pluginId: BUNDLE_ID })
  }
}
