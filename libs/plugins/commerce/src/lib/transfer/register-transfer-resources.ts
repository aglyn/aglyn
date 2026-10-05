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

import type { TransferCatalogInput } from '@aglyn/aglyn/data-transfer'
import {
  registerPluginTransferResource,
  type PluginTransferResource,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  PRODUCT_ALIAS_DICTIONARIES,
  PRODUCT_DERIVED_FIELDS,
  PRODUCT_LOCKED_RULES,
  PRODUCT_MATCH_KEYS,
  PRODUCT_STANDARD_FIELDS,
  PRODUCT_SYSTEM_FIELDS,
  PRODUCT_TRANSFER_GROUPS,
  SHOPIFY_PRODUCT_PRESET,
  type ProductPlannedRow,
} from './product-transfer'
import {
  CATEGORY_MATCH_KEYS,
  CATEGORY_TRANSFER_FIELDS,
  COUPON_MATCH_KEYS,
  COUPON_TRANSFER_FIELDS,
  DISCOUNT_MATCH_KEYS,
  DISCOUNT_TRANSFER_FIELDS,
  GIFT_CARD_MATCH_KEYS,
  GIFT_CARD_TRANSFER_FIELDS,
  ORDER_TRANSFER_FIELDS,
  ORDER_TRANSFER_GROUPS,
  type GiftCardPlannedRow,
} from './records-transfer'
import {
  COMMERCE_CATEGORIES_TRANSFER,
  COMMERCE_COUPONS_TRANSFER,
  COMMERCE_DISCOUNTS_TRANSFER,
  COMMERCE_GIFT_CARDS_TRANSFER,
  COMMERCE_ORDERS_TRANSFER,
  COMMERCE_PRODUCTS_TRANSFER,
} from './transfer-keys'

/*
 * THE SERVER HALVES, REGISTERED AT BOOT (AGL-3531), from the console's
 * server declarations — the transfer routes are the console's alone. What a
 * route reads before any record (fields, keys, dictionaries, presets, rules)
 * is data from the pure modules; every hook that touches the store loads its
 * module the first time a job or an export asks.
 */

const productsServer = () => import('./products.server')
const recordsServer = () => import('./records.server')
const giftCardsServer = () => import('./gift-cards.server')

/** A resource whose store-touching hooks load `pick(module)` on first use. */
function deferred(
  load: () => Promise<PluginTransferResource>,
  data: Pick<PluginTransferResource, 'fields' | 'matchKeys' | 'aliases' | 'presets' | 'lockedRules' | 'invariants'>,
  hooks: ReadonlyArray<'count' | 'picklists' | 'addPicklistValues' | 'plan'> = ['count'],
): PluginTransferResource {
  const call =
    <K extends keyof PluginTransferResource>(name: K) =>
    async (...args: unknown[]) => {
      const impl = await load()
      const hook = impl[name] as unknown as (...rest: unknown[]) => unknown
      return hook(...args)
    }
  return {
    ...data,
    readPage: call('readPage') as PluginTransferResource['readPage'],
    lookup: call('lookup') as PluginTransferResource['lookup'],
    apply: call('apply') as PluginTransferResource['apply'],
    revert: call('revert') as PluginTransferResource['revert'],
    ...Object.fromEntries(hooks.map((name) => [name, call(name)])),
  }
}

const catalog = (input: TransferCatalogInput) => () => input

export function registerCommerceTransferResources(): void {
  registerPluginTransferResource(
    COMMERCE_PRODUCTS_TRANSFER,
    {
      fields: catalog({
        standard: PRODUCT_STANDARD_FIELDS,
        derived: PRODUCT_DERIVED_FIELDS,
        system: PRODUCT_SYSTEM_FIELDS,
        groups: PRODUCT_TRANSFER_GROUPS,
      }),
      matchKeys: PRODUCT_MATCH_KEYS,
      aliases: PRODUCT_ALIAS_DICTIONARIES,
      presets: [SHOPIFY_PRODUCT_PRESET],
      lockedRules: () => PRODUCT_LOCKED_RULES,
      invariants: [
        {
          id: 'product-storable',
          label: 'A product the store can hold',
          check: (row) => (row as ProductPlannedRow).commerce?.problem ?? null,
        },
      ],
      count: async (ctx, options) => (await productsServer()).countProductRows(ctx, options),
      readPage: async (ctx, cursor, fieldIds, options) =>
        (await productsServer()).readProductsPage(ctx, cursor, fieldIds, options),
      lookup: async (ctx, requests) => (await productsServer()).lookupProducts(ctx, requests),
      picklists: async (ctx, ids) => (await productsServer()).productPicklists(ctx, ids),
      addPicklistValues: async (ctx, id, values) => (await productsServer()).addProductCategories(ctx, id, values),
      plan: async (ctx, input) => (await productsServer()).planProducts(ctx, input),
      apply: async (ctx, chunk, writer) =>
        (await productsServer()).applyProducts(ctx, chunk as Parameters<typeof import('./products.server').applyProducts>[1], writer),
      revert: async (ctx, snapshot, decisions) => (await productsServer()).revertProducts(ctx, snapshot, decisions),
    },
    { pluginId: BUNDLE_ID },
  )

  registerPluginTransferResource(
    COMMERCE_CATEGORIES_TRANSFER,
    deferred(async () => (await recordsServer()).categoriesTransfer, {
      fields: catalog({ standard: CATEGORY_TRANSFER_FIELDS }),
      matchKeys: CATEGORY_MATCH_KEYS,
    }, ['count', 'plan']),
    { pluginId: BUNDLE_ID },
  )

  registerPluginTransferResource(
    COMMERCE_ORDERS_TRANSFER,
    deferred(async () => (await recordsServer()).ordersTransfer, {
      fields: catalog({ standard: ORDER_TRANSFER_FIELDS, groups: ORDER_TRANSFER_GROUPS }),
      matchKeys: [{ fieldId: 'id', normalizer: 'aglynId' }],
      invariants: [
        {
          id: 'orders-export-only',
          label: 'Orders are exported only',
          check: () =>
            'Orders are exported, never imported: an order is the record of a sale, written by checkout, the register or a paid draft.',
        },
      ],
    }),
    { pluginId: BUNDLE_ID },
  )

  registerPluginTransferResource(
    COMMERCE_DISCOUNTS_TRANSFER,
    deferred(
      async () => (await recordsServer()).discountsTransfer,
      { fields: catalog({ standard: DISCOUNT_TRANSFER_FIELDS }), matchKeys: DISCOUNT_MATCH_KEYS },
      ['count', 'plan', 'picklists'],
    ),
    { pluginId: BUNDLE_ID },
  )

  registerPluginTransferResource(
    COMMERCE_COUPONS_TRANSFER,
    deferred(
      async () => (await recordsServer()).couponsTransfer,
      { fields: catalog({ standard: COUPON_TRANSFER_FIELDS }), matchKeys: COUPON_MATCH_KEYS },
      ['count', 'plan'],
    ),
    { pluginId: BUNDLE_ID },
  )

  // Imported by ISSUING each card (AGL-3551): the plan decides each card and
  // the total, and a row it refuses is failed here with the reason.
  registerPluginTransferResource(
    COMMERCE_GIFT_CARDS_TRANSFER,
    deferred(
      async () => (await giftCardsServer()).giftCardsTransfer,
      {
        fields: catalog({ standard: GIFT_CARD_TRANSFER_FIELDS }),
        matchKeys: GIFT_CARD_MATCH_KEYS,
        invariants: [
          {
            id: 'gift-card-issuable',
            label: 'A gift card the store can issue',
            check: (row) => (row as GiftCardPlannedRow).giftCard?.problem ?? null,
          },
        ],
      },
      ['count', 'plan'],
    ),
    { pluginId: BUNDLE_ID },
  )
}
