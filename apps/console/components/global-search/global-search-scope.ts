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
 * What console search can answer, and the words it uses to promise it
 * (AGL-2179).
 *
 * ## Why this is a module and not three lines in the dialog
 *
 * The defect this closes is a PROMISE that outran the product: the console
 * mockup on `/product` and `/product/console` shows a top-bar field reading
 * `Search sites, orders, contacts…`, and the console had no search of any
 * kind. The fix is not to paste that placeholder over a real input — that
 * would be the same defect with a working text cursor. So the scope is
 * computed, the placeholder is DERIVED from it, and both are tested, because
 * the sentence is the part that can lie.
 *
 * ## What is searchable, and what is not
 *
 * Firestore has no full-text index and no `LIKE`. What it has is the
 * "scalable switcher" shape (AGL-835/838): a normalized `nameLower` written
 * beside the display name, queried as a prefix range. That is the whole
 * mechanism here, which fixes the boundary precisely:
 *
 * * **Sites** — `users/{uid}/hostMemberships` carries `nameLower`
 *   (`host-memberships.ts`) and is already indexed and in production behind
 *   the site switcher. Scoped by construction: the path is the caller's own
 *   membership projection, narrowed to the open workspace.
 * * **Screens** — `hosts/{hostId}/screens` carries `nameLower`, and only
 *   screens do: `/api/hosts/resources` stamps it for `resourceKey === 'screen'`
 *   and deliberately for nothing else, because "stamping it on every resource
 *   kind would be an index field nothing reads".
 *
 * Which is exactly why ORDERS AND CONTACTS ARE NOT HERE, despite being in the
 * mockup's placeholder:
 *
 * * **Orders** — `hosts/{h}/orders` has no `nameLower`. A prefix search over
 *   it costs a schema field, a backfill of every existing order and a new
 *   composite index; a missing index does not degrade, it throws
 *   `FAILED_PRECONDITION` in production. Adding the word "orders" to a
 *   placeholder is free, and that asymmetry is the whole trap.
 * * **Contacts** — real (`libs/plugins/contacts`) but behind
 *   `release_contacts`, which is `defaultEnabled: false`. Naming a
 *   capability most orgs cannot see is the mockup's error, not a fix for it.
 *
 * So the placeholder names what this context can actually reach and nothing
 * else. `describeEntities` keeps that honest by construction: a future entity
 * is added to one list and the sentence follows, rather than the two drifting.
 */

/** A class of thing console search can look through. */
export type GlobalSearchEntity = 'sites' | 'screens'

/** Everything the scope decision depends on. */
export interface GlobalSearchContext {
  /**
   * The resolved workspace, or null while it is still resolving.
   *
   * Load-bearing for SCOPE, not just for loading states. The sites query is
   * narrowed by `where('orgId','==',orgId)`, and an unresolved id there does
   * not narrow anything — it drops the filter and returns this person's site
   * memberships across every org they belong to (AGL-2350). So a null org
   * must produce a scope that searches NOTHING rather than a scope that
   * searches sites with a filter that is not there yet.
   */
  orgId: string | null
  /** The open site, when the URL names one. */
  hostId: string | null
  /** `hostId` is settled — `HostIdProvider` has finished resolving. */
  hostReady: boolean
}

export interface GlobalSearchScope {
  /** What may be queried, in the order results are shown. */
  entities: GlobalSearchEntity[]
  /** The field's placeholder, derived from `entities`. */
  placeholder: string
  /**
   * Nothing is searchable, so the affordance must not be offered at all.
   *
   * An input that cannot answer is the defect this issue is about, one
   * viewport smaller.
   */
  unavailable: boolean
}

/** How each entity is named to a person. */
const ENTITY_NOUN: Record<GlobalSearchEntity, string> = {
  sites: 'sites',
  screens: 'pages',
}

/**
 * "sites", "sites and pages", "sites, pages and orders" — an Oxford-comma-free
 * list, because this is prose in a placeholder rather than a sentence.
 */
export function describeEntities(entities: GlobalSearchEntity[]): string {
  const nouns = entities.map((entity) => ENTITY_NOUN[entity])
  if (nouns.length === 0) return ''
  if (nouns.length === 1) return nouns[0]
  return `${nouns.slice(0, -1).join(', ')} and ${nouns[nouns.length - 1]}`
}

/**
 * What can be searched from where the caller is standing.
 *
 * Deliberately total and deliberately pure: every branch is reachable from a
 * real console route — the workspace picker (no org yet), an org-level page
 * (org but no site), and any site page (both).
 */
export function resolveGlobalSearchScope(
  context: GlobalSearchContext,
): GlobalSearchScope {
  const entities: GlobalSearchEntity[] = []

  // Sites first: they are the only thing searchable off a site, and the
  // thing people navigate between most.
  if (context.orgId) entities.push('sites')
  // Screens belong to ONE site, so they are only offered on a site, and only
  // once the id is settled — a half-resolved host would query
  // `hosts//screens`, which `useSwitcherCollection` holds on anyway.
  if (context.orgId && context.hostReady && context.hostId) {
    entities.push('screens')
  }

  if (entities.length === 0) {
    return {
      entities,
      placeholder: 'Search',
      unavailable: true,
    }
  }

  return {
    entities,
    placeholder: `Search ${describeEntities(entities)}…`,
    unavailable: false,
  }
}

/**
 * The sentence under the results, which is the honest half of this feature.
 *
 * A prefix match behaves unlike the search box people expect: typing `store`
 * finds "Store front" and never "My store". Leaving that undocumented makes
 * an absent result read as "you do not have one", which for a person about to
 * create a duplicate is the expensive direction to be wrong in. Named after
 * `mediaSearchScopeMessage`, which exists for the same reason.
 */
export function globalSearchScopeMessage(scope: GlobalSearchScope): string {
  if (scope.unavailable) return ''
  return (
    `Matches ${describeEntities(scope.entities)} whose name STARTS with what ` +
    'you type. Orders and contacts are not searchable.'
  )
}
