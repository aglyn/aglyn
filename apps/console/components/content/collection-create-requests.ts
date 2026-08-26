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
 * What creating a collection actually SENDS (AGL-2498).
 *
 * things — name, the address it serves, and the two screens that render its
 * list and its entries.
 *
 * Those four do not travel together. `/api/hosts/collections` accepts
 * `displayName` and `slug` on `create` and writes the template pointers under
 * a separate `templates` action, because assigning a screen to a collection is
 * a different permission question from naming one. So a fully-specified new
 * collection is two requests, and which ones to send is a decision worth
 * having in one place with a test rather than inline in a dialog.
 */

export interface CollectionCreateInput {
  hostId: string
  displayName: string
  slug: string
  /** Empty means the built-in themed list — the default, and no request. */
  listScreenId?: string
  /** Empty means the built-in themed article. */
  entryScreenId?: string
}

/** One POST body for `/api/hosts/collections`. */
export type CollectionCreateBody = Record<string, unknown>

/** The create request, always sent first — nothing can point at a document
 * That does not exist yet. */
export function collectionCreateBody(
  input: CollectionCreateInput,
): CollectionCreateBody {
  return {
    hostId: input.hostId,
    action: 'create',
    kind: 'content',
    data: { displayName: input.displayName, slug: input.slug },
  }
}

/**
 * The template-pointer requests, if any — sent AFTER the create, with the id
 * it returned.
 *
 * Empty for a collection left on both built-in pages, which is the common
 * case and the one the docs teach: create, write entries, then design the
 * pages. A collection with no pointers still renders.
 *
 * The entry pointer clears the superseded AGL-105 `templateScreenId` in the
 * same write, so a brand-new document is never born carrying a pointer the
 * runtime only keeps for hosts that predate the list/entry split.
 */
export function collectionTemplateBodies(
  input: CollectionCreateInput & { id: string },
): CollectionCreateBody[] {
  const bodies: CollectionCreateBody[] = []
  if (input.listScreenId) {
    bodies.push({
      hostId: input.hostId,
      action: 'templates',
      id: input.id,
      data: { listScreenId: input.listScreenId },
    })
  }
  if (input.entryScreenId) {
    bodies.push({
      hostId: input.hostId,
      action: 'templates',
      id: input.id,
      data: {
        entryScreenId: input.entryScreenId,
        templateScreenId: null,
      },
    })
  }
  return bodies
}
