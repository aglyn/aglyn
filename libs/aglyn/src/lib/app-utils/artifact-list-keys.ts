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

import { displayNameSearchFields } from './name-search'

/*
 * THE KEYS A SITE ARTIFACT'S LISTS QUERY BY (AGL-3321).
 *
 * The screens, layouts, reusable components and templates of a site are
 * listed, searched and filtered by Firestore queries, so every key a list
 * asks about has to be WRITTEN — a query cannot find a document by a value it
 * derives, and cannot find one that lacks the field at all:
 *
 *   nameLower / nameTokens / nameReversed
 *                the name keys (`displayNameSearchFields`), on all four;
 *   kind         on a component, `site` or `email` — a component stored
 *                before AGL-3287 carries none and is read as `site`, so the
 *                "Used in: Page" filter needs the word stored;
 *                on a template, `page`, `component` or `layout` — a template
 *                stored with none is read as a page template;
 *   source.type  on a template, its provenance — one stored with no
 *                `source`, or with the legacy `workspace`, was saved here,
 *                which is `authored`;
 *   libraryRow   on a template, whether it is its own row of the templates
 *                library: a multi-page STARTER is one row (AGL-696), led by
 *                its first live page, so the other pages carry `false` — and
 *                so does a deleted template (`artifactDeleteListKeys`), which
 *                is how the library's query leaves tombstones out;
 *
 *   description  on a layout or component that has none, `null` — the
 *                lists sort by it (AGL-3680), and an `orderBy` drops every
 *                document that lacks the field. A writer that passes a
 *                partial document here must pass its `description` too, or
 *                the null would overwrite the one it writes;
 *   deletedAt    on a screen, `null` — the flag a campaign's screens list
 *                asks for (`deletedAt == null`) to leave tombstones out. A
 *                query cannot ask for a field to be absent, so a live
 *                screen must STORE the null; a delete overwrites it with
 *                the time (and the security rules let an editor do that
 *                only while it is null, so a tombstone stays one);
 *
 * A DELETED screen gets none of them. The email templates list orders by
 * `nameLower`, and an email template's delete clears its name keys so the
 * tombstone leaves that order (a query cannot ask for `deletedAt` to be
 * absent) — so no create, restore or backfill may stamp them back.
 *
 * Every CREATE stamps them (`artifactCreateListKeys`) and every rename
 * restamps the name keys (`artifactRenameListKeys`).
 * `tools/scripts/backfill-artifacts-list-keys.mjs` stamps the documents
 * written before them; a script cannot import this library, so it reads the
 * documents the way this module does, and both sides answer
 * `tools/scripts/lib/artifact-list-keys.fixtures.json` — this module's spec
 * and the backfill's `--self-test`.
 */

/** The site artifact collections whose lists query these keys. */
export const LISTED_ARTIFACT_COLLECTIONS = [
  'screens',
  'layouts',
  'components',
  'templates',
] as const

export type ListedArtifactCollection =
  (typeof LISTED_ARTIFACT_COLLECTIONS)[number]

/** Whether a host subcollection is one whose lists query these keys. */
export const isListedArtifactCollection = (
  collection: string,
): collection is ListedArtifactCollection =>
  (LISTED_ARTIFACT_COLLECTIONS as readonly string[]).includes(collection)

/** The kinds a template's `kind` holds; absent reads as `page`. */
const TEMPLATE_KINDS = ['page', 'component', 'layout']

/**
 * A provenance word no writer stores any more: a detached marketplace copy
 * was stamped `workspace` before it was stamped `authored` (AGL-3321).
 */
const LEGACY_AUTHORED_SOURCE = 'workspace'

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

/**
 * The name a list finds an artifact by.
 *
 * Its `displayName` — except a page of a multi-page STARTER, which the
 * templates library lists as ONE row under the starter's name
 * (`source.starterName`), so every page of it carries that name's keys and a
 * search for the starter finds the row whichever page leads it.
 */
export function artifactSearchName(
  collection: string,
  doc: Record<string, unknown>,
): unknown {
  if (collection === 'templates') {
    const starterName = record(doc['source'])['starterName']
    if (typeof starterName === 'string' && starterName.trim()) return starterName
  }
  return doc['displayName']
}

/**
 * The list keys a CREATE of `doc` into `collection` stamps: the name keys,
 * and the stored default of a kind a reader otherwise infers. Nothing for a
 * collection no artifact list queries.
 *
 * Spread AFTER the document's own fields: the keys are derived from them.
 */
export function artifactCreateListKeys(
  collection: string,
  doc: Record<string, unknown>,
): Record<string, unknown> {
  if (!isListedArtifactCollection(collection)) return {}
  if (collection === 'screens' && doc['deletedAt'] != null) return {}
  const keys: Record<string, unknown> = {
    ...displayNameSearchFields(artifactSearchName(collection, doc)),
  }
  // Stored, not omitted: `deletedAt == null` matches only a document that
  // holds the field (AGL-3321, a campaign's screens).
  if (collection === 'screens') keys['deletedAt'] = null
  if (collection === 'components' && doc['kind'] !== 'email') keys['kind'] = 'site'
  // Stored, not omitted: the Description header orders by it (AGL-3680).
  if ((collection === 'layouts' || collection === 'components') && doc['description'] == null) {
    keys['description'] = null
  }
  if (collection === 'templates') {
    if (!TEMPLATE_KINDS.includes(String(doc['kind']))) keys['kind'] = 'page'
    // Provenance is server-managed (AGL-666), and a writer that states it is
    // never overridden here. None at all, or the legacy word a detached copy
    // carried, was saved here, which is `authored`.
    const sourceType = record(doc['source'])['type']
    if (typeof sourceType !== 'string' || sourceType === LEGACY_AUTHORED_SOURCE) {
      keys['source'] = { ...record(doc['source']), type: 'authored' }
    }
    keys['libraryRow'] = doc['deletedAt'] == null && leadsItsStarter(doc)
  }
  return keys
}

/**
 * Whether a template leads its starter's library row when the starter is
 * written whole: every template that is not a starter page does, and of a
 * starter's pages the first (`starterOrder` 0). A later delete moves the lead
 * to the next live page — see `artifactDeleteListKeys`.
 */
function leadsItsStarter(doc: Record<string, unknown>): boolean {
  const source = record(doc['source'])
  const starterId = source['starterId']
  if (typeof starterId !== 'string' || !starterId) return true
  return Number(source['starterOrder'] ?? 0) === 0
}

/**
 * The list keys a SOFT DELETE writes beside `deletedAt`: a deleted template
 * is no longer a library row. A caller deleting the page that LEADS a
 * starter's row gives the lead to the next live page (`libraryRow: true`),
 * or the starter disappears from the library with pages still in it.
 */
export function artifactDeleteListKeys(
  collection: string,
): Record<string, unknown> {
  return collection === 'templates' ? { libraryRow: false } : {}
}

/**
 * The name keys a RENAME writes beside the new `displayName`. `doc` is the
 * document as read, for the one case whose search name is not its display
 * name (a starter page — see `artifactSearchName`).
 */
export function artifactRenameListKeys(
  collection: string,
  displayName: unknown,
  doc: Record<string, unknown> = {},
): Record<string, unknown> {
  if (!isListedArtifactCollection(collection)) return {}
  return displayNameSearchFields(
    artifactSearchName(collection, { ...doc, displayName }),
  )
}
