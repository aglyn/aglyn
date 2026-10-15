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
  aiAddonName,
  hasAiAddon,
  PLAN_ENTITLEMENTS,
  resolveEffectivePlan,
  resolveOrgEntitlements,
  UNLIMITED,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import { countManagerSeats } from '@aglyn/aglyn/app-utils/organizations'
import { pluginOrgCapacities } from '@aglyn/aglyn/plugin-manager/plugin-org-capacity'
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  listOrgMembers,
} from '@aglyn/tenant-data-admin'
import { registerPluginServerDeclarations } from '../../../../constants/plugins.declarations.server.generated'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import { countOrgCapacity, countOrgSites } from '../../../../utils/server/capacity-in-use'

/**
 * The organization's effective entitlements as the staff page prints them
 * (AGL-3667): every numeric limit as it resolves now (plan default, the
 * staff override, a comp, an add-on), beside the plan default and what the
 * organization holds against it. The page works this out in the browser from
 * the org document and a count per collection; the apps read it from here.
 *
 * Sites and manager seats are the platform's own; every other capacity is one
 * a plugin declares, counted from the collection its declaration names. A
 * count that could not be read is left out, so the row shows a dash and not a
 * zero that reads as "none held".
 */
const format = (value: number): string => (value === UNLIMITED ? '\u221e' : value.toLocaleString('en-US'))

async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const orgId = String(query.orgId ?? '')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    await registerPluginServerDeclarations()
    const snapshot = await firebaseAdmin.app().firestore().collection('orgs').doc(orgId).get()
    if (!snapshot.exists) {
      return Response.json({ error: 'No such organization' }, { status: 404 })
    }
    const org = snapshot.data() as Record<string, unknown>
    const resolved = resolveOrgEntitlements(org as never)
    const defaults = PLAN_ENTITLEMENTS[resolveEffectivePlan(org as never)] as unknown as Record<string, unknown>
    const overrides = (org['entitlements'] ?? {}) as Record<string, unknown>

    const capacities = pluginOrgCapacities()
    const [sites, members, ...declared] = await Promise.all([
      countOrgSites(orgId, org),
      listOrgMembers(orgId).catch(() => null),
      ...capacities.map((capacity) => countOrgCapacity(orgId, capacity.collection)),
    ])
    const seats = members ? countManagerSeats(members as never) : null
    const used: Record<string, number> = {}
    if (sites !== null) used['hostLimit'] = sites
    if (seats !== null) {
      used['managersPerOrg'] = seats
      used['maxManagersPerOrg'] = seats
    }
    capacities.forEach((capacity, index) => {
      const count = declared[index]
      if (count === null || count === undefined) return
      used[capacity.includedEntitlement] = count
      used[capacity.purchaseCeilingEntitlement] = count
    })

    const aiAddon = hasAiAddon(org as never)
    const rows = Object.entries(resolved)
      .filter(([key, value]) => key !== 'features' && typeof value === 'number')
      .map(([key, value]) => {
        const fallback = defaults[key]
        return {
          key,
          used: used[key] !== undefined ? used[key].toLocaleString('en-US') : '',
          effective: format(value as number),
          planDefault: typeof fallback === 'number' ? format(fallback) : '',
          overridden: overrides[key] !== null && overrides[key] !== undefined,
          addon: key === 'assistCreditsPerMonth' && aiAddon ? `${aiAddonName()} add-on` : '',
        }
      })
    return Response.json({ orgId, rows }, { status: 200 })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/org-entitlements] failed', error)
    return Response.json({ error: 'Entitlements lookup failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
