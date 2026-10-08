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

import { hostRoleCanWrite } from '@aglyn/aglyn/app-utils/organizations'
import { checkEntitlement, checkQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  registerPluginResourceDraftWriter,
  type PluginDraftCheck,
  type PluginDraftContext,
  type PluginDraftRecord,
  type PluginDraftRefusal,
  type PluginDraftWrite,
  type PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  COMMERCE_MAX_OPTION_VALUES,
  COMMERCE_MAX_OPTIONS,
  COMMERCE_MAX_PRICE_USD,
  COMMERCE_MAX_VARIANTS,
  commerceSlug,
  type HostProduct,
  productCollectionIds,
  productPriceMissing,
  productSearchFields,
  type ProductType,
  type ProposedProduct,
  type SmartCollectionRules,
  unpricedProductDraft,
  type UnpricedProductDraft,
  validateProduct,
} from '../model/commerce'

/**
 * A PRODUCT ANOTHER PLUGIN ASKS FOR (AGL-3616).
 *
 * The draft writer this plugin registers for the `product` resource on the
 * core's resource-drafts seam. A plugin that sets a store up from a brief
 * asks for the writer by name and gets this plugin's rules:
 *
 *  - THE DOCUMENT is the one the products card makes from an accepted AI
 *    proposal (`unpricedProductDraft`): a `draft` — off the storefront, and
 *    refused by every sale door — with one variant per combination of its
 *    options, no photo, and the search, stock and smart-collection keys every
 *    product write derives. Born live (`deletedAt: null`), as the product
 *    resource stamps it, so the products table lists it.
 *  - THE PRICE is left empty unless the content states one. An unpriced
 *    product is marked for the merchant to price: the editor will not save it
 *    and the card will not activate it until every variant has a price.
 *  - THE ROOM is the `productsPerHost` allowance, counted the way the
 *    resources route and the importer count it, inside the transaction that
 *    creates. THE PLAN is the `commerce` feature, and THE ROLE a member who
 *    may write the site's content — refused in the resources route's words.
 *  - THE CHECK is `validateProduct`, the rule every product write is held to,
 *    with a placeholder price standing in where none was stated.
 *
 * Nothing is published, priced or sold. The writer touches the one new
 * product document.
 */

type Firestore = FirebaseFirestore.Firestore

/** The resource name this writer is registered under. */
export const PRODUCT_DRAFT_RESOURCE = 'product'

/** The longest product name the proposals and the editor keep. */
export const PRODUCT_DRAFT_NAME_MAX = 120
/** The longest description a draft keeps. */
export const PRODUCT_DRAFT_DESCRIPTION_MAX = 5_000
/** The most tags a draft keeps, and the longest one. */
export const PRODUCT_DRAFT_TAGS_MAX = 20
export const PRODUCT_DRAFT_TAG_MAX = 40
/** The most categories a draft is filed under. */
export const PRODUCT_DRAFT_CATEGORIES_MAX = 10
/** The longest search-listing title and description a draft keeps. */
export const PRODUCT_DRAFT_SEO_TITLE_MAX = 120
export const PRODUCT_DRAFT_SEO_DESCRIPTION_MAX = 320

/** The resources route's refusal for a member who may not write the site. */
export const PRODUCT_DRAFT_ROLE_REFUSAL = 'Editing requires the editor role'
/** The resources route's refusal for a plan without the feature. */
export const PRODUCT_DRAFT_PLAN_REFUSAL = 'This feature is not included in your plan — see Billing'

/** The resources route's refusal at the plan's allowance. */
export function productDraftLimitRefusal(limit: number): string {
  return `Your plan includes ${limit} ${limit === 1 ? 'product' : 'products'} — ` +
    'upgrade in Billing for more'
}

/**
 * What a caller sends as `content`: a proposed product, as the AI products
 * job proposes one, with an optional stated price for every variant and the
 * ids of categories the site already has. A photo is never taken: the
 * merchant adds pictures in the editor.
 */
export interface ProductDraftContent {
  name: string
  type?: ProductType
  description?: string
  tags?: string[]
  options?: Array<{ name: string; values: string[] }>
  seoTitle?: string
  seoDescription?: string
  /** One price for every variant, in dollars; absent leaves them unpriced. */
  priceUsd?: number
  /** Ids of the site's product categories; one the site lacks is dropped. */
  categoryIds?: string[]
}

const PRODUCT_TYPES: readonly ProductType[] = ['physical', 'digital', 'service']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Text on one line: controls and runs of space folded to one space. */
function line(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\p{Cc}\s]+/gu, ' ').trim() : ''
}

function strings(label: string, value: unknown, problems: string[]): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    problems.push(`${label} are a list of words`)
    return []
  }
  return [...new Set(value.map(line).filter(Boolean))]
}

/** A draft as the writer will store it, before its slug and keys are settled. */
export interface ProductDraftRead {
  proposal: ProposedProduct
  /** The price stated for every variant, or `null` for the merchant to set. */
  priceUsd: number | null
  categoryIds: string[]
}

export type ProductDraftContentRead =
  | { ok: true; value: ProductDraftRead }
  | { ok: false; problems: string[] }

/** The content as the writer reads it, or every problem that stops it. */
export function readProductDraftContent(
  content: Readonly<Record<string, unknown>>,
): ProductDraftContentRead {
  const problems: string[] = []
  const name = line(content['name'])
  if (!name) problems.push('The product needs a name')
  else if (name.length > PRODUCT_DRAFT_NAME_MAX) {
    problems.push(`The name is longer than ${PRODUCT_DRAFT_NAME_MAX} characters`)
  }
  const rawType = content['type'] ?? 'physical'
  if (!(PRODUCT_TYPES as readonly unknown[]).includes(rawType)) {
    problems.push('The type is physical, digital or service')
  }
  const rawDescription = content['description']
  const description = typeof rawDescription === 'string' ? rawDescription.trim() : ''
  if (rawDescription !== undefined && typeof rawDescription !== 'string') {
    problems.push('The description is text')
  } else if (description.length > PRODUCT_DRAFT_DESCRIPTION_MAX) {
    problems.push(`The description is longer than ${PRODUCT_DRAFT_DESCRIPTION_MAX} characters`)
  }
  const tags = strings('Tags', content['tags'], problems)
  if (tags.length > PRODUCT_DRAFT_TAGS_MAX) problems.push(`A product keeps at most ${PRODUCT_DRAFT_TAGS_MAX} tags`)
  if (tags.some((tag) => tag.length > PRODUCT_DRAFT_TAG_MAX)) {
    problems.push(`A tag is longer than ${PRODUCT_DRAFT_TAG_MAX} characters`)
  }
  const categoryIds = strings('Categories', content['categoryIds'], problems)
  if (categoryIds.length > PRODUCT_DRAFT_CATEGORIES_MAX) {
    problems.push(`A product is filed under at most ${PRODUCT_DRAFT_CATEGORIES_MAX} categories`)
  }
  const seoTitle = line(content['seoTitle'])
  const seoDescription = line(content['seoDescription'])
  if (seoTitle.length > PRODUCT_DRAFT_SEO_TITLE_MAX) {
    problems.push(`The search title is longer than ${PRODUCT_DRAFT_SEO_TITLE_MAX} characters`)
  }
  if (seoDescription.length > PRODUCT_DRAFT_SEO_DESCRIPTION_MAX) {
    problems.push(`The search description is longer than ${PRODUCT_DRAFT_SEO_DESCRIPTION_MAX} characters`)
  }

  // Options are held here before the draft expands them: a matrix past the
  // variant ceiling is refused, never built.
  const rawOptions = content['options'] ?? []
  const options: ProposedProduct['options'] = []
  if (!Array.isArray(rawOptions)) {
    problems.push('Options are a list of a name and its values')
  } else {
    if (rawOptions.length > COMMERCE_MAX_OPTIONS) {
      problems.push(`At most ${COMMERCE_MAX_OPTIONS} options per product`)
    }
    for (const option of rawOptions) {
      const optionName = isRecord(option) ? line(option['name']) : ''
      const values = isRecord(option) ? strings(`The values of "${optionName}"`, option['values'], problems) : []
      if (!optionName || !values.length) {
        problems.push('Each option needs a name and at least one value')
        continue
      }
      if (values.length > COMMERCE_MAX_OPTION_VALUES) {
        problems.push(`Option "${optionName}" has too many values`)
        continue
      }
      options.push({ name: optionName, values })
    }
    if (new Set(options.map((option) => option.name)).size !== options.length) {
      problems.push('Each option needs its own name')
    }
    const combinations = options.reduce((count, option) => count * option.values.length, 1)
    if (combinations > COMMERCE_MAX_VARIANTS) {
      problems.push(`Those options make ${combinations} variants; a product holds at most ${COMMERCE_MAX_VARIANTS}`)
    }
  }

  // No price unless one is stated: the merchant sets it otherwise.
  const rawPrice = content['priceUsd']
  let priceUsd: number | null = null
  if (rawPrice !== undefined && rawPrice !== null) {
    if (
      typeof rawPrice !== 'number' ||
      !Number.isFinite(rawPrice) ||
      rawPrice < 0 ||
      rawPrice > COMMERCE_MAX_PRICE_USD ||
      Math.round(rawPrice * 100) !== rawPrice * 100
    ) {
      problems.push(`A stated price is dollars and cents from 0 to ${COMMERCE_MAX_PRICE_USD}`)
    } else {
      priceUsd = rawPrice
    }
  }
  if (problems.length) return { ok: false, problems: [...new Set(problems)] }
  return {
    ok: true,
    value: {
      proposal: {
        name,
        type: rawType as ProductType,
        description,
        tags,
        options,
        seoTitle,
        seoDescription,
      },
      priceUsd,
      categoryIds,
    },
  }
}

/** The product document a read builds, under `slug`, at `nowMs`. */
export function productDraftDocument(
  read: ProductDraftRead,
  slug: string,
  nowMs: number,
): UnpricedProductDraft | HostProduct {
  const draft = unpricedProductDraft(read.proposal, new Set(), nowMs)
  const priced =
    read.priceUsd === null
      ? draft
      : ({
          ...draft,
          variants: draft.variants.map((variant) => ({ ...variant, priceUsd: read.priceUsd as number })),
        } as HostProduct)
  return {
    ...priced,
    // The search keys travel with every create; recomputed for the price.
    ...productSearchFields(priced as HostProduct),
    slug,
    ...(read.categoryIds.length ? { categoryIds: read.categoryIds } : {}),
  }
}

/** What the owner's product rule says about a draft, a placeholder price standing in for none. */
function productProblem(product: UnpricedProductDraft | HostProduct): string | null {
  return validateProduct({
    ...product,
    variants: product.variants.map((variant) => ({
      ...variant,
      priceUsd: (variant as { priceUsd?: number }).priceUsd ?? 0,
    })),
  } as HostProduct)
}

function factsOf(product: Partial<HostProduct>) {
  return {
    status: product.status ?? 'draft',
    slug: product.slug ?? '',
    type: product.type ?? 'physical',
    variants: product.variants?.length ?? 0,
    priceMissing: productPriceMissing({ variants: product.variants ?? [] }),
  }
}

/** Whether content is a product this plugin would store, with what it says about it. Pure. */
export function checkProductDraftContent(content: Readonly<Record<string, unknown>>): PluginDraftCheck {
  const read = readProductDraftContent(content)
  if (read.ok === false) return read
  const slug = commerceSlug(read.value.proposal.name) || 'product'
  const product = productDraftDocument(read.value, slug, 0)
  const problem = productProblem(product)
  return problem ? { ok: false, problems: [problem] } : { ok: true, facts: factsOf(product as HostProduct) }
}

function recordOf(product: FirebaseFirestore.DocumentSnapshot): PluginDraftRecord {
  const data = (product.data() ?? {}) as Partial<HostProduct>
  return { id: product.id, name: String(data.name ?? ''), versionId: null, facts: factsOf(data) }
}

export function roleRefusal(host: FirebaseFirestore.DocumentSnapshot, uid: string): PluginDraftRefusal | null {
  const role = (host.get('memberRoles') ?? {})[uid]
  return hostRoleCanWrite(role) ? null : { status: 403, error: PRODUCT_DRAFT_ROLE_REFUSAL }
}

export function planRefusal(org: PluginDraftContext['org']): PluginDraftRefusal | null {
  return checkEntitlement(org as never, 'commerce') ? null : { status: 403, error: PRODUCT_DRAFT_PLAN_REFUSAL }
}

/** The allowance, counted as the resources route and the importer count a product create. */
export function roomRefusal(org: PluginDraftContext['org'], used: number): PluginDraftRefusal | null {
  const quota = checkQuota(org as never, 'productsPerHost', used)
  return quota.allowed ? null : { status: 403, error: productDraftLimitRefusal(quota.limit) }
}

/** Candidates asked of the store at once, as the console's slug ledger probes. */
const SLUG_PROBE = 10

/**
 * The first of `base`, `base-2`, `base-3`, … that no product holds, live or
 * deleted — a soft-deleted product still answers its slug on the storefront
 * (`productSlugLedger`, AGL-3321). Asked inside the transaction.
 */
async function freeSlug(
  products: FirebaseFirestore.CollectionReference,
  base: string,
  read: (query: FirebaseFirestore.Query) => Promise<FirebaseFirestore.QuerySnapshot>,
): Promise<string> {
  const candidate = (suffix: number) => (suffix < 2 ? base : `${base}-${suffix}`)
  for (let first = 1; ; first += SLUG_PROBE) {
    const batch = Array.from({ length: SLUG_PROBE }, (_, offset) => candidate(first + offset))
    const held = new Set(
      (await read(products.where('slug', 'in', batch))).docs.map((doc) => String(doc.get('slug') ?? '')),
    )
    const free = batch.find((slug) => !held.has(slug))
    if (free) return free
  }
}

export interface ProductDraftWriterDeps {
  /** The Admin SDK handle; specs hand in a double. */
  firestore?: () => Firestore
}

export function createProductDraftWriter(deps: ProductDraftWriterDeps = {}): PluginResourceDraftWriter {
  const firestore = deps.firestore ?? (() => firebaseAdmin.app().firestore() as unknown as Firestore)
  return {
    refusal: async (context) => {
      const hostRef = firestore().collection('hosts').doc(context.hostId)
      const host = await hostRef.get()
      if (!host.exists) return { status: 404, error: 'Unknown site' }
      const early = roleRefusal(host, context.uid) ?? planRefusal(context.org)
      if (early) return early
      const used = (await hostRef.collection('products').count().get()).data().count
      return roomRefusal(context.org, Number(used) || 0)
    },

    check: (content) => checkProductDraftContent(content),

    read: async ({ hostId, id }) => {
      const product = await firestore().collection('hosts').doc(hostId).collection('products').doc(id).get()
      return product.exists ? recordOf(product) : null
    },

    write: async (request): Promise<PluginDraftWrite> => {
      // The request's name is the one asked for; the content's stands in.
      const asked = line(request.name)
      const read = readProductDraftContent(asked ? { ...request.content, name: asked } : request.content)
      if (read.ok === false) return { ok: false, status: 400, error: read.problems[0] }
      const db = firestore()
      const hostRef = db.collection('hosts').doc(request.hostId)
      const products = hostRef.collection('products')
      const productRef = products.doc(request.id)
      return db.runTransaction(async (tx): Promise<PluginDraftWrite> => {
        // Every read before any write, which Firestore requires.
        const [host, existing] = await Promise.all([tx.get(hostRef), tx.get(productRef)])
        if (!host.exists) return { ok: false, status: 404, error: 'Unknown site' }
        // Asked again under the same id: the draft it already wrote.
        if (existing.exists) return { ok: true, replayed: true, ...recordOf(existing) }
        const early = roleRefusal(host, request.uid) ?? planRefusal(request.org)
        if (early) return { ok: false, ...early }
        const used = (await tx.get(products.count())).data().count
        const room = roomRefusal(request.org, Number(used) || 0)
        if (room) return { ok: false, ...room }
        const base = commerceSlug(read.value.proposal.name) || 'product'
        const [slug, categories, smart] = await Promise.all([
          freeSlug(products, base, (query) => tx.get(query)),
          // A category the site does not have is dropped, not stored.
          read.value.categoryIds.length
            ? Promise.all(read.value.categoryIds.map((id) => tx.get(hostRef.collection('productCategories').doc(id))))
            : Promise.resolve([]),
          tx.get(hostRef.collection('collections').where('kind', '==', 'catalog').where('mode', '==', 'smart')),
        ])
        const categoryIds = categories.filter((category) => category.exists).map((category) => category.id)
        const nowMs = request.now.getTime()
        const product = productDraftDocument({ ...read.value, categoryIds }, slug, nowMs)
        const problem = productProblem(product)
        if (problem) return { ok: false, status: 400, error: problem }
        const rules: SmartCollectionRules[] = smart.docs.map((doc) => ({
          id: doc.id,
          rules: doc.get('rules') ?? [],
          matchAll: doc.get('matchAll'),
        }))
        const priced = read.value.priceUsd !== null
        tx.create(productRef, {
          ...product,
          collectionIds: productCollectionIds(product as HostProduct, rules),
          // The legacy flat price every create path still writes, only where
          // there is one: an unpriced draft is not a free one.
          ...(priced ? { priceUsd: read.value.priceUsd } : {}),
          deletedAt: null,
          createdAt: request.now,
          updatedAt: request.now,
          createdBy: request.uid,
        })
        return {
          ok: true,
          replayed: false,
          id: request.id,
          name: product.name,
          versionId: null,
          facts: factsOf(product as HostProduct),
        }
      })
    },
  }
}

export const productDraftWriter = createProductDraftWriter()

/**
 * Registers the writer; the console surface calls it, since only the console
 * runs AI jobs (AGL-3026). Idempotent: a second call replaces the first.
 */
export function registerProductDraftWriter(): void {
  registerPluginResourceDraftWriter(PRODUCT_DRAFT_RESOURCE, productDraftWriter, { pluginId: BUNDLE_ID })
}
