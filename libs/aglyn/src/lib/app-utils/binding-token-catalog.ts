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
    token: '{{entry.author}}',
    label: 'Author',
    description: 'The byline set on the entry.',
  },
  {
    token: '{{entry.authorBio}}',
    label: 'Author bio',
    description: 'Blurb from the author’s record.',
  },
  {
    token: '{{entry.authorImage}}',
    label: 'Author portrait',
    description: 'Portrait or logo from the author’s record.',
  },
  {
    token: '{{entry.authorUrl}}',
    label: 'Author link',
    description: 'The author’s own page.',
  },
  {
    token: '{{entry.authorPageUrl}}',
    label: 'Author page',
    description:
      'This author’s page on this site — everything they wrote, across every ' +
      'collection. Separate from Author link, which is their own site.',
  },
  {
    token: '{{entry.slug}}',
    label: 'Slug',
    description: 'URL-safe entry identifier.',
  },
  /*
    Named "Its collection…" rather than "Collection…", which is what these
    describe and also exactly what the `{{collection.*}}` entries below are
    called. The picker groups options by heading, so the two sets sit apart —
    but a designer scanning it reads the LABEL, and two options reading
    "Collection name" three lines apart is a choice made by guessing. The
    pronoun is doing real work: on the one page where both resolve, they mean
    different collections.
  */
  {
    token: '{{entry.collection}}',
    label: 'Its collection',
    description:
      'Which section this entry belongs to. Worth binding on a listing that ' +
      'MIXES collections — an author page — where a card otherwise cannot ' +
      'tell a release note from an essay.',
  },
  {
    token: '{{entry.collectionSlug}}',
    label: 'Its collection slug',
    description: 'That collection’s URL segment.',
  },
  {
    token: '{{entry.collectionUrl}}',
    label: 'Its collection link',
    description: 'The listing this entry belongs to.',
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
 * `{{collection.*}}` and `{{pagination.*}}` tokens (AGL-551/1321/1386) —
 * resolve on collection list/entry template screens (see the tenant compose
 * pipeline's collection tokens).
 *
 * The category and pagination tokens all resolve to the empty string where
 * they do not apply, so they are safe to bind unconditionally: ONE list
 * screen serves the bare listing, every `/page/{n}` and every
 * `/category/{slug}`, and a template has no runtime conditional to vary
 * itself with.
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
  {
    token: '{{collection.category}}',
    label: 'Filtered category',
    description: 'Category the URL filtered on; empty when unfiltered.',
  },
  {
    token: '{{collection.categorySlug}}',
    label: 'Filtered category slug',
    description: 'That category’s URL segment; empty when unfiltered.',
  },
  {
    token: '{{pagination.page}}',
    label: 'Current page',
    description: 'Page number this URL is showing.',
  },
  {
    token: '{{pagination.totalPages}}',
    label: 'Total pages',
    description: 'Pages in the listing, after any category filter.',
  },
  {
    token: '{{pagination.prevUrl}}',
    label: 'Previous page link',
    description: 'Keeps the category; empty on the first page.',
  },
  {
    token: '{{pagination.nextUrl}}',
    label: 'Next page link',
    description: 'Keeps the category; empty on the last page.',
  },
]

/**
 * `{{author.*}}` tokens (AGL-2518) — resolve on an author's own page,
 * `/author/{slug}`.
 *
 * Empty everywhere else, like the category tokens above and for the same
 * reason: a template has no runtime conditional, so the tokens have to be the
 * thing that varies. A heading bound to `{{author.name}}` prints a name on an
 * author page and nothing anywhere else.
 *
 * The `{{pagination.*}}` tokens resolve HERE TOO, over this author's own
 * archive — deliberately the same four names a collection listing uses, so a
 * pager built once works on both.
 */
export const AUTHOR_TOKEN_CATALOG: readonly BindingTokenCatalogEntry[] = [
  {
    token: '{{author.name}}',
    label: 'Name',
    description: 'The byline this page collects.',
  },
  {
    token: '{{author.bio}}',
    label: 'Bio',
    description: 'Their blurb, from the author record.',
  },
  {
    token: '{{author.image}}',
    label: 'Portrait',
    description: 'Their portrait or logo, from the author record.',
  },
  {
    token: '{{author.jobTitle}}',
    label: 'Role',
    description: 'Their job title; empty for an Organization author.',
  },
  {
    token: '{{author.worksFor}}',
    label: 'Organization',
    description: 'Who they write for; empty for an Organization author.',
  },
  {
    token: '{{author.url}}',
    label: 'Their own site',
    description:
      'The url on their record — a personal site, not this page. Empty when ' +
      'they have none.',
  },
  {
    token: '{{author.pageUrl}}',
    label: 'This page',
    description: 'The canonical address of the page you are designing.',
  },
  {
    token: '{{author.entryCount}}',
    label: 'Post count',
    description: 'How many entries they have published, across every collection.',
  },
  {
    token: '{{author.entryCountLabel}}',
    label: 'Post count, worded',
    description:
      '"1 post" or "12 posts" — pluralized for you, because a template has no ' +
      'conditional to do it with.',
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
