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
 *   and options, and what each photo should show. No price and no picture.
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

/** The most products one bulk job writes the copy of. */
export const AI_PRODUCTS_BULK_MAX = 50

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
      return {
        target: 'bulk',
        productIds: [...new Set(input.productIds.filter((id) => ID.test(id)))]
          .slice(0, AI_PRODUCTS_BULK_MAX)
          .join(','),
      }
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
}

export interface AiCatalogProposal {
  kind: 'catalog'
  products: AiCatalogProduct[]
  notes: string[]
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
