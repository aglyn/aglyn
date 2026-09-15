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
  AUTHOR_TOKEN_CATALOG,
  COLLECTION_TOKEN_CATALOG,
  ENTRY_TOKEN_CATALOG,
  type BindingTokenCatalogEntry,
} from '@aglyn/aglyn/app-utils/binding-token-catalog'

/**
 * What a generated page template renders for (AGL-2909): one page drawn once
 * per record the site already keeps.
 *
 * - `entry` — a content collection's entry page: a blog post, an event, a
 *   case study. Picked as the collection's entry template screen.
 * - `product` — the store's product page. Picked as the product template in
 *   Store settings.
 * - `author` — an author's page. Picked as the author page screen.
 *
 * Everything that differs per record is a binding token, and the tokens a
 * template may bind are the ones the platform fills on that page. For an
 * entry and an author those are the besigner's own insert-picker catalogs, so
 * what a model may bind and what an author can pick are one list; a product's
 * are the commerce product page's, which no catalog names yet (below).
 *
 * Model only: shapes, the vocabularies and the inputs reader, no runtime.
 */

export type AiTemplateSubject = 'entry' | 'product' | 'author'

export const AI_TEMPLATE_SUBJECTS: readonly AiTemplateSubject[] = ['entry', 'product', 'author']

/**
 * The tokens the commerce product page fills. The commerce plugin's page
 * resolver is their definition of record; a spec reads its source and holds
 * this list to it in both directions, because a plugin never imports another
 * plugin's internals.
 */
export const AI_PRODUCT_TEMPLATE_TOKENS: readonly BindingTokenCatalogEntry[] = [
  { token: '{{product.name}}', label: 'Name', description: 'The product’s name.' },
  {
    token: '{{product.description}}',
    label: 'Description',
    description: 'The product’s description.',
  },
  {
    token: '{{product.price}}',
    label: 'Price',
    description: 'The price, or “From” the lowest price when variants differ.',
  },
  { token: '{{product.image}}', label: 'Image', description: 'The product’s first image.' },
  { token: '{{product.slug}}', label: 'Slug', description: 'The product’s URL segment.' },
]

/** The pager tokens, which resolve on an author's page over their own archive. */
const PAGINATION_TOKENS = COLLECTION_TOKEN_CATALOG.filter((entry) =>
  entry.token.startsWith('{{pagination.'),
)

export interface AiTemplateSubjectDefinition {
  subject: AiTemplateSubject
  /** One rendered page's record, as a sentence names it. */
  noun: string
  /** The token the page's one h1 binds, so every record shows its own title. */
  titleToken: string
  /** Every token the page may bind. */
  tokens: readonly BindingTokenCatalogEntry[]
  /**
   * Palette blocks that fill themselves from this subject on its page, and
   * render nothing on another subject's. Inside a Collection Entries card each
   * fills from that card's entry instead, so a card is exempt.
   */
  blocks: readonly string[]
  /** The template's name when the plan names none. */
  defaultName: string
  /** Where a member puts the page to work, for the proposal and the docs. */
  appliedIn: string
}

export const AI_TEMPLATE_SUBJECT_DEFINITIONS: Readonly<
  Record<AiTemplateSubject, AiTemplateSubjectDefinition>
> = {
  entry: {
    subject: 'entry',
    noun: 'a collection entry',
    titleToken: '{{entry.title}}',
    tokens: [...ENTRY_TOKEN_CATALOG, ...COLLECTION_TOKEN_CATALOG],
    blocks: ['collectionEntryMeta', 'collectionEntryBody', 'collectionEntryAuthor', 'collectionRelated'],
    defaultName: 'Entry page template',
    appliedIn: 'the collection’s entry template screen, under Template screens in Content',
  },
  product: {
    subject: 'product',
    noun: 'a product',
    titleToken: '{{product.name}}',
    tokens: AI_PRODUCT_TEMPLATE_TOKENS,
    blocks: [],
    defaultName: 'Product page template',
    appliedIn: 'the product page template in Store settings',
  },
  author: {
    subject: 'author',
    noun: 'an author',
    titleToken: '{{author.name}}',
    tokens: [...AUTHOR_TOKEN_CATALOG, ...PAGINATION_TOKENS],
    blocks: ['contentAuthorProfile'],
    defaultName: 'Author page template',
    appliedIn: 'the author page screen on the Authors tab',
  },
}

/** Every `{{…}}` token a string holds, spelled without inner whitespace. */
export function aiBindingTokensIn(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)].map((match) => `{{${match[1]}}}`)
}

/**
 * Whether a token may fill a link or media prop whole: its field is an
 * address or a picture (`{{entry.url}}`, `{{entry.coverImage}}`,
 * `{{author.image}}`), never copy.
 */
export function isAiAddressToken(token: string): boolean {
  const field = token.replace(/^\{\{|\}\}$/g, '').split('.').pop() ?? ''
  return /^(?:url|image)$|(?:Url|Image|Video)$/.test(field)
}

/** The tokens of a subject a link or media prop may hold. */
export function aiTemplateAddressTokens(definition: AiTemplateSubjectDefinition): string[] {
  return definition.tokens.map((entry) => entry.token).filter(isAiAddressToken)
}

/** What a template job reads from its inputs. */
export interface AiTemplateJobInputs {
  subject: AiTemplateSubject
  /** The content collection an entry template is for; `null` for a product or author page. */
  collectionId: string | null
}

const RECORD_ID = /^[A-Za-z0-9_-]{1,100}$/

/** The inputs of a template job, or a sentence naming what is missing. */
export function parseAiTemplateJobInputs(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): AiTemplateJobInputs | string {
  const subject = String(inputs?.['subject'] ?? '')
  if (!(AI_TEMPLATE_SUBJECTS as readonly string[]).includes(subject)) {
    return `Name what the template is for: inputs.subject is one of ${AI_TEMPLATE_SUBJECTS.join(', ')}`
  }
  if (subject !== 'entry') return { subject: subject as AiTemplateSubject, collectionId: null }
  const raw = inputs?.['collectionId']
  const collectionId = typeof raw === 'string' ? raw.trim() : ''
  if (!RECORD_ID.test(collectionId)) {
    return 'An entry page template names its content collection in inputs.collectionId'
  }
  return { subject: 'entry', collectionId }
}
