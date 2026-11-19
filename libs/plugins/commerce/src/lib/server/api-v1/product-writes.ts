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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { SCREEN_SEO_TEXT_GUIDANCE } from '@aglyn/aglyn/app-utils/screen-seo-fields'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { ApiErrors, apiJson } from '@aglyn/tenant-data-admin'
import {
  type ApiV1Context,
  apiActorFields,
  claimWrite,
  readJsonBody,
} from '@aglyn/tenant-data-admin/server/api-v1-kit'
import {
  COMMERCE_MAX_OPTIONS,
  COMMERCE_SLUG_MAX_LENGTH,
  commerceSlug,
  liftLegacyProduct,
  type ProductOption,
  type ProductStatus,
  type ProductType,
  type ProductVariant,
  renameProductOptions,
  stockTrackingApplies,
  variantMatrixProblem,
} from '../../model/commerce'
import {
  blankProductDraft,
  type EditedProduct,
  PRODUCT_NAME_MAX_LENGTH,
  variantComboKey,
  variantsForOptions,
} from '../../model/product-write'
import {
  claimProductSlug,
  deleteProduct,
  type ProductBuildRefusal,
  type ProductSaveInput,
  type ProductWriteRefusal,
  saveProduct,
} from '../products-write'
import { productView } from './product-view'

/*
 * A site's products, written over the customer REST API (AGL-4235):
 * `POST /v1/sites/{siteId}/products`, `PATCH` and `DELETE` on one product,
 * and `PATCH` on one of its variants.
 *
 * Every write here is the console editor's own, through `saveProduct` and
 * `deleteProduct` — the functions the native apps' routes call — so a product
 * saved by an integration carries exactly the search keys, stock verdict,
 * price, image, smart-collection membership and cache drop the editor's
 * save would have written, and meets the same checks.
 *
 * What a person can do in the editor is the boundary. Variants are the grid
 * of a product's option values, rebuilt from the options as the editor
 * rebuilds it (`variantsForOptions`); a person cannot add or remove one
 * variant by itself, so neither can a caller. Stock is typed into the grid
 * and written by the save, `null` for untracked and `0` for sold out.
 *
 * Every function here is pre-authorized: `handleProducts` asks the scope,
 * the plan, the plugin's switch for the site and the person's permission
 * before it calls one.
 */

/** The members a product write may carry, in the order the description lists them. */
export const PRODUCT_WRITABLE_KEYS = [
  'name',
  'description',
  'status',
  'type',
  'slug',
  'tags',
  'categoryIds',
  'mediaUrls',
  'options',
  'variants',
  'seo',
] as const

/** The members a variant write may carry. */
export const VARIANT_WRITABLE_KEYS = [
  'priceUsd',
  'compareAtPriceUsd',
  'sku',
  'barcode',
  'weightGrams',
  'inventory',
] as const

/** What names the variant one entry of a product write's `variants` changes. */
const VARIANT_TARGET_KEYS = ['id', 'options'] as const

/** The search listing members a write may set. */
const SEO_WRITABLE_KEYS = ['title', 'description'] as const

/**
 * The kinds of product a caller may make. A digital product delivers files a
 * person uploads in the editor, so it is made there.
 */
export const PRODUCT_API_TYPES: readonly ProductType[] = ['physical', 'service']
export const PRODUCT_DIGITAL_REFUSAL =
  'A digital product delivers files uploaded in the console, so it is created and changed to digital there.'

export const PRODUCT_STATUSES: readonly ProductStatus[] = ['draft', 'active', 'archived']

/** The stock a digital or service subscription cannot keep (AGL-1744), as the editor says it. */
export const PRODUCT_STOCK_NOT_TRACKED =
  'Stock is not tracked on a digital or service subscription. Send `null` to clear it.'

/** One variant's writable fields, as parsed. `null` clears a field; absent leaves it. */
export interface VariantWrite {
  priceUsd?: number | null
  compareAtPriceUsd?: number | null
  sku?: string | null
  barcode?: string | null
  weightGrams?: number | null
  inventory?: number | null
}

/** One entry of a product write's `variants`: the variant it names, and what changes on it. */
export interface VariantTargetWrite extends VariantWrite {
  id?: string
  options?: Record<string, string>
}

export interface ProductWriteValues {
  name?: string
  description?: string
  status?: ProductStatus
  type?: ProductType
  slug?: string
  tags?: string[]
  categoryIds?: string[]
  mediaUrls?: string[]
  options?: ProductOption[]
  variants?: VariantTargetWrite[]
  seo?: { title?: string | null; description?: string | null }
}

type Parsed<T> = { values: T } | { errors: Record<string, string> }

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** Each key of `body` not in `allowed`, named for the 400. */
function unknownKeys(body: Record<string, unknown>, allowed: readonly string[], prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.keys(body)
      .filter((key) => !allowed.includes(key))
      .map((key) => [`${prefix}${key}`, 'Not writable here']),
  )
}

/** A list of non-empty trimmed strings, or why not. */
function stringList(value: unknown): string[] | string {
  if (!Array.isArray(value)) return 'Must be an array of strings'
  if (value.some((entry) => typeof entry !== 'string')) return 'Must be an array of strings'
  return (value as string[]).map((entry) => entry.trim()).filter(Boolean)
}

/** A number the field may hold, `null` to clear it, or why not. */
function amount(value: unknown, what: string): number | null | string {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return `${what} must be a number, zero or more, or null`
  return value
}

/**
 * One variant's writable fields from a body (`VariantWrite`). With `target`,
 * also the `id` or `options` that name which variant it is — an entry of a
 * product write's `variants`.
 */
export function readVariantWrite(
  body: unknown,
  options: { target?: boolean; prefix?: string } = {},
): Parsed<VariantTargetWrite> {
  const prefix = options.prefix ?? ''
  if (!isPlainObject(body)) return { errors: { [prefix || 'body']: 'Must be an object' } }
  const allowed: readonly string[] = options.target ? [...VARIANT_WRITABLE_KEYS, ...VARIANT_TARGET_KEYS] : VARIANT_WRITABLE_KEYS
  const errors: Record<string, string> = unknownKeys(body, allowed, prefix)
  const values: VariantTargetWrite = {}
  for (const field of ['priceUsd', 'compareAtPriceUsd', 'weightGrams'] as const) {
    if (!(field in body)) continue
    const parsed = amount(body[field], field === 'weightGrams' ? 'A weight' : 'A price')
    if (typeof parsed === 'string') errors[`${prefix}${field}`] = parsed
    else values[field] = parsed
  }
  for (const field of ['sku', 'barcode'] as const) {
    if (!(field in body)) continue
    const raw = body[field]
    if (raw !== null && typeof raw !== 'string') errors[`${prefix}${field}`] = 'Must be a string, or null'
    else values[field] = typeof raw === 'string' ? raw.trim() : null
  }
  if ('inventory' in body) {
    const raw = body['inventory']
    if (raw !== null && !(typeof raw === 'number' && Number.isInteger(raw) && raw >= 0)) {
      errors[`${prefix}inventory`] = 'Must be a whole number, zero or more (0 is sold out), or null (stock not tracked)'
    } else values.inventory = raw as number | null
  }
  if (options.target) {
    if ('id' in body) {
      if (typeof body['id'] !== 'string' || !body['id']) errors[`${prefix}id`] = 'Must be a variant id'
      else values.id = body['id']
    }
    if ('options' in body) {
      const raw = body['options']
      if (!isPlainObject(raw) || Object.values(raw).some((value) => typeof value !== 'string')) {
        errors[`${prefix}options`] = 'Must map each option name to one of its values'
      } else values.options = raw as Record<string, string>
    }
    if (!('id' in body) && !('options' in body)) {
      errors[prefix || 'variant'] = 'Name the variant by its `id` or by its `options`'
    }
  }
  return Object.keys(errors).length ? { errors } : { values }
}

/**
 * A product write's body (`ProductWrite`): the members the editor lets a
 * person set without a further plan feature. Every member it does not name
 * is a 400 that names it. `create` requires `name`.
 */
export function readProductWrite(body: Record<string, unknown>, options: { create: boolean }): Parsed<ProductWriteValues> {
  const errors: Record<string, string> = unknownKeys(body, PRODUCT_WRITABLE_KEYS)
  const values: ProductWriteValues = {}
  if ('name' in body || options.create) {
    const name = body['name']
    if (typeof name !== 'string' || !name.trim()) errors['name'] = 'Required, and not blank'
    else if (name.trim().length > PRODUCT_NAME_MAX_LENGTH) errors['name'] = `At most ${PRODUCT_NAME_MAX_LENGTH} characters`
    else values.name = name.trim()
  }
  if ('description' in body) {
    const description = body['description']
    if (description !== null && typeof description !== 'string') errors['description'] = 'Must be a string, or null'
    else values.description = typeof description === 'string' ? description : ''
  }
  if ('status' in body) {
    if (!PRODUCT_STATUSES.includes(body['status'] as ProductStatus)) errors['status'] = `Must be one of: ${PRODUCT_STATUSES.join(', ')}`
    else values.status = body['status'] as ProductStatus
  }
  if ('type' in body) {
    const type = body['type']
    if (type === 'digital') errors['type'] = PRODUCT_DIGITAL_REFUSAL
    else if (!PRODUCT_API_TYPES.includes(type as ProductType)) errors['type'] = `Must be one of: ${PRODUCT_API_TYPES.join(', ')}`
    else values.type = type as ProductType
  }
  if ('slug' in body) {
    const slug = body['slug']
    if (typeof slug !== 'string' || !slug || slug !== commerceSlug(slug)) {
      errors['slug'] = `Lowercase letters, numbers and dashes, at most ${COMMERCE_SLUG_MAX_LENGTH} characters`
    } else values.slug = slug
  }
  for (const field of ['tags', 'categoryIds', 'mediaUrls'] as const) {
    if (!(field in body)) continue
    const list = stringList(body[field])
    if (typeof list === 'string') errors[field] = list
    else if (field === 'mediaUrls' && list.some((url) => !/^https?:\/\/\S+$/.test(url))) errors[field] = 'Each must be an http or https URL'
    else values[field] = field === 'tags' ? list : [...new Set(list)]
  }
  if ('options' in body) {
    const raw = body['options']
    if (!Array.isArray(raw)) errors['options'] = 'Must be an array of { name, values }'
    else if (raw.length > COMMERCE_MAX_OPTIONS) errors['options'] = `At most ${COMMERCE_MAX_OPTIONS} options per product`
    else {
      const parsed: ProductOption[] = []
      raw.forEach((option, index) => {
        const optionValues = isPlainObject(option) ? stringList(option['values']) : 'Must be { name, values }'
        if (!isPlainObject(option)) errors[`options[${index}]`] = 'Must be { name, values }'
        else if (Object.keys(unknownKeys(option, ['name', 'values'])).length) errors[`options[${index}]`] = 'Only `name` and `values`'
        else if (typeof option['name'] !== 'string' || !option['name'].trim()) errors[`options[${index}].name`] = 'Required, and not blank'
        else if (typeof optionValues === 'string') errors[`options[${index}].values`] = optionValues
        // Trimmed and blanks dropped, as the editor's value chips are.
        else parsed.push({ name: option['name'].trim(), values: optionValues })
      })
      values.options = parsed
    }
  }
  if ('variants' in body) {
    const raw = body['variants']
    if (!Array.isArray(raw)) errors['variants'] = 'Must be an array of variant changes'
    else {
      const parsed: VariantTargetWrite[] = []
      raw.forEach((entry, index) => {
        const read = readVariantWrite(entry, { target: true, prefix: `variants[${index}].` })
        if ('errors' in read) Object.assign(errors, read.errors)
        else parsed.push(read.values)
      })
      values.variants = parsed
    }
  }
  if ('seo' in body) {
    const raw = body['seo']
    if (!isPlainObject(raw)) errors['seo'] = 'Must be { title, description }'
    else {
      Object.assign(errors, unknownKeys(raw, SEO_WRITABLE_KEYS, 'seo.'))
      const seo: NonNullable<ProductWriteValues['seo']> = {}
      for (const field of SEO_WRITABLE_KEYS) {
        if (!(field in raw)) continue
        const text = raw[field]
        const limit = SCREEN_SEO_TEXT_GUIDANCE[field]
        if (text !== null && typeof text !== 'string') errors[`seo.${field}`] = 'Must be a string, or null'
        else if (typeof text === 'string' && text.trim().length > limit) errors[`seo.${field}`] = `At most ${limit} characters`
        else seo[field] = typeof text === 'string' ? text.trim() : null
      }
      values.seo = seo
    }
  }
  return Object.keys(errors).length ? { errors } : { values }
}

/** A variant with a variant write applied, as the editor's grid applies a typed cell. */
export function applyVariantWrite(variant: ProductVariant, write: VariantWrite): ProductVariant {
  const next: Record<string, unknown> = { ...variant }
  for (const field of ['priceUsd', 'compareAtPriceUsd', 'weightGrams'] as const) {
    if (!(field in write)) continue
    // A cleared number is no number (AGL-3676): the key goes.
    if (write[field] === null) delete next[field]
    else next[field] = write[field]
  }
  for (const field of ['sku', 'barcode'] as const) {
    if (!(field in write)) continue
    if (!write[field]) delete next[field]
    else next[field] = write[field]
  }
  // `null` untracked, a number counted: the grid's Stock cell.
  if ('inventory' in write) next['inventory'] = write.inventory ?? null
  return next as unknown as ProductVariant
}

const buildRefusal = (status: number, error: string, detail?: Record<string, string>): ProductBuildRefusal => ({
  refusal: { status, error, ...(detail ? { detail } : {}) },
})

/** Whether a stock number is asked of a product that cannot keep one. */
function stockRefusal(product: EditedProduct, writes: readonly VariantWrite[], field: (index: number) => string) {
  if (stockTrackingApplies(product)) return null
  const index = writes.findIndex((write) => typeof write.inventory === 'number')
  return index === -1 ? null : buildRefusal(400, 'Product failed validation', { [field(index)]: PRODUCT_STOCK_NOT_TRACKED })
}

/**
 * The product a write makes of `base`: only the members it carries change,
 * so every field it does not name — the ones this API does not expose
 * included — stays as stored.
 */
export function mergeProductWrite(base: EditedProduct, values: ProductWriteValues, nowMs: number): EditedProduct | ProductBuildRefusal {
  let next: EditedProduct = { ...base }
  for (const field of ['name', 'description', 'status', 'type', 'slug', 'tags', 'categoryIds', 'mediaUrls'] as const) {
    if (values[field] !== undefined) (next as unknown as Record<string, unknown>)[field] = values[field]
  }
  if (values.seo) {
    const seo: Record<string, unknown> = { ...(base.seo ?? {}) }
    for (const [field, text] of Object.entries(values.seo)) {
      if (text) seo[field] = text
      else delete seo[field]
    }
    if (Object.keys(seo).length) next.seo = seo as EditedProduct['seo']
    else delete next.seo
  }
  if (values.options) {
    const options = values.options
    // A rename moves each variant's selections to the new name (AGL-3066),
    // as the editor's rename does; then the grid is rebuilt from the values,
    // as the editor's value change does. Past the ceiling the variants are
    // left as they are and the save refuses (AGL-4100).
    if ((next.options ?? []).length === options.length) {
      next = { ...next, ...renameProductOptions(next, options.map((option) => option.name)) }
    }
    if (!variantMatrixProblem(options)) next.variants = variantsForOptions(next, options, nowMs)
    next.options = options
  }
  if (values.variants?.length) {
    const variants = [...next.variants]
    const seen = new Set<number>()
    for (const [index, write] of values.variants.entries()) {
      const at = write.id
        ? variants.findIndex((variant) => variant.id === write.id)
        : variants.findIndex((variant) => variantComboKey(variant.options) === variantComboKey(write.options))
      if (at === -1) {
        return buildRefusal(400, 'Product failed validation', {
          [`variants[${index}]`]: write.id
            ? 'No variant of this product has this id'
            : 'No variant of this product has these options; a product’s variants are every combination of its options',
        })
      }
      if (seen.has(at)) return buildRefusal(400, 'Product failed validation', { [`variants[${index}]`]: 'Names a variant another entry already changes' })
      seen.add(at)
      // Only the variant fields apply; `id` and `options` named the variant.
      variants[at] = applyVariantWrite(variants[at], write)
    }
    next.variants = variants
    const refused = stockRefusal(next, values.variants, (index) => `variants[${index}].inventory`)
    if (refused) return refused
  }
  return next
}

/** A product write's refusal, in the API's envelope. */
function refusalResponse(ctx: ApiV1Context, refusal: ProductWriteRefusal): Response {
  switch (refusal.code) {
    case 'invalid':
      return ApiErrors.badRequest({ message: refusal.error, code: 'validation_failed', headers: ctx.headers })
    case 'plan':
      return ApiErrors.planRequired({ message: refusal.error, code: 'commerce', headers: ctx.headers })
    case 'quota':
      return ApiErrors.planRequired({ message: refusal.error, code: 'product_quota', headers: ctx.headers })
    case 'slug_taken':
      return ApiErrors.conflict({ message: refusal.error, code: 'slug_taken', headers: ctx.headers })
    case 'missing':
      return ApiErrors.notFound({ message: 'No such product', headers: ctx.headers })
    case 'refused':
      return refusal.status === 404
        ? ApiErrors.notFound({ message: refusal.error, headers: ctx.headers })
        : ApiErrors.badRequest({
            message: refusal.error,
            code: 'validation_failed',
            ...(refusal.detail ? { fields: refusal.detail as Record<string, string> } : {}),
            headers: ctx.headers,
          })
  }
}

const validationFailed = (ctx: ApiV1Context, fields: Record<string, string>, message = 'Product failed validation') =>
  ApiErrors.badRequest({ message, code: 'validation_failed', fields, headers: ctx.headers })

function productsOf(ctx: ApiV1Context, hostId: string) {
  return ctx.firestore.collection('hosts').doc(hostId).collection('products')
}

/** The categories a write names that the site does not have. */
async function danglingCategories(ctx: ApiV1Context, hostId: string, ids: readonly string[] | undefined) {
  if (!ids?.length) return null
  const categories = ctx.firestore.collection('hosts').doc(hostId).collection('productCategories')
  const missing: string[] = []
  for (const id of ids) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !(await categories.doc(id).get()).exists) missing.push(id)
  }
  return missing.length ? { categoryIds: `No such category on this site: ${missing.join(', ')}` } : null
}

/** What every save from here hands `saveProduct` beside the product. */
function saveContext(ctx: ApiV1Context, hostId: string, deps: ProductApiDeps) {
  return {
    firestore: ctx.firestore,
    hostId,
    org: ctx.org as Record<string, unknown>,
    nowMs: (deps.now ?? Date.now)(),
    dropCache: deps.dropCache ?? dropPluginSiteCache,
  }
}

/** Seams for the specs; production passes none. */
export interface ProductApiDeps {
  now?: () => number
  dropCache?: ProductSaveInput['dropCache']
}

/**
 * The product a create starts from: the editor's blank draft, unpriced.
 *
 * The editor opens a new product at its default price for the person looking
 * at it to change or clear. A caller sees no such field: one that sent no
 * price asked for none, so its variant is saved unpriced — "Price coming
 * soon", not for sale (`variantHasPrice`) — rather than at a price nobody
 * chose. A grid rebuilt from options takes the first variant's values, as the
 * editor's does, so its new combinations are unpriced too until a variant
 * write prices them.
 */
export function unpricedProductDraft(): EditedProduct {
  const draft = blankProductDraft()
  return {
    ...draft,
    variants: draft.variants.map((variant) => {
      const unpriced: Partial<ProductVariant> = { ...variant }
      delete unpriced.priceUsd
      return unpriced as ProductVariant
    }),
  }
}

/**
 * `POST /v1/sites/{siteId}/products` — the editor's Add product.
 *
 * A draft unless `status` says otherwise, as the editor starts one, so a new
 * product is not on sale until someone means it to be. The id is minted
 * here. The slug is claimed from the name when none is sent, as Duplicate
 * claims one (`claimProductSlug`), and a sent slug another product holds —
 * a deleted one's included, because a deleted product still answers its
 * slug on the storefront — is a 409.
 *
 * Replay-safe on an `Idempotency-Key`, as `createContact` is and for its
 * reasons: validation above the claim, every refusal after it releasing the
 * key, the plan and the allowance counted inside the save's transaction.
 */
export async function createProduct(
  request: Request,
  ctx: ApiV1Context,
  hostId: string,
  deps: ProductApiDeps = {},
): Promise<Response> {
  const parsed = readProductWrite(await readJsonBody(request), { create: true })
  if ('errors' in parsed) return validationFailed(ctx, parsed.errors)
  const values = parsed.values
  const dangling = await danglingCategories(ctx, hostId, values.categoryIds)
  if (dangling) return validationFailed(ctx, dangling)
  const draft = mergeProductWrite(unpricedProductDraft(), values, (deps.now ?? Date.now)())
  if ('refusal' in draft) return refusalResponse(ctx, { ok: false, code: 'refused', ...draft.refusal })

  const claimed = await claimWrite(ctx, hostId, request.headers.get('Idempotency-Key'), 'product-creates')
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed
  try {
    const products = productsOf(ctx, hostId)
    const productId = createResourceUid()
    const base = commerceSlug(draft.name)
    const slug = values.slug ?? (base ? await claimProductSlug(products, base) : '')
    const saved = await saveProduct({
      ...saveContext(ctx, hostId, deps),
      productId,
      create: true,
      product: { ...draft, slug },
      uniqueSlug: true,
      // The person a connected app acts for, where the app's routes stamp the
      // member; an API key is no person, and its name says who made it.
      createdBy: ctx.uid ?? null,
      createStamps: apiActorFields(ctx),
      cacheReason: 'product created over the API',
    })
    if (saved.ok === false) {
      await claim.release()
      return refusalResponse(ctx, saved)
    }
    const view = productView(await products.doc(productId).get())
    // Stored as 200 so a replay is distinguishable from the fresh 201.
    await claim.record(200, view)
    return apiJson(view, { status: 201, headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

/** The stored product a write starts from, read in the save's own transaction. */
function storedProduct(stored: FirebaseFirestore.DocumentSnapshot): EditedProduct | ProductBuildRefusal {
  if (!stored.exists || stored.get('deletedAt')) return buildRefusal(404, 'No such product')
  return liftLegacyProduct((stored.data() ?? {}) as never) as EditedProduct
}

/**
 * `PATCH /v1/sites/{siteId}/products/{productId}` — the editor's save, for
 * the fields sent. The editor's save is a full replace, so the stored product
 * is read in the save's transaction and only the members sent change on it:
 * subscription terms, add-ons, stock holds, stored timestamps and every other
 * field this API does not expose stay as stored. A slug another product
 * holds is a 409. An empty body changes nothing and answers the product.
 */
export async function updateProduct(
  request: Request,
  ctx: ApiV1Context,
  hostId: string,
  productId: string,
  deps: ProductApiDeps = {},
): Promise<Response> {
  const body = await readJsonBody(request)
  const parsed = readProductWrite(body, { create: false })
  if ('errors' in parsed) return validationFailed(ctx, parsed.errors)
  const values = parsed.values
  const products = productsOf(ctx, hostId)
  if (Object.keys(body).length > 0) {
    const dangling = await danglingCategories(ctx, hostId, values.categoryIds)
    if (dangling) return validationFailed(ctx, dangling)
    const context = saveContext(ctx, hostId, deps)
    const saved = await saveProduct({
      ...context,
      productId,
      create: false,
      product: (stored) => {
        const base = storedProduct(stored)
        return 'refusal' in base ? base : mergeProductWrite(base, values, context.nowMs)
      },
      uniqueSlug: values.slug !== undefined,
      createdBy: null,
      cacheReason: 'product updated over the API',
    })
    if (saved.ok === false) return refusalResponse(ctx, saved)
  }
  const snap = await products.doc(productId).get()
  if (!snap.exists || snap.get('deletedAt')) return ApiErrors.notFound({ message: 'No such product', headers: ctx.headers })
  return apiJson(productView(snap), { headers: ctx.headers })
}

/**
 * `PATCH /v1/sites/{siteId}/products/{productId}/variants/{variantId}` —
 * one row of the editor's variant grid: its price, compare-at price, SKU,
 * barcode, weight and stock, through the same save, so every check runs.
 * Answers the whole product.
 */
export async function updateProductVariant(
  request: Request,
  ctx: ApiV1Context,
  hostId: string,
  productId: string,
  variantId: string,
  deps: ProductApiDeps = {},
): Promise<Response> {
  const body = await readJsonBody(request)
  const parsed = readVariantWrite(body)
  if ('errors' in parsed) return validationFailed(ctx, parsed.errors, 'Variant failed validation')
  const write = parsed.values
  const products = productsOf(ctx, hostId)
  if (Object.keys(write).length > 0) {
    const saved = await saveProduct({
      ...saveContext(ctx, hostId, deps),
      productId,
      create: false,
      product: (stored) => {
        const base = storedProduct(stored)
        if ('refusal' in base) return base
        const at = base.variants.findIndex((variant) => variant.id === variantId)
        if (at === -1) return buildRefusal(404, 'No such variant')
        const variants = [...base.variants]
        variants[at] = applyVariantWrite(variants[at], write)
        const next = { ...base, variants }
        return stockRefusal(next, [write], () => 'inventory') ?? next
      },
      createdBy: null,
      cacheReason: 'product variant updated over the API',
    })
    if (saved.ok === false) return refusalResponse(ctx, saved)
  }
  const snap = await products.doc(productId).get()
  if (!snap.exists || snap.get('deletedAt')) return ApiErrors.notFound({ message: 'No such product', headers: ctx.headers })
  const variants = (snap.get('variants') ?? []) as ProductVariant[]
  if (!variants.some((variant) => variant.id === variantId)) {
    return ApiErrors.notFound({ message: 'No such variant', headers: ctx.headers })
  }
  return apiJson(productView(snap), { headers: ctx.headers })
}

/**
 * `DELETE /v1/sites/{siteId}/products/{productId}` — the products list's
 * Delete: `deletedAt` on the product, which takes it off sale, and the
 * site's cache drop. Asked again, it answers the same receipt; a product
 * that never existed is a 404.
 */
export async function deleteProductOverApi(
  ctx: ApiV1Context,
  hostId: string,
  productId: string,
  deps: ProductApiDeps = {},
): Promise<Response> {
  const removed = await deleteProduct({
    firestore: ctx.firestore,
    hostId,
    productId,
    dropCache: deps.dropCache ?? dropPluginSiteCache,
    cacheReason: 'product deleted over the API',
  })
  if (removed.ok === false) return ApiErrors.notFound({ message: 'No such product', headers: ctx.headers })
  return apiJson({ id: productId, object: 'product', deleted: true }, { headers: ctx.headers })
}
