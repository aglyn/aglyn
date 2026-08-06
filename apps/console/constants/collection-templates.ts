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
 * The three fields a content collection can point at a template screen with.
 * `templateScreenId` is the legacy AGL-105 field the tenant runtime's
 * `resolveCollectionTemplateScreenId` still falls back to, so hosts predating
 * the list/entry split are covered.
 *
 * Kept in step with `app/api/hosts/resources/count-billable-screens.ts`, which
 * subtracts the same set from the plan's screen allowance, and with the tenant
 * runtime's `COLLECTION_TEMPLATE_SCREEN_FIELDS` (AGL-1267), which subtracts it
 * from the host routing map. Deliberately re-declared rather than imported
 * from `@aglyn/tenant-runtime`: that module's first statement is
 * `import { firebaseAdmin } from '@aglyn/tenant-data-admin'`, and every reader
 * here is a `'use client'` page.
 */
export const COLLECTION_TEMPLATE_SCREEN_FIELDS = [
  'listScreenId',
  'entryScreenId',
  'templateScreenId',
] as const

/** Which of a collection's two routes a template screen renders. */
export type CollectionTemplateRole = 'list' | 'entry'

/** One route a template screen is responsible for. */
export interface CollectionTemplateRoute {
  role: CollectionTemplateRole
  /** The collection's routing slug, e.g. `blog`. */
  collectionSlug: string
  /** The collection's name, for prose that names it rather than its slug. */
  collectionName?: string
}

/** The fields this reads off a `hosts/{hostId}/collections` document. */
export interface CollectionTemplateSource {
  slug?: unknown
  displayName?: unknown
  listScreenId?: unknown
  entryScreenId?: unknown
  templateScreenId?: unknown
}

function screenIdOf(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/**
 * Every screen id any collection designates as a list or entry template.
 *
 * The billable-screen precheck's shape (AGL-1173), lifted out of the screens
 * page so the publish surfaces answer the same question the same way. All
 * three fields count, including a `templateScreenId` superseded by a newer
 * `entryScreenId`: a superseded pointer still marks the screen as a template,
 * so it is still not billable and still not a page (AGL-1267).
 */
export function collectionTemplateScreenIds(
  collections:
    | ReadonlyArray<CollectionTemplateSource | null | undefined>
    | null
    | undefined,
): Set<string> {
  const ids = new Set<string>()
  for (const contentCollection of collections ?? []) {
    if (!contentCollection) continue
    for (const field of COLLECTION_TEMPLATE_SCREEN_FIELDS) {
      const screenId = screenIdOf(contentCollection[field])
      if (screenId) ids.add(screenId)
    }
  }
  return ids
}

/**
 * What each template screen actually renders, keyed by screen id.
 *
 * Mirrors the tenant runtime's `resolveCollectionTemplateScreenId`: a list
 * route resolves through `listScreenId` ONLY, an entry route through
 * `entryScreenId` with the legacy `templateScreenId` as fallback. So a
 * `templateScreenId` sitting behind a set `entryScreenId` contributes no
 * route — it is designated but superseded, and claiming it renders
 * `/{collection}/{entry}` would be as wrong as the slug this replaces.
 *
 * A screen may appear under several routes: the same screen can be both the
 * list and the entry template of one collection, or a template for two.
 * Collections with no slug contribute nothing, since there is no route to
 * name.
 */
export function collectCollectionTemplateRoutes(
  collections:
    | ReadonlyArray<CollectionTemplateSource | null | undefined>
    | null
    | undefined,
): Map<string, CollectionTemplateRoute[]> {
  const routes = new Map<string, CollectionTemplateRoute[]>()
  const add = (screenId: string, route: CollectionTemplateRoute) => {
    const existing = routes.get(screenId)
    if (existing) existing.push(route)
    else routes.set(screenId, [route])
  }
  for (const contentCollection of collections ?? []) {
    if (!contentCollection) continue
    const collectionSlug =
      typeof contentCollection.slug === 'string' ? contentCollection.slug : ''
    if (!collectionSlug) continue
    const collectionName =
      typeof contentCollection.displayName === 'string'
        ? contentCollection.displayName
        : undefined
    const listScreenId = screenIdOf(contentCollection.listScreenId)
    if (listScreenId) {
      add(listScreenId, { role: 'list', collectionSlug, collectionName })
    }
    const entryScreenId =
      screenIdOf(contentCollection.entryScreenId) ??
      screenIdOf(contentCollection.templateScreenId)
    if (entryScreenId) {
      add(entryScreenId, { role: 'entry', collectionSlug, collectionName })
    }
  }
  return routes
}

/** The path a template route is served at: `/blog`, `/blog/{entry}`. */
export function collectionTemplateRoutePath(
  route: CollectionTemplateRoute,
): string {
  return route.role === 'list'
    ? `/${route.collectionSlug}`
    : `/${route.collectionSlug}/{entry}`
}

/** `a`, `a and b`, `a, b and c`. */
function joinPhrases(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * The paths a template screen renders, deduplicated and in a stable order
 * (list before entry, then by slug) — `undefined` when it renders none that
 * can be named.
 */
export function collectionTemplateRoutesSummary(
  routes: readonly CollectionTemplateRoute[] | undefined,
): string | undefined {
  if (!routes?.length) return undefined
  const paths = [...routes]
    .sort((a, b) =>
      a.role === b.role
        ? a.collectionSlug.localeCompare(b.collectionSlug)
        : a.role === 'list'
          ? -1
          : 1,
    )
    .map(collectionTemplateRoutePath)
  const unique = [...new Set(paths)]
  return unique.length ? joinPhrases(unique) : undefined
}

/**
 * What to tell the author after publishing a screen that is a collection
 * template (AGL-1269).
 *
 * Publishing a template is still the right thing to do — it is what makes the
 * compose pipeline pick the screen up — but since AGL-1267 the screen is NOT
 * a page of the site, so naming the slug it was published under names a 404.
 * Say what publishing achieved instead: the collection routes this template
 * now renders.
 *
 * Returns `undefined` when the screen is not a template, so callers keep their
 * ordinary `Published at …` message.
 */
export function collectionTemplatePublishMessage(
  routes: readonly CollectionTemplateRoute[] | undefined,
  options?: { isTemplateScreen?: boolean },
): string | undefined {
  const summary = collectionTemplateRoutesSummary(routes)
  if (summary) return `Published — this template now renders ${summary}`
  // Designated as a template but with no route to name: a collection with no
  // slug yet, or a legacy `templateScreenId` superseded by `entryScreenId`.
  // Still not a page, so still must not be described as one.
  if (options?.isTemplateScreen) {
    return (
      'Published — this screen is a collection template, so it is not ' +
      'served at a path of its own'
    )
  }
  return undefined
}
