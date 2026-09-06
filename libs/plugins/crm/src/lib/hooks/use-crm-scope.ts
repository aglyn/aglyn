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
import { useMemo } from 'react'

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

export interface CrmScope {
  /** The org data root, or `null` until the org lookup settles or when there is none. */
  scope: readonly ['orgs', string] | null
  /** The owning org, or null while the lookup runs or when there is none. */
  orgId: string | null
  /** Whether the org lookup has settled — `orgId` null after this means no org. */
  ready: boolean
  /** The controller this surface is being viewed as. */
  consentGroup: ConsentGroup
  /**
   * What this viewer may LIST — every listener's `array-contains-any`
   * predicate, capped at what the operator accepts. Stable across renders
   * for the same org and site, so it can sit in a query's dependency list.
   */
  visibleTo: readonly ScopeToken[]
  /** What a record this viewer CREATES is stamped with. */
  createTokens: readonly ScopeToken[]
}

/**
 * The scope facts every CRM surface needs, resolved once (AGL-2597, one
 * hook since AGL-2614).
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
  hostId: string
  org?: CrmOrgDoc
}): CrmScope {
  const { hostId } = props
  const org = (props.org ?? null) as Record<string, unknown> | null
  const { scope, orgId, ready } = useOrgDataScope({ hostId })
  const consentGroup = useMemo(
    () => consentGroupForHost(org, hostId),
    [org, hostId],
  )
  const visibleTo = useMemo(() => crmReadTokens(consentGroup), [consentGroup])
  const createTokens = useMemo(
    () => crmScopeTokens(org, consentGroup),
    [org, consentGroup],
  )
  return useMemo(
    () => ({ scope, orgId, ready, consentGroup, visibleTo, createTokens }),
    [scope, orgId, ready, consentGroup, visibleTo, createTokens],
  )
}

export default useCrmScope
