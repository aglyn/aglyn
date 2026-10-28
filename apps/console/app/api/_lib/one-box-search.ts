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

import { holdsSiteKey } from '@aglyn/aglyn/app-utils/host-permissions'
import {
  ONE_BOX_WORKSPACES_GROUP,
  pageOneBoxGroup,
  type OneBoxGroup,
  type OneBoxResponse,
  type OneBoxRow,
  type OneBoxScored,
} from '@aglyn/aglyn/app-utils/one-box-search'
import { scoreMatch, MATCH_SCORE, searchWords } from '@aglyn/aglyn/app-utils/name-match'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import { consentGroupForHost } from '@aglyn/aglyn/app-utils/consent-groups'
import {
  hostScopeToken,
  MAX_SCOPE_HOSTS,
  ORG_SCOPE_TOKEN,
} from '@aglyn/aglyn/app-utils/scope-tokens'
import { memberCanSee, isOrgWideMember } from '@aglyn/aglyn/app-utils/organizations'
import { resolveOrgEntitlements } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  resolveEnabledPlugins,
  resolveHostEnabledPlugins,
} from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import type { PluginSearchSource, RegisteredPluginSearchSource } from '@aglyn/aglyn/plugin-manager/plugin-search-sources'
import {
  planListQuery,
  type ListQueryPlan,
} from '@aglyn/shared-util-tools/list-query/list-query-plan'
import {
  buildResultHref,
  entitlementAllows,
  GLOBAL_SEARCH_ENTITIES,
  GLOBAL_SEARCH_SITES_COLLECTION,
  rowBelongsTo,
  type GlobalSearchEntityDef,
} from '../../../components/global-search/global-search-scope'
import { buildRoute, Route } from '../../../constants/route-links'

/**
 * THE ONE BOX, ON THE SERVER (AGL-3943): what `GET /api/search` answers the
 * native apps, grouped, paged and filtered to what the caller may open.
 *
 * It reads what the console's palette reads (`global-search-scope.ts`'s own
 * groups, and every plugin's search sources, registered for the server in
 * `plugin-search-sources.ts`) the way the palette reads it: a capped window
 * per collection ordered by document id, matched in memory by the console's
 * `scoreMatch`, widened once when a full window matched nothing. A source
 * that declares its list's query (orders) is read through `planListQuery`
 * instead, on the index its list already uses, so no index is new.
 *
 * On top it answers what only a server can: the person's workspaces and
 * sites ACROSS every workspace (the switcher half of the one box). The app's
 * own screens and settings are the apps' to answer, from the nav manifest
 * they hold (`searchNavScreens`), with no read.
 *
 * ## Who sees what
 *
 * The Admin SDK bypasses the rules, so every gate the rules and the palette
 * apply is applied here, and nothing is read before it passes:
 *
 * - workspaces and sites come from the caller's OWN reverse indexes
 *   (`users/{uid}/orgs`, `users/{uid}/hostMemberships`), keyed by the
 *   token's uid, never a uid from the request;
 * - a workspace named in the request must have the caller as a member
 *   (`orgs/{orgId}/members/{uid}`), or the answer is 403 — a member of one
 *   workspace never reads another's records by naming it;
 * - a site must belong to that workspace and carry the caller in its
 *   `memberRoles`, as the rules' `isHostMember` asks;
 * - a group needs its plugin on (workspace, site and release flags), its
 *   plan flag and quota, its permission, and for `hostAccess: 'sensitive'`
 *   (orders) the admin or editor site role;
 * - an org-shared row (CRM) is read through the site's scope tokens under a
 *   site and only by an org-wide member off one, then each row is held to
 *   `memberCanSee`, the Admin-SDK enforcement of `visibleTo`.
 */

/** The window one collection is read in first, as the palette reads it. */
export const ONE_BOX_WINDOW = 30

/** The widening read a full window that matched nothing gets, once. */
export const ONE_BOX_ESCALATION = 270

/** A document as the engine reads it. */
export interface OneBoxDoc {
  id: string
  data: Record<string, unknown>
}

/** The reads the engine makes, so a spec can hand it a store of its own. */
export interface OneBoxStore {
  /** One document, or null when it does not exist. */
  get(path: string): Promise<Record<string, unknown> | null>
  /**
   * A collection in document-id order, optionally narrowed by one equality
   * or one `array-contains-any`, after `startAfterId`, at most `limit` docs.
   */
  window(
    path: string,
    options: {
      where?: { field: string; op: '==' | 'array-contains-any'; value: unknown }
      limit: number
      startAfterId?: string
    },
  ): Promise<OneBoxDoc[]>
  /** A collection through a planned list query, at most `limit` docs. */
  planned(path: string, plan: ListQueryPlan, limit: number): Promise<OneBoxDoc[]>
}

export interface OneBoxSearchInput {
  store: OneBoxStore
  uid: string
  text: string
  orgId?: string | null
  hostId?: string | null
  limit: number
  /** Page only this group, from `cursor`. */
  group?: string | null
  cursor?: number
  /** The plugins' registered server search sources. */
  sources: readonly RegisteredPluginSearchSource[]
  /** The org's permissions for this member, resolved the console's way. */
  permissions(orgId: string, member: Record<string, unknown>): Promise<Record<string, boolean>>
  /** The plugin ids left once the release flags apply, for this org. */
  releaseFilter(pluginIds: readonly string[], orgId: string): Promise<string[]>
}

export type OneBoxSearchResult =
  | { status: 200; body: OneBoxResponse }
  | { status: 403 | 404; error: string }

interface GroupPlan {
  meta: Pick<OneBoxGroup, 'group' | 'heading' | 'noun'>
  /** Where the group is listed, ascending: the palette's `order`. */
  order: number
  run(): Promise<{ scored: OneBoxScored[]; searched: number; truncated: boolean }>
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** A source's row label: its own label rule, its name, its fallback, its id. */
function labelOf(
  def: Pick<GlobalSearchEntityDef, 'nameField' | 'fallbackNameField'> & { label?: PluginSearchSource['label'] },
  row: Record<string, unknown>,
): string {
  if (def.label) return def.label(row)
  return (
    text(row[def.nameField]).trim() ||
    (def.fallbackNameField ? text(row[def.fallbackNameField]).trim() : '') ||
    text(row['$id'])
  )
}

export async function runOneBoxSearch(input: OneBoxSearchInput): Promise<OneBoxSearchResult> {
  const { store, uid, text: query, limit } = input
  const orgId = input.orgId || null
  const hostId = orgId ? input.hostId || null : null
  const only = input.group || null
  const cursor = input.cursor ?? 0

  // The caller's own workspaces: the switcher half, and every slug a link needs.
  const memberships = await store.window(`users/${uid}/orgs`, {
    limit: ONE_BOX_WINDOW + ONE_BOX_ESCALATION,
  })
  const slugs = new Map(memberships.map((doc) => [doc.id, text(doc.data['slug'])]))

  let member: Record<string, unknown> | null = null
  let org: Record<string, unknown> | null = null
  let host: Record<string, unknown> | null = null
  let enabled: string[] = []
  if (orgId) {
    member = await store.get(`orgs/${orgId}/members/${uid}`)
    if (!member) return { status: 403, error: 'You are not a member of this workspace' }
    org = (await store.get(`orgs/${orgId}`)) ?? {}
    if (hostId) {
      host = await store.get(`hosts/${hostId}`)
      if (!host || text(host['orgId']) !== orgId) {
        return { status: 404, error: 'No such site in this workspace' }
      }
      const roles = host['memberRoles']
      // Membership of the site at all; what they may read is a key below.
      const hostRole =
        roles && typeof roles === 'object'
          ? text((roles as Record<string, unknown>)[uid]) || null
          : null
      if (!hostRole) return { status: 403, error: 'You are not a member of this site' }
    }
    enabled = await input.releaseFilter(
      host
        ? resolveHostEnabledPlugins(org as never, host as never)
        : resolveEnabledPlugins(org as never),
      orgId,
    )
  }
  const orgSlug = orgId ? text(org?.['slug']) || slugs.get(orgId) || '' : ''
  const hostSubdomain = host ? text(host['subdomain']) : ''
  const resolved = org ? resolveOrgEntitlements(org as never) : null
  const entitlements = resolved
    ? ({ ...resolved, ...(resolved as { features?: object }).features } as Record<string, unknown>)
    : null
  let permissions: Record<string, boolean> | null = null
  const can = async (permission?: string) => {
    if (!permission) return true
    if (!orgId || !member) return false
    permissions ??= await input.permissions(orgId, member)
    return permissions[permission] === true
  }

  const plans: GroupPlan[] = []

  plans.push({
    meta: { group: ONE_BOX_WORKSPACES_GROUP, heading: 'Workspaces', noun: 'workspaces' },
    order: 0,
    run: async () => ({
      scored: memberships.flatMap((doc) => {
        const label = text(doc.data['orgName']) || text(doc.data['slug']) || doc.id
        const slug = text(doc.data['slug'])
        const score = scoreMatch({ name: label, extra: [slug] }, query)
        if (score === null) return []
        const row: OneBoxRow = {
          group: ONE_BOX_WORKSPACES_GROUP,
          id: doc.id,
          label,
          ...(slug ? { detail: slug, link: `/${slug}` } : {}),
          orgId: doc.id,
        }
        return [{ row, score }]
      }),
      searched: memberships.length,
      truncated: memberships.length >= ONE_BOX_WINDOW + ONE_BOX_ESCALATION,
    }),
  })

  plans.push({
    meta: { group: 'sites', heading: 'Sites', noun: 'sites' },
    order: 10,
    run: async () => {
      // Narrowed to the workspace in hand, or every site the person reaches.
      const sites = await store.window(`users/${uid}/${GLOBAL_SEARCH_SITES_COLLECTION}`, {
        ...(orgId ? { where: { field: 'orgId', op: '==' as const, value: orgId } } : {}),
        limit: ONE_BOX_WINDOW + ONE_BOX_ESCALATION,
      })
      return {
        scored: sites.flatMap((doc) => {
          const label = text(doc.data['displayName']) || text(doc.data['subdomain']) || doc.id
          const subdomain = text(doc.data['subdomain'])
          const siteOrg = text(doc.data['orgId'])
          const score = scoreMatch({ name: label, extra: [subdomain] }, query)
          if (score === null) return []
          const slug = slugs.get(siteOrg)
          const row: OneBoxRow = {
            group: 'sites',
            id: doc.id,
            label,
            ...(subdomain ? { detail: subdomain } : {}),
            ...(siteOrg ? { orgId: siteOrg } : {}),
            hostId: doc.id,
            ...(slug && subdomain
              ? { link: buildRoute(Route.HOST_DASHBOARD, { orgSlug: slug, host: subdomain }) }
              : {}),
          }
          return [{ row, score }]
        }),
        searched: sites.length,
        truncated: sites.length >= ONE_BOX_WINDOW + ONE_BOX_ESCALATION,
      }
    },
  })

  const linkContext = { orgSlug, hostSubdomain: hostSubdomain || null }
  const tokens = hostId && org
    ? [ORG_SCOPE_TOKEN, ...consentGroupForHost(org, hostId).hostIds.map(hostScopeToken)].slice(
        0,
        MAX_SCOPE_HOSTS,
      )
    : null

  /** A windowed group, read the palette's way and matched in memory. */
  const windowed = (
    def: GlobalSearchEntityDef & Partial<Pick<PluginSearchSource, 'label' | 'detail'>>,
    href: (row: Record<string, unknown>) => string | null,
  ): GroupPlan => ({
    meta: { group: def.id, heading: def.group, noun: def.noun },
    order: def.order,
    run: async () => {
      const path =
        def.scopeKind === 'orgData' ? `orgs/${orgId}/${def.collection}` : `hosts/${hostId}/${def.collection}`
      const where =
        def.scopeKind === 'orgData' && hostId
          ? { field: 'visibleTo', op: 'array-contains-any' as const, value: tokens ?? [] }
          : undefined
      const score = (doc: OneBoxDoc): OneBoxScored | null => {
        const row = { ...doc.data, $id: doc.id }
        if (!rowBelongsTo(def.id, row)) return null
        // The Admin SDK reads past the rules, so each org-shared row is held to them.
        if (
          def.scopeKind === 'orgData' &&
          !memberCanSee(member as never, row['visibleTo'] as string[] | undefined)
        ) {
          return null
        }
        const label = labelOf(def, row)
        const value = scoreMatch(
          { name: label, extra: (def.extraFields ?? []).map((field) => text(row[field])) },
          query,
        )
        if (value === null) return null
        const link = href(row)
        if (!link) return null
        const detail = def.detail?.(row)
        return {
          score: value,
          row: {
            group: def.id,
            id: doc.id,
            label,
            ...(detail ? { detail } : {}),
            ...(orgId ? { orgId } : {}),
            ...(hostId ? { hostId } : {}),
            link,
          },
        }
      }
      const first = await store.window(path, { ...(where ? { where } : {}), limit: ONE_BOX_WINDOW })
      let docs = first
      let scored = first.map(score).filter((entry): entry is OneBoxScored => entry !== null)
      let truncated = first.length >= ONE_BOX_WINDOW
      if (truncated && !scored.length) {
        const more = await store.window(path, {
          ...(where ? { where } : {}),
          limit: ONE_BOX_ESCALATION,
          startAfterId: first[first.length - 1]?.id,
        })
        docs = [...first, ...more]
        scored = docs.map(score).filter((entry): entry is OneBoxScored => entry !== null)
        truncated = more.length >= ONE_BOX_ESCALATION
      }
      return { scored, searched: docs.length, truncated }
    },
  })

  /** A group read through its list's own query, newest first. */
  const planned = (source: PluginSearchSource): GroupPlan => ({
    meta: { group: source.id, heading: source.group, noun: source.noun },
    order: source.order,
    run: async () => {
      const plan = planListQuery(
        source.listQuery as never,
        { clauses: [], search: searchWords(query) },
        nameSearchNormalizers,
      )
      const wanted = cursor + limit + 1
      const docs = plan.searched
        ? await store.planned(`hosts/${hostId}/${source.collection}`, plan, wanted)
        : []
      const scored = docs.flatMap((doc, index): OneBoxScored[] => {
        const row = { ...doc.data, $id: doc.id }
        const link = source.href(row, { orgSlug, host: hostSubdomain || null })
        if (!link) return []
        const detail = source.detail?.(row)
        return [
          {
            // The query's own order (newest first) is the ranking.
            score: MATCH_SCORE.exact + docs.length - index,
            row: {
              group: source.id,
              id: doc.id,
              label: labelOf(source, row),
              ...(detail ? { detail } : {}),
              ...(orgId ? { orgId } : {}),
              ...(hostId ? { hostId } : {}),
              link,
            },
          },
        ]
      })
      return { scored, searched: docs.length, truncated: docs.length >= wanted }
    },
  })

  if (orgId && member) {
    // The console's own groups under a site (the sites group is above).
    if (hostId) {
      for (const def of GLOBAL_SEARCH_ENTITIES) {
        if (def.scopeKind !== 'host') continue
        if (!entitlementAllows(def, entitlements)) continue
        plans.push(
          windowed(def, (row) =>
            buildResultHref(def, row as Record<string, unknown>, linkContext, (route, payload) =>
              buildRoute(route as never, payload as never),
            ),
          ),
        )
      }
    }
    const coreIds = new Set(GLOBAL_SEARCH_ENTITIES.map((def) => def.id))
    const orgWide = isOrgWideMember(member as never)
    const on = new Set(enabled)
    for (const { pluginId, gates, source } of input.sources) {
      // Offered only where the plugin runs: the workspace's set, narrowed by
      // the site, with the release flags applied.
      if (!on.has(pluginId)) continue
      if (coreIds.has(source.id)) continue
      if (source.scope === 'host' && !hostId) continue
      if (source.scope === 'orgData' && !hostId && !orgWide) continue
      if (source.scope === 'orgData' && hostId && !tokens?.length) continue
      const def: GlobalSearchEntityDef = {
        id: source.id,
        group: source.group,
        noun: source.noun,
        scopeKind: source.scope,
        collection: source.collection,
        nameField: source.nameField,
        fallbackNameField: source.fallbackNameField,
        extraFields: source.extraFields,
        entitlementKey: source.entitlementKey,
        order: source.order,
      }
      const flags = [gates.featureFlag, source.featureFlag].filter(Boolean) as string[]
      if (flags.some((flag) => entitlements?.[flag] !== true)) continue
      if (!entitlementAllows(def, entitlements)) continue
      // "See orders and webhooks" (`site.sensitive`, AGL-4047), read as the rules read it.
      if (source.hostAccess === 'sensitive' && !holdsSiteKey(host, uid, 'site.sensitive')) continue
      if (!(await can(gates.permission)) || !(await can(source.permission))) continue
      plans.push(
        source.listQuery
          ? planned(source)
          : windowed({ ...def, label: source.label, detail: source.detail }, (row) =>
              source.href(row, { orgSlug, host: hostSubdomain || null }),
            ),
      )
    }
  }

  // Listed by `order`; the sort is stable, so equal numbers keep the
  // console's groups ahead of the plugins', as the palette lists them.
  const ordered = [...plans].sort((a, b) => a.order - b.order)
  const chosen = only ? ordered.filter((plan) => plan.meta.group === only) : ordered
  const groups = await Promise.all(
    chosen.map(async (plan): Promise<OneBoxGroup> => {
      try {
        const { scored, searched, truncated } = await plan.run()
        return pageOneBoxGroup(
          { ...plan.meta, searched, truncated, failed: false },
          scored,
          only ? cursor : 0,
          limit,
        )
      } catch (error) {
        console.error('[api/search] a group could not be read', plan.meta.group, error)
        return pageOneBoxGroup({ ...plan.meta, searched: 0, truncated: false, failed: true }, [], 0, limit)
      }
    }),
  )
  return {
    status: 200,
    body: {
      query,
      ...(orgId ? { orgId } : {}),
      ...(hostId ? { hostId } : {}),
      // A group with nothing to say is left out; a failed or partly read one says so.
      groups: groups.filter((group) => group.matched > 0 || group.failed || group.truncated),
    },
  }
}
