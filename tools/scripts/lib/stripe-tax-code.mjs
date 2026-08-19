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
 * THE TAX CODE ON AGLYN'S OWN PRODUCTS (AGL-1877, for AGL-1811).
 *
 * Every live Stripe product on this account carries `tax_code:
 * 'txcd_10103001'` — "Software as a service (SaaS) — business use", which
 * under the Texas position is a **data processing service**, taxable on 20% of
 * the charge (an 80% exemption). It is the single input that decides how much
 * Texas sales tax Aglyn collects from September 1 and remits on the return.
 *
 * Until this module, that string appeared **nowhere in the repository**. It
 * had been set by hand in the Stripe Dashboard, on the products that happened
 * to exist at the time, and:
 *
 *  - `setup-stripe.mjs` created products with `name` and `metadata[plan]`
 *    only, so **any new tier it provisions ships with the account default**
 *    and is taxed on the full base — a wrong return, with no symptom anyone
 *    would see short of reconciling a filing;
 *  - **no TEST-mode product carries it at all**, measured 2026-08-19: a test
 *    subscription's invoice came back `taxability_reason: 'standard_rated'`
 *    with `taxable_amount` equal to the whole charge, where live would answer
 *    `taxable_basis_reduced` on 20% of it. So the one environment in which
 *    the tax position can safely be rehearsed was rehearsing a **different
 *    position**, and `platform-revenue.ts` — which documents
 *    `taxable_basis_reduced` as the shape it stores — could never see it;
 *  - nothing asserted any of it.
 *
 * This module is the one place the code lives, so the provisioning script,
 * the audit and this file's test all read the same string.
 *
 * NOT A PRICING CHANGE. The charged price is untouched and locked; tax is
 * collected on top and held for the state.
 */
export const PLATFORM_TAX_CODE = 'txcd_10103001'

/**
 * Products this account owns that are missing the tax code, or carrying a
 * different one.
 *
 * Takes the product list rather than fetching it, so the audit, the setup
 * script and the test all ask the same question of whatever they hold.
 *
 * `active: false` products are INCLUDED when they are still referenced by a
 * live price — an archived product whose price is still on a subscription
 * still bills, and still gets taxed. The caller decides what it holds; this
 * function does not silently drop anything.
 *
 * Returns `{ id, name, taxCode }` rows, never throws, and treats a malformed
 * list as empty — an audit that crashes on a shape it did not expect reports
 * nothing, which reads exactly like a clean account.
 */
export function productsMissingTaxCode(products, expected = PLATFORM_TAX_CODE) {
  if (!Array.isArray(products)) return []
  const missing = []
  for (const product of products) {
    if (!product || typeof product !== 'object') continue
    const taxCode =
      typeof product.tax_code === 'string'
        ? product.tax_code
        : (product.tax_code?.id ?? null)
    if (taxCode === expected) continue
    missing.push({
      id: String(product.id ?? ''),
      name: String(product.name ?? ''),
      taxCode: taxCode ?? null,
    })
  }
  return missing
}
