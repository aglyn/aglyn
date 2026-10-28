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

import type { AiJobOutput, AiJobSummary } from './ai-jobs.types'
import { AI_PRODUCTS_BULK_MAX, aiProductsBulkBrief, aiProductsBulkInputs } from './ai-products-bulk'

export { AI_PRODUCTS_BULK_MAX, aiProductsBulkBrief }

/**
 * COMMERCE BY AI (AGL-2916): what a `products` job is asked, and what it
 * proposes. Pure, so the step that asks, the console cards that start a job
 * and show its proposals, and the eval harness all read one shape.
 *
 * `inputs.target` names the work:
 *
 * - `product` — one product's copy, from what its editor holds right now:
 *   the name, the text, the tags, the categories and options it has, and the
 *   first photo. The editor may hold a product nobody has saved yet, so the
 *   job never reads a product document for this target.
 * - `bulk` — the copy of up to `AI_PRODUCTS_BULK_MAX` saved products, one
 *   product a pass, each read from the catalog as it is reached.
 * - `catalog` — a store's first products from the brief: names, copy, tags
 *   and options, what each photo should show, and a suggested price by what
 *   the product is (`aiCatalogPrice`, Zach 2026-10-12). No picture.
 * - `categories` — store categories and a first set of discounts from the brief.
 *
 * Every output is a PROPOSAL (`resource: 'product'`, with `proposal`), and the
 * job writes nothing. The commerce plugin's own surfaces write what a person
 * accepts, through the doors those surfaces already use.
 */

export const AI_PRODUCTS_TARGETS = ['product', 'bulk', 'catalog', 'categories'] as const
export type AiProductsTarget = (typeof AI_PRODUCTS_TARGETS)[number]

export const AI_PRODUCT_TYPES = ['physical', 'digital', 'service'] as const
export type AiProductType = (typeof AI_PRODUCT_TYPES)[number]

/** The longest product name the editor saves. */
export const AI_PRODUCT_NAME_MAX_CHARS = 120

/** How much of a product's existing description a request carries. */
export const AI_PRODUCT_TEXT_MAX_CHARS = 2_000

/** The longest description the job proposes. */
export const AI_PRODUCT_DESCRIPTION_MAX_CHARS = 1_200

export const AI_PRODUCT_TAGS_MAX = 8
export const AI_PRODUCT_TAG_MAX_CHARS = 30

/** The most categories one product's proposal names. */
export const AI_PRODUCT_CATEGORIES_MAX = 3

/** The most of a site's categories a request lists to choose from. */
export const AI_PRODUCT_CATEGORY_LIST_MAX = 100

/** A product's option axes, as the commerce editor bounds them. */
export const AI_PRODUCT_OPTIONS_MAX = 3
export const AI_PRODUCT_OPTION_VALUES_MAX = 25
export const AI_PRODUCT_OPTION_NAME_MAX_CHARS = 30

/** How many products a catalog proposal holds. */
export const AI_CATALOG_PRODUCTS = { min: 1, max: 12 } as const

/**
 * A proposed product is shorter than a written one: its description and tags
 * are a start the owner completes, and twelve of them at every bound still fit
 * one answer (`ai-job-products-step.spec.ts` measures it).
 */
export const AI_CATALOG_DESCRIPTION_MAX_CHARS = 600
export const AI_CATALOG_TAGS_MAX = 6

/** A proposed product's options: few axes and few short values, so its variants stay a short list. */
export const AI_CATALOG_OPTIONS_MAX = 2
export const AI_CATALOG_OPTION_VALUES_MAX = 6
export const AI_CATALOG_OPTION_VALUE_MAX_CHARS = 30

/** What a proposed product's photo should show, in one sentence. */
export const AI_CATALOG_PHOTO_MAX_CHARS = 160

/**
 * A proposed product's suggested price, in US dollars — the one currency a
 * catalog prices in (`priceUsd`) — and the range code keeps it to (Zach,
 * 2026-10-12): a store's first products priced by what each one is (a bar
 * of handmade soap about $8–12, a candle $18–32, a gift set $30–45) instead
 * of every one at the commerce default. Never $0 or less, nothing past what
 * a small shop's first product plausibly lists at; a price outside the range,
 * or none, is no price, and the writer gives the product its default price.
 * Below the commerce ceiling (`COMMERCE_MAX_PRICE_USD`, $10,000) by design.
 */
export const AI_CATALOG_PRICE_USD = { min: 1, max: 5_000 } as const

/**
 * A proposed price as code keeps it: a finite number of dollars (or a plain
 * "$12.50" a model wrote as text) inside `AI_CATALOG_PRICE_USD`, rounded to
 * whole cents; anything else — missing, zero, negative, absurd, not a number
 * — is `null`, so the product takes the store's default price for the owner
 * to change. The model is never re-asked for a price: a bad one costs the
 * product only its suggestion.
 */
export function aiCatalogPrice(raw: unknown): number | null {
  let value: number | null = null
  if (typeof raw === 'number') value = raw
  else if (typeof raw === 'string') {
    const match = /^\s*(?:US\s*)?\$?\s*(\d{1,6}(?:\.\d{1,2})?)\s*(?:USD)?\s*$/i.exec(raw)
    value = match ? Number(match[1]) : null
  }
  if (value === null || !Number.isFinite(value)) return null
  const cents = Math.round(value * 100)
  if (cents < AI_CATALOG_PRICE_USD.min * 100 || cents > AI_CATALOG_PRICE_USD.max * 100) return null
  return cents / 100
}

export const AI_CATEGORIES_MAX = 12
export const AI_DISCOUNTS_MAX = 5
export const AI_CATEGORY_NAME_MAX_CHARS = 60
export const AI_PROPOSAL_WHY_MAX_CHARS = 200

/** The highest percentage a proposed discount takes off, and the most a fixed one takes, in dollars. */
export const AI_DISCOUNT_MAX_PERCENT = 90
export const AI_DISCOUNT_MAX_FIXED_USD = 1_000

/** A discount code: letters, digits, dashes and underscores, stored upper case. */
export const AI_DISCOUNT_CODE = /^[A-Z0-9_-]{3,20}$/

/** An option axis. */
export interface AiProductOption {
  name: string
  values: string[]
}

/** One product as its editor hands it to a `product` job. */
export interface AiProductFacts {
  /** `null` for a product nobody has saved yet. */
  id: string | null
  name: string
  type: AiProductType
  /** The product's current description, cut to `AI_PRODUCT_TEXT_MAX_CHARS`. */
  text: string
  tags: string[]
  categoryIds: string[]
  options: AiProductOption[]
  /** The first photo's stored media value, or `null`. */
  imageUrl: string | null
  seoTitle: string
  seoDescription: string
}

/** A site's product category, as a request lists it to choose from. */
export interface AiProductCategory {
  id: string
  name: string
}

/** The merchant's own words about a product, which a claim in its copy may repeat. */
export function aiProductMerchantWords(product: Pick<AiProductFacts, 'name' | 'text' | 'tags'>): string {
  return [product.name, product.text, ...product.tags].join('\n')
}

export type AiProductsJobInputs =
  | { target: 'product'; product: AiProductFacts }
  | { target: 'bulk'; productIds: string[] }
  | { target: 'catalog' }
  | { target: 'categories' }

const ID = /^[A-Za-z0-9_-]{1,64}$/

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''

/** A list stored as JSON, read defensively: strings only, trimmed, bounded. */
function jsonStrings(value: unknown, max: number, maxChars: number): string[] {
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => text(entry, maxChars))
      .filter(Boolean)
      .slice(0, max)
  } catch {
    return []
  }
}

function jsonOptions(value: unknown): AiProductOption[] {
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => {
        const record = (entry ?? {}) as Record<string, unknown>
        return {
          name: text(record['name'], AI_PRODUCT_OPTION_NAME_MAX_CHARS),
          values: Array.isArray(record['values'])
            ? record['values'].map((value) => text(value, 40)).filter(Boolean).slice(0, AI_PRODUCT_OPTION_VALUES_MAX)
            : [],
        }
      })
      .slice(0, AI_PRODUCT_OPTIONS_MAX)
  } catch {
    return []
  }
}

/**
 * How large a job's inputs may be once written as JSON: under the 8,000
 * characters the create door admits, with room for the door's own keys.
 */
export const AI_PRODUCTS_INPUTS_MAX_JSON_CHARS = 7_500

/**
 * A job's inputs for a target, as the console sends them: every value a
 * scalar, lists as JSON or as comma-separated ids, each bounded, and the
 * product's text shortened last until the whole fits what the create door
 * admits.
 */
export function aiProductsJobInputs(input: AiProductsJobInputs): Record<string, string> {
  switch (input.target) {
    case 'product': {
      const product = input.product
      const inputs: Record<string, string> = {
        target: 'product',
        productId: product.id ?? '',
        name: text(product.name, AI_PRODUCT_NAME_MAX_CHARS),
        type: product.type,
        text: product.text.slice(0, AI_PRODUCT_TEXT_MAX_CHARS),
        tags: JSON.stringify(product.tags.slice(0, 10).map((tag) => tag.slice(0, 40))),
        categoryIds: product.categoryIds.filter((id) => ID.test(id)).slice(0, 10).join(','),
        options: JSON.stringify(
          product.options.slice(0, AI_PRODUCT_OPTIONS_MAX).map((option) => ({
            name: option.name.slice(0, AI_PRODUCT_OPTION_NAME_MAX_CHARS),
            values: option.values.slice(0, AI_PRODUCT_OPTION_VALUES_MAX).map((value) => value.slice(0, 40)),
          })),
        ),
        imageUrl: (product.imageUrl ?? '').slice(0, 300),
        seoTitle: product.seoTitle.slice(0, 100),
        seoDescription: product.seoDescription.slice(0, 200),
      }
      while (JSON.stringify(inputs).length > AI_PRODUCTS_INPUTS_MAX_JSON_CHARS && inputs['text']) {
        inputs['text'] = inputs['text'].slice(0, Math.max(0, inputs['text'].length - 250))
      }
      return inputs
    }
    case 'bulk':
      return aiProductsBulkInputs(input.productIds)
    default:
      return { target: input.target }
  }
}

/** Why a `products` job's inputs cannot run, in words a person can act on. */
export const AI_PRODUCTS_NO_TARGET_COPY = 'This AI job does not say what to write for your products.'
export const AI_PRODUCTS_NO_NAME_COPY = 'Give the product a name before writing its copy.'
export const AI_PRODUCTS_NO_SELECTION_COPY = 'Pick the products to write copy for.'
export const AI_PRODUCTS_TOO_MANY_COPY = `Pick at most ${AI_PRODUCTS_BULK_MAX} products at a time.`

/** A job's inputs read back, or the sentence that says why they cannot run. */
export function parseAiProductsJobInputs(raw: Readonly<Record<string, unknown>> | undefined): AiProductsJobInputs | string {
  const inputs = raw ?? {}
  const target = inputs['target']
  if (!(AI_PRODUCTS_TARGETS as readonly unknown[]).includes(target)) return AI_PRODUCTS_NO_TARGET_COPY
  if (target === 'product') {
    const name = text(inputs['name'], AI_PRODUCT_NAME_MAX_CHARS)
    if (!name) return AI_PRODUCTS_NO_NAME_COPY
    const type = inputs['type']
    const id = typeof inputs['productId'] === 'string' && ID.test(inputs['productId']) ? inputs['productId'] : null
    return {
      target,
      product: {
        id,
        name,
        type: (AI_PRODUCT_TYPES as readonly unknown[]).includes(type) ? (type as AiProductType) : 'physical',
        text: typeof inputs['text'] === 'string' ? inputs['text'].trim().slice(0, AI_PRODUCT_TEXT_MAX_CHARS) : '',
        tags: jsonStrings(inputs['tags'], 10, 40),
        categoryIds: String(inputs['categoryIds'] ?? '')
          .split(',')
          .map((part) => part.trim())
          .filter((part) => ID.test(part))
          .slice(0, 10),
        options: jsonOptions(inputs['options']),
        imageUrl: text(inputs['imageUrl'], 300) || null,
        seoTitle: text(inputs['seoTitle'], 100),
        seoDescription: text(inputs['seoDescription'], 200),
      },
    }
  }
  if (target === 'bulk') {
    const ids = String(inputs['productIds'] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => ID.test(part))
    const unique = [...new Set(ids)]
    if (!unique.length) return AI_PRODUCTS_NO_SELECTION_COPY
    if (unique.length > AI_PRODUCTS_BULK_MAX) return AI_PRODUCTS_TOO_MANY_COPY
    return { target, productIds: unique }
  }
  return { target: target as 'catalog' | 'categories' }
}

/* ------------------------------------------------------------------------ *
 * Proposals
 * ------------------------------------------------------------------------ */

/** A product's copy, as proposed. */
export interface AiProductCopy {
  description: string
  seoTitle: string
  seoDescription: string
  tags: string[]
  categoryIds: string[]
  /** One name per option the product had, in order. */
  optionNames: string[]
}

/** What became of the product's photo. */
export type AiProductPhotoRead =
  /** The photo was read. */
  | 'read'
  /** The product has no photo. */
  | 'none'
  /** The photo is not an asset of this site's media library, or its org's. */
  | 'not-in-library'
  /** The photo could not be read. */
  | 'unreadable'
  /** The model this job ran on does not read pictures. */
  | 'model'

export interface AiProductCopyProposal {
  kind: 'copy'
  product: { id: string | null; name: string }
  /** `null` when there was nothing to propose: see `skipped`. */
  values: AiProductCopy | null
  /** The categories `values` names, with the names they had when the job read them. */
  categories: Array<{ id: string; name: string }>
  /** The option names the product had, beside the ones proposed. */
  optionNamesBefore: string[]
  /** The facts the copy marks as missing, in square brackets, for a person to fill in. */
  gaps: string[]
  photo: AiProductPhotoRead
  /** Why a bulk pass proposed nothing for this product, in customer-safe words. */
  skipped: string | null
  notes: string[]
}

export interface AiCatalogProduct {
  name: string
  type: AiProductType
  description: string
  tags: string[]
  options: AiProductOption[]
  seoTitle: string
  seoDescription: string
  /** What the product's photo should show; nothing is uploaded or linked. */
  photo: string
  /**
   * The suggested price for every variant, in US dollars, as `aiCatalogPrice`
   * kept it; `null` (or absent, on a proposal made before 2026-10-12) when
   * the model gave none in range, and the store's default price stands in.
   */
  price?: number | null
}

export interface AiCatalogProposal {
  kind: 'catalog'
  products: AiCatalogProduct[]
  notes: string[]
}

// ── A product a shopper would buy (AGL-4065) ────────────────────────────

/**
 * The re-ask a catalog whose names are kinds of product is answered with
 * (AGL-4065). The 2026-10-25 Berm & Bolt Moto Parts start listed "Riding Gear
 * Item", "OEM ATV Parts Order" and "Aftermarket Dirt Bike Part" at suggested
 * prices, from a brief that named kinds of part and no product.
 */
export const AI_CATALOG_NAME_REASK =
  'Name real products a shopper would buy, never a category with “Item” or “Order” after it; where the brief names kinds of product and no product, name each one a plain item of one of those kinds, never a brand or a model the brief does not name.'

/** The code a catalog's kind-for-a-name is refused under. */
export const AI_CATALOG_NAME_CODE = 'catalog-name-kind'

/** A name's last word that names a kind of thing, or a transaction, never one thing a shopper buys. */
const KIND_HEAD =
  /\b(?:items?|orders?|products?|parts?|things?|options?|selections?|assortments?|stuff|goods|merchandise|gear|accessor(?:y|ies)|suppl(?:y|ies)|equipment|essentials?|requests?|inquir(?:y|ies))$/i

/** Makes a product name carries only where the brief names them: vehicles, apparel and electronics most of all. */
const BRANDS =
  /\b(?:porsche|ferrari|lamborghini|bmw|mercedes|audi|volkswagen|toyota|honda|yamaha|kawasaki|suzuki|ktm|ducati|harley(?:-davidson)?|husqvarna|gasgas|polaris|can-am|tesla|ford|chevrolet|chevy|dodge|jeep|nissan|subaru|mazda|nike|adidas|reebok|samsung|iphone|playstation|xbox|nintendo|starbucks|coca-cola|pepsi)\b/i

/** A model number: letters and figures run together, as "CRF450R" or "KX250". */
const MODEL_CODE = /\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9][A-Z0-9-]{3,}\b/

/** The make a text names that the brief does not (AGL-4065), or `null`: a sample row or a product names none. Pure. */
export function aiTextNamesBrand(text: string, brief: string): string | null {
  const brand = BRANDS.exec(text)?.[0]
  return brand && !brief.toLowerCase().includes(brand.toLowerCase()) ? brand : null
}

/**
 * Why a proposed product's name is not one a shopper would buy (AGL-4065), or
 * `null`: a kind of product with a word like "Item", "Order" or "Part" after
 * it, or a make or a model number the brief does not name. "Dirt Bike Tire"
 * and "Motocross helmet" are products; "Riding Gear Item" is a kind. Pure.
 */
export function aiCatalogNameProblem(name: string, brief: string): string | null {
  const plain = name.replace(/\s+/g, ' ').trim()
  if (!plain) return null
  const words = brief.toLowerCase()
  if (KIND_HEAD.test(plain.replace(/[^\p{L}\p{N}]+$/u, ''))) return `“${plain}” names a kind of product, not one a shopper buys`
  if (aiTextNamesBrand(plain, brief)) return `“${plain}” names a make the brief does not`
  const model = MODEL_CODE.exec(plain)?.[0]
  if (model && !words.includes(model.toLowerCase())) return `“${plain}” names a model the brief does not`
  return null
}

export type AiDiscountKind = 'percent' | 'fixed' | 'free_shipping'

export interface AiProposedDiscount {
  name: string
  /** The code a shopper types, upper case; `null` for an automatic discount. */
  code: string | null
  kind: AiDiscountKind
  /** A `percent` discount's percentage. */
  valuePct: number | null
  /** A `fixed` discount's amount off, in cents. */
  valueCents: number | null
  /** The smallest order it applies to, in cents; `null` for any order. */
  minSubtotalCents: number | null
  why: string
}

export interface AiCategoriesProposal {
  kind: 'categories'
  categories: Array<{ name: string; why: string }>
  discounts: AiProposedDiscount[]
  notes: string[]
}

export type AiProductsProposal = AiProductCopyProposal | AiCatalogProposal | AiCategoriesProposal

/** Output ids, so a pass that runs again finds what it already proposed. */
export const AI_PRODUCTS_OUTPUT_IDS = {
  copy: (productId: string | null) => `copy:${productId ?? 'new'}`,
  catalog: 'catalog',
  categories: 'categories',
} as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** An output's proposal, or `null` for an output that is not a products proposal. */
export function aiProductsProposalOf(output: Pick<AiJobOutput, 'resource' | 'proposal'> | null | undefined): AiProductsProposal | null {
  if (!output || output.resource !== 'product' || !isRecord(output.proposal)) return null
  const kind = output.proposal['kind']
  return kind === 'copy' || kind === 'catalog' || kind === 'categories'
    ? (output.proposal as unknown as AiProductsProposal)
    : null
}

/** A job's copy proposals, in the order the job made them. */
export function aiProductCopyProposals(job: Pick<AiJobSummary, 'outputs'> | null | undefined): AiProductCopyProposal[] {
  return (job?.outputs ?? [])
    .map((output) => aiProductsProposalOf(output))
    .filter((proposal): proposal is AiProductCopyProposal => proposal?.kind === 'copy')
}

/** A job's proposal of one kind, or `null`. */
export function aiProductsProposalOfKind<K extends AiProductsProposal['kind']>(
  job: Pick<AiJobSummary, 'outputs'> | null | undefined,
  kind: K,
): Extract<AiProductsProposal, { kind: K }> | null {
  for (const output of job?.outputs ?? []) {
    const proposal = aiProductsProposalOf(output)
    if (proposal?.kind === kind) return proposal as Extract<AiProductsProposal, { kind: K }>
  }
  return null
}

/** The gaps a text marks for a person in square brackets, as `[material]`, each once. */
export function aiProductGaps(...texts: readonly string[]): string[] {
  const found = new Set<string>()
  for (const value of texts) {
    for (const match of value.matchAll(/\[([^\]\n]{1,60})\]/g)) found.add(match[1].trim())
  }
  return [...found].filter(Boolean)
}

/* ------------------------------------------------------------------------ *
 * The console's cards
 * ------------------------------------------------------------------------ */

/** The option the import zone sets to write the imported products' copy. */
export const AI_PRODUCTS_IMPORT_WRITE_COPY = 'ai.writeCopy'

const BULK_BRIEF = /^Write storefront copy for (\d+) products?$/

/** How many products a bulk copy job was asked for, read from its brief; `null` for any other job. */
export function aiProductsBulkCount(job: Pick<AiJobSummary, 'brief'> | null | undefined): number | null {
  const match = BULK_BRIEF.exec(job?.brief ?? '')
  return match ? Number(match[1]) : null
}
