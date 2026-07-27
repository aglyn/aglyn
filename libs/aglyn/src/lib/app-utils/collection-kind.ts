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
 * New documents carry `kind`; the classifier below falls back to shape so the
 * live documents that predate it need no backfill to be read correctly.
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
 * Trusts an explicit `kind` when present. Otherwise infers from shape: only
 * catalog collections carry the membership keys (`mode`, `rules`,
 * `productIds`), so their presence is decisive, and everything else — including
 * a bare `{ displayName, slug }` — is content. Defaulting the ambiguous case to
 * content is the safe direction: content is the kind that owns `entries`, and
 * mistaking it for catalog is what puts those entries in reach of a delete.
 */
export function hostCollectionKind(
  data: Record<string, unknown> | null | undefined,
): HostCollectionKind {
  if (!data) return 'content'
  if (isKind(data['kind'])) return data['kind']
  if (
    data['mode'] !== undefined ||
    data['rules'] !== undefined ||
    data['productIds'] !== undefined
  ) {
    return 'catalog'
  }
  return 'content'
}

/** Filter helper: `docs.filter(isHostCollectionKind('catalog'))`. */
export function isHostCollectionKind(kind: HostCollectionKind) {
  return (data: Record<string, unknown> | null | undefined): boolean =>
    hostCollectionKind(data) === kind
}
