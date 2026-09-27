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
 * A product's smart-collection membership, for plain Node scripts (AGL-3321).
 *
 * The storefront reads a smart collection no query can express as
 * `collectionIds array-contains <id>`, and every product writer stamps that
 * array with `productCollectionIds`
 * (`libs/plugins/commerce/src/lib/model/commerce.ts`). A backfill cannot
 * import it, yet must stamp exactly what it stamps, so this is its ONE
 * script-side restatement — the rule matcher, the price range it compares and
 * the legacy lift a stored product is read through.
 *
 * Both sides are held to `product-collection-ids.fixtures.json`: the commerce
 * spec `smart-collection-membership.spec.ts` asserts it against the library,
 * and `product-collection-ids.test.mjs` (`npm run test:product-collection-ids`)
 * against this.
 */

/**
 * `liftLegacyProduct`, as far as membership reads it: a product with no
 * variants is a Commerce Starter doc with a flat price and defaults.
 *
 * @param {Record<string, any>} raw
 */
export function liftForMembership(raw) {
  if (Array.isArray(raw.variants) && raw.variants.length > 0) return raw
  const priceUsd = Number(raw.priceUsd ?? 0)
  return {
    ...raw,
    name: raw.name ?? 'Product',
    type: raw.type ?? 'physical',
    variants: [{ id: 'default', priceUsd: Number.isFinite(priceUsd) ? priceUsd : 0 }],
  }
}

/** `productPriceRange`: the lowest and highest variant price. */
function priceRange(product) {
  const prices = (product.variants ?? [])
    .map((variant) => Number(variant?.priceUsd))
    .filter((price) => Number.isFinite(price) && price >= 0)
  if (prices.length === 0) return [0, 0]
  return [Math.min(...prices), Math.max(...prices)]
}

/** `ruleMatches`. */
function ruleMatches(product, rule) {
  const value = rule.value
  switch (rule.field) {
    case 'tag': {
      const has = (product.tags ?? []).includes(String(value))
      return rule.op === 'neq' ? !has : has
    }
    case 'categoryId': {
      const has = (product.categoryIds ?? []).includes(String(value))
      return rule.op === 'neq' ? !has : has
    }
    case 'priceUsd': {
      const [min, max] = priceRange(product)
      const numeric = Number(value)
      if (!Number.isFinite(numeric)) return false
      if (rule.op === 'lt') return min < numeric
      if (rule.op === 'gt') return max > numeric
      if (rule.op === 'neq') return min !== numeric || max !== numeric
      return min <= numeric && numeric <= max
    }
    case 'name': {
      const name = String(product.name ?? '').toLowerCase()
      const needle = String(value).toLowerCase()
      if (rule.op === 'contains') return name.includes(needle)
      if (rule.op === 'neq') return name !== needle
      return name === needle
    }
    case 'type': {
      const matches = product.type === value
      return rule.op === 'neq' ? !matches : matches
    }
    default:
      return false
  }
}

/**
 * `smartCollectionMatches`: whether the product's own fields answer the
 * collection's rules. No rules holds nothing.
 *
 * @param {Record<string, any>} product
 * @param {{ rules?: any[], matchAll?: boolean }} collection
 */
export function smartCollectionMatches(product, collection) {
  const rules = collection.rules ?? []
  if (rules.length === 0) return false
  const matcher = (rule) => ruleMatches(product, rule)
  return collection.matchAll === false ? rules.some(matcher) : rules.every(matcher)
}

/**
 * `productCollectionIds`: the sorted ids of the smart collections a product
 * answers.
 *
 * @param {Record<string, any>} product
 * @param {ReadonlyArray<{ id: string, rules?: any[], matchAll?: boolean }>} smartCollections
 * @returns {string[]}
 */
export function productCollectionIds(product, smartCollections) {
  return smartCollections
    .filter((collection) => smartCollectionMatches(product, collection))
    .map((collection) => collection.id)
    .sort()
}
