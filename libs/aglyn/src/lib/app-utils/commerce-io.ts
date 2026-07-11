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
 * Catalog CSV import/export (AGL-282) speaking Shopify's product CSV
 * dialect — the migration wedge for switchers: `Handle` groups variant
 * rows into one product, `Option1..3 Name/Value` build the option axes,
 * `Variant *` columns carry per-variant data, and repeated-handle rows
 * with only `Image Src` add media. Export mirrors the same columns so
 * round-trips are lossless for the fields both sides share.
 */

import {
  commerceSlug,
  validateProduct,
  type HostProduct,
  type ProductOption,
  type ProductStatus,
  type ProductVariant,
} from './commerce'
import { parseCsv } from './dataset-io'

export const PRODUCT_CSV_HEADER = [
  'Handle',
  'Title',
  'Body (HTML)',
  'Type',
  'Tags',
  'Published',
  'Option1 Name',
  'Option1 Value',
  'Option2 Name',
  'Option2 Value',
  'Option3 Name',
  'Option3 Value',
  'Variant SKU',
  'Variant Barcode',
  'Variant Price',
  'Variant Compare At Price',
  'Variant Inventory Qty',
  'Variant Grams',
  'Image Src',
] as const

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** One row per variant; extra image rows follow Shopify's convention. */
export function productsToCsv(
  products: Array<HostProduct & { $id?: string }>,
): string {
  const lines = [PRODUCT_CSV_HEADER.join(',')]
  for (const product of products) {
    const options = product.options ?? []
    product.variants.forEach((variant, index) => {
      const optionCells: string[] = []
      for (let axis = 0; axis < 3; axis += 1) {
        const option = options[axis]
        optionCells.push(
          index === 0 ? (option?.name ?? '') : '',
          option ? (variant.options?.[option.name] ?? '') : '',
        )
      }
      lines.push(
        [
          csvCell(product.slug),
          csvCell(index === 0 ? product.name : ''),
          csvCell(index === 0 ? (product.description ?? '') : ''),
          csvCell(index === 0 ? product.type : ''),
          csvCell(index === 0 ? (product.tags ?? []).join(', ') : ''),
          csvCell(index === 0 ? String(product.status === 'active') : ''),
          ...optionCells.map(csvCell),
          csvCell(variant.sku ?? ''),
          csvCell(variant.barcode ?? ''),
          csvCell(variant.priceUsd),
          csvCell(variant.compareAtPriceUsd ?? ''),
          csvCell(variant.inventory ?? ''),
          csvCell(variant.weightGrams ?? ''),
          csvCell(index === 0 ? (product.mediaUrls?.[0] ?? '') : ''),
        ].join(','),
      )
    })
    for (const url of (product.mediaUrls ?? []).slice(1)) {
      lines.push(
        [
          csvCell(product.slug),
          ...Array(PRODUCT_CSV_HEADER.length - 2).fill(''),
          csvCell(url),
        ].join(','),
      )
    }
  }
  return lines.join('\n')
}

export interface ProductCsvImport {
  products: HostProduct[]
  /** Row-anchored problems; importable products still parse. */
  errors: string[]
}

/** Case-insensitive column lookup so hand-edited headers still map. */
function headerIndex(header: string[]): Map<string, number> {
  const map = new Map<string, number>()
  header.forEach((cell, index) =>
    map.set(cell.trim().toLowerCase(), index),
  )
  return map
}

export function parseProductsCsv(text: string): ProductCsvImport {
  const rows = parseCsv(text)
  if (rows.length < 2) {
    return { products: [], errors: ['No data rows found'] }
  }
  const columns = headerIndex(rows[0])
  const cell = (row: string[], name: string): string => {
    const index = columns.get(name.toLowerCase())
    return index == null ? '' : (row[index] ?? '').trim()
  }
  if (!columns.has('handle') || !columns.has('title')) {
    return {
      products: [],
      errors: ['Missing required columns: Handle, Title'],
    }
  }

  const byHandle = new Map<string, HostProduct>()
  const errors: string[] = []
  rows.slice(1).forEach((row, rowIndex) => {
    const line = rowIndex + 2
    const handle = commerceSlug(cell(row, 'handle'))
    if (!handle) {
      if (row.some((value) => value.trim())) {
        errors.push(`Row ${line}: missing Handle`)
      }
      return
    }
    let product = byHandle.get(handle)
    const title = cell(row, 'title')
    if (!product) {
      if (!title) {
        // Image-only continuation row for a product we never saw.
        errors.push(`Row ${line}: first row for "${handle}" needs a Title`)
        return
      }
      const published = cell(row, 'published').toLowerCase()
      const type = cell(row, 'type').toLowerCase()
      product = {
        name: title,
        slug: handle,
        description: cell(row, 'body (html)') || undefined,
        type: ['physical', 'digital', 'service'].includes(type)
          ? (type as HostProduct['type'])
          : 'physical',
        status: (published === 'false'
          ? 'draft'
          : 'active') as ProductStatus,
        tags: cell(row, 'tags')
          ? cell(row, 'tags')
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean)
          : undefined,
        options: [],
        variants: [],
        mediaUrls: [],
      }
      byHandle.set(handle, product)
    }

    const imageSrc = cell(row, 'image src')
    if (imageSrc && !(product.mediaUrls ?? []).includes(imageSrc)) {
      product.mediaUrls = [...(product.mediaUrls ?? []), imageSrc]
    }

    const priceRaw = cell(row, 'variant price')
    const hasVariant = priceRaw !== '' || cell(row, 'variant sku') !== ''
    if (!hasVariant) return

    const options: Record<string, string> = {}
    for (let axis = 1; axis <= 3; axis += 1) {
      const name = cell(row, `option${axis} name`)
      const value = cell(row, `option${axis} value`)
      if (name && product.options![axis - 1] == null) {
        product.options![axis - 1] = { name, values: [] }
      }
      const optionName = product.options![axis - 1]?.name
      if (optionName && value) {
        options[optionName] = value
        const axisOption = product.options![axis - 1] as ProductOption
        if (!axisOption.values.includes(value)) {
          axisOption.values.push(value)
        }
      }
    }

    const price = Number(priceRaw)
    if (!Number.isFinite(price) || price < 0) {
      errors.push(`Row ${line}: invalid Variant Price "${priceRaw}"`)
      return
    }
    const qtyRaw = cell(row, 'variant inventory qty')
    const compareRaw = cell(row, 'variant compare at price')
    const gramsRaw = cell(row, 'variant grams')
    const variant: ProductVariant = {
      id: `v${product.variants.length + 1}`,
      ...(Object.keys(options).length ? { options } : {}),
      priceUsd: price,
      ...(cell(row, 'variant sku') ? { sku: cell(row, 'variant sku') } : {}),
      ...(cell(row, 'variant barcode')
        ? { barcode: cell(row, 'variant barcode') }
        : {}),
      ...(compareRaw && Number.isFinite(Number(compareRaw))
        ? { compareAtPriceUsd: Number(compareRaw) }
        : {}),
      inventory: qtyRaw === '' ? null : Math.max(0, Math.round(Number(qtyRaw))),
      ...(gramsRaw && Number.isFinite(Number(gramsRaw))
        ? { weightGrams: Number(gramsRaw) }
        : {}),
    }
    product.variants.push(variant)
  })

  const products: HostProduct[] = []
  for (const [handle, product] of byHandle) {
    product.options = (product.options ?? []).filter(Boolean)
    if (product.options.length === 0) delete product.options
    if ((product.mediaUrls?.length ?? 0) === 0) delete product.mediaUrls
    if (product.variants.length === 0) {
      errors.push(`"${handle}": no variant rows (needs Variant Price)`)
      continue
    }
    const problem = validateProduct(product)
    if (problem) {
      errors.push(`"${handle}": ${problem}`)
      continue
    }
    products.push(product)
  }
  return { products, errors }
}
