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
 * Two unrelated features share `hosts/{hostId}/collections` (AGL-954):
 *
 * - **content** — the Content page's publishable collections. They own an
 *   `entries` subcollection and serve at `/{collectionSlug}/{entrySlug}`.
 * - **catalog** — commerce's manual/smart product collections. They own
 *   nothing and serve at `/collections/{slug}`.
 *
 * Nothing on the documents said which was which, so every surface listed the
 * other's rows and a public slug lookup could resolve to the wrong kind.
 * Every document now carries `kind` — both console surfaces stamp it, site
 * import stamps it, and the pre-existing documents were backfilled (AGL-979),
 * so reads no longer infer anything from shape. `legacyCollectionKind` below
 * is the one remaining inference, confined to the import adapter.
 */
export type HostCollectionKind = 'content' | 'catalog'

/** Written onto every collection doc created from here on (AGL-954). */
export const HOST_COLLECTION_KINDS: readonly HostCollectionKind[] = [
  'content',
  'catalog',
]

function isKind(value: unknown): value is HostCollectionKind {
  return value === 'content' || value === 'catalog'
}

/**
 * Which feature owns this `collections` doc.
 *
 * Reads `kind` and nothing else. A document that does not say what it is is
 * treated as content — the safe direction, because content is the kind that
 * owns `entries`, and mistaking it for catalog is what puts those entries in
 * reach of a delete.
 */
export function hostCollectionKind(
  data: object | null | undefined,
): HostCollectionKind {
  if (!data) return 'content'
  // Accepts any object shape — callers pass typed rows (HostCollection) as
  // readily as raw Firestore data.
  const fields = (data as Record<string, unknown>)['kind']
  return isKind(fields) ? fields : 'content'
}

/**
 * Classify a collection that predates the `kind` field, from its shape.
 *
 * ONLY for the site-import adapter: a bundle exported before AGL-954 has no
 * `kind`, and that is the one path where an old catalog collection can still
 * arrive. Every other reader uses {@link hostCollectionKind}, which does not
 * guess. Only catalog collections carry the membership keys, so their presence
 * is decisive; everything else is content.
 */
export function legacyCollectionKind(
  data: object | null | undefined,
): HostCollectionKind {
  if (!data) return 'content'
  const fields = data as Record<string, unknown>
  if (isKind(fields['kind'])) return fields['kind']
  return fields['mode'] !== undefined ||
    fields['rules'] !== undefined ||
    fields['productIds'] !== undefined
    ? 'catalog'
    : 'content'
}

/** Filter helper: `docs.filter(isHostCollectionKind('catalog'))`. */
export function isHostCollectionKind(kind: HostCollectionKind) {
  return (data: object | null | undefined): boolean =>
    hostCollectionKind(data) === kind
}
