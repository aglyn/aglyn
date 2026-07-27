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

import { type HostCollectionKind, hostCollectionKind } from './collection-kind'

/**
 * A collection's slug is its public address — `/{slug}` for content,
 * `/collections/{slug}` for catalog — and nothing made it unique (AGL-957).
 * Two collections of the same kind could both be `blog`, and the resolvers,
 * which take the first match of the right kind, then served whichever one
 * Firestore happened to return. The other became unreachable, with no error
 * anywhere to say so.
 *
 * Uniqueness is per host AND per kind: content and catalog have separate URL
 * namespaces, so `/blog` and `/collections/blog` may coexist.
 */
export interface CollectionSlugCandidate {
  $id?: string
  slug?: string
}

/**
 * The id of the collection already using `slug`, or null when it is free.
 *
 * `exceptId` is the collection being edited — a rename that keeps the same
 * slug must not collide with itself. Comparison is case- and space-
 * insensitive because the slugifiers differ slightly between the two
 * surfaces and "Blog" vs "blog" resolve to the same URL either way.
 */
export function findCollectionSlugOwner(
  slug: string,
  kind: HostCollectionKind,
  existing: readonly CollectionSlugCandidate[] | null | undefined,
  exceptId?: string | null,
): string | null {
  const wanted = String(slug ?? '').trim().toLowerCase()
  if (!wanted) return null
  for (const candidate of existing ?? []) {
    if (exceptId && candidate.$id === exceptId) continue
    if (hostCollectionKind(candidate) !== kind) continue
    if (String(candidate.slug ?? '').trim().toLowerCase() === wanted) {
      return candidate.$id ?? ''
    }
  }
  return null
}

/** Convenience predicate over {@link findCollectionSlugOwner}. */
export function isCollectionSlugTaken(
  slug: string,
  kind: HostCollectionKind,
  existing: readonly CollectionSlugCandidate[] | null | undefined,
  exceptId?: string | null,
): boolean {
  return findCollectionSlugOwner(slug, kind, existing, exceptId) !== null
}
