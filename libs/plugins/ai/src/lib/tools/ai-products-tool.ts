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

import { SEO_LISTING_FIELDS } from '@aglyn/aglyn/app-utils/seo-listing-fields'
import {
  AI_CATALOG_DESCRIPTION_MAX_CHARS,
  AI_CATALOG_OPTION_VALUE_MAX_CHARS,
  AI_CATALOG_OPTION_VALUES_MAX,
  AI_CATALOG_OPTIONS_MAX,
  AI_CATALOG_PHOTO_MAX_CHARS,
  AI_CATALOG_PRODUCTS,
  AI_CATALOG_TAGS_MAX,
  AI_CATEGORIES_MAX,
  AI_CATEGORY_NAME_MAX_CHARS,
  AI_DISCOUNT_CODE,
  AI_DISCOUNT_MAX_FIXED_USD,
  AI_DISCOUNT_MAX_PERCENT,
  AI_DISCOUNTS_MAX,
  AI_PRODUCT_CATEGORIES_MAX,
  AI_PRODUCT_DESCRIPTION_MAX_CHARS,
  AI_PRODUCT_NAME_MAX_CHARS,
  AI_PRODUCT_OPTION_NAME_MAX_CHARS,
  AI_PRODUCT_TAG_MAX_CHARS,
  AI_PRODUCT_TAGS_MAX,
  AI_PRODUCT_TYPES,
  AI_PROPOSAL_WHY_MAX_CHARS,
  type AiCatalogProduct,
  type AiCategoriesProposal,
  type AiDiscountKind,
  type AiProductCopy,
  type AiProductOption,
  type AiProductType,
  type AiProposedDiscount,
} from '../model/ai-products'
import {
  findInventedPrices,
  findStorefrontClaims,
  storefrontClaimViolations,
  type AiStorefrontCopySample,
} from '../model/ai-storefront-claims'
import type { AiTool } from '../providers/contract'
import type { AiGenerationCheckResult } from '../runtime/ai-doctrine'
import { detectOffVoiceCopy, type AiDoctrineViolation } from '../runtime/ai-doctrine-validators'

/**
 * The strict tools commerce by AI answers through (AGL-2916), and the checks
 * that hold each answer to the commerce editor it proposes for.
 *
 * - `propose_product_copy` — one product's description, search listing, tags,
 *   categories and option names.
 * - `propose_catalog` — a store's first products, from a brief.
 * - `propose_categories_and_discounts` — store categories and a first set of
 *   discounts, from a brief.
 *
 * Each schema is kept small, and no field is nullable: "none" is an empty
 * string, an empty list or zero. A strict schema accepts no length keyword,
 * so every bound is stated in a description and enforced here. A check
 * returns a value only when nothing in the answer is broken, and otherwise
 * the violations and the parts at fault, for the generation call's one
 * re-ask.
 */

export const AI_PRODUCT_COPY_TOOL_NAME = 'propose_product_copy'
export const AI_CATALOG_TOOL_NAME = 'propose_catalog'
export const AI_CATEGORIES_TOOL_NAME = 'propose_categories_and_discounts'

const SEO_TITLE_MAX = SEO_LISTING_FIELDS.title.maxLength
const SEO_DESCRIPTION_MAX = SEO_LISTING_FIELDS.description.maxLength

const string = (description: string) => ({ type: 'string', description })
const strings = (description: string) => ({ type: 'array', items: { type: 'string' }, description })

/* ------------------------------------------------------------------------ *
 * Shared reads
 * ------------------------------------------------------------------------ */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** One line: runs of white space folded to one space. */
const line = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')

/** Paragraphs: spaces folded within a line, at most one blank line between paragraphs. */
const paragraphs = (value: unknown): string =>
  typeof value === 'string'
    ? value
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((part) => part.replace(/[ \t\f\v]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : ''

const MARKUP = /<\/?[a-z][^>]*>/i
const MARKDOWN = /(^|\n)\s*#{1,6}\s|\*\*[^*\n]+\*\*|__[^_\n]+__|!\[[^\]]*\]\(|\[[^\]]+\]\(https?:/
const EMOJI = /\p{Extended_Pictographic}/u
const BRACKET = /[[\]]/
const URL = /\bhttps?:\/\/|\bwww\./i

interface Findings {
  violations: AiDoctrineViolation[]
  offending: Record<string, unknown>
}

function fail(findings: Findings, at: string, code: string, message: string, value: unknown): void {
  findings.violations.push({ rule: null, code, message, paths: [at] })
  if (!(at in findings.offending)) findings.offending[at] = value
}

/** A piece of copy a shopper reads: there, within its length, and plain text. */
function checkCopyText(
  findings: Findings,
  at: string,
  raw: unknown,
  bounds: { label: string; max: number; multiline?: boolean; brackets?: boolean },
): string {
  if (typeof raw !== 'string') {
    fail(findings, at, 'type', `${bounds.label} must be text.`, raw)
    return ''
  }
  const value = bounds.multiline ? paragraphs(raw) : line(raw)
  if (!value) {
    fail(findings, at, 'missing', `${bounds.label} is required.`, raw)
    return ''
  }
  if (value.length > bounds.max) {
    fail(findings, at, 'too-long', `${bounds.label} is ${value.length} characters; it may have ${bounds.max}.`, raw)
  }
  if (MARKUP.test(value) || MARKDOWN.test(value)) {
    fail(findings, at, 'markup', `${bounds.label} is plain text, with no markup or formatting marks.`, raw)
  }
  if (EMOJI.test(value)) fail(findings, at, 'emoji', `${bounds.label} holds no emoji.`, raw)
  if (URL.test(value)) fail(findings, at, 'link', `${bounds.label} holds no link.`, raw)
  if (bounds.brackets === false && BRACKET.test(value)) {
    fail(findings, at, 'bracket', `${bounds.label} is published as written, so it marks no missing fact in brackets.`, raw)
  }
  return value
}

/** Tags a shopper filters by: short, distinct, no `#`, no more than `max`. */
function checkTags(findings: Findings, at: string, raw: unknown, max = AI_PRODUCT_TAGS_MAX): string[] {
  if (!Array.isArray(raw)) {
    fail(findings, at, 'type', 'Tags are a list of words or short phrases.', raw)
    return []
  }
  const seen = new Set<string>()
  const tags: string[] = []
  raw.forEach((entry, index) => {
    const tag = line(entry).replace(/^#+/, '').trim()
    if (!tag) return
    if (tag.length > AI_PRODUCT_TAG_MAX_CHARS || EMOJI.test(tag) || BRACKET.test(tag)) {
      fail(findings, `${at}[${index}]`, 'tag', `A tag is a plain word or phrase of at most ${AI_PRODUCT_TAG_MAX_CHARS} characters.`, entry)
      return
    }
    const key = tag.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    tags.push(tag)
  })
  if (tags.length > max) {
    fail(findings, at, 'too-many', `A product carries at most ${max} tags.`, raw)
  }
  return tags
}

/** The claims and prices a set of copy may not make, as violations. */
function claimViolations(samples: readonly AiStorefrontCopySample[], merchantWords: string): AiDoctrineViolation[] {
  return storefrontClaimViolations(
    findStorefrontClaims(samples, merchantWords),
    findInventedPrices(samples, merchantWords),
  )
}

/* ------------------------------------------------------------------------ *
 * One product's copy
 * ------------------------------------------------------------------------ */

export const AI_PRODUCT_COPY_TOOL: AiTool = {
  name: AI_PRODUCT_COPY_TOOL_NAME,
  description: 'Propose the storefront copy for one product. Every field is required.',
  strict: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['description', 'seoTitle', 'seoDescription', 'tags', 'categoryIds', 'optionNames'],
    properties: {
      description: string(
        `The product description shoppers read, in short paragraphs, at most ${AI_PRODUCT_DESCRIPTION_MAX_CHARS} characters.`,
      ),
      seoTitle: string(`The search result headline, published as written, at most ${SEO_TITLE_MAX} characters.`),
      seoDescription: string(`The search result summary, at most ${SEO_DESCRIPTION_MAX} characters.`),
      tags: strings(`At most ${AI_PRODUCT_TAGS_MAX} tags, each at most ${AI_PRODUCT_TAG_MAX_CHARS} characters.`),
      categoryIds: strings(
        `At most ${AI_PRODUCT_CATEGORIES_MAX} category ids from the list you were given; empty when none fits.`,
      ),
      optionNames: strings(
        `One name per option the product has, in order, each at most ${AI_PRODUCT_OPTION_NAME_MAX_CHARS} characters; empty when it has none.`,
      ),
    },
  },
}

export interface AiProductCopyCheckContext {
  /** The ids of the site's categories the request listed. */
  categoryIds: readonly string[]
  /** How many options the product has. */
  optionCount: number
  /** The merchant's own words about the product: its name, text and tags. */
  merchantWords: string
}

/**
 * A product copy answer held to the editor: every field written and within
 * its length, plain text, the categories the request listed, one distinct
 * name per option, and no claim or price the copy may not make.
 */
export function checkAiProductCopy(
  answer: Record<string, unknown>,
  context: AiProductCopyCheckContext,
): AiGenerationCheckResult<AiProductCopy> {
  const findings: Findings = { violations: [], offending: {} }
  const description = checkCopyText(findings, 'description', answer['description'], {
    label: 'The description',
    max: AI_PRODUCT_DESCRIPTION_MAX_CHARS,
    multiline: true,
  })
  const seoTitle = checkCopyText(findings, 'seoTitle', answer['seoTitle'], {
    label: 'The search title',
    max: SEO_TITLE_MAX,
    brackets: false,
  })
  const seoDescription = checkCopyText(findings, 'seoDescription', answer['seoDescription'], {
    label: 'The search description',
    max: SEO_DESCRIPTION_MAX,
    brackets: false,
  })
  const tags = checkTags(findings, 'tags', answer['tags'])

  const allowed = new Set(context.categoryIds)
  const categoryIds: string[] = []
  const rawCategories = answer['categoryIds']
  if (!Array.isArray(rawCategories)) {
    fail(findings, 'categoryIds', 'type', 'Categories are a list of ids.', rawCategories)
  } else {
    for (const entry of rawCategories) {
      const id = line(entry)
      if (!id || categoryIds.includes(id)) continue
      if (!allowed.has(id)) {
        fail(findings, 'categoryIds', 'category-unknown', 'Use only the category ids you were given.', rawCategories)
        continue
      }
      categoryIds.push(id)
    }
    if (categoryIds.length > AI_PRODUCT_CATEGORIES_MAX) {
      fail(findings, 'categoryIds', 'too-many', `A product goes in at most ${AI_PRODUCT_CATEGORIES_MAX} categories.`, rawCategories)
    }
  }

  const optionNames: string[] = []
  const rawOptions = answer['optionNames']
  if (!Array.isArray(rawOptions)) {
    fail(findings, 'optionNames', 'type', 'Option names are a list.', rawOptions)
  } else {
    if (rawOptions.length !== context.optionCount) {
      fail(
        findings,
        'optionNames',
        'option-count',
        `The product has ${context.optionCount} ${context.optionCount === 1 ? 'option' : 'options'}; give one name for each.`,
        rawOptions,
      )
    }
    rawOptions.slice(0, context.optionCount).forEach((entry, index) => {
      const name = line(entry)
      if (!name || name.length > AI_PRODUCT_OPTION_NAME_MAX_CHARS || BRACKET.test(name) || EMOJI.test(name)) {
        fail(findings, `optionNames[${index}]`, 'option-name', `An option name is a plain word or phrase of at most ${AI_PRODUCT_OPTION_NAME_MAX_CHARS} characters.`, entry)
      }
      optionNames.push(name)
    })
    if (new Set(optionNames.map((name) => name.toLowerCase())).size !== optionNames.length) {
      fail(findings, 'optionNames', 'option-duplicate', 'Each option needs its own name.', rawOptions)
    }
  }

  const samples: AiStorefrontCopySample[] = [
    { at: 'description', text: description },
    { at: 'seoTitle', text: seoTitle },
    { at: 'seoDescription', text: seoDescription },
    ...tags.map((tag, index) => ({ at: `tags[${index}]`, text: tag })),
  ]
  findings.violations.push(
    ...claimViolations(samples, context.merchantWords),
    ...detectOffVoiceCopy(samples, null),
  )
  const value = findings.violations.length
    ? null
    : { description, seoTitle, seoDescription, tags, categoryIds, optionNames }
  return { value, violations: findings.violations, offending: findings.offending }
}

/* ------------------------------------------------------------------------ *
 * A store's first products
 * ------------------------------------------------------------------------ */

export const AI_CATALOG_TOOL: AiTool = {
  name: AI_CATALOG_TOOL_NAME,
  description: 'Propose the products of a new store, each a draft its owner completes. Every field is required.',
  strict: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['products'],
    properties: {
      products: {
        type: 'array',
        description: `Between ${AI_CATALOG_PRODUCTS.min} and ${AI_CATALOG_PRODUCTS.max} products.`,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'type', 'description', 'tags', 'options', 'seoTitle', 'seoDescription', 'photo'],
          properties: {
            name: string(`Distinct within the list, at most ${AI_PRODUCT_NAME_MAX_CHARS} characters.`),
            type: { type: 'string', enum: [...AI_PRODUCT_TYPES] },
            description: string(`In short paragraphs, at most ${AI_CATALOG_DESCRIPTION_MAX_CHARS} characters.`),
            tags: strings(`At most ${AI_CATALOG_TAGS_MAX} tags, each at most ${AI_PRODUCT_TAG_MAX_CHARS} characters.`),
            options: {
              type: 'array',
              description: `The choices a shopper makes, at most ${AI_CATALOG_OPTIONS_MAX}; empty for a product with none.`,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'values'],
                properties: {
                  name: string(`At most ${AI_PRODUCT_OPTION_NAME_MAX_CHARS} characters.`),
                  values: strings(
                    `At most ${AI_CATALOG_OPTION_VALUES_MAX} distinct values, each at most ${AI_CATALOG_OPTION_VALUE_MAX_CHARS} characters.`,
                  ),
                },
              },
            },
            seoTitle: string(`At most ${SEO_TITLE_MAX} characters.`),
            seoDescription: string(`At most ${SEO_DESCRIPTION_MAX} characters.`),
            photo: string(`What the product photo should show, in one sentence of at most ${AI_CATALOG_PHOTO_MAX_CHARS} characters.`),
          },
        },
      },
    },
  },
}

/** A catalog answer held to the products editor and the storefront copy rules. */
export function checkAiCatalog(
  answer: Record<string, unknown>,
  context: { merchantWords: string },
): AiGenerationCheckResult<AiCatalogProduct[]> {
  const findings: Findings = { violations: [], offending: {} }
  const raw = answer['products']
  if (!Array.isArray(raw)) {
    fail(findings, 'products', 'type', 'The products are a list.', raw)
    return { value: null, violations: findings.violations, offending: findings.offending }
  }
  if (raw.length < AI_CATALOG_PRODUCTS.min || raw.length > AI_CATALOG_PRODUCTS.max) {
    fail(findings, 'products', 'product-count', `Propose between ${AI_CATALOG_PRODUCTS.min} and ${AI_CATALOG_PRODUCTS.max} products.`, `${raw.length} products`)
  }
  const names = new Set<string>()
  const products: AiCatalogProduct[] = []
  const samples: AiStorefrontCopySample[] = []
  raw.slice(0, AI_CATALOG_PRODUCTS.max).forEach((entry, index) => {
    const at = `products[${index}]`
    if (!isRecord(entry)) {
      fail(findings, at, 'type', 'Each product is an object.', entry)
      return
    }
    const name = checkCopyText(findings, `${at}.name`, entry['name'], {
      label: 'A product name',
      max: AI_PRODUCT_NAME_MAX_CHARS,
      brackets: false,
    })
    if (name && names.has(name.toLowerCase())) {
      fail(findings, `${at}.name`, 'name-duplicate', 'Each product needs its own name.', entry['name'])
    }
    names.add(name.toLowerCase())
    const type = entry['type']
    if (!(AI_PRODUCT_TYPES as readonly unknown[]).includes(type)) {
      fail(findings, `${at}.type`, 'type', 'A product is physical, digital or a service.', type)
    }
    const description = checkCopyText(findings, `${at}.description`, entry['description'], {
      label: 'A product description',
      max: AI_CATALOG_DESCRIPTION_MAX_CHARS,
      multiline: true,
    })
    const tags = checkTags(findings, `${at}.tags`, entry['tags'], AI_CATALOG_TAGS_MAX)
    const options = checkCatalogOptions(findings, `${at}.options`, entry['options'])
    const seoTitle = checkCopyText(findings, `${at}.seoTitle`, entry['seoTitle'], {
      label: 'A search title',
      max: SEO_TITLE_MAX,
      brackets: false,
    })
    const seoDescription = checkCopyText(findings, `${at}.seoDescription`, entry['seoDescription'], {
      label: 'A search description',
      max: SEO_DESCRIPTION_MAX,
      brackets: false,
    })
    const photo = checkCopyText(findings, `${at}.photo`, entry['photo'], {
      label: 'What the photo shows',
      max: AI_CATALOG_PHOTO_MAX_CHARS,
      brackets: false,
    })
    samples.push(
      { at: `${at}.name`, text: name },
      { at: `${at}.description`, text: description },
      { at: `${at}.seoTitle`, text: seoTitle },
      { at: `${at}.seoDescription`, text: seoDescription },
      ...tags.map((tag, tagIndex) => ({ at: `${at}.tags[${tagIndex}]`, text: tag })),
    )
    products.push({
      name,
      type: type as AiProductType,
      description,
      tags,
      options,
      seoTitle,
      seoDescription,
      photo,
    })
  })
  findings.violations.push(...claimViolations(samples, context.merchantWords), ...detectOffVoiceCopy(samples, null))
  return {
    value: findings.violations.length ? null : products,
    violations: findings.violations,
    offending: findings.offending,
  }
}

function checkCatalogOptions(findings: Findings, at: string, raw: unknown): AiProductOption[] {
  if (!Array.isArray(raw)) {
    fail(findings, at, 'type', 'Options are a list.', raw)
    return []
  }
  if (raw.length > AI_CATALOG_OPTIONS_MAX) {
    fail(findings, at, 'too-many', `A proposed product has at most ${AI_CATALOG_OPTIONS_MAX} options.`, raw)
  }
  const options: AiProductOption[] = []
  raw.slice(0, AI_CATALOG_OPTIONS_MAX).forEach((entry, index) => {
    const here = `${at}[${index}]`
    const record = isRecord(entry) ? entry : {}
    const name = line(record['name'])
    if (!name || name.length > AI_PRODUCT_OPTION_NAME_MAX_CHARS || BRACKET.test(name)) {
      fail(findings, `${here}.name`, 'option-name', `An option name is a plain word or phrase of at most ${AI_PRODUCT_OPTION_NAME_MAX_CHARS} characters.`, record['name'])
    }
    const values = Array.isArray(record['values']) ? record['values'].map(line).filter(Boolean) : []
    if (!values.length || values.length > AI_CATALOG_OPTION_VALUES_MAX) {
      fail(findings, `${here}.values`, 'too-many', `An option has between 1 and ${AI_CATALOG_OPTION_VALUES_MAX} values.`, record['values'])
    }
    if (values.some((value) => value.length > AI_CATALOG_OPTION_VALUE_MAX_CHARS || BRACKET.test(value))) {
      fail(findings, `${here}.values`, 'option-values', `An option value is a plain word or phrase of at most ${AI_CATALOG_OPTION_VALUE_MAX_CHARS} characters.`, record['values'])
    }
    if (new Set(values.map((value) => value.toLowerCase())).size !== values.length) {
      fail(findings, `${here}.values`, 'option-values', 'An option’s values are all different.', record['values'])
    }
    options.push({ name, values: values.slice(0, AI_CATALOG_OPTION_VALUES_MAX) })
  })
  if (new Set(options.map((option) => option.name.toLowerCase())).size !== options.length) {
    fail(findings, at, 'option-duplicate', 'Each option needs its own name.', raw)
  }
  return options
}

/* ------------------------------------------------------------------------ *
 * Categories and discounts
 * ------------------------------------------------------------------------ */

export const AI_CATEGORIES_TOOL: AiTool = {
  name: AI_CATEGORIES_TOOL_NAME,
  description: 'Propose store categories and a first set of discounts, each created only if the owner accepts it. Every field is required.',
  strict: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['categories', 'discounts'],
    properties: {
      categories: {
        type: 'array',
        description: `At most ${AI_CATEGORIES_MAX} categories; empty when the brief gives no reason for any.`,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'why'],
          properties: {
            name: string(`At most ${AI_CATEGORY_NAME_MAX_CHARS} characters.`),
            why: string(`One sentence of at most ${AI_PROPOSAL_WHY_MAX_CHARS} characters.`),
          },
        },
      },
      discounts: {
        type: 'array',
        description: `At most ${AI_DISCOUNTS_MAX} discounts; empty when the brief gives no reason for any.`,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'code', 'kind', 'value', 'minimumOrderUsd', 'why'],
          properties: {
            name: string(`At most ${AI_CATEGORY_NAME_MAX_CHARS} characters.`),
            code: string('The code a shopper types: 3 to 20 capital letters, digits, dashes or underscores; empty for a discount that applies on its own.'),
            kind: { type: 'string', enum: ['percent', 'fixed', 'free_shipping'] },
            value: {
              type: 'number',
              description: `percent: the percentage, 1 to ${AI_DISCOUNT_MAX_PERCENT}; fixed: dollars off, at most ${AI_DISCOUNT_MAX_FIXED_USD}; free_shipping: 0.`,
            },
            minimumOrderUsd: { type: 'number', description: 'The smallest order it applies to, in dollars; 0 for any order.' },
            why: string(`One sentence of at most ${AI_PROPOSAL_WHY_MAX_CHARS} characters.`),
          },
        },
      },
    },
  },
}

/** A categories answer held to the catalog and discount editors and the storefront copy rules. */
export function checkAiCategories(
  answer: Record<string, unknown>,
  context: { existingCategoryNames: readonly string[]; merchantWords: string },
): AiGenerationCheckResult<Pick<AiCategoriesProposal, 'categories' | 'discounts'>> {
  const findings: Findings = { violations: [], offending: {} }
  const existing = new Set(context.existingCategoryNames.map((name) => line(name).toLowerCase()))
  const samples: AiStorefrontCopySample[] = []

  const categories: AiCategoriesProposal['categories'] = []
  const rawCategories = answer['categories']
  if (!Array.isArray(rawCategories)) {
    fail(findings, 'categories', 'type', 'Categories are a list.', rawCategories)
  } else {
    if (rawCategories.length > AI_CATEGORIES_MAX) {
      fail(findings, 'categories', 'too-many', `Propose at most ${AI_CATEGORIES_MAX} categories.`, `${rawCategories.length} categories`)
    }
    const seen = new Set<string>()
    rawCategories.slice(0, AI_CATEGORIES_MAX).forEach((entry, index) => {
      const at = `categories[${index}]`
      const record = isRecord(entry) ? entry : {}
      const name = checkCopyText(findings, `${at}.name`, record['name'], {
        label: 'A category name',
        max: AI_CATEGORY_NAME_MAX_CHARS,
        brackets: false,
      })
      const key = name.toLowerCase()
      if (name && existing.has(key)) {
        fail(findings, `${at}.name`, 'category-exists', `The store already has a category named ${name}.`, record['name'])
      } else if (name && seen.has(key)) {
        fail(findings, `${at}.name`, 'category-duplicate', 'Each category needs its own name.', record['name'])
      }
      seen.add(key)
      const why = checkCopyText(findings, `${at}.why`, record['why'], {
        label: 'Why a category helps',
        max: AI_PROPOSAL_WHY_MAX_CHARS,
        brackets: false,
      })
      samples.push({ at: `${at}.name`, text: name }, { at: `${at}.why`, text: why })
      categories.push({ name, why })
    })
  }

  const discounts: AiProposedDiscount[] = []
  const rawDiscounts = answer['discounts']
  if (!Array.isArray(rawDiscounts)) {
    fail(findings, 'discounts', 'type', 'Discounts are a list.', rawDiscounts)
  } else {
    if (rawDiscounts.length > AI_DISCOUNTS_MAX) {
      fail(findings, 'discounts', 'too-many', `Propose at most ${AI_DISCOUNTS_MAX} discounts.`, `${rawDiscounts.length} discounts`)
    }
    const codes = new Set<string>()
    rawDiscounts.slice(0, AI_DISCOUNTS_MAX).forEach((entry, index) => {
      const at = `discounts[${index}]`
      const record = isRecord(entry) ? entry : {}
      const name = checkCopyText(findings, `${at}.name`, record['name'], {
        label: 'A discount name',
        max: AI_CATEGORY_NAME_MAX_CHARS,
        brackets: false,
      })
      const typedCode = line(record['code']).toUpperCase()
      if (typedCode && !AI_DISCOUNT_CODE.test(typedCode)) {
        fail(findings, `${at}.code`, 'code', 'A code is 3 to 20 capital letters, digits, dashes or underscores.', record['code'])
      } else if (typedCode && codes.has(typedCode)) {
        fail(findings, `${at}.code`, 'code-duplicate', 'Each discount needs its own code.', record['code'])
      }
      if (typedCode) codes.add(typedCode)
      const kind = record['kind']
      const value = Number(record['value'])
      const minimum = Number(record['minimumOrderUsd'])
      let valuePct: number | null = null
      let valueCents: number | null = null
      if (kind === 'percent') {
        if (!Number.isInteger(value) || value < 1 || value > AI_DISCOUNT_MAX_PERCENT) {
          fail(findings, `${at}.value`, 'discount-value', `A percentage is a whole number from 1 to ${AI_DISCOUNT_MAX_PERCENT}.`, record['value'])
        }
        valuePct = value
      } else if (kind === 'fixed') {
        if (!Number.isFinite(value) || value <= 0 || value > AI_DISCOUNT_MAX_FIXED_USD) {
          fail(findings, `${at}.value`, 'discount-value', `An amount off is more than 0 and at most ${AI_DISCOUNT_MAX_FIXED_USD} dollars.`, record['value'])
        }
        valueCents = Math.round(value * 100)
      } else if (kind !== 'free_shipping') {
        fail(findings, `${at}.kind`, 'type', 'A discount is a percentage, an amount off or free shipping.', kind)
      }
      if (!Number.isFinite(minimum) || minimum < 0 || minimum > 10_000) {
        fail(findings, `${at}.minimumOrderUsd`, 'discount-minimum', 'A minimum order is between 0 and 10,000 dollars.', record['minimumOrderUsd'])
      }
      const why = checkCopyText(findings, `${at}.why`, record['why'], {
        label: 'Why a discount helps',
        max: AI_PROPOSAL_WHY_MAX_CHARS,
        brackets: false,
      })
      // The discount's own amount is stated in its fields, so only its name
      // and reason are read for a claim: "15% off" is the discount, not a price.
      samples.push({ at: `${at}.name`, text: name }, { at: `${at}.why`, text: why })
      discounts.push({
        name,
        code: typedCode || null,
        kind: kind as AiDiscountKind,
        valuePct,
        valueCents,
        minSubtotalCents: minimum > 0 ? Math.round(minimum * 100) : null,
        why,
      })
    })
  }

  if (!categories.length && !discounts.length && !findings.violations.length) {
    fail(findings, 'categories', 'empty', 'Propose at least one category or one discount.', answer)
  }
  findings.violations.push(
    ...storefrontClaimViolations(findStorefrontClaims(samples, context.merchantWords)),
    ...detectOffVoiceCopy(samples, null),
  )
  return {
    value: findings.violations.length ? null : { categories, discounts },
    violations: findings.violations,
    offending: findings.offending,
  }
}
