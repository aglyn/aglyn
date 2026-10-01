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

import type { PluginIndexedRecord } from '@aglyn/aglyn/plugin-manager/plugin-record-index'

/**
 * One stored product as this plugin shares it with another (AGL-3080) — the
 * one shape its server index (`product-record-index.ts`) and its console list
 * source (`commerce-record-lists.ts`) both answer.
 *
 * `null` for a deleted product and an unnamed one. Otherwise its `facts`:
 *   `type` (`physical` | `digital` | `service` | the stored value),
 *   `description`, `tags: string[]`, `categoryIds: string[]`,
 *   `options: Array<{ name, values: string[] }>`, `imageUrl` (the first
 *   photo's stored media value, or `null`), `seoTitle`, `seoDescription`,
 *   `priceUsd` (the product's own price in dollars, or `null`) and
 *   `variants: Array<{ id, options: Record<string, string>, priceUsd }>` —
 *   each priced variant as stored, empty for a product without variants.
 */
export function productIndexedRecord(
  id: string,
  data: Readonly<Record<string, unknown>> | undefined,
): PluginIndexedRecord | null {
  if (!data || data['deletedAt'] != null) return null
  const name = str(data['name'])
  if (!name) return null
  const seo = (data['seo'] ?? {}) as Record<string, unknown>
  const mediaUrls = Array.isArray(data['mediaUrls']) ? data['mediaUrls'] : []
  return {
    id,
    name,
    facts: {
      type: data['type'],
      description: str(data['description']),
      tags: strings(data['tags']),
      categoryIds: strings(data['categoryIds']),
      options: (Array.isArray(data['options']) ? data['options'] : []).map((option) => {
        const record = (option ?? {}) as Record<string, unknown>
        return { name: str(record['name']), values: strings(record['values']) }
      }),
      imageUrl: str(mediaUrls[0]) || str(data['imageUrl']) || null,
      seoTitle: str(seo['title']),
      seoDescription: str(seo['description']),
      priceUsd: price(data['priceUsd']),
      variants: (Array.isArray(data['variants']) ? data['variants'] : []).map((variant) => {
        const record = (variant ?? {}) as Record<string, unknown>
        const options = (record['options'] ?? {}) as Record<string, unknown>
        return {
          id: str(record['id']),
          options: Object.fromEntries(Object.entries(options).map(([key, value]) => [key, str(value)])),
          priceUsd: price(record['priceUsd']),
        }
      }),
    },
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function strings(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).map(str).filter(Boolean)
}

function price(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return value === null || value === undefined || value === '' || !Number.isFinite(parsed) ? null : parsed
}
