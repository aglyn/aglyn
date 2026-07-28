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
 * Scoped sharing (AGL-1037): org-owned resources — datasets, media assets,
 * media folders — carry a `visibleTo` array naming who may see them, so an
 * agency can keep an internal dataset off its client sites without forking
 * storage into a second host-scoped collection (see AGL-237, which moved
 * these the other way).
 *
 * The shape is dictated by what both enforcement layers can evaluate:
 * Firestore rules have no `.map()`, so the caller's read set is denormalized
 * onto their member doc (AGL-1038) and matched with `list.hasAny(list)`;
 * clients match the same field with `array-contains-any`. A flat array of
 * strings is the only shape both primitives accept — the friendlier
 * `{ kind, hostIds }` form is a presentation concern and lives in
 * `describeScope` below, never on the doc.
 */

import type { ScopeToken } from '../foundation'

// The type itself lives in foundation (app-utils imports foundation, never
// the reverse) so the media doc interfaces can reference it; re-exported
// here so callers get the type and its helpers from one place.
export type { ScopeToken }

/** Everyone in the owning org, and every host it owns. */
export const ORG_SCOPE_TOKEN = 'org' as const satisfies ScopeToken

const HOST_TOKEN_PREFIX = 'host:'

/**
 * `array-contains-any` and `hasAny` both cap at 30 values. That caps a
 * selected-sites scope at 30 hosts, and a collaborator's read query at 29
 * hosts plus `'org'`. Wider than that is the `['org']` case.
 */
export const MAX_SCOPE_HOSTS = 30

/** `host:{hostId}` — the token naming a single site. */
export function hostScopeToken(hostId: string): ScopeToken {
  return `${HOST_TOKEN_PREFIX}${hostId}`
}

export function isScopeToken(value: unknown): value is ScopeToken {
  if (typeof value !== 'string') return false
  if (value === ORG_SCOPE_TOKEN) return true
  return (
    value.startsWith(HOST_TOKEN_PREFIX) &&
    value.length > HOST_TOKEN_PREFIX.length
  )
}

/** Reads a token back apart; null when it isn't one. */
export function parseScopeToken(
  token: string
): { kind: 'org' } | { kind: 'host'; hostId: string } | null {
  if (token === ORG_SCOPE_TOKEN) return { kind: 'org' }
  if (!isScopeToken(token)) return null
  return { kind: 'host', hostId: token.slice(HOST_TOKEN_PREFIX.length) }
}

/** Every host id named by a scope, in order; `['org']` names none. */
export function hostIdsFromScope(
  visibleTo: readonly string[] | undefined
): string[] {
  const ids: string[] = []
  for (const token of visibleTo ?? []) {
    const parsed = parseScopeToken(token)
    if (parsed?.kind === 'host') ids.push(parsed.hostId)
  }
  return ids
}

/**
 * The read set for one site: what a server read path or a scoped client
 * query passes to `array-contains-any`. `'org'` is included because an
 * org-wide resource is visible to every host in the org.
 */
export function scopeTokensForHost(hostId: string): ScopeToken[] {
  return [ORG_SCOPE_TOKEN, hostScopeToken(hostId)]
}

/**
 * Whether a host may see a resource.
 *
 * A **missing** `visibleTo` reads as org-wide: docs predate the AGL-1040
 * backfill and must stay visible until it runs. An **empty array** does not
 * — that is a written value, only reachable by a bug, and hiding a resource
 * is recoverable where leaking one is not.
 */
export function visibleToHost(
  visibleTo: readonly string[] | undefined | null,
  hostId: string
): boolean {
  if (visibleTo == null) return true
  if (visibleTo.includes(ORG_SCOPE_TOKEN)) return true
  return visibleTo.includes(hostScopeToken(hostId))
}

/**
 * Whether a caller holding `scopeTokens` (AGL-1038) may see a resource.
 * The TypeScript twin of the rules' `visibleTo.hasAny(scopeTokens)`, for
 * the Admin-SDK paths that never evaluate rules at all.
 */
export function visibleToTokens(
  visibleTo: readonly string[] | undefined | null,
  scopeTokens: readonly string[] | undefined | null
): boolean {
  if (visibleTo == null) return true
  if (!scopeTokens?.length) return false
  return visibleTo.some((token) => scopeTokens.includes(token))
}

/**
 * Cleans a scope for storage: drops junk, dedupes, and collapses to
 * `['org']` when org-wide is present, since that already implies every
 * host. Returns null when the result is unusable — empty, or over
 * `MAX_SCOPE_HOSTS` — so the caller decides rather than this silently
 * dropping hosts (losing access) or widening to org (leaking).
 */
export function normalizeVisibleTo(
  input: readonly string[] | undefined | null
): ScopeToken[] | null {
  const tokens = (input ?? []).filter(isScopeToken)
  if (!tokens.length) return null
  if (tokens.includes(ORG_SCOPE_TOKEN)) return [ORG_SCOPE_TOKEN]
  const unique = [...new Set(tokens)]
  if (unique.length > MAX_SCOPE_HOSTS) return null
  return unique
}

/** A scope covering exactly the given hosts; null when unusable. */
export function scopeForHosts(
  hostIds: readonly string[]
): ScopeToken[] | null {
  return normalizeVisibleTo(hostIds.map(hostScopeToken))
}

/** Whether a scope is the org-wide one (including the legacy absent case). */
export function isOrgWideScope(
  visibleTo: readonly string[] | undefined | null
): boolean {
  return visibleTo == null || visibleTo.includes(ORG_SCOPE_TOKEN)
}

/**
 * Whether moving from `before` to `after` takes visibility away from any
 * host — the direction that can break a published page, and the one the
 * console confirms before saving (AGL-1044/AGL-1045).
 */
export function narrowsScope(
  before: readonly string[] | undefined | null,
  after: readonly string[] | undefined | null
): boolean {
  if (isOrgWideScope(before)) return !isOrgWideScope(after)
  if (isOrgWideScope(after)) return false
  const kept = new Set(after ?? [])
  return (before ?? []).some((token) => !kept.has(token))
}

/**
 * The sentence the console shows. `hostNames` maps host id → display name;
 * ids missing from it fall back to the count wording, since a name we
 * can't resolve is worse than no name.
 */
export function describeScope(
  visibleTo: readonly string[] | undefined | null,
  hostNames: Readonly<Record<string, string>> = {}
): string {
  if (isOrgWideScope(visibleTo)) return 'All sites'
  const hostIds = hostIdsFromScope(visibleTo ?? [])
  if (!hostIds.length) return 'No sites'
  if (hostIds.length === 1) {
    const name = hostNames[hostIds[0]]
    return name ? `${name} only` : '1 site'
  }
  return `${hostIds.length} sites`
}

/**
 * The scope a newly created resource starts with (AGL-1048).
 *
 * Honours the org's `defaultResourceScope`, but only when a site is
 * actually in context: created from the org Media or Data page there is no
 * host to scope to, and inventing one would hide the resource from the
 * page that just created it.
 */
export function defaultScopeForNewResource(options: {
  defaultResourceScope?: 'org' | 'host'
  hostId?: string | null
}): ScopeToken[] {
  return options.defaultResourceScope === 'host' && options.hostId
    ? [hostScopeToken(options.hostId)]
    : [ORG_SCOPE_TOKEN]
}

/**
 * Whether `target` is visible everywhere `source` is — the condition a
 * cross-dataset REFERENCE has to satisfy (AGL-1044).
 *
 * A reference field on dataset A pointing at dataset B is only resolvable
 * on the sites that can see BOTH. If A is shared with a site that cannot
 * see B, a page there resolves the reference to nothing: the row renders
 * with a blank where the linked value should be, and nothing says why. So
 * B's scope must COVER A's.
 *
 * Org-wide covers everything. A missing scope reads as org-wide, matching
 * the rest of this module.
 */
export function scopeCovers(
  target: readonly string[] | undefined | null,
  source: readonly string[] | undefined | null,
): boolean {
  if (isOrgWideScope(target)) return true
  // The target is restricted; an org-wide source reaches sites it cannot.
  if (isOrgWideScope(source)) return false
  const reach = new Set(target ?? [])
  return (source ?? []).every((token) => reach.has(token))
}

/**
 * Rewrites an org media CDN path so it names the site using the asset
 * (AGL-1043/1045).
 *
 * `/api/media/cdn/org:{orgId}/{mediaId}` serves ORG-WIDE assets only. A
 * restricted asset has to be requested through the form that names the
 * site — `org:{orgId}:{hostId}` — because the CDN is unauthenticated and
 * the URL is the only thing it can decide from.
 *
 * Returns the path untouched when there is nothing to do: an org-wide
 * asset, a host-library asset, no host context, or a path that is not an
 * org CDN URL. That keeps it safe to apply blindly at every pick site.
 */
export function hostQualifiedCdnPath(
  cdnPath: string | undefined | null,
  visibleTo: readonly string[] | undefined | null,
  hostId: string | undefined | null,
): string | undefined {
  if (!cdnPath) return cdnPath ?? undefined
  if (!hostId || isOrgWideScope(visibleTo)) return cdnPath
  // `/api/media/cdn/{scope}/{mediaId}[/{hash}]`
  const marker = '/api/media/cdn/'
  const at = cdnPath.indexOf(marker)
  if (at === -1) return cdnPath
  const head = cdnPath.slice(0, at + marker.length)
  const rest = cdnPath.slice(at + marker.length)
  const [scopeSegment, ...tail] = rest.split('/')
  // Only the bare `org:{orgId}` form is rewritten; an already-qualified
  // scope is left alone rather than gaining a second host.
  if (!scopeSegment.startsWith('org:') || scopeSegment.includes(':', 4)) {
    return cdnPath
  }
  return [`${head}${scopeSegment}:${hostId}`, ...tail].join('/')
}
