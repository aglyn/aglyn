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

/**
 * The console routes, under the `tax-engines` prefix. A card reaches them as
 * `/api/<route>`; the server registers the same strings.
 */
export const TAX_ENGINES_API_ROUTES = {
  /** GET: whether the deployment can hold a connection, and the site's. */
  connection: 'tax-engines/connection',
  /** POST: save credentials, test them, and connect. */
  connect: 'tax-engines/connect',
  /** POST: test the stored credentials again. */
  test: 'tax-engines/test',
  /** POST: forget the credentials. */
  disconnect: 'tax-engines/disconnect',
  /** POST: ship-from address, default tax code, recording switch. */
  settings: 'tax-engines/settings',
  /** POST: the engine's reading of an address. */
  addressValidate: 'tax-engines/address/validate',
  /** GET / POST: one product's tax code. */
  productTaxCode: 'tax-engines/product-tax-code',
  /** GET: the site's exempt customers. POST: save one. */
  exemptions: 'tax-engines/exemptions',
  /** POST: remove one exempt customer. */
  exemptionsDelete: 'tax-engines/exemptions/delete',
  /** GET: how one order stands with the engine. */
  orderTransaction: 'tax-engines/order-transaction',
  /** POST: record one order with the engine again. */
  orderTransactionRetry: 'tax-engines/order-transaction/retry',
} as const

export type TaxEnginesRoute = (typeof TAX_ENGINES_API_ROUTES)[keyof typeof TAX_ENGINES_API_ROUTES]
