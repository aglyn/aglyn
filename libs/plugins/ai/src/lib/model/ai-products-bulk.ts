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
 * THE BULK COPY JOB AN IMPORT ASKS FOR (AGL-2916, AGL-3671) — the pure half of
 * "write descriptions with AI as they land", with no import at all, so the
 * native apps replay it (`aiProductsImportJob`) beside the console's products
 * hub card, which starts the very same job.
 *
 * A product import that asked for its copy leaves one `products` job for the
 * products it CREATED: the first `AI_PRODUCTS_BULK_MAX` of them, their ids
 * read from the import job's results (`api/transfer/status`), one brief that
 * names how many, and `inputs` that carry the ids.
 */

/** The most products one bulk job writes the copy of. */
export const AI_PRODUCTS_BULK_MAX = 50

const PRODUCT_ID = /^[A-Za-z0-9_-]{1,64}$/

/** The brief a bulk copy job carries, which the jobs list shows and a card recognizes it by. */
export const aiProductsBulkBrief = (count: number): string =>
  `Write storefront copy for ${count} ${count === 1 ? 'product' : 'products'}`

/** A bulk job's `inputs`: the product ids that can be read back, once each, at most `AI_PRODUCTS_BULK_MAX`. */
export function aiProductsBulkInputs(productIds: readonly string[]): Record<string, string> {
  return {
    target: 'bulk',
    productIds: [...new Set(productIds.filter((id) => PRODUCT_ID.test(id)))].slice(0, AI_PRODUCTS_BULK_MAX).join(','),
  }
}

/** One row of an import job's results. */
export interface ImportResultRow {
  outcome?: string
  recordId?: string
}

/** The products an applied import created, once each and in the order the results list them. */
export function createdProductIdsOf(rows: readonly ImportResultRow[] | null | undefined): string[] {
  const ids: string[] = []
  for (const row of rows ?? []) {
    if (row?.outcome === 'created' && row.recordId && !ids.includes(row.recordId)) ids.push(row.recordId)
  }
  return ids
}

/**
 * The copy job a landed import starts — the brief and the `inputs` the jobs route takes — for the first
 * `AI_PRODUCTS_BULK_MAX` products it created; `null` when it created none.
 */
export function aiProductsImportJob(
  rows: readonly ImportResultRow[] | null | undefined,
): { brief: string; inputs: Record<string, string> } | null {
  const ids = createdProductIdsOf(rows).slice(0, AI_PRODUCTS_BULK_MAX)
  if (!ids.length) return null
  return { brief: aiProductsBulkBrief(ids.length), inputs: aiProductsBulkInputs(ids) }
}
