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
import { COMMERCE_MAX_OPTION_VALUES, COMMERCE_MAX_PRICE_USD } from '../model/commerce'
import {
  PRODUCT_DRAFT_NAME_MAX,
  PRODUCT_DRAFT_RESOURCE,
  PRODUCT_DRAFT_SEO_DESCRIPTION_MAX,
  PRODUCT_DRAFT_SEO_TITLE_MAX,
  PRODUCT_DRAFT_TAG_MAX,
} from './product-drafts'

/**
 * WHAT AN AI BUILD CAN MAKE IN COMMERCE (AGL-3616): a product, as a draft.
 *
 * The capability the AI plugin's build planner offers for "sell my candles".
 * Its item is written by this plugin's `product` draft writer, so every rule
 * is the writer's: the plan's `commerce` feature and product allowance, the
 * member's role, `validateProduct`. The product is born a draft with no
 * photo and — unless the request stated a price — no price, so nothing is on
 * the storefront until the merchant prices it and sets it to Active.
 *
 * The arguments are flat, as the contract requires: at most one option
 * (Size, Scent, …), which `draftContent` turns into the product's options.
 * No page block depends on it: a draft is on no storefront block until it is
 * activated, so a page placing one would show nothing.
 */

/** The operation's name in a build plan. */
export const PRODUCT_AI_OP = 'product'

/** The description a planner writes; the writer keeps longer ones a person writes. */
const PRODUCT_AI_DESCRIPTION_MAX = 1_200
/** The tags a planner proposes, as the AI products job proposes them. */
const PRODUCT_AI_TAGS_MAX = 8
/** The longest option name or value a planner writes. */
const PRODUCT_AI_OPTION_TEXT_MAX = 30

/** The writer's content for an item. */
export function productDraftContentFromArgs(args: PluginAiCapabilityArgs): Readonly<Record<string, unknown>> {
  const optionName = typeof args['optionName'] === 'string' ? args['optionName'].trim() : ''
  const optionValues = Array.isArray(args['optionValues']) ? (args['optionValues'] as readonly string[]) : []
  const copied = ['name', 'type', 'description', 'tags', 'seoTitle', 'seoDescription', 'priceUsd']
  return {
    ...Object.fromEntries(copied.filter((key) => args[key] !== undefined).map((key) => [key, args[key]])),
    // One half without the other is an option the writer refuses by name.
    ...(optionName || optionValues.length ? { options: [{ name: optionName, values: [...optionValues] }] } : {}),
  }
}

export const productAiCapability: PluginAiCapability = {
  op: PRODUCT_AI_OP,
  noun: 'product',
  where: 'Products → Catalog, as a draft',
  intents: [
    'products to sell, with a description, tags and options — created as drafts for you to price, photograph and activate',
  ],
  argsSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The product name a shopper reads.', maxLength: PRODUCT_DRAFT_NAME_MAX },
      type: {
        type: 'string',
        description: '"physical" ships, "digital" is a download, "service" is work done for the buyer.',
        enum: ['physical', 'digital', 'service'],
      },
      description: {
        type: 'string',
        description: 'What the product is and why someone wants it, in a short paragraph.',
        maxLength: PRODUCT_AI_DESCRIPTION_MAX,
      },
      tags: {
        type: 'array',
        description: 'A few lowercase words shoppers filter by.',
        items: { type: 'string', maxLength: PRODUCT_DRAFT_TAG_MAX },
        maxItems: PRODUCT_AI_TAGS_MAX,
      },
      optionName: {
        type: 'string',
        description: 'The one way the product varies, if it does, e.g. "Size". Leave out for a single product.',
        maxLength: PRODUCT_AI_OPTION_TEXT_MAX,
      },
      optionValues: {
        type: 'array',
        description: 'The choices for optionName, e.g. ["8 oz", "16 oz"].',
        items: { type: 'string', maxLength: PRODUCT_AI_OPTION_TEXT_MAX },
        maxItems: COMMERCE_MAX_OPTION_VALUES,
      },
      seoTitle: { type: 'string', description: 'The search listing title.', maxLength: PRODUCT_DRAFT_SEO_TITLE_MAX },
      seoDescription: {
        type: 'string',
        description: 'The search listing description.',
        maxLength: PRODUCT_DRAFT_SEO_DESCRIPTION_MAX,
      },
      priceUsd: {
        type: 'number',
        description: 'The price in dollars, ONLY when the request states it; otherwise leave it out for the merchant to set.',
        minimum: 0,
        maximum: COMMERCE_MAX_PRICE_USD,
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
  maxPerPlan: 12,
  // Free includes no commerce and no products (`productsPerHost: 0`).
  freeAllowed: false,
  feature: 'commerce',
  quota: 'productsPerHost',
  draftResource: PRODUCT_DRAFT_RESOURCE,
  // Written without a model: the planner already filled the arguments.
  estimateCredits: () => 0,
  degrade: 'omit',
  draftContent: (item) => productDraftContentFromArgs(item.args),
}

/**
 * Registers the capability; the console surface calls it beside the writer,
 * since only the console runs AI jobs (AGL-3026). Idempotent.
 */
export function registerProductAiCapability(): void {
  registerPluginAiCapability(productAiCapability, { pluginId: BUNDLE_ID })
}
