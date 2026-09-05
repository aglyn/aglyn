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
 * (AGL-2179, widened and corrected under AGL-2486).
 *
 * ## The failure this shape exists to avoid, measured rather than reasoned
 *
 * Driven against the seeded emulator, a `nameLower` prefix query does this:
 * opening the palette lists four rows — a site and three pages, one of them
 * literally named **Home** — and typing `home` returns **zero**.
 *
 * The reason is not the matcher being strict. It is that the search mode of
 * `useSwitcherCollection` is `orderBy('nameLower')`, and **Firestore omits
 * every document that does not carry the ordered field**. `nameLower` is
 * written by exactly three paths (`/api/hosts/resources` on create, the screen
 * rename in the `view` page, and `/api/hosts/import`) and for exactly one
 * resource kind. Every screen older than AGL-835, and every screen written by
 * any other path, is therefore invisible to search while remaining visible in
 * the idle list — which is precisely "shows results until you touch it".
 *
 * This is the same hazard `/api/admin/orgs` already documents in its own
 * comment: *"an `orderBy` on a field some org docs lack would silently hide
 * them"*. It cost that route a real bug; it costs this one the whole feature.
 *
 * ## The mechanism now, and why it is the DAM's and not the switcher's
 *
 * `media-search.ts` faced this exact fork and chose: read a bounded set, match
 * richly over all of it, and describe the bound. Its reasoning applies here
 * word for word — Firestore has no `LIKE` and no full-text index, so a
 * word-anywhere match has no server expression at any price, and buying the
 * prefix shape for eleven more collections costs a schema field, a backfill of
 * every existing document, and a composite index for each one that also
 * carries a `where`. The repo has exactly ONE `nameLower` composite index
 * today, which is the measure of how far that path was ever taken.
 *
 * So: `useGlobalSearch` reads a capped window per collection, ONCE per page
 * mount, and `name-match.ts` matches over all of it. That fixes the
 * disappearing "Home", and it is what lets `layout` find "Main Layout".
 *
 * ## Read cost is a design input here, not an afterthought
 *
 * A palette that reads on open bills every org for every page mount, whether
 * or not anybody searches. Three controls, in order of how much they save:
 *
 * 1. **Nothing is read until two characters are typed.** Populating a
 *    recently-updated list on open would spend a read in every group before
 *    anyone has asked for anything. Opening costs zero.
 * 2. **One fetch per collection per page mount**, cached. Typing more, or
 *    closing and reopening the palette, costs nothing further — a longer
 *    query can only ever narrow what a shorter one returned, so it is
 *    answered from memory.
 * 3. **A group nobody is entitled to is never read.** The free plan has no
 *    workflows, products, services or redirects, so a free workspace fans out
 *    to strictly fewer collections than a paid one. Cost scales with what the
 *    org actually owns, which is the right direction for a plan that has to
 *    hard-cap.
 *
 * ## And the honesty, which is load-bearing
 *
 * A window is a partial set. `globalSearchScopeMessage` says so, and
 * `useGlobalSearch` marks any group that filled its window as truncated, so an
 * absent result never silently reads as "you do not have one" to somebody
 * about to create a duplicate. That promise was only half kept until AGL-2179
 * was reverified against a real console: a group that matched NOTHING used to
 * be dropped before it could render its caveat, so the one case where the
 * caveat carried information was the one case that hid it. It is also why the
 * window now escalates rather than merely apologising — see
 * `SEARCH_ESCALATION_WINDOW`. A group whose read FAILED says that too, rather
 * than rendering as zero matches — a swallowed query that renders as a
 * measured zero is worse than an error, because nothing looks wrong.
 */

import { Route } from '@aglyn/aglyn/app-utils/console-routes'

/** A class of thing console search can look through. */
export type GlobalSearchEntity =
  | 'sites'
  | 'screens'
  | 'emails'
  | 'contacts'
  | 'components'
  | 'layouts'
  | 'templates'
  | 'collections'
  | 'authors'
  | 'workflows'
  | 'products'
  | 'redirects'
  | 'services'

/**
 * Where a collection hangs, which decides BOTH the path and who may read it.
 *
 * `host` collections are `hosts/{hostId}/…` for the site already open, which
 * `HostGuard` has admitted the caller to and which the Firestore rules gate on
 * host membership. `org` collections are `users/{uid}/…` — the caller's OWN
 * projection, which the rules would refuse for anyone else. Nothing here is a
 * top-level collection query, deliberately: a top-level query is the shape
 * that can leak, whatever it filters on.
 */
/**
 * Where a collection lives, which decides how it is read.
 *
 * `host` is `hosts/{hostId}/…`; `org` is the caller's OWN projection under
 * `users/{uid}/…`, narrowed by `orgId`; `orgData` is the org-shared data root
 * `orgs/{orgId}/…`, whose rules judge every document by its `visibleTo`
 * tokens (AGL-2596) — so an `orgData` read carries the viewer's tokens as an
 * `array-contains-any` filter, the same predicate the rules evaluate, and is
 * refused outright when they are unknown rather than issued unfiltered and
 * denied.
 */
export type GlobalSearchScopeKind = 'host' | 'org' | 'orgData'

export interface GlobalSearchEntityDef {
  id: GlobalSearchEntity
  /** Heading above the rows. */
  group: string
  /** How the entity is named inside a sentence. */
  noun: string
  scopeKind: GlobalSearchScopeKind
  /** Collection name under the scope root. */
  collection: string
  /**
   * The document field holding the human-readable name.
   *
   * Not uniform across the platform and deliberately not normalised here:
   * screens/layouts/components/templates use `displayName`, the logic and
   * commerce resources use `name`. Getting this wrong renders a group of rows
   * all labelled with their document id, which is why every entry is pinned
   * by a test against the real write path's allow-list.
   */
  nameField: string
  /**
   * The field the row is LABELLED by when `nameField` is empty.
   *
   * A contact captured by a checkout may carry no name at all, and a row
   * labelled by its document id is a row nobody recognizes; the email is
   * what the CRM shows for the same person.
   */
  fallbackNameField?: string
  /** Extra fields a reader may legitimately search by (slug, route). */
  extraFields?: string[]
  /**
   * The plan quota that must be non-zero, or the feature flag that must be
   * on, for this group to be READ AT ALL.
   *
   * Both a cost control and a correctness one: querying a collection the org
   * cannot use spends a read to render nothing, every time.
   */
  entitlementKey?: string
  featureKey?: string
}

/**
 * Everything searchable, in the order groups are shown.
 *
 * Ordered by how often the answer is wanted, not alphabetically: somebody
 * typing into a console search box is usually trying to REACH a page.
 */
export const GLOBAL_SEARCH_ENTITIES: GlobalSearchEntityDef[] = [
  {
    id: 'sites',
    group: 'Sites',
    noun: 'sites',
    scopeKind: 'org',
    collection: 'hostMemberships',
    nameField: 'displayName',
    extraFields: ['subdomain'],
  },
  {
    id: 'screens',
    group: 'Pages',
    noun: 'pages',
    scopeKind: 'host',
    collection: 'screens',
    nameField: 'displayName',
    extraFields: ['route', 'slug'],
  },
  {
    id: 'emails',
    group: 'Emails',
    noun: 'emails',
    scopeKind: 'host',
    collection: 'screens',
    nameField: 'displayName',
  },
  {
    /*
     * People, by name, email, phone number or company (AGL-2596). The phone
     * and the company name are top-level echoes of the viewing holder's
     * facet, written by every path that sets them, precisely so this read —
     * which never resolves a facet — can hit them. Ungated by plan: every
     * tier has an audience band. Gated by the CALLER instead: the dialog
     * supplies `orgDataTokens` only when the Contacts surface is released
     * for the viewer and they hold `data.manage`, which is the read rule.
     */
    id: 'contacts',
    group: 'Contacts',
    noun: 'contacts',
    scopeKind: 'orgData',
    collection: 'contacts',
    nameField: 'name',
    fallbackNameField: 'email',
    extraFields: ['email', 'phone', 'companyName'],
  },
  {
    id: 'components',
    group: 'Components',
    noun: 'components',
    scopeKind: 'host',
    collection: 'components',
    nameField: 'displayName',
    // A boolean feature rather than a numeric quota: the free plan turns
    // reusable components OFF entirely rather than allowing zero of them.
    featureKey: 'reusableComponents',
  },
  {
    id: 'layouts',
    group: 'Layouts',
    noun: 'layouts',
    scopeKind: 'host',
    collection: 'layouts',
    nameField: 'displayName',
    entitlementKey: 'sharedLayoutsPerHost',
  },
  {
    id: 'templates',
    group: 'Templates',
    noun: 'templates',
    scopeKind: 'host',
    collection: 'templates',
    nameField: 'displayName',
    extraFields: ['slug'],
    entitlementKey: 'templatesPerHost',
  },
  {
    id: 'collections',
    group: 'Content',
    noun: 'content collections',
    scopeKind: 'host',
    collection: 'collections',
    nameField: 'displayName',
    extraFields: ['slug'],
  },
  {
    id: 'authors',
    group: 'Authors',
    noun: 'authors',
    scopeKind: 'host',
    collection: 'authors',
    nameField: 'name',
  },
  {
    id: 'workflows',
    group: 'Workflows',
    noun: 'workflows',
    scopeKind: 'host',
    collection: 'workflows',
    nameField: 'name',
    entitlementKey: 'workflowsPerHost',
    featureKey: 'workflows',
  },
  {
    id: 'products',
    group: 'Products',
    noun: 'products',
    scopeKind: 'host',
    collection: 'products',
    nameField: 'name',
    extraFields: ['slug'],
    entitlementKey: 'productsPerHost',
    featureKey: 'commerce',
  },
  {
    id: 'redirects',
    group: 'Redirects',
    noun: 'redirects',
    scopeKind: 'host',
    collection: 'redirects',
    nameField: 'source',
    extraFields: ['destination'],
    entitlementKey: 'redirectsPerHost',
    featureKey: 'redirects',
  },
  {
    id: 'services',
    group: 'Services',
    noun: 'services',
    scopeKind: 'host',
    collection: 'services',
    nameField: 'name',
    entitlementKey: 'servicesPerHost',
    featureKey: 'bookings',
  },
]

/** Everything the scope decision depends on. */
export interface GlobalSearchContext {
  /**
   * The resolved workspace, or null while it is still resolving.
   *
   * Load-bearing for SCOPE, not just for loading states. The sites read is
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
  /**
   * Numeric plan quotas and boolean feature flags for the open workspace,
   * or null while they are still resolving.
   *
   * Null means UNRESOLVED, and is treated as "read nothing extra" rather than
   * as "free tier" — a loading default that answers a question it was never
   * asked is how a paying org gets rendered as Free. Groups with no
   * entitlement key at all (pages, content, authors) are unaffected, so the
   * palette still works while entitlements settle.
   */
  entitlements: Record<string, unknown> | null
  /** True once `entitlements` reflects a real answer rather than a default. */
  entitlementsReady: boolean
  /**
   * The viewer's scope tokens for the org-shared data root, or null when
   * `orgData` groups must not be offered at all (AGL-2596).
   *
   * Null covers three situations the resolver cannot tell apart and does not
   * need to: the tokens are still resolving, the viewer lacks the permission
   * the rules read for, or the surface those groups belong to is not
   * released for them. In every case the right answer is the same — no
   * `orgData` group — and a read attempted anyway would be denied and render
   * as a failure the reader cannot act on.
   */
  orgDataTokens?: readonly string[] | null
}

export interface GlobalSearchScope {
  /** What may be queried, in the order results are shown. */
  entities: GlobalSearchEntityDef[]
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

/**
 * Is this group's entitlement satisfied?
 *
 * A numeric quota counts as enabled when it is anything other than zero —
 * `UNLIMITED` is a sentinel number, and a plan that grants none of something
 * stores `0`. An ABSENT key is treated as enabled, because a resolved
 * entitlement record that simply does not mention a quota is the shape every
 * pre-existing org has, and reading "absent" as "denied" would silently empty
 * most of the palette for them.
 */
export function entitlementAllows(
  definition: GlobalSearchEntityDef,
  entitlements: Record<string, unknown> | null,
): boolean {
  if (!definition.entitlementKey && !definition.featureKey) return true
  if (!entitlements) return false
  if (definition.featureKey && entitlements[definition.featureKey] === false) {
    return false
  }
  if (definition.entitlementKey) {
    const quota = entitlements[definition.entitlementKey]
    if (quota === 0 || quota === false) return false
  }
  return true
}

/**
 * "sites", "sites and pages", "sites, pages and emails" — an Oxford-comma-free
 * list, because this is prose in a placeholder rather than a sentence.
 */
export function describeEntities(entities: GlobalSearchEntityDef[]): string {
  const nouns = entities.map((entity) => entity.noun)
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
  const entities: GlobalSearchEntityDef[] = []
  const onHost = Boolean(context.orgId && context.hostReady && context.hostId)

  for (const definition of GLOBAL_SEARCH_ENTITIES) {
    // Sites are the only thing searchable off a site, and the thing people
    // navigate between most.
    if (definition.scopeKind === 'org' && !context.orgId) continue
    // Host collections belong to ONE site, so they are only offered on a
    // site, and only once the id is settled — a half-resolved host would
    // address `hosts//screens`.
    if (definition.scopeKind === 'host' && !onHost) continue
    // Org data is read through the viewer's scope tokens, and without them
    // the read cannot be filtered the way the rules require — so the group
    // is withheld rather than offered and denied.
    if (
      definition.scopeKind === 'orgData' &&
      (!context.orgId || !context.orgDataTokens?.length)
    ) {
      continue
    }
    // An unresolved entitlement answers nothing: hold the gated groups until
    // it is real, rather than letting a loading default decide.
    if (
      (definition.entitlementKey || definition.featureKey) &&
      (!context.entitlementsReady ||
        !entitlementAllows(definition, context.entitlements))
    ) {
      continue
    }
    entities.push(definition)
  }

  if (entities.length === 0) {
    return { entities, placeholder: 'Search', unavailable: true }
  }

  // The placeholder names the first few rather than all twelve: a field whose
  // placeholder does not fit the field is not a promise anybody reads.
  //
  // `and more` REPLACES the list's own conjunction rather than following it.
  // Measured on a real console, the two together read
  // "Search sites, pages and emails and more…" — the one element of this
  // feature everybody sees, stuttering.
  const named = entities.slice(0, 3)
  const body =
    entities.length > named.length
      ? `${named.map((entity) => entity.noun).join(', ')} and more`
      : describeEntities(named)
  return {
    entities,
    placeholder: `Search ${body}…`,
    unavailable: false,
  }
}

/**
 * The sentence under the results, which is the honest half of this feature.
 *
 * Two claims, both of which have to stay true as the code changes, which is
 * why they are generated from the same constant the reader is bounded by:
 *
 *  * WHAT counts as a match — any part of the name, so an absent result is
 *    really an absent thing and not a matcher technicality. This is the claim
 *    the old copy had to make in the opposite direction ("whose name STARTS
 *    with what you type"), and the reason it had to is now gone.
 *  * HOW MUCH was looked at — the window. This is the claim that keeps the
 *    new mechanism from being a nicer-looking version of the old lie. Named
 *    after `mediaSearchScopeMessage`, which exists for the same reason.
 */
export function globalSearchScopeMessage(
  scope: GlobalSearchScope,
  windowSize: number,
): string {
  if (scope.unavailable) return ''
  return (
    'Matches any part of a name. Searches up to ' +
    `${windowSize} items in each group, so a very large group may hold ` +
    'matches that are not shown.'
  )
}

/** Where a row of each kind links to. */
export interface GlobalSearchLinkContext {
  orgSlug: string | null
  hostSubdomain: string | null
}

/**
 * Build the href for one result row.
 *
 * Returns null rather than a broken link when a row cannot be addressed — a
 * screen with no `versionId` has never been opened and the besigner routes
 * are version-keyed, so there is genuinely nowhere to go. A row that cannot
 * be reached is dropped rather than rendered dead, which is the specific
 * complaint this issue opened with.
 */
export function buildResultHref(
  entity: GlobalSearchEntity,
  row: Record<string, any>,
  context: GlobalSearchLinkContext,
  buildRoute: (route: Route, payload: Record<string, string>) => string,
): string | null {
  const { orgSlug, hostSubdomain } = context
  if (!orgSlug) return null
  const id = String(row.$id ?? '')
  const host = hostSubdomain ?? ''

  switch (entity) {
    case 'sites':
      return row.subdomain
        ? buildRoute(Route.HOST_DASHBOARD, {
            orgSlug,
            host: String(row.subdomain),
          })
        : null
    case 'screens':
      if (!host || !row.versionId) return null
      return buildRoute(Route.SCREEN_DETAILS, {
        orgSlug,
        host,
        screenId: id,
        versionId: String(row.versionId),
      })
    case 'emails':
      // A `kind: 'email'` screen is authored in the screen besigner like any
      // other screen; the `/emails/[templateKey]` routes address the
      // transactional CATALOG, which is a different store entirely.
      if (!host || !row.versionId) return null
      return buildRoute(Route.SCREEN_BESIGNER, {
        orgSlug,
        host,
        screenId: id,
        versionId: String(row.versionId),
      })
    case 'components':
      return host
        ? buildRoute(Route.COMPONENT_DETAILS, { orgSlug, host, componentId: id })
        : null
    case 'layouts':
      return host
        ? buildRoute(Route.LAYOUT_DETAILS, { orgSlug, host, layoutId: id })
        : null
    case 'templates':
      return host
        ? buildRoute(Route.TEMPLATE_DETAILS, { orgSlug, host, templateId: id })
        : null
    case 'collections':
    case 'authors':
      return host ? buildRoute(Route.HOST_CONTENT, { orgSlug, host }) : null
    case 'workflows':
      return host ? buildRoute(Route.HOST_AUTOMATION, { orgSlug, host }) : null
    case 'products':
      return host ? buildRoute(Route.HOST_PRODUCTS, { orgSlug, host }) : null
    case 'redirects':
      return host ? buildRoute(Route.HOST_REDIRECTS, { orgSlug, host }) : null
    case 'services':
      return host ? buildRoute(Route.HOST_BOOKINGS, { orgSlug, host }) : null
    case 'contacts':
      // The CRM is a plugin hub, addressed through the generic plugin route;
      // the record lives under its `contacts` section, and the id is encoded
      // because a Firestore id is opaque.
      return host
        ? `${buildRoute(Route.HOST_PLUGIN, { orgSlug, host, pluginSlug: 'crm' })}/contacts/${encodeURIComponent(id)}`
        : null
    default:
      return null
  }
}
