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

import {
  isPluginStaffAuditAccess,
  pluginStaffAuditActionGroup,
} from '../plugin-manager/plugin-activity-actions'
import { nameSearchTokens } from './name-search'

/*
 * WHAT THE STAFF AUDIT LOG IS QUERIED BY, WRITTEN WITH EVERY ROW (AGL-3321).
 *
 * The staff audit page and the audit tables on a staff account's page filter
 * `adminAudit` by fields no writer used to store — the action's group, the
 * kind of thing acted on, the site, whether the act only looked — and search
 * it. All of that used to be answered by reading the log in batches and
 * keeping the rows that matched, and a match read that way stops wherever
 * the batches stop, so an entry past them was reported as not there. On an
 * audit trail that is the one wrong answer that matters.
 *
 * So each is stored on the row as it is written, and the query asks for it:
 *
 *   actionGroup    the facet's group for the action, answered by the plugin
 *                  activity registry (`pluginStaffAuditActionGroup`): a
 *                  registered group by code or by `staffAuditPrefixes`,
 *                  otherwise the action's leading namespace.
 *   kind           `access` for an act that only looked (a core read action,
 *                  or one a plugin declares in `staffAuditAccessActions`),
 *                  `change` for everything else.
 *   targetKind     the kind of record acted on: the first segment of the
 *                  target path (`orgs`, `users`, `hosts`, `lockdowns`).
 *   targetHostId   the site acted on, when the target is a site or a record
 *                  under one (`hosts/{id}/…`, `orgs/{org}/hosts/{id}/…`);
 *                  null otherwise, so "no site" is a value a query can ask for.
 *   searchTokens   word-prefix tokens (`nameSearchTokens`) of the fields a
 *                  reviewer searches by, for `array-contains` on one word.
 *
 * Every write goes through `withAdminAuditIndex`, on the server through
 * `addAdminAudit` / `setAdminAudit` / `recordAdminAudit` in
 * `@aglyn/tenant-data-admin`. `apps/console/specs/admin-audit-writes-are-stamped.spec.ts`
 * refuses a write to the collection anywhere else, and
 * `apps/console/specs/admin-audit-action-groups.spec.ts` pins the registry's
 * groups and reads to `tools/scripts/lib/admin-audit-index.fixtures.json`,
 * the mapping `tools/scripts/backfill-admin-audit-index.mjs` restamps old
 * rows with. A plugin adding a code, a prefix or a read action therefore
 * fails CI until the fixture names it, and the backfill is re-run.
 */

/** The row's group, as the Action group filter asks for it. */
export const ADMIN_AUDIT_GROUP_FIELD = 'actionGroup'

/** Whether the row only looked, as the account page's two tables ask for it. */
export const ADMIN_AUDIT_KIND_FIELD = 'kind'

/** The kind of record acted on, as the Target type filter asks for it. */
export const ADMIN_AUDIT_TARGET_KIND_FIELD = 'targetKind'

/** The site acted on, as the Site filter asks for it. */
export const ADMIN_AUDIT_SITE_FIELD = 'targetHostId'

/** The row's search tokens, as the search asks for one. */
export const ADMIN_AUDIT_SEARCH_FIELD = 'searchTokens'

/**
 * The fields a search reaches, in the order they claim the token budget:
 * what was done, who did it, what it was done to, then why.
 */
export const ADMIN_AUDIT_SEARCHED_FIELDS = [
  'action',
  'actorEmail',
  'target',
  'actorUid',
  'scope',
  'reason',
  'note',
] as const

/**
 * The most tokens one row stores. A free-text note is the only field that
 * can run long, and it is searched last, so it is the one that loses reach
 * past the cap.
 */
export const ADMIN_AUDIT_SEARCH_TOKEN_LIMIT = 200

/** Access looked at data; change altered something or acted on someone. */
export type AdminAuditKind = 'access' | 'change'

/**
 * The core actions that only LOOKED.
 *
 * An exception list, not a classification of everything, and the default
 * matters more than the membership: anything absent is a `change`. A change
 * is the louder half of the console's audit card, so an action nobody has
 * classified yet gets the MORE prominent treatment rather than the quieter
 * one. The failure mode of the opposite default is an unclassified
 * impersonation rendering as routine browsing.
 *
 * An export is deliberately NOT here. Data leaving the platform is a
 * high-consequence act even though it mutates nothing, and it belongs beside
 * the impersonations rather than beside the record views.
 */
export const ADMIN_AUDIT_ACCESS_ACTIONS: readonly string[] = [
  'email.message-viewed',
  // The acquisition card (AGL-3289): where an account or a workspace came
  // from, cross-checked against the sales workspace's people. Read only.
  'user.acquisition-viewed',
  'org.acquisition-viewed',
]

/** What a row carries that the stamped fields are derived from. */
export type AdminAuditIndexSource = Partial<
  Record<(typeof ADMIN_AUDIT_SEARCHED_FIELDS)[number], unknown>
>

/** The fields the lists query. */
export interface AdminAuditIndexFields {
  actionGroup: string
  kind: AdminAuditKind
  targetKind: string
  targetHostId: string | null
  searchTokens: string[]
}

/** Separators inside a value: an address's `@` and `.`, a path's `/`, a code's `.`. */
const SEPARATORS = /[^\p{L}\p{N}]+/gu

/**
 * The search tokens for one row.
 *
 * Each value is tokenized twice: as written, so a typed address or code
 * (`jane@acme`, `org.override`) matches from its start, and split at its
 * separators, so a reader finds `org.override` by `override` and an address
 * by its domain.
 */
export function adminAuditSearchTokens(entry: AdminAuditIndexSource): string[] {
  const tokens = new Set<string>()
  for (const field of ADMIN_AUDIT_SEARCHED_FIELDS) {
    const value = entry[field]
    if (typeof value !== 'string' || !value.trim()) continue
    const words = [
      ...nameSearchTokens(value),
      ...nameSearchTokens(value.replace(SEPARATORS, ' ')),
    ]
    for (const token of words) {
      tokens.add(token)
      if (tokens.size >= ADMIN_AUDIT_SEARCH_TOKEN_LIMIT) return [...tokens]
    }
  }
  return [...tokens]
}

/**
 * The group an action is filed under — the same answer the page's facet
 * offers. Empty for a row with no action.
 */
export function adminAuditActionGroup(action: unknown): string {
  return pluginStaffAuditActionGroup(action)
}

/**
 * An access when the platform or a plugin declares the action a read — a
 * plugin's staff card opening on an org or an account names its own read
 * actions through its activity group (AGL-2939) — and a change otherwise.
 */
export function adminAuditKind(action: unknown): AdminAuditKind {
  return typeof action === 'string' &&
    action &&
    (ADMIN_AUDIT_ACCESS_ACTIONS.includes(action) || isPluginStaffAuditAccess(action))
    ? 'access'
    : 'change'
}

/** The segments of a target path; empty for a target that is not one. */
const segmentsOf = (target: unknown): string[] =>
  typeof target === 'string' ? target.trim().split('/').filter(Boolean) : []

/**
 * The kind of record acted on: the target's first segment, which for every
 * path-shaped target is its collection (`orgs/{id}` → `orgs`). A target
 * that is an identifier rather than a path (`sso-domains:acme.com`) is its
 * own type up to the first `:`. Empty for a row with no target.
 */
export function adminAuditTargetKind(target: unknown): string {
  const [first = ''] = segmentsOf(target)
  const colon = first.indexOf(':')
  return colon > 0 ? first.slice(0, colon) : first
}

/**
 * The site acted on: the id after a `hosts` segment in the target path —
 * `hosts/{id}` and anything under it, and a site filed under its
 * organization (`orgs/{org}/hosts/{id}`). Null when the act was not on a site.
 */
export function adminAuditTargetHostId(target: unknown): string | null {
  const segments = segmentsOf(target)
  for (let at = 0; at < segments.length - 1; at += 2) {
    if (segments[at] === 'hosts') return segments[at + 1] || null
  }
  return null
}

/** Every stamped field for one row. */
export function adminAuditIndexFields(
  entry: AdminAuditIndexSource,
): AdminAuditIndexFields {
  return {
    actionGroup: adminAuditActionGroup(entry.action),
    kind: adminAuditKind(entry.action),
    targetKind: adminAuditTargetKind(entry.target),
    targetHostId: adminAuditTargetHostId(entry.target),
    searchTokens: adminAuditSearchTokens(entry),
  }
}

/**
 * The row as it is stored: the entry, with the fields its lists query.
 * Every write to `adminAudit` passes its data through this.
 */
export function withAdminAuditIndex<Entry extends AdminAuditIndexSource>(
  entry: Entry,
): Entry & AdminAuditIndexFields {
  return { ...entry, ...adminAuditIndexFields(entry) }
}
