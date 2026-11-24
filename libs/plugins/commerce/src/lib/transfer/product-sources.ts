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

import type { TransferAliasDictionary, TransferPlanRow } from '@aglyn/aglyn/data-transfer'

/*==========================================
 * WIX AND SQUARESPACE PRODUCT FILES (AGL-4245).
 *
 * A Shopify product CSV is laid out the way an Aglyn one is (a row per
 * variant, the product's fields on its first row, a handle on every row), so
 * its columns only need names (`SHOPIFY_PRODUCT_COLUMNS`). A Wix or
 * Squarespace export is recognized the same way, by an alias dictionary of
 * its own column names, so the Columns step maps it with nothing to pick.
 * What the two files MEAN differs from that layout, and is read here before
 * the plan, by the file's header signature:
 *
 * - **Wix Stores** (the catalog export): rows of `fieldType` `Product` carry
 *   the product, its option names and each option's choices; `Variant` rows
 *   sharing the `handleId` carry each variant's choice, SKU, stock and a
 *   `surcharge` on the product's price. A colour choice may read `#hex:Name`,
 *   and is kept as its name. `inventory` is a number, or `InStock` (not
 *   counted) or `OutOfStock` (none). A `PERCENT` or `AMOUNT` discount makes
 *   the discounted price the price and the full one the compare-at price.
 *   `handleId` is an id, not an address, so a product's handle is made from
 *   its name.
 * - **Squarespace Commerce**: a row per variant, the product's title and
 *   description on its first row only. Rows are grouped by
 *   `Product ID [Non Editable]`, or, without one, a row with no handle and no
 *   title belongs to the product above it. `Product URL` is the old address,
 *   kept as the handle. `Stock` may be `Unlimited` (not counted). `On Sale`
 *   with a `Sale Price` makes the sale price the price and `Price` the
 *   compare-at price. `Product Type` maps to Physical, Digital or Service, and
 *   a gift card is not a product: its rows are skipped with a note.
 * - **Both**: a photo cell lists several (Wix by `;`, Squarespace by
 *   spaces), read into **Images**. A weight is dropped with a note, because
 *   neither file says whether it is in pounds or kilograms.
 *
 * Unknown and missing columns are never a failure: a column no field claims
 * is left unmapped, and a field no column fills is left as it is.
 *=========================================*/

/** The field ids this module reads and writes; the same ids as `PRODUCT_FIELD`. */
export const SOURCE_FIELD = {
  handle: 'handle',
  title: 'title',
  description: 'description',
  kind: 'type',
  published: 'published',
  tags: 'tags',
  categories: 'categories',
  option1Name: 'option1Name',
  option2Name: 'option2Name',
  option3Name: 'option3Name',
  option1Value: 'option1Value',
  option2Value: 'option2Value',
  option3Value: 'option3Value',
  sku: 'sku',
  barcode: 'barcode',
  price: 'price',
  compareAtPrice: 'compareAtPrice',
  inventory: 'inventory',
  weightGrams: 'weightGrams',
  variantImage: 'variantImage',
  variantCheckIn: 'variantCheckIn',
  images: 'images',
  sourceProductId: 'sourceProductId',
  rowType: 'rowType',
  priceSurcharge: 'priceSurcharge',
  discountType: 'discountType',
  discountAmount: 'discountAmount',
  salePrice: 'salePrice',
  onSale: 'onSale',
  sourceType: 'sourceType',
} as const

const S = SOURCE_FIELD

/** The fields that exist only to read another store's file; never stored, blank on export. */
export const SOURCE_ONLY_FIELDS: readonly string[] = [
  S.sourceProductId,
  S.rowType,
  S.priceSurcharge,
  S.discountType,
  S.discountAmount,
  S.salePrice,
  S.onSale,
  S.sourceType,
]

/** Where a row's group key is kept once the file's own grouping is read. */
export const SOURCE_GROUP_KEY = '$group'
/** Where a row that is not brought in keeps why. */
export const SOURCE_SKIP_KEY = '$skip'

/** Wix Stores' product CSV columns, by the field each one means. */
export const WIX_PRODUCT_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  [S.sourceProductId]: ['handleId'],
  [S.rowType]: ['fieldType'],
  [S.title]: ['name'],
  [S.description]: ['description'],
  [S.images]: ['productImageUrl'],
  [S.categories]: ['collection'],
  [S.sku]: ['sku'],
  [S.price]: ['price'],
  [S.priceSurcharge]: ['surcharge'],
  [S.published]: ['visible'],
  [S.discountType]: ['discountMode'],
  [S.discountAmount]: ['discountValue'],
  [S.inventory]: ['inventory'],
  [S.weightGrams]: ['weight'],
  [S.option1Name]: ['productOptionName1'],
  [S.option2Name]: ['productOptionName2'],
  [S.option3Name]: ['productOptionName3'],
  [S.option1Value]: ['productOptionDescription1'],
  [S.option2Value]: ['productOptionDescription2'],
  [S.option3Value]: ['productOptionDescription3'],
}

/** Squarespace's product CSV columns, by the field each one means. */
export const SQUARESPACE_PRODUCT_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  [S.sourceProductId]: ['Product ID [Non Editable]'],
  [S.sourceType]: ['Product Type [Non Editable]'],
  [S.handle]: ['Product URL'],
  [S.title]: ['Title'],
  [S.description]: ['Description'],
  [S.sku]: ['SKU'],
  [S.option1Name]: ['Option Name 1'],
  [S.option1Value]: ['Option Value 1'],
  [S.option2Name]: ['Option Name 2'],
  [S.option2Value]: ['Option Value 2'],
  [S.option3Name]: ['Option Name 3'],
  [S.option3Value]: ['Option Value 3'],
  [S.price]: ['Price'],
  [S.salePrice]: ['Sale Price'],
  [S.onSale]: ['On Sale'],
  [S.inventory]: ['Stock'],
  [S.categories]: ['Categories'],
  [S.tags]: ['Tags'],
  [S.weightGrams]: ['Weight'],
  [S.published]: ['Visible'],
  [S.images]: ['Hosted Image URLs'],
}

/** The two dictionaries, beside Shopify's. */
export const SOURCE_ALIAS_DICTIONARIES: readonly TransferAliasDictionary[] = [
  { source: 'Wix', aliases: WIX_PRODUCT_COLUMNS },
  { source: 'Squarespace', aliases: SQUARESPACE_PRODUCT_COLUMNS },
]

/** Which other store's file this is. */
export type ProductFileSource = 'wix' | 'squarespace'

const compact = (header: unknown) => String(header ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * The store a file came from, by its header signature: Wix's `handleId` and
 * `fieldType` beside its image or option columns; Squarespace's two
 * `[Non Editable]` ids or its hosted images. `null` for any other file,
 * Shopify's included. With no headers (a JSON file), by the columns read.
 */
export function productFileSource(
  headers: readonly string[] | undefined,
  rows: readonly TransferPlanRow[] = [],
): ProductFileSource | null {
  if (headers?.length) {
    const have = new Set(headers.map(compact))
    if (have.has('handleid') && have.has('fieldtype') && (have.has('productimageurl') || have.has('productoptionname1'))) {
      return 'wix'
    }
    if (have.has('productidnoneditable') && (have.has('variantidnoneditable') || have.has('hostedimageurls'))) {
      return 'squarespace'
    }
    return null
  }
  const mapped = (fieldId: string) => rows.some((row) => fieldId in row.values)
  if (mapped(S.rowType) && mapped(S.sourceProductId)) return 'wix'
  if (mapped(S.sourceType) || mapped(S.onSale) || mapped(S.salePrice)) return 'squarespace'
  return null
}

/** Something the dry run says about how another store's file was read. */
export interface SourceNote {
  /** The row; `-1` for the whole file. */
  row: number
  fieldId?: string
  value?: string
  detail: string
}

const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value).trim())

/** A money cell as a number of dollars; `null` for blank, unreadable or not in US dollars. */
function amountOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'object' && 'amountMinor' in (value as object)) {
    const amount = value as { amountMinor: number; currency: string }
    return String(amount.currency).toUpperCase() === 'USD' ? Math.round(Number(amount.amountMinor)) / 100 : null
  }
  const number = Number(String(value).replace(/[$,\s]/g, ''))
  return Number.isFinite(number) ? number : null
}

const cents = (value: number) => Math.round(value * 100) / 100

const VARIANT_FIELDS = [
  S.option1Value,
  S.option2Value,
  S.option3Value,
  S.sku,
  S.barcode,
  S.price,
  S.compareAtPrice,
  S.inventory,
  S.weightGrams,
  S.variantImage,
  S.variantCheckIn,
] as const
const OPTION_NAMES = [S.option1Name, S.option2Name, S.option3Name] as const
const OPTION_VALUES = [S.option1Value, S.option2Value, S.option3Value] as const

/** A Wix choice as it is shown: `#ff0000:Red` is Red. */
export function wixChoiceName(value: unknown): string {
  return text(value).replace(/^#[0-9a-f]{3,8}\s*:\s*/i, '').trim()
}

/** A Wix option's choices, from the product row's comma list. */
function wixChoices(value: unknown): string[] {
  return text(value)
    .split(',')
    .map(wixChoiceName)
    .filter(Boolean)
}

/** A row being read: its values and problems, writable. */
interface Draft {
  index: number
  values: Record<string, unknown>
  problems: Array<NonNullable<TransferPlanRow['problems']>[number]>
  source: TransferPlanRow
}

function draftOf(row: TransferPlanRow): Draft {
  return { index: row.index, values: { ...row.values }, problems: [...(row.problems ?? [])], source: row }
}

function rowOf(draft: Draft): TransferPlanRow {
  const rest: TransferPlanRow = { ...draft.source }
  delete (rest as { problems?: unknown }).problems
  return { ...rest, values: draft.values, ...(draft.problems.length ? { problems: draft.problems } : {}) }
}

/**
 * A stock cell a number could not read, as the other store wrote it:
 * `InStock` and `Unlimited` are stock that is not counted, `OutOfStock` none.
 */
function readStockWords(draft: Draft): void {
  const at = draft.problems.findIndex((problem) => problem.fieldId === S.inventory)
  if (at < 0) return
  const raw = text(draft.problems[at]?.raw).toLowerCase().replace(/[\s_-]+/g, '')
  if (raw === 'instock' || raw === 'unlimited') {
    draft.problems.splice(at, 1)
    delete draft.values[S.inventory]
  } else if (raw === 'outofstock') {
    draft.problems.splice(at, 1)
    draft.values[S.inventory] = 0
  }
}

/** The price a row ends with once a sale or discount is read: the sale price, the full one as compare-at. */
function applySale(draft: Draft, full: number | null, sale: number | null): void {
  if (full === null) return
  if (sale !== null && sale > 0 && sale < full) {
    draft.values[S.price] = cents(sale)
    if (text(draft.values[S.compareAtPrice]) === '') draft.values[S.compareAtPrice] = cents(full)
  } else {
    draft.values[S.price] = cents(full)
  }
}

function wixDiscounted(full: number | null, mode: string, amount: number | null): number | null {
  if (full === null || amount === null || amount <= 0) return null
  if (mode === 'percent') return amount < 100 ? full * (1 - amount / 100) : null
  if (mode === 'amount') return amount < full ? full - amount : null
  return null
}

function dropWeights(drafts: readonly Draft[], source: ProductFileSource, notes: SourceNote[]): void {
  let dropped = false
  for (const draft of drafts) {
    if (text(draft.values[S.weightGrams]) !== '') dropped = true
    delete draft.values[S.weightGrams]
    draft.problems = draft.problems.filter((problem) => problem.fieldId !== S.weightGrams)
  }
  if (dropped) {
    notes.push({
      row: -1,
      fieldId: S.weightGrams,
      detail: `Weights are not brought in, because a ${source === 'wix' ? 'Wix' : 'Squarespace'} file does not say whether they are in pounds or kilograms. Set each product's weight on the product.`,
    })
  }
}

function clearSourceFields(draft: Draft): void {
  for (const fieldId of SOURCE_ONLY_FIELDS) delete draft.values[fieldId]
}

function adaptWix(drafts: Draft[], notes: SourceNote[]): void {
  const groups = new Map<string, Draft[]>()
  drafts.forEach((draft, position) => {
    const id = text(draft.values[S.sourceProductId])
    const key = id ? `w:${id}` : `r:${position}`
    draft.values[SOURCE_GROUP_KEY] = key
    groups.set(key, [...(groups.get(key) ?? []), draft])
  })
  for (const group of groups.values()) {
    const kind = (draft: Draft) => text(draft.values[S.rowType]).toLowerCase()
    const product = group.find((draft) => kind(draft) === 'product') ?? (group[0] as Draft)
    const variants = group.filter((draft) => draft !== product && kind(draft) === 'variant')
    const base = amountOf(product.values[S.price])
    const mode = text(product.values[S.discountType]).toLowerCase()
    const discount = amountOf(product.values[S.discountAmount])
    const priced = (draft: Draft, full: number | null) => applySale(draft, full, wixDiscounted(full, mode, discount))

    if (variants.length) {
      // The product row holds the product; its own SKU, price and choice lists are not a variant.
      for (const fieldId of VARIANT_FIELDS) delete product.values[fieldId]
      product.problems = product.problems.filter((problem) => !(VARIANT_FIELDS as readonly string[]).includes(problem.fieldId))
      for (const variant of variants) {
        OPTION_VALUES.forEach((fieldId) => {
          if (text(variant.values[fieldId])) variant.values[fieldId] = wixChoiceName(variant.values[fieldId])
        })
        const own = amountOf(variant.values[S.price])
        const surcharge = amountOf(variant.values[S.priceSurcharge]) ?? 0
        priced(variant, own ?? (base === null ? null : base + surcharge))
        readStockWords(variant)
      }
    } else {
      // A product with no variant rows is one variant; a choice list cannot be one.
      const lists = OPTION_VALUES.map((fieldId) => wixChoices(product.values[fieldId]))
      if (lists.some((choices) => choices.length > 1)) {
        const named = OPTION_NAMES.map((fieldId, axis) =>
          text(product.values[fieldId]) && lists[axis]?.length ? `${text(product.values[fieldId])}: ${lists[axis]?.join(', ')}` : '',
        ).filter(Boolean)
        notes.push({
          row: product.index,
          fieldId: S.option1Value,
          value: named.join('; '),
          detail:
            "This product's choices have no variant rows in the file, so it is brought in as one variant. Add its choices on the product.",
        })
        for (const fieldId of [...OPTION_VALUES, ...OPTION_NAMES]) delete product.values[fieldId]
      } else {
        OPTION_VALUES.forEach((fieldId, axis) => {
          if (lists[axis]?.length) product.values[fieldId] = lists[axis]?.[0]
          else delete product.values[fieldId]
        })
      }
      priced(product, base)
      readStockWords(product)
    }
  }
}

/** A Squarespace `Product URL` is the last part of the old address. */
function squarespaceHandle(value: unknown): string {
  const parts = text(value).split(/[/?#]/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

const SQUARESPACE_KIND: Readonly<Record<string, string>> = {
  physical: 'Physical',
  digital: 'Digital',
  service: 'Service',
}

function adaptSquarespace(drafts: Draft[], notes: SourceNote[]): void {
  const groups = new Map<string, Draft[]>()
  let current: string | null = null
  drafts.forEach((draft, position) => {
    const id = text(draft.values[S.sourceProductId])
    if (text(draft.values[S.handle])) draft.values[S.handle] = squarespaceHandle(draft.values[S.handle])
    const handle = text(draft.values[S.handle])
    const key: string = id ? `s:${id}` : handle ? `h:${handle.toLowerCase()}` : text(draft.values[S.title]) ? `r:${position}` : (current ?? `r:${position}`)
    current = key
    draft.values[SOURCE_GROUP_KEY] = key
    groups.set(key, [...(groups.get(key) ?? []), draft])
  })
  for (const group of groups.values()) {
    const type = text(group.map((draft) => draft.values[S.sourceType]).find((value) => text(value)))
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
    const first = group[0] as Draft
    if (type === 'gift_card' || type === 'giftcard') {
      for (const draft of group) draft.values[SOURCE_SKIP_KEY] = 'giftCard'
      notes.push({
        row: first.index,
        value: text(first.values[S.title]) || undefined,
        detail: 'A gift card is not a product, so its rows are skipped. Bring gift cards in with a gift card import.',
      })
      continue
    }
    const kind = SQUARESPACE_KIND[type]
    if (kind && text(first.values[S.kind]) === '') first.values[S.kind] = kind
    for (const draft of group) {
      const full = amountOf(draft.values[S.price])
      const sale = draft.values[S.onSale] === true ? amountOf(draft.values[S.salePrice]) : null
      if (full !== null) applySale(draft, full, sale)
      readStockWords(draft)
    }
  }
}

/**
 * A sale price in any other file: below the price, it becomes the price and
 * the price the compare-at price; with an On sale column, only when it says yes.
 */
function adaptSalePrices(drafts: readonly Draft[]): void {
  const flagged = drafts.some((draft) => S.onSale in draft.values)
  for (const draft of drafts) {
    if (!(S.salePrice in draft.values)) continue
    if (flagged && draft.values[S.onSale] !== true) continue
    const full = amountOf(draft.values[S.price])
    const sale = amountOf(draft.values[S.salePrice])
    if (full !== null && sale !== null) applySale(draft, full, sale)
  }
}

/**
 * The rows read into the layout the products plan reads. For another
 * store's file: each row's group under {@link SOURCE_GROUP_KEY}, prices
 * settled, stock words read, a row not brought in marked under
 * {@link SOURCE_SKIP_KEY}. For any file: a sale price settled, and the
 * source-only fields gone. What was changed or left out is in `notes`.
 */
export function adaptProductSourceRows(
  rows: readonly TransferPlanRow[],
  source: ProductFileSource | null,
): { rows: TransferPlanRow[]; notes: SourceNote[] } {
  const touched = rows.some((row) => SOURCE_ONLY_FIELDS.some((fieldId) => fieldId in row.values))
  if (!source && !touched) return { rows: [...rows], notes: [] }
  const drafts = rows.map(draftOf)
  const notes: SourceNote[] = []
  // Before the rows are read, which clears a Wix product row's own variant cells.
  if (source) dropWeights(drafts, source, notes)
  if (source === 'wix') adaptWix(drafts, notes)
  else if (source === 'squarespace') adaptSquarespace(drafts, notes)
  else adaptSalePrices(drafts)
  for (const draft of drafts) clearSourceFields(draft)
  return { rows: drafts.map(rowOf), notes }
}
