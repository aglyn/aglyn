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
  type AglynOrgBilling,
  type ConsentGroup,
  consentGroupForHost,
  crmScopeTokens,
  hostScopeToken,
  MAX_SCOPE_HOSTS,
  ORG_SCOPE_TOKEN,
  type ScopeToken,
} from '@aglyn/aglyn'
import { useOrgDataScope } from '@aglyn/tenant-feature-instance'
import { useMemo } from 'react'

export interface CrmScope {
  /** The org data root, or `null` until the org lookup settles. */
  scope: readonly ['orgs', string] | null
  orgId: string | undefined
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
 * The three scope facts every CRM surface needs, resolved once (AGL-2597).
 *
 * The contact list resolves its consent group, builds the token list its
 * listener filters on, and looks up the org root in three separate steps.
 * Every CRM section needs the same three, and the company pages need them in
 * four files, so this is the one place the expression lives — a surface
 * that spelled its own could omit the `'org'` token and stop listing the
 * org-wide records the rules would have let it read.
 *
 * `visibleTo` and `createTokens` are different questions with different
 * answers. The first is the union of everything this viewer may see; the
 * second is where a new record lands, which `crmScopeTokens` decides from
 * the org's default and is narrower — a group of one site creates for that
 * site, and reads the org-wide rows beside its own.
 */
export function useCrmScope(props: {
  hostId: string
  org?: Partial<AglynOrgBilling> | null
}): CrmScope {
  const { hostId, org } = props
  const { scope, orgId } = useOrgDataScope({ hostId })
  const consentGroup = useMemo(
    () => consentGroupForHost((org ?? {}) as Record<string, unknown>, hostId),
    [org, hostId],
  )
  const visibleTo = useMemo(
    () =>
      [
        ORG_SCOPE_TOKEN,
        ...consentGroup.hostIds.map((id) => hostScopeToken(id)),
      ].slice(0, MAX_SCOPE_HOSTS),
    [consentGroup],
  )
  const createTokens = useMemo(
    () => crmScopeTokens((org ?? {}) as Record<string, unknown>, consentGroup),
    [org, consentGroup],
  )
  return useMemo(
    () => ({ scope, orgId, consentGroup, visibleTo, createTokens }),
    [scope, orgId, consentGroup, visibleTo, createTokens],
  )
}

export default useCrmScope
