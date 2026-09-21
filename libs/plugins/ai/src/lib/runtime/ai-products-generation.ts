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
  AI_CATALOG_OPTION_VALUES_MAX,
  AI_PRODUCT_CATEGORY_LIST_MAX,
  aiProductMerchantWords,
  type AiCatalogProduct,
  type AiCategoriesProposal,
  type AiProductCategory,
  type AiProductCopy,
  type AiProductFacts,
} from '../model/ai-products'
import type { AiStepKind } from '../providers/catalog'
import type { AiImagePart, AiMessagePart, AiProvider } from '../providers/contract'
import { AI_ROUTING_TABLE, type AiPluginSettings } from '../providers/routing'
import {
  AI_CATALOG_TOOL,
  AI_CATALOG_TOOL_NAME,
  AI_CATEGORIES_TOOL,
  AI_CATEGORIES_TOOL_NAME,
  AI_PRODUCT_COPY_TOOL,
  AI_PRODUCT_COPY_TOOL_NAME,
  checkAiCatalog,
  checkAiCategories,
  checkAiProductCopy,
} from '../tools/ai-products-tool'
import { runValidatedGeneration, type AiValidatedGeneration } from './ai-doctrine'
import type { AiSystemBlock } from './ai-runtime'

/**
 * COMMERCE BY AI (AGL-2916): the three generations a `products` job makes, each
 * through the building doctrine's generation call (`runValidatedGeneration`):
 * the doctrine's cached block, which carries the acceptable-use rules, then the
 * generation's own rules, cached after it, and one strict tool. The store's
 * name, a product's facts, its categories, its photo and the brief ride in the
 * user turn, so no byte of a store sits inside the cached prefix, and no site
 * inventory is sent: product copy is written from the product.
 *
 * Every answer is held by a check in `tools/ai-products-tool.ts`, which is
 * where storefront copy safety is enforced — no health, financial or legal
 * claim, no certification or endorsement the merchant did not state, and no
 * price. The rules below say the same, so the model is never refused for a
 * rule it was not told.
 */

/** The step kind every generation of a `products` job is routed as. */
export const AI_PRODUCTS_STEP: AiStepKind = 'job.products'

/**
 * Each generation's answer ceiling. A catalog is the largest answer the step
 * asks for, so it takes the routing table's; one product's copy and a set of
 * categories with discounts are far smaller, and asking them for less keeps a
 * pass's least time short enough for a bulk job to run several a beat.
 * `ai-job-products-step.spec.ts` measures the largest answer each tool accepts
 * against its ceiling.
 */
export const AI_CATALOG_MAX_TOKENS = AI_ROUTING_TABLE[AI_PRODUCTS_STEP].maxTokens
export const AI_PRODUCT_COPY_MAX_TOKENS = 1_500
export const AI_PRODUCT_CATEGORIES_MAX_TOKENS = 2_000

/**
 * Rules every storefront generation states, because its check refuses an
 * answer for each of them.
 */
const STOREFRONT_RULES = [
  'Never write a price, a discount, a shipping promise or a stock level: the store owner sets those.',
  'Never say a product cures, treats, heals or prevents anything, and never promise a health, financial or legal result.',
  'Never claim a certification, an award, a license, an endorsement or a best seller that the owner’s own words do not state.',
  'Write plain text: no markup, no formatting marks, no emoji, no links.',
]

/** The rules for one product's copy. Byte-identical on every request. */
export const AI_PRODUCT_COPY_INSTRUCTIONS: AiSystemBlock[] = [
  {
    text:
      'You write the storefront copy for one product of an online store: its description, its search listing, its tags, the store categories it belongs in and clear names for its options.\n\n' +
      `Answer by calling ${AI_PRODUCT_COPY_TOOL_NAME} exactly once. A reply in prose cannot be used.\n\n` +
      'Rules:\n' +
      [
        'Write only from what you are given: the product’s name, its current text, its tags, its options and its photo. Never invent a material, a size, a quantity, an origin or a feature. Where a shopper would need a fact you do not have, mark it in square brackets, like [material], in the description only.',
        'Keep every fact the current text states, in your own words.',
        ...STOREFRONT_RULES,
        'The description is short paragraphs a shopper reads. The search title names the product plainly; the search description is one or two sentences; neither marks a missing fact.',
        'Tags are words or short phrases a shopper filters by.',
        'Choose categories only from the list you are given, by id, and none when none fits.',
        'Give one name per option the product has, in order, keeping a name that is already clear.',
        'When a photo is attached, use only what it plainly shows, and prefer the product’s own text where the two differ. What it shows — a color, a finish, a shape, a part — is a fact you have: write it, rather than marking it in brackets.',
        'Write in the language of the product’s name and text.',
      ]
        .map((rule) => `- ${rule}`)
        .join('\n'),
    cacheBreakpoint: true,
  },
]

/** The rules for a store's first products. Byte-identical on every request. */
export const AI_CATALOG_INSTRUCTIONS: AiSystemBlock[] = [
  {
    text:
      'You propose the first products of an online store from its owner’s brief. Each is a draft the owner completes: a name, a type, a description, tags, options, a search listing and what its photo should show.\n\n' +
      `Answer by calling ${AI_CATALOG_TOOL_NAME} exactly once. A reply in prose cannot be used.\n\n` +
      'Rules:\n' +
      [
        'Propose 6 to 12 products that fit the brief, unless the brief says how many.',
        'Write only from the brief. Never invent a material, a size, an origin or a feature it does not give; where a shopper would need a fact the brief does not give, mark it in square brackets, like [material], in the description only.',
        ...STOREFRONT_RULES,
        `Options are only the choices a shopper makes, such as a size or a color, with at most ${AI_CATALOG_OPTION_VALUES_MAX} values each; a product with no choice has none.`,
        'The photo says in one sentence what a photo of the product should show, so the owner can take or pick it. Never a link.',
        'The search title names the product plainly, and neither it nor the search description marks a missing fact.',
        'Write in the language of the brief.',
      ]
        .map((rule) => `- ${rule}`)
        .join('\n'),
    cacheBreakpoint: true,
  },
]

/** The rules for categories and discounts. Byte-identical on every request. */
export const AI_CATEGORIES_INSTRUCTIONS: AiSystemBlock[] = [
  {
    text:
      'You propose store categories and a first set of discounts from an online store owner’s brief. The owner creates the ones they accept, and every discount starts switched off.\n\n' +
      `Answer by calling ${AI_CATEGORIES_TOOL_NAME} exactly once. A reply in prose cannot be used.\n\n` +
      'Rules:\n' +
      [
        'Categories group the store’s products the way a shopper browses them. Never repeat a category the store already has.',
        'A discount is a percentage off, an amount off in dollars, or free shipping, with an optional minimum order, and a code a shopper types or no code when it applies on its own. Keep them few and modest, and in line with the brief.',
        'Each category and each discount says in one sentence why it helps this store.',
        'Never promise savings, earnings or results beyond the discount itself, and never make a health, financial or legal claim.',
        'Write plain text: no markup, no emoji, no links.',
        'Propose nothing the brief gives no reason for; an empty list is an answer.',
        'Write in the language of the brief.',
      ]
        .map((rule) => `- ${rule}`)
        .join('\n'),
    cacheBreakpoint: true,
  },
]

export interface AiProductCopyPromptInput {
  /** The store's name, as its visitors see it. */
  store: string
  product: AiProductFacts
  categories: readonly AiProductCategory[]
  /** Whether a photo rides with the request. */
  photo: boolean
}

/** The user turn's text: the store, the product as it stands, and the categories to choose from. */
export function aiProductCopyPrompt(input: AiProductCopyPromptInput): string {
  const { product } = input
  const lines = [
    `Store: ${input.store || 'untitled store'}`,
    `Product: ${product.name}`,
    `Type: ${product.type}`,
    'Current text:',
    product.text.trim() || '(none)',
    `Current tags: ${product.tags.length ? product.tags.join(', ') : '(none)'}`,
  ]
  if (product.options.length) {
    lines.push('Options:', ...product.options.map((option) => `- ${option.name}: ${option.values.join(', ')}`))
  } else {
    lines.push('Options: (none)')
  }
  if (product.seoTitle || product.seoDescription) {
    lines.push(
      `Current search title: ${product.seoTitle || '(none)'}`,
      `Current search description: ${product.seoDescription || '(none)'}`,
    )
  }
  const categories = input.categories.slice(0, AI_PRODUCT_CATEGORY_LIST_MAX)
  lines.push(
    categories.length ? 'Categories to choose from:' : 'Categories to choose from: (none)',
    ...categories.map((category) => `- ${category.id}: ${category.name}`),
    `Photo: ${input.photo ? 'attached' : 'none'}`,
  )
  return lines.join('\n')
}

interface AiProductsGenerationBase {
  settings?: AiPluginSettings
  model?: string
  maxTokens?: number
  signal?: AbortSignal
  provider?: AiProvider
}

export interface GenerateAiProductCopyInput extends AiProductsGenerationBase, AiProductCopyPromptInput {
  /** The product's photo, when the model reads pictures and the photo was read. */
  image?: AiImagePart | null
}

/**
 * Propose one product's copy. It asks the routing table's `job.products` model
 * through the doctrine's generation call and resolves to `ok` with the copy,
 * `needs_input` when the answer could not be held to the rules after one
 * re-ask, or `refused`. It writes nothing.
 */
export function generateAiProductCopy(input: GenerateAiProductCopyInput): Promise<AiValidatedGeneration<AiProductCopy>> {
  const image = input.photo ? (input.image ?? null) : null
  const content: AiMessagePart[] = [
    ...(image ? [image] : []),
    { type: 'text', text: aiProductCopyPrompt({ ...input, photo: Boolean(image) }) },
  ]
  return runValidatedGeneration('product copy', {
    step: AI_PRODUCTS_STEP,
    ...(input.settings ? { settings: input.settings } : {}),
    ...(input.model ? { model: input.model } : {}),
    instructions: AI_PRODUCT_COPY_INSTRUCTIONS,
    messages: [{ role: 'user', content: image ? content : aiProductCopyPrompt({ ...input, photo: false }) }],
    tool: AI_PRODUCT_COPY_TOOL,
    maxTokens: input.maxTokens ?? AI_PRODUCT_COPY_MAX_TOKENS,
    ...thinkingOf(),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    check: (answer) =>
      checkAiProductCopy(answer, {
        categoryIds: input.categories.slice(0, AI_PRODUCT_CATEGORY_LIST_MAX).map((category) => category.id),
        optionCount: input.product.options.length,
        merchantWords: aiProductMerchantWords(input.product),
      }),
  })
}

export interface GenerateAiCatalogInput extends AiProductsGenerationBase {
  store: string
  brief: string
}

/** The user turn for a catalog: the store and the brief. */
export function aiCatalogPrompt(input: Pick<GenerateAiCatalogInput, 'store' | 'brief'>): string {
  return [`Store: ${input.store || 'untitled store'}`, 'Brief:', input.brief.trim()].join('\n')
}

/** Propose a store's first products from a brief. It writes nothing. */
export function generateAiCatalog(input: GenerateAiCatalogInput & { maxTokens: number }): Promise<AiValidatedGeneration<AiCatalogProduct[]>> {
  return runValidatedGeneration('catalog', {
    step: AI_PRODUCTS_STEP,
    ...(input.settings ? { settings: input.settings } : {}),
    ...(input.model ? { model: input.model } : {}),
    instructions: AI_CATALOG_INSTRUCTIONS,
    messages: [{ role: 'user', content: aiCatalogPrompt(input) }],
    tool: AI_CATALOG_TOOL,
    maxTokens: input.maxTokens,
    ...thinkingOf(),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    check: (answer) => checkAiCatalog(answer, { merchantWords: input.brief }),
  })
}

export interface GenerateAiCategoriesInput extends AiProductsGenerationBase {
  store: string
  brief: string
  /** The names of the categories the store already has. */
  existingCategoryNames: readonly string[]
}

/** The user turn for categories and discounts: the store, what it has, and the brief. */
export function aiCategoriesPrompt(input: Pick<GenerateAiCategoriesInput, 'store' | 'brief' | 'existingCategoryNames'>): string {
  const existing = input.existingCategoryNames.slice(0, AI_PRODUCT_CATEGORY_LIST_MAX)
  return [
    `Store: ${input.store || 'untitled store'}`,
    `Categories the store already has: ${existing.length ? existing.join(', ') : '(none)'}`,
    'Brief:',
    input.brief.trim(),
  ].join('\n')
}

/** Propose categories and discounts from a brief. It writes nothing. */
export function generateAiCategories(
  input: GenerateAiCategoriesInput & { maxTokens: number },
): Promise<AiValidatedGeneration<Pick<AiCategoriesProposal, 'categories' | 'discounts'>>> {
  return runValidatedGeneration('store categories and discounts', {
    step: AI_PRODUCTS_STEP,
    ...(input.settings ? { settings: input.settings } : {}),
    ...(input.model ? { model: input.model } : {}),
    instructions: AI_CATEGORIES_INSTRUCTIONS,
    messages: [{ role: 'user', content: aiCategoriesPrompt(input) }],
    tool: AI_CATEGORIES_TOOL,
    maxTokens: input.maxTokens,
    ...thinkingOf(),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    check: (answer) =>
      checkAiCategories(answer, {
        existingCategoryNames: input.existingCategoryNames,
        merchantWords: input.brief,
      }),
  })
}

/** The routing row's thinking and effort, sent only where the row names one. */
function thinkingOf() {
  const row = AI_ROUTING_TABLE[AI_PRODUCTS_STEP]
  return {
    ...(row.thinking ? { thinking: row.thinking } : {}),
    ...(row.effort ? { effort: row.effort } : {}),
  }
}
