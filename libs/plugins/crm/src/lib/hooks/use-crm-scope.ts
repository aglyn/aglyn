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
'use client'

import {
  type ConsentGroup,
  type ConsolePluginPageProps,
  consentGroupForHost,
  crmReadTokens,
  crmScopeTokens,
  type ScopeToken,
} from '@aglyn/aglyn'
import { useOrgDataScope } from '@aglyn/tenant-feature-instance'
import { type QueryConstraint, where } from 'firebase/firestore'
import { useMemo } from 'react'
import { useCrmOrgMount } from './use-crm-org-mount'

/**
 * The org document as a CRM surface receives it: the shell's typed billing
 * projection on a page, or the plain record a card was handed. Read as a
 * record at the one seam below, so no component casts it itself.
 */
export type CrmOrgDoc =
  | ConsolePluginPageProps['org']
  | Record<string, unknown>
  | null
  | undefined

/** Where a CRM surface is mounted: under one site, or over the whole org. */
export type CrmScopeLevel = 'site' | 'org'

export interface CrmScope {
  /** The org data root, or `null` until the org lookup settles or when there is none. */
  scope: readonly ['orgs', string] | null
  /** The owning org, or null while the lookup runs or when there is none. */
  orgId: string | null
  /** Whether the org lookup has settled — `orgId` null after this means no org. */
  ready: boolean
  /** Under a site, or at the organization level (AGL-2630). */
  level: CrmScopeLevel
  /** The mounted site, or `null` at the organization level. */
  hostId: string | null
  /**
   * The controller this surface is being viewed as, or `null` at the org
   * level, where there is no one viewing site: a cross-holder reader
   * resolves each contact's own facet instead (`contactPrimaryGroup`).
   */
  consentGroup: ConsentGroup | null
  /**
   * What this viewer may LIST — every listener's `array-contains-any`
   * predicate, capped at what the operator accepts — or `null` at the org
   * level, where an org-wide member's listeners carry NO scope clause: the
   * rules' `canReadScoped()` short-circuits on `isOrgWideMember()`, so the
   * clause would only ever narrow what the reader is already allowed. Hand
   * it to {@link crmVisibleToClause}, which spells both cases. Stable across
   * renders for the same org and site, so it can sit in a query's
   * dependency list.
   */
  visibleTo: readonly ScopeToken[] | null
  /**
   * The site a record this viewer CREATES is captured by: the mounted site,
   * or at the org level the site the reader picked (`null` until they
   * have). A create must hold until this is known — the tokens below are
   * empty without it, and a record stamped with none is visible to nobody.
   */
  createHostId: string | null
  /** The consent group of {@link createHostId} — what a create records consent for. */
  createGroup: ConsentGroup | null
  /** What a record this viewer CREATES is stamped with; empty until {@link createHostId} is known. */
  createTokens: readonly ScopeToken[]
}

const NO_TOKENS: readonly ScopeToken[] = Object.freeze([])

/**
 * The scope facts every CRM surface needs, resolved once (AGL-2597, one
 * hook since AGL-2614, two levels since AGL-2630).
 *
 * A CRM surface — a list, a record page, a drawer, a card on somebody
 * else's page — resolves its consent group, builds the token list its
 * listener filters on, builds the tokens a create stamps, and looks up the
 * org root. Every section needs the same answers, and for a while the deals
 * had a hook of their own that answered them under different names
 * (`readTokens` for `visibleTo`), which is two chances to filter by one set
 * of tokens and stamp with another. This is the one place the expression
 * lives: a surface that spelled its own could omit the `'org'` token and
 * stop listing the org-wide records the rules would have let it read.
 *
 * ## Two levels, one call
 *
 * Under a site, `hostId` names it and everything follows from the org
 * document and that id, as it always has. At the ORGANIZATION level the
 * hub hands every surface `hostId: null`, and the org comes from the mount
 * the hub published (`useCrmOrgMount`): the org root is known at once,
 * reads are unscoped, and the site a create stamps from is the one the
 * reader picked. A surface written against `{ scope, visibleTo,
 * createTokens }` serves both levels without knowing which it is on — the
 * two differences it cannot ignore are that `visibleTo` and `consentGroup`
 * are `null` at the org level, and both are typed to say so.
 *
 * `visibleTo` and `createTokens` are different questions with different
 * answers. The first is the union of everything this viewer may see; the
 * second is where a new record lands, which `crmScopeTokens` decides from
 * the org's default and is narrower — a group of one site creates for that
 * site, and reads the org-wide rows beside its own.
 *
 * Pure over the org document the shell already passed, so it costs no read;
 * only the org lookup behind `useOrgDataScope` is asynchronous, and `ready`
 * is how a surface tells "not yet" from "no org".
 */
export function useCrmScope(props: {
  hostId: string | null | undefined
  org?: CrmOrgDoc
}): CrmScope {
  const hostId = props.hostId || null
  const org = (props.org ?? null) as Record<string, unknown> | null
  const mount = useCrmOrgMount()
  // Under a site the org is looked up from the host index; at the org level
  // it is the mount's, known at once. A `null` host with no mount is a
  // surface mounted nowhere, and resolves to no org rather than guessing.
  const { scope, orgId, ready } = useOrgDataScope(
    hostId ? { hostId } : { orgId: mount?.orgId },
  )
  const level: CrmScopeLevel = hostId ? 'site' : 'org'
  const consentGroup = useMemo(
    () => (hostId ? consentGroupForHost(org, hostId) : null),
    [org, hostId],
  )
  const visibleTo = useMemo(
    () => (consentGroup ? crmReadTokens(consentGroup) : null),
    [consentGroup],
  )
  const createHostId = hostId ?? mount?.createHostId ?? null
  const createGroup = useMemo(
    () => (createHostId ? consentGroupForHost(org, createHostId) : null),
    [org, createHostId],
  )
  const createTokens = useMemo(
    () => (createGroup ? crmScopeTokens(org, createGroup) : NO_TOKENS),
    [org, createGroup],
  )
  return useMemo(
    () => ({
      scope,
      orgId,
      ready,
      level,
      hostId,
      consentGroup,
      visibleTo,
      createHostId,
      createGroup,
      createTokens,
    }),
    [
      scope,
      orgId,
      ready,
      level,
      hostId,
      consentGroup,
      visibleTo,
      createHostId,
      createGroup,
      createTokens,
    ],
  )
}

/**
 * The scope clause a CRM listener carries, spelled once for both levels
 * (AGL-2630).
 *
 * Under a site: `where('visibleTo', 'array-contains-any', tokens)`, the
 * predicate the rules evaluate with `hasAny`, which is what makes a
 * filtered query provable per document. At the org level: NOTHING — the
 * reader is an org-wide member, the rules admit them to every row, and a
 * query that kept the clause would need the org's whole site list on it
 * and still miss a site the list did not carry. Spread into the query, so
 * the two cases are one line at every listener: `...crmVisibleToClause(
 * scope.visibleTo)`.
 *
 * A query that drops an `array-contains-any` may need a composite index
 * the scoped form did not: the equality and range clauses beside it stay,
 * and Firestore composes them on their own. The org-level entries live in
 * `cloud/firebase-firestore.indexes.json` beside their scoped twins.
 */
export function crmVisibleToClause(
  visibleTo: readonly ScopeToken[] | readonly string[] | null | undefined,
): QueryConstraint[] {
  if (!visibleTo) return []
  return [where('visibleTo', 'array-contains-any', [...visibleTo])]
}

/**
 * Whether a listener that filters on `visibleTo` has anything to ask for:
 * `true` at the org level (no clause is a complete question), and under a
 * site only when the token list is non-empty — an `array-contains-any`
 * over nothing is a query Firestore refuses.
 */
export function crmScopeListable(
  visibleTo: readonly ScopeToken[] | readonly string[] | null | undefined,
): boolean {
  return visibleTo === null || visibleTo === undefined || visibleTo.length > 0
}

export default useCrmScope
