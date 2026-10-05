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

/*
 * THE COMMERCE TRANSFER RESOURCES (AGL-3531), by the key each is declared
 * under in `plugins.config.json` (`transferResources`). Every one is a site's
 * records (`scope: host`); the console's lists open the import wizard and the
 * export dialog on these keys through the core launcher.
 *
 * | key | import | why |
 * | -- | -- | -- |
 * | products | yes | matched by handle, then SKU, then ID; a match is updated |
 * | categories | yes | matched by slug, then name, then ID |
 * | discounts | yes | matched by code, then name, then ID; new ones start switched off |
 * | coupons | yes | matched by code; new ones start switched off |
 * | orders | no | an order is the record of a sale, written by checkout alone |
 * | gift cards | no | a balance is money a shopper can spend; it is issued, never imported |
 */

export const COMMERCE_PRODUCTS_TRANSFER = 'commerce.products'
export const COMMERCE_ORDERS_TRANSFER = 'commerce.orders'
export const COMMERCE_DISCOUNTS_TRANSFER = 'commerce.discounts'
export const COMMERCE_COUPONS_TRANSFER = 'commerce.coupons'
export const COMMERCE_GIFT_CARDS_TRANSFER = 'commerce.gift-cards'
export const COMMERCE_CATEGORIES_TRANSFER = 'commerce.categories'

/** Every commerce resource key, in the order the hub lists them. */
export const COMMERCE_TRANSFER_RESOURCES = [
  COMMERCE_PRODUCTS_TRANSFER,
  COMMERCE_CATEGORIES_TRANSFER,
  COMMERCE_ORDERS_TRANSFER,
  COMMERCE_DISCOUNTS_TRANSFER,
  COMMERCE_COUPONS_TRANSFER,
  COMMERCE_GIFT_CARDS_TRANSFER,
] as const

/** The resources a file may write; the others are exported only. */
export const COMMERCE_IMPORTABLE_TRANSFERS: ReadonlySet<string> = new Set([
  COMMERCE_PRODUCTS_TRANSFER,
  COMMERCE_CATEGORIES_TRANSFER,
  COMMERCE_DISCOUNTS_TRANSFER,
  COMMERCE_COUPONS_TRANSFER,
])
