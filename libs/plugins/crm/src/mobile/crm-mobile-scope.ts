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
  type ConsentGroup,
  consentGroupForHost,
  soloConsentGroup,
} from '@aglyn/aglyn/app-utils/consent-groups'
import { crmReadTokens, crmScopeTokens } from '@aglyn/aglyn/app-utils/crm'
import { checkEntitlement, planLabelGrantingFeature } from '@aglyn/aglyn/app-utils/plan-entitlements'

/*
 * THE CRM'S SCOPE IN THE APP (AGL-3622) — `useCrmScope` for a reader who
 * picked a workspace and maybe a site, worked out the same way so every
 * query carries the clause the rules prove it by.
 *
 * Under a site the list asks `visibleTo array-contains-any` the site's
 * consent-group tokens, narrowed to the member's own reach for a DECLARED
 * group (AGL-3320), and the site's own tokens until that reach has loaded.
 * With no site picked the app reads the organization level only for an
 * org-wide member — the one reader whose queries the rules prove without a
 * scope clause. Anyone else is asked to pick a site.
 */

/** The member's reach, as `useOrgAccess` reads it. */
export interface CrmMobileReach {
  loaded: boolean
  orgWide: boolean
  tokens: readonly string[]
}

export interface CrmMobileScope {
  orgId: string
  level: 'site' | 'org'
  /** The picked site, or null at the organization level. */
  hostId: string | null
  /** The list clause's tokens, or null at the organization level (no clause). */
  visibleTo: readonly string[] | null
  /** Whether a search may fold into the scope clause (`useCrmFoldsScope`). */
  foldsScope: boolean
  /** The site a record created here is captured by, or null until one is picked. */
  createHostId: string | null
  /** What a record created here is stamped with. */
  createTokens: readonly string[]
  consentGroup: ConsentGroup | null
}

/** Why there is no scope yet, for the screen to say. */
export type CrmMobileScopeGap = 'loading' | 'no-org' | 'pick-site'

export function crmMobileScope(input: {
  orgId: string | null
  hostId: string | null
  /** The org document, or null while it loads (an unreadable one is `{}`). */
  org: Record<string, unknown> | null
  reach: CrmMobileReach
}): CrmMobileScope | CrmMobileScopeGap {
  const { orgId, hostId, org, reach } = input
  if (!orgId) return 'no-org'
  if (!hostId) {
    if (!reach.loaded) return 'loading'
    if (!reach.orgWide) return 'pick-site'
    return {
      orgId,
      level: 'org',
      hostId: null,
      visibleTo: null,
      foldsScope: true,
      createHostId: null,
      createTokens: [],
      consentGroup: null,
    }
  }
  // The site's consent group is read off the org document: until it has
  // loaded, a declared group would read as the site alone and the list
  // would change its query when it arrived.
  if (!org) return 'loading'
  const group = consentGroupForHost(org, hostId)
  const tokens = crmReadTokens(group)
  let visibleTo: readonly string[]
  if (group.declared !== true) visibleTo = tokens
  else if (!reach.loaded) visibleTo = crmReadTokens(soloConsentGroup(group.hostId))
  else if (reach.orgWide) visibleTo = tokens
  else {
    const held = new Set(reach.tokens)
    visibleTo = tokens.filter((token) => held.has(token))
  }
  return {
    orgId,
    level: 'site',
    hostId,
    visibleTo,
    foldsScope: reach.loaded && reach.orgWide,
    createHostId: hostId,
    createTokens: crmScopeTokens(org, group),
    consentGroup: group,
  }
}

/** Whether a value is a usable scope rather than the reason there is none. */
export function isCrmMobileScope(value: CrmMobileScope | CrmMobileScopeGap): value is CrmMobileScope {
  return typeof value === 'object'
}

/** What the screen says in place of a list with no scope. */
export const CRM_SCOPE_GAP_COPY: Record<CrmMobileScopeGap, { title: string; body?: string }> = {
  loading: { title: 'Loading your CRM' },
  'no-org': { title: 'Pick a workspace to see its CRM' },
  'pick-site': {
    title: 'Pick a site to see its CRM',
    body: 'Your access is to specific sites, so the CRM opens under one of them.',
  },
}

/**
 * What a record created from a record's page is stamped with (`CrmScoped`):
 * the site it names as provenance and the tokens `crmScopeTokens` gives
 * that site's group. The console's record pages create under the record's
 * own site at the organization level (`CrmCreateSiteDefault`), and under
 * the mounted site otherwise; `null` when neither is known, which is when
 * the console refuses the create too.
 */
export function crmCreateStamp(
  org: Record<string, unknown> | null,
  hostId: string | null,
): { hostId: string; visibleTo: string[] } | null {
  if (!hostId) return null
  return { hostId, visibleTo: [...crmScopeTokens(org, consentGroupForHost(org, hostId))] }
}

/**
 * Whether the member's role writes CRM records at all: the rules' own
 * `canWriteOrgData()` (owner, admin, editor). The scope half is the
 * record's, and the rules judge it on the write.
 */
export function crmMobileCanWrite(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor'
}

/** The entitlement the CRM suite is sold under (`features.crm`, the console's `crm-suite-lock`). */
const CRM_SUITE_FEATURE = 'crm'

/**
 * Whether the org's plan carries the CRM. The console's shell draws the
 * whole hub locked without it — every section, every record — and the
 * rules refuse every CRM write (`orgCarriesCrmSuite`), so the app opens
 * none of it either. `null` (the org still loading) is not a verdict.
 */
export function crmSuiteIncluded(org: Record<string, unknown> | null): boolean | null {
  if (!org) return null
  return checkEntitlement(org as Parameters<typeof checkEntitlement>[0], CRM_SUITE_FEATURE)
}

/** What the locked CRM says, as the console's notice does. */
export function crmSuiteLockedCopy(): { title: string; body: string } {
  const plan = planLabelGrantingFeature(CRM_SUITE_FEATURE)
  return {
    title: 'Your plan does not include the CRM',
    body: plan ? `Leads, contacts, companies and deals are included from ${plan}.` : 'Upgrade to use leads, contacts, companies and deals.',
  }
}
