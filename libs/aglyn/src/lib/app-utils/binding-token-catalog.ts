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
  DATASET_FIELD_TYPE_LABELS,
  type DatasetModel,
} from './dataset-models'
import { humanizeDatasetFieldId } from './datasets'

/**
 * Browsable data-placeholder catalogs for the designer's insert picker
 * (AGL-583). Hand-typing `{{entry.title}}` stays the advanced path; these
 * catalogs give every token a friendly label + description so editors can
 * browse and insert instead of memorizing the grammar.
 *
 * The token STRINGS are owned elsewhere — `collectionEntryTokens`
 * (collection-entries.ts) and the tenant compose pipeline resolve them —
 * this module only names them for pickers. The spec cross-checks the entry
 * catalog against the resolver so the two can never drift.
 */
export interface BindingTokenCatalogEntry {
  /** The literal token inserted into the prop, e.g. `{{entry.title}}`. */
  token: string
  /** Friendly picker label, e.g. `Title`. */
  label: string
  /** One-line description shown as the option's secondary text. */
  description?: string
}

/**
 * `{{entry.*}}` tokens (AGL-105/551/582) — resolve per entry inside a
 * Collection entries block and page-wide on entry-template screens.
 * Mirrors {@link collectionEntryTokens}; the spec enforces the mirror.
 */
export const ENTRY_TOKEN_CATALOG: readonly BindingTokenCatalogEntry[] = [
  { token: '{{entry.title}}', label: 'Title', description: 'The entry headline.' },
  {
    token: '{{entry.excerpt}}',
    label: 'Excerpt',
    description: 'Short summary text.',
  },
  {
    token: '{{entry.body}}',
    label: 'Body',
    description: 'The full entry body.',
  },
  {
    token: '{{entry.url}}',
    label: 'Link URL',
    description: 'Auto-route to the entry page.',
  },
  {
    token: '{{entry.date}}',
    label: 'Published date',
    description: 'Formatted publish date.',
  },
  {
    token: '{{entry.slug}}',
    label: 'Slug',
    description: 'URL-safe entry identifier.',
  },
  {
    token: '{{entry.coverImage}}',
    label: 'Cover image',
    description: 'Cover image URL.',
  },
  {
    token: '{{entry.category}}',
    label: 'Category',
    description: 'The entry category.',
  },
  {
    token: '{{entry.tags}}',
    label: 'Tags',
    description: 'Tags, comma separated.',
  },
  {
    token: '{{entry.seoTitle}}',
    label: 'SEO title',
    description: 'Search title; falls back to Title.',
  },
  {
    token: '{{entry.seoDescription}}',
    label: 'SEO description',
    description: 'Meta description; falls back to Excerpt.',
  },
]

/**
 * `{{collection.*}}` tokens (AGL-551) — resolve on collection list/entry
 * template screens (see the tenant compose pipeline's collection tokens).
 */
export const COLLECTION_TOKEN_CATALOG: readonly BindingTokenCatalogEntry[] = [
  {
    token: '{{collection.name}}',
    label: 'Collection name',
    description: 'Display name of the routed collection.',
  },
  {
    token: '{{collection.slug}}',
    label: 'Collection slug',
    description: 'URL slug of the routed collection.',
  },
]

/**
 * Renders an `{{item.*}}` token for a dataset field, optionally hopping
 * one reference to a field of the referenced record (AGL-180). Always
 * takes the stable model field ID — display names are labels only.
 */
export function datasetItemToken(
  fieldId: string,
  targetFieldId?: string,
): string {
  return targetFieldId
    ? `{{item.${fieldId}.${targetFieldId}}}`
    : `{{item.${fieldId}}}`
}

/**
 * Dataset-item token entries for a repeatable container's model: one per
 * field in model order, labeled with the CURRENT display name while the
 * token carries the stable reference id (AGL-578 — renaming a label never
 * breaks bindings). Reference fields with a configured display field also
 * get their one-hop token (`{{item.author.name}}`).
 */
export function datasetItemTokens(
  model: DatasetModel,
): BindingTokenCatalogEntry[] {
  const entries: BindingTokenCatalogEntry[] = []
  for (const fieldId of model.order ?? []) {
    const field = model.fields?.[fieldId]
    if (!field) continue
    const label = field.name?.trim() || humanizeDatasetFieldId(fieldId)
    entries.push({
      token: datasetItemToken(fieldId),
      label,
      description: DATASET_FIELD_TYPE_LABELS[field.type] ?? field.type,
    })
    // One reference hop (AGL-180): surface the configured display field of
    // the referenced record — the hop editors reach for most.
    const hopId =
      field.type === 'reference' ? field.reference?.displayFieldId : undefined
    if (hopId) {
      entries.push({
        token: datasetItemToken(fieldId, hopId),
        label: `${label} → ${humanizeDatasetFieldId(hopId)}`,
        description: 'Field from the referenced record.',
      })
    }
  }
  return entries
}
