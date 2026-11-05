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
 * ## A missing `visibleTo` is visible to NOBODY
 *
 * It once read as org-wide, so that documents predating the scope backfill
 * stayed visible until it reached them. That default is the shape of failure
 * this codebase keeps paying for: **a read that cannot see a value answered
 * the same as a value that is absent.** "This document was never scoped" and
 * "this document is shared with every site" are different facts, and one
 * unscoped document under an agency account was one client's data on every
 * other client's site — silently, because the permissive answer is the one
 * nothing complains about.
 *
 * Both enforcement layers below this function already fail CLOSED on the
 * missing field: `array-contains-any` matches nothing on a document that
 * lacks the array, and the rules' `hasAny` is false for the same reason. So
 * the permissive default was never a policy either of them agreed with — it
 * was one TypeScript helper disagreeing with the database, which is what made
 * AGL-1466 invisible for three weeks.
 *
 * The migration is `tools/scripts/backfill-consent-host.mjs`, which stamps
 * `['org']` on the documents that should carry it. Until a document is
 * stamped it is hidden, and hiding is the recoverable direction.
 *
 * An **empty array** answers the same and always did.
 */
export function visibleToHost(
  visibleTo: readonly string[] | undefined | null,
  hostId: string
): boolean {
  if (visibleTo == null) return false
  if (visibleTo.includes(ORG_SCOPE_TOKEN)) return true
  return visibleTo.includes(hostScopeToken(hostId))
}

/**
 * Whether a caller holding `scopeTokens` (AGL-1038) may see a resource.
 * The TypeScript twin of the rules' `visibleTo.hasAny(scopeTokens)`, for
 * the Admin-SDK paths that never evaluate rules at all.
 *
 * A missing `visibleTo` is visible to nobody, for the reason
 * {@link visibleToHost} gives — and here the twinning is the argument on its
 * own: `hasAny` over a missing field is false in the rules, so a helper that
 * answered `true` was not a twin of anything.
 */
export function visibleToTokens(
  visibleTo: readonly string[] | undefined | null,
  scopeTokens: readonly string[] | undefined | null
): boolean {
  if (visibleTo == null) return false
  if (!scopeTokens?.length) return false
  return visibleTo.some((token) => scopeTokens.includes(token))
}

/**
 * The scope a document ACTUALLY carries — `null` when it carries none
 * (AGL-1466/AGL-1480).
 *
 * Every helper above this line answers "may this be seen", and answers it
 * the way both enforcement layers do: a missing `visibleTo` is seen by
 * nobody.
 *
 * An **editor** asks a different question — "what did somebody choose" —
 * and it still needs its own answer, because "nobody chose" and "somebody
 * chose nobody" are the same to an editor and different on the document.
 * Four call sites across two files each wrote their own
 *
 * ```ts
 * Array.isArray(doc.visibleTo) ? doc.visibleTo : [ORG_SCOPE_TOKEN]
 * ```
 *
 * and every one of them rendered "All sites" over a document no site could
 * see. That inversion is why AGL-1466 went three weeks unnoticed with the
 * folder tree missing from every host, and AGL-1480 is the third and fourth
 * copies of it turning up at the surface people use most.
 *
 * So: one function, the same lesson `newMediaFolderDoc` drew on the write
 * side. A caller that wants a display default may still `?? []` or
 * `?? [ORG_SCOPE_TOKEN]` — but it has to say so, in one visible place,
 * instead of a ternary that reads like a null check.
 *
 * An empty array answers `null` too. On the document the two differ, and
 * `newResourceScopeFields` refuses to WRITE one; to an editor they are the
 * same fact — nobody chose this — and both must offer the choice rather
 * than pre-fill an answer.
 *
 * Not normalized, deliberately. `normalizeVisibleTo` collapses for STORAGE;
 * doing it here would make an untouched editor differ from the document it
 * was seeded from, and the save gates compare exactly those two to decide
 * whether to write at all.
 */
export function storedScope(
  visibleTo: readonly string[] | undefined | null
): string[] | null {
  return Array.isArray(visibleTo) && visibleTo.length ? [...visibleTo] : null
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

/**
 * The scope a save writes, or why the selection cannot be written.
 *
 * {@link normalizeVisibleTo} answers null for a selection it cannot store, and
 * a save has no safe substitute for that null: the org token shares the
 * resource with every site, and dropping tokens takes access from sites
 * somebody picked. So a caller refuses the save and shows `problem`.
 */
export function scopeToStore(
  input: readonly string[] | undefined | null
): { scope: ScopeToken[]; problem: null } | { scope: null; problem: string } {
  const scope = normalizeVisibleTo(input)
  if (scope) return { scope, problem: null }
  return {
    scope: null,
    problem: (input ?? []).some(isScopeToken)
      ? `Choose ${MAX_SCOPE_HOSTS} sites or fewer, or share with All sites.`
      : 'Choose at least one site, or share with All sites.',
  }
}

/** A scope covering exactly the given hosts; null when unusable. */
export function scopeForHosts(
  hostIds: readonly string[]
): ScopeToken[] | null {
  return normalizeVisibleTo(hostIds.map(hostScopeToken))
}

/**
 * Whether a scope is the org-wide one.
 *
 * An absent scope is NOT org-wide — see {@link visibleToHost}. That is the
 * whole correction: this predicate is what `describeScope` renders and what
 * `scopeCovers` and `narrowsScope` reason from, and while it answered `true`
 * for a document nothing could see, the console said "All sites" over it.
 */
export function isOrgWideScope(
  visibleTo: readonly string[] | undefined | null
): boolean {
  return visibleTo != null && visibleTo.includes(ORG_SCOPE_TOKEN)
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
 * Honours the org's default — `defaultResourceScope` for a dataset,
 * `defaultMediaScopeOf(org)` for media, passed in the same option — but
 * only when a site is
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
 * The org's default sharing for new MEDIA — uploads and folders (AGL-3662).
 *
 * `defaultMediaScope` when the org has set it, otherwise
 * `defaultResourceScope`: until the two were split one field decided both,
 * so an org that chose "only the site they were created in" before the split
 * keeps that choice for media until it sets media on its own. Datasets read
 * `defaultResourceScope` directly.
 */
export function defaultMediaScopeOf(
  org:
    | {
        defaultMediaScope?: 'org' | 'host'
        defaultResourceScope?: 'org' | 'host'
      }
    | null
    | undefined,
): 'org' | 'host' | undefined {
  return org?.defaultMediaScope ?? org?.defaultResourceScope
}

/**
 * The scope fields a document being CREATED in a scoped collection carries
 * (AGL-1478), as a spreadable object.
 *
 * The argument is REQUIRED and has no default, which is the whole point.
 * AGL-1466 was two call sites that each built a `mediaFolders` document
 * inline and each forgot `visibleTo`; `newMediaFolderDoc` fixed that one
 * collection by making the input mandatory, and this is the same guarantee
 * for the collections that have no document constructor of their own —
 * `datasets`, `media`, `contacts`, `contactSegments`. A creator that has
 * not decided cannot compile.
 *
 * Three inputs, three meanings:
 *
 * - **tokens** — stamp them.
 * - **`null`** — this collection is NOT scoped (a `hosts/{hostId}`
 *   subcollection is private by construction), so store nothing. Saying it
 *   out loud is what distinguishes "not applicable" from "forgotten".
 * - **`[]`** — throws. Unlike a missing field, a stored empty array is a
 *   written "visible to nobody": the backfill leaves it alone by design and
 *   no read path treats it as legacy, so it is permanent where absent is
 *   repairable. Getting here means a caller computed a scope and came back
 *   with nothing, which is worth a stack trace.
 */
export function newResourceScopeFields(
  visibleTo: readonly ScopeToken[] | null
): { visibleTo?: ScopeToken[] } {
  if (visibleTo && !visibleTo.length) {
    throw new Error('A scoped resource cannot be created with an empty scope')
  }
  return visibleTo ? { visibleTo: [...visibleTo] } : {}
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
 * Org-wide covers everything. A missing scope is seen by nobody and
 * therefore covers nothing, matching the rest of this module.
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
 * `/api/media/cdn/org:{orgId}/{mediaId}` serves org-wide assets, and assets
 * shared with all sites except some. An asset shared with chosen sites has to
 * be requested through the form that names the site — `org:{orgId}:{hostId}` — because the CDN is unauthenticated and
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

/*==========================================
 * SEEN, AND HELD (AGL-3336).
 *
 * `visibleTo` answers one question, "who may see this", because it is the
 * one field both enforcement layers can evaluate. A visibility GRANT — an
 * org manager sharing a record with another site, by hand or by a rule —
 * has to widen exactly that field, or the other site's lists, which are
 * real `array-contains-any` queries, could never return the record.
 *
 * But a site a record was shared with does not HOLD it. It did not capture
 * the person, it holds no consent from them, and letting go of the record
 * is not its decision. So a document that carries a grant records which of
 * its tokens the grant added, under `sharing.added`, and every question
 * about holding — who may delete it, whose audience it joins, which site's
 * list it enters — reads {@link heldScopeTokens} instead of `visibleTo`.
 *
 * A document without the field is held by everything that sees it, which
 * is every document written before grants existed.
 *=========================================*/

/** The map a scoped document records its visibility grants under. */
export const SCOPE_GRANTS_FIELD = 'sharing'

/** The tokens a grant ADDED to `visibleTo`: seen through, never held. */
export function grantedScopeTokens(
  doc: Readonly<Record<string, unknown>> | null | undefined,
): string[] {
  const grants = (doc ?? {})[SCOPE_GRANTS_FIELD]
  if (!grants || typeof grants !== 'object' || Array.isArray(grants)) return []
  const added = (grants as Record<string, unknown>)['added']
  return Array.isArray(added)
    ? added.filter((token): token is string => typeof token === 'string')
    : []
}

/**
 * The tokens that HOLD a document: `visibleTo` without the ones a grant
 * added. Missing `visibleTo` is held by nobody, as it is seen by nobody.
 *
 * A site that created the document (`hostId`) or captured the person on it
 * (`capturedByHostIds`) holds its token whatever the grants say: a record
 * shared with a site that then captures the person itself is that site's
 * own from the capture on, before anything re-evaluates the grants.
 */
export function heldScopeTokens(
  doc: Readonly<Record<string, unknown>> | null | undefined,
): string[] {
  const visibleTo = (doc ?? {})['visibleTo']
  if (!Array.isArray(visibleTo)) return []
  const granted = new Set(grantedScopeTokens(doc))
  const capturing = new Set<string>()
  const hostId = (doc ?? {})['hostId']
  if (typeof hostId === 'string' && hostId) capturing.add(hostScopeToken(hostId))
  const captured = (doc ?? {})['capturedByHostIds']
  if (Array.isArray(captured)) {
    for (const id of captured) if (typeof id === 'string' && id) capturing.add(hostScopeToken(id))
  }
  return visibleTo.filter(
    (token): token is string =>
      typeof token === 'string' && (!granted.has(token) || capturing.has(token)),
  )
}

/**
 * Whether a site HOLDS a document rather than only seeing it through a
 * grant. The question a marketing audience, a list rule, a sequence and a
 * holder count ask; {@link visibleToHost} is the one a reader asks.
 */
export function heldByHost(
  doc: Readonly<Record<string, unknown>> | null | undefined,
  hostId: string,
): boolean {
  return visibleToHost(heldScopeTokens(doc), hostId)
}

/**
 * Whether a site sees a document ONLY through a grant: it carries grants and
 * the site does not hold it. The filter an audience sweep applies to what
 * its scoped query returned — a document with no grants answers `false`, so
 * every read that predates sharing keeps exactly the rows it had.
 */
export function seenOnlyThroughGrant(
  doc: Readonly<Record<string, unknown>> | null | undefined,
  hostId: string,
): boolean {
  return grantedScopeTokens(doc).length > 0 && !heldByHost(doc, hostId)
}

/*==========================================
 * ALL SITES EXCEPT… (AGL-4047).
 *
 * A third way to share, beside "All sites" and "these sites". Neither
 * enforcement layer can read an exclusion: Firestore has no "does not
 * contain", `not-in` cannot sit beside `array-contains-any`, and a rule that
 * refused on one would fail every scoped member's whole list. So what readers
 * enforce stays what it has always been, a flat `visibleTo` of the sites that
 * ARE included, and the choice that produced it sits beside it as a marker:
 *
 *   visibleTo:   ['host:b', 'host:c']   the only field a reader looks at
 *   scopeMode:   'allExcept'            says new sites join
 *   scopeExcept: ['host:a']             the sites that stay out
 *
 * `visibleTo` is therefore a list that has to be kept up: a new site joins it
 * and a deleted one leaves it. {@link reconcileAllExcept} is the one answer to
 * what it should hold; the sweep (`scope-sharing-sweep.ts`) applies it.
 *
 * `visibleTo` always wins over the marker when they disagree, because it is
 * what the database enforces. A helper describing a document some other way
 * would be describing something no reader does.
 *=========================================*/

/** The `scopeMode` a document kept up by the sweep carries. */
export const SCOPE_MODE_ALL_EXCEPT = 'allExcept' as const

/**
 * What a sharing choice writes. A `null` marker field means the document must
 * not carry it, which a server write spells as a field delete, so a document
 * moved back to All sites or to chosen sites keeps no stale marker.
 */
export interface ScopeSharingFields {
  visibleTo: ScopeToken[]
  scopeMode: typeof SCOPE_MODE_ALL_EXCEPT | null
  scopeExcept: ScopeToken[] | null
}

/** How a document is shared, as a person would choose it. */
export type ScopeSharing =
  | { mode: 'all' }
  | { mode: 'selected'; hostIds: string[] }
  | { mode: 'allExcept'; exceptHostIds: string[]; includedHostIds: string[] }
  | { mode: 'none' }

/** What a person picked: the input to {@link sharingFromChoice}. */
export type ScopeSharingChoice =
  | { mode: 'all' }
  | { mode: 'selected'; hostIds: readonly string[] }
  | { mode: 'allExcept'; exceptHostIds: readonly string[] }

const uniqueStrings = (values: readonly string[]): string[] => [
  ...new Set(values.filter((value) => typeof value === 'string' && value)),
]

/**
 * The excluded sites a marker names, or null when the marker is not one this
 * module can act on: anything but an array of host tokens. Null is what keeps
 * a damaged marker from being read as "except nothing", which means All sites.
 */
function markerExceptHostIds(
  doc: Readonly<Record<string, unknown>> | null | undefined,
): string[] | null {
  if (doc?.['scopeMode'] !== SCOPE_MODE_ALL_EXCEPT) return null
  const except = doc['scopeExcept']
  if (!Array.isArray(except)) return null
  const ids: string[] = []
  for (const token of except) {
    const parsed = typeof token === 'string' ? parseScopeToken(token) : null
    if (parsed?.kind !== 'host') return null
    ids.push(parsed.hostId)
  }
  return uniqueStrings(ids)
}

/**
 * How a document is shared. Reads the marker only where it agrees with what
 * readers enforce: a document carrying `'org'` is shared with all sites
 * whatever a marker beside it says, and a damaged marker reads as the chosen
 * sites `visibleTo` names.
 */
export function scopeSharingOf(
  doc: Readonly<Record<string, unknown>> | null | undefined,
): ScopeSharing {
  const visibleTo = doc?.['visibleTo']
  const tokens = Array.isArray(visibleTo)
    ? visibleTo.filter((token): token is string => typeof token === 'string')
    : null
  if (tokens?.includes(ORG_SCOPE_TOKEN)) return { mode: 'all' }
  const included = uniqueStrings(hostIdsFromScope(tokens ?? []))
  const except = tokens ? markerExceptHostIds(doc) : null
  if (except) {
    return { mode: 'allExcept', exceptHostIds: except, includedHostIds: included }
  }
  return included.length ? { mode: 'selected', hostIds: included } : { mode: 'none' }
}

/**
 * What a sharing choice writes, or why it cannot be written.
 *
 * `orgHostIds` is the workspace's sites as the writer read them. An exclusion
 * naming a site that is no longer there is dropped, not refused: the person
 * asked for that site to stay out, and it is out. Excluding nothing is
 * refused, since that choice is All sites; excluding everything is refused,
 * since it would hide the document from every site.
 *
 * An all-except list is not held to `MAX_SCOPE_HOSTS`, which limits what a
 * QUERY can ask for and never what a document stores. A collection whose
 * stored fields multiply by site passes its own `maxIncluded`. `keepHostIds`
 * are sites that stay on the list even if excluded, such as a site that
 * captured the person a record is about.
 */
export function sharingFromChoice(
  choice: ScopeSharingChoice,
  orgHostIds: readonly string[],
  options: { maxIncluded?: number | null; keepHostIds?: readonly string[] } = {},
): { fields: ScopeSharingFields; problem: null } | { fields: null; problem: string } {
  if (choice.mode === 'all') {
    return {
      fields: { visibleTo: [ORG_SCOPE_TOKEN], scopeMode: null, scopeExcept: null },
      problem: null,
    }
  }
  if (choice.mode === 'selected') {
    const stored = scopeToStore(choice.hostIds.map(hostScopeToken))
    return stored.scope
      ? { fields: { visibleTo: stored.scope, scopeMode: null, scopeExcept: null }, problem: null }
      : { fields: null, problem: stored.problem }
  }
  const org = uniqueStrings(orgHostIds)
  const except = uniqueStrings(choice.exceptHostIds).filter((id) => org.includes(id))
  if (!except.length) {
    return {
      fields: null,
      problem: 'Choose at least one site to leave out, or share with All sites.',
    }
  }
  const included = includedHostIds(org, except, options.keepHostIds)
  if (!included.length) {
    return { fields: null, problem: 'Keep at least one site in, or choose the sites.' }
  }
  if (options.maxIncluded != null && included.length > options.maxIncluded) {
    return {
      fields: null,
      problem: `This can reach ${options.maxIncluded === 1 ? '1 site' : `${options.maxIncluded} sites`} at most. Leave out more sites, or choose the sites.`,
    }
  }
  return {
    fields: {
      visibleTo: included.map(hostScopeToken),
      scopeMode: SCOPE_MODE_ALL_EXCEPT,
      scopeExcept: except.map(hostScopeToken),
    },
    problem: null,
  }
}

/** The workspace's sites minus the excluded ones, plus the kept, sorted. */
function includedHostIds(
  org: readonly string[],
  except: readonly string[],
  keep: readonly string[] | undefined,
): string[] {
  const out = new Set(except)
  const kept = new Set(keep ?? [])
  return org.filter((id) => !out.has(id) || kept.has(id)).sort()
}

/** What keeping an all-except document up to date came to. */
export interface AllExceptReconcile {
  /**
   * - `unmarked`: not an all-except document; nothing to do.
   * - `current`: already says what it should.
   * - `changed`: write `fields`.
   * - `capped`: it should reach more sites than `maxIncluded`, so it stopped
   *   widening. Any `fields` only take away sites that are gone.
   * - `invalid`: a marker this module cannot act on, or one beside `'org'`.
   *   Left alone and reported, because either guess moves who can see it.
   */
  status: 'unmarked' | 'current' | 'changed' | 'capped' | 'invalid'
  fields: ScopeSharingFields | null
}

/**
 * What an all-except document should say, given the workspace's sites today.
 *
 * Pure and idempotent, which is what lets every trigger and the drift report
 * ask the same question: a second run over its own answer says `current`.
 *
 * - A new site joins `visibleTo`, unless it is excluded.
 * - A site that left the workspace leaves `visibleTo` and `scopeExcept`.
 * - Once no exclusion is left the document IS All sites, so it collapses to
 *   `['org']` and drops its marker.
 * - When every remaining site is excluded `visibleTo` is empty and the marker
 *   stays: no site sees it until a new one joins. The data is kept, which is
 *   why {@link isSiteOnlyScope} answers false for a marked document.
 * - A site in `sharing.added` stays, since a person shared the document with
 *   it. So do `keepHostIds`. Both only while the site is in the workspace.
 */
export function reconcileAllExcept(
  doc: Readonly<Record<string, unknown>> | null | undefined,
  orgHostIds: readonly string[],
  options: { maxIncluded?: number | null; keepHostIds?: readonly string[] } = {},
): AllExceptReconcile {
  if (doc?.['scopeMode'] === undefined || doc['scopeMode'] === null) {
    return { status: 'unmarked', fields: null }
  }
  const storedExcept = markerExceptHostIds(doc)
  const visibleTo = doc['visibleTo']
  if (
    !storedExcept ||
    !Array.isArray(visibleTo) ||
    visibleTo.includes(ORG_SCOPE_TOKEN)
  ) {
    return { status: 'invalid', fields: null }
  }
  const org = uniqueStrings(orgHostIds)
  const except = storedExcept.filter((id) => org.includes(id))
  if (!except.length) {
    return {
      status: 'changed',
      fields: { visibleTo: [ORG_SCOPE_TOKEN], scopeMode: null, scopeExcept: null },
    }
  }
  const current = uniqueStrings(hostIdsFromScope(visibleTo as string[]))
  const keep = [
    ...(options.keepHostIds ?? []),
    ...hostIdsFromScope(grantedScopeTokens(doc)),
  ]
  let included = includedHostIds(org, except, keep)
  let capped = false
  if (
    options.maxIncluded != null &&
    included.length > options.maxIncluded &&
    included.some((id) => !current.includes(id))
  ) {
    capped = true
    included = current.filter((id) => org.includes(id)).sort()
  }
  const same =
    included.length === current.length &&
    included.every((id) => current.includes(id)) &&
    except.length === storedExcept.length
  const fields: ScopeSharingFields | null = same
    ? null
    : {
        visibleTo: included.map(hostScopeToken),
        scopeMode: SCOPE_MODE_ALL_EXCEPT,
        scopeExcept: except.map(hostScopeToken),
      }
  if (capped) return { status: 'capped', fields }
  return fields ? { status: 'changed', fields } : { status: 'current', fields: null }
}

/**
 * The sentence the console shows for how a document is shared:
 * {@link describeScope}, plus the all-except wording. Sites are named only
 * where `hostNames` has them, so a reader who cannot see a site's name is told
 * how many sites, never an id.
 */
export function describeSharing(
  doc: Readonly<Record<string, unknown>> | null | undefined,
  hostNames: Readonly<Record<string, string>> = {},
): string {
  const sharing = scopeSharingOf(doc)
  if (sharing.mode !== 'allExcept') {
    return describeScope(doc?.['visibleTo'] as readonly string[] | undefined, hostNames)
  }
  if (!sharing.includedHostIds.length) return 'No sites'
  const names = sharing.exceptHostIds.map((id) => hostNames[id])
  const count = names.length
  if (count === 1) return `All sites except ${names[0] || '1 site'}`
  if (count === 2 && names.every(Boolean)) {
    return `All sites except ${names[0]} and ${names[1]}`
  }
  return `All sites except ${count} sites`
}

/**
 * Whether a document belongs to this site alone: what deciding to erase it
 * with the site asks, so the three copies of that question share one answer.
 *
 * FALSE FOR ANY MARKED DOCUMENT, and that is the reason this exists. A site
 * can be the last one an all-except document still reaches, with `visibleTo`
 * naming it and nothing else, and the document is still the workspace's.
 * Reading that as "this site's own" would erase the data with the site.
 */
export function isSiteOnlyScope(
  doc: Readonly<Record<string, unknown>> | null | undefined,
  hostId: string,
): boolean {
  if (doc?.['scopeMode'] !== undefined && doc?.['scopeMode'] !== null) return false
  const visibleTo = doc?.['visibleTo']
  const token = hostScopeToken(hostId)
  return (
    Array.isArray(visibleTo) &&
    visibleTo.length > 0 &&
    visibleTo.every((entry) => entry === token)
  )
}

/**
 * {@link scopeCovers} for whole documents: whether `target` stays visible
 * everywhere `source` is, which a cross-dataset reference needs.
 *
 * Today's tokens are not enough once either side is all-except, because the
 * two lists move when a site is added: a chosen-sites target cannot cover an
 * all-except source however it looks today (the next new site gets the source
 * and not the target), and an all-except target covers an all-except source
 * only when it leaves out no site the source includes.
 */
export function sharingCovers(
  target: Readonly<Record<string, unknown>> | null | undefined,
  source: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
  const targetTokens = target?.['visibleTo'] as readonly string[] | undefined
  const sourceTokens = source?.['visibleTo'] as readonly string[] | undefined
  const targetSharing = scopeSharingOf(target)
  const sourceSharing = scopeSharingOf(source)
  if (sourceSharing.mode === 'allExcept') {
    if (targetSharing.mode === 'all') return true
    if (targetSharing.mode !== 'allExcept') return false
    const sourceExcept = new Set(sourceSharing.exceptHostIds)
    if (!targetSharing.exceptHostIds.every((id) => sourceExcept.has(id))) return false
  }
  return scopeCovers(targetTokens, sourceTokens)
}
