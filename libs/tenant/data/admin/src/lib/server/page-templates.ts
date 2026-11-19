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

import type { TemplatePlaceholder } from '@aglyn/aglyn/foundation'
import {
  LIBRARY_TEMPLATE_SOURCE_TYPES,
  resolveTemplateNodes,
  templateFillablePlaceholders,
  templatePlaceholderValues,
} from '@aglyn/aglyn/app-utils/page-template-use'
import { STARTER_TEMPLATE_SOURCE } from '@aglyn/aglyn/plugin-manager/plugin-template-sources'
import { STARTER_TEMPLATES, starterTemplateDocId } from '@aglyn/aglyn/app-utils/starter-templates'
import { FieldPath, type Firestore } from 'firebase-admin/firestore'
import { decodeCursor, encodeCursor, parseLimit } from './api-http'

/*
 * THE PAGE TEMPLATES A NEW PAGE CAN START FROM, ON THE SERVER (AGL-4235).
 *
 * What the console's template gallery offers when a page is made, read for
 * the public API:
 *
 * - The site's own library: `hosts/{hostId}/templates` documents of kind
 *   `page`, saved on the site or installed by a plugin
 *   (`LIBRARY_TEMPLATE_SOURCE_TYPES`), not deleted — the gallery's "Your
 *   templates" shelf.
 * - The built-in starters, one template per starter page, by the id a copy
 *   of that page is stored under (`starterTemplateDocId`). A starter the
 *   site has never used is read from the code definitions, as the gallery
 *   renders it; one the site has copied into its library is read from its
 *   copies, which the site may have edited or deleted.
 *
 * Nothing here writes. Using a starter does not copy it into the site's
 * library: the console's copy is a library entry made on the side, and never
 * what the page is made from (its pages are built from the same
 * definitions either way).
 */

/** One page template, as the API reads it. */
export interface PageTemplate {
  id: string
  name: string | null
  description: string | null
  category: string | null
  /** The placeholders it asks to be filled in, `{{prop.*}}` bindings left out. */
  placeholders: TemplatePlaceholder[]
  /** `site`: in the site's own library. `built_in`: one of the platform's starters. */
  source: 'site' | 'built_in'
  /** Its tree, as stored (either stored form) or as defined. */
  nodes: unknown
  /** The address it suggests for the page it makes. */
  slug?: string
  /** The search listing it carries onto the page it makes. */
  seo?: Record<string, unknown>
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** A stored template document as a {@link PageTemplate}. */
function storedTemplate(id: string, data: Record<string, unknown>, source: PageTemplate['source']): PageTemplate {
  return {
    id,
    name: text(data['displayName']),
    description: text(data['description']),
    category: text(data['category']),
    placeholders: templateFillablePlaceholders(data['placeholders']),
    source,
    nodes: data['nodes'],
    ...(typeof data['slug'] === 'string' ? { slug: data['slug'] } : {}),
    ...(isObject(data['seo']) ? { seo: data['seo'] } : {}),
  }
}

const sourceType = (data: Record<string, unknown>): unknown => (isObject(data['source']) ? data['source']['type'] : undefined)

/** A stored page template of the site's own library, as the gallery's "Your templates" shelf keeps it. */
function isLibraryPageTemplate(data: Record<string, unknown> | undefined): data is Record<string, unknown> {
  return (
    Boolean(data) &&
    data?.['kind'] === 'page' &&
    data['deletedAt'] == null &&
    LIBRARY_TEMPLATE_SOURCE_TYPES.includes(String(sourceType(data)))
  )
}

/**
 * Every built-in starter page, in the gallery's order: each starter in turn,
 * its pages in the order it lists them. A starter the site has copied in is
 * its live copies; one it has not is the definitions.
 */
async function starterPageTemplates(firestore: Firestore, hostId: string): Promise<PageTemplate[]> {
  const copies = await firestore
    .collection('hosts')
    .doc(hostId)
    .collection('templates')
    .where('source.type', '==', STARTER_TEMPLATE_SOURCE)
    .get()
  const copiesByStarter = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>()
  for (const doc of copies.docs) {
    const data = doc.data() as Record<string, unknown>
    if (sourceType(data) !== STARTER_TEMPLATE_SOURCE) continue
    const starterId = String((data['source'] as Record<string, unknown>)['starterId'] ?? '')
    if (!starterId) continue
    copiesByStarter.set(starterId, [...(copiesByStarter.get(starterId) ?? []), { id: doc.id, data }])
  }
  const templates: PageTemplate[] = []
  for (const starter of STARTER_TEMPLATES) {
    const copied = copiesByStarter.get(starter.id)
    if (copied) {
      // The site's copies replace the definitions, whatever was done to them.
      copied
        .filter(({ data }) => data['kind'] === 'page' && data['deletedAt'] == null)
        .sort((a, b) => starterOrder(a.data) - starterOrder(b.data))
        .forEach(({ id, data }) => templates.push(storedTemplate(id, data, 'built_in')))
      continue
    }
    for (const screen of starter.screens) {
      templates.push({
        id: starterTemplateDocId(starter.id, screen.key),
        name: screen.displayName,
        description: text(screen.description),
        category: text(starter.category),
        placeholders: [],
        source: 'built_in',
        nodes: screen.nodes,
        slug: screen.slug,
        ...(screen.seo ? { seo: screen.seo as Record<string, unknown> } : {}),
      })
    }
  }
  return templates
}

const starterOrder = (data: Record<string, unknown>): number =>
  Number((data['source'] as Record<string, unknown> | undefined)?.['starterOrder'] ?? 0)

/** The cursor of a page that starts inside the starters, after `offset` of them. */
const STARTERS_CURSOR = '~starters:'

/**
 * One page of a site's page templates: the site's own library by id, then
 * the built-in starters. `limit` and `cursor` as every list takes them; a
 * page of the library can come back short, because a stored template that
 * is not a page template of the library is left out after it is read.
 */
export async function listPageTemplates(
  firestore: Firestore,
  hostId: string,
  page: { limit?: string | null; cursor?: string | null },
): Promise<{ templates: PageTemplate[]; nextCursor: string | null }> {
  const limit = parseLimit(page.limit)
  const cursor = decodeCursor(page.cursor)
  const starterPage = async (offset: number, room: number, lead: PageTemplate[]) => {
    const starters = await starterPageTemplates(firestore, hostId)
    const taken = starters.slice(offset, offset + room)
    const end = offset + taken.length
    return {
      templates: [...lead, ...taken],
      nextCursor: end < starters.length ? encodeCursor(`${STARTERS_CURSOR}${end}`) : null,
    }
  }
  if (cursor?.startsWith(STARTERS_CURSOR)) {
    const offset = Math.max(0, Math.floor(Number(cursor.slice(STARTERS_CURSOR.length)) || 0))
    return starterPage(offset, limit, [])
  }

  let query = firestore
    .collection('hosts')
    .doc(hostId)
    .collection('templates')
    .where('kind', '==', 'page')
    .orderBy(FieldPath.documentId())
    .limit(limit + 1)
  if (cursor) query = query.startAfter(cursor)
  const snapshot = await query.get()
  const docs = snapshot.docs.slice(0, limit)
  const library = docs
    .filter((doc) => isLibraryPageTemplate(doc.data() as Record<string, unknown>))
    .map((doc) => storedTemplate(doc.id, doc.data() as Record<string, unknown>, 'site'))
  if (snapshot.docs.length > limit && docs.length) {
    return { templates: library, nextCursor: encodeCursor(docs[docs.length - 1].id) }
  }
  // The library is done: the rest of the page is the starters.
  return starterPage(0, limit - library.length, library)
}

/**
 * One page template by id: a page template of the site's library, a copy of
 * a starter page the site keeps, or a built-in starter page the site has not
 * copied. `null` for anything else — a deleted template, a component or
 * layout template, a starter page the site has deleted, an id nothing has.
 */
export async function readPageTemplate(
  firestore: Firestore,
  hostId: string,
  templateId: string,
): Promise<PageTemplate | null> {
  const stored = await firestore.collection('hosts').doc(hostId).collection('templates').doc(templateId).get()
  const data = stored.data() as Record<string, unknown> | undefined
  if (stored.exists && data) {
    if (isLibraryPageTemplate(data)) return storedTemplate(templateId, data, 'site')
    if (sourceType(data) === STARTER_TEMPLATE_SOURCE && data['kind'] === 'page' && data['deletedAt'] == null) {
      return storedTemplate(templateId, data, 'built_in')
    }
    return null
  }
  if (!templateId.startsWith('starter-')) return null
  return (await starterPageTemplates(firestore, hostId)).find((template) => template.id === templateId) ?? null
}

/** What a page made from a template starts with, or the placeholders the caller named that it does not ask for. */
export function pageTemplateDraft(
  template: PageTemplate,
  typed: Readonly<Record<string, string>> | null | undefined,
):
  | { ok: true; nodes: Record<string, unknown>; description?: string; seo?: Record<string, unknown>; slug?: string }
  | { ok: false; fields: Record<string, string> } {
  const asked = new Set(template.placeholders.map((entry) => entry.name))
  const fields: Record<string, string> = {}
  for (const name of Object.keys(typed ?? {})) {
    if (!asked.has(name)) fields[`placeholders.${name}`] = 'This template has no such placeholder'
  }
  if (Object.keys(fields).length) return { ok: false, fields }
  return {
    ok: true,
    nodes: resolveTemplateNodes(template.nodes, templatePlaceholderValues(template.placeholders, typed)) as Record<string, unknown>,
    ...(template.description ? { description: template.description } : {}),
    ...(template.seo ? { seo: template.seo } : {}),
    ...(template.slug ? { slug: template.slug } : {}),
  }
}
