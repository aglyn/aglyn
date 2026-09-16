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
  AI_ADDON_CREDITS_PER_MONTH,
  aiAddonName,
  hasAiAddon,
  isUnlimitedQuota,
  resolveEffectivePlan,
  resolveOrgEntitlements,
  resolvePlanPricing,
  type AglynOrgBilling,
} from '@aglyn/aglyn'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { UsageMeter } from '@aglyn/shared-ui-jsx/components/usage-meter.component'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { Link, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'

export interface AiCreditsCardProps {
  orgId?: string | null
  /** The billing-merged org doc the Usage page resolved. */
  org?: Partial<AglynOrgBilling> | null
  /** The Billing overview's path, for the one caption that points at the add-ons card. */
  billingHref?: string
}

/**
 * The AI credits meter (AGL-2899), on the Billing → Usage page's plugin
 * band below the platform's own meters (AGL-2939).
 *
 * Credits, because AI actions differ in cost by up to two orders of
 * magnitude — a question against generating a screen — and a message count
 * would price them the same. The band is refused at the cap, so this
 * readout is the only thing standing between a customer and learning their
 * limit by being turned down mid-build.
 *
 * Rendered only where a band is sold. Free and Starter carry
 * `assistCreditsPerMonth: 0` and no `aiAssist`, and a "0 of 0" meter is not
 * a readout of anything. Starter WITH the AI add-on carries the add-on's
 * band and renders like any Pro-and-up plan. ONE meter for one pool: the
 * add-on widens `assistCreditsPerMonth` rather than opening a second band,
 * so the limit here is already plan plus add-on and the caption under it
 * says how much of that the add-on is.
 *
 * From the server, not from Firestore like the platform's meters:
 * `orgs/{orgId}/assistUsage` is default-deny for every client, so a browser
 * read would fail silently and leave this reading "not yet metered" forever.
 * Credits, never dollars: the route is where the one conversion happens.
 */
export default function AiCreditsCard(props: AiCreditsCardProps) {
  const { orgId, org, billingHref } = props
  const { data: user } = useUser()
  const [credits, setCredits] = useState<{ used: number; limit: number | null } | null>(null)
  useEffect(() => {
    if (!orgId || !user) return undefined
    let active = true
    void (async () => {
      try {
        const response = await authorizedFetch(
          user,
          `/api/ai/billing/credits?orgId=${encodeURIComponent(orgId)}`,
        )
        if (!response.ok) return
        const result = await response.json()
        if (active && result?.credits) setCredits(result.credits)
      } catch {
        // The meter keeps its "not yet metered" state on failure —
        // deliberately not 0, which reads as "you have used none".
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, user])

  const entitlements = resolveOrgEntitlements(org)
  if (entitlements.assistCreditsPerMonth <= 0) return null
  const plan = resolveEffectivePlan(org)
  const aiAddonCredits = hasAiAddon(org) ? AI_ADDON_CREDITS_PER_MONTH[plan] : 0
  // Sold to THIS workspace, not merely on its plan: a staff comp has no
  // subscription to add the item to, so its price list sells none (AGL-3034).
  const aiAddonSold = resolvePlanPricing(org).aiAddonMonthlyUsd != null
  return (
    <CardDisplay
      header={'AI credits'}
      help={pluginDocsHelp('billing', {
        anchor: '#usage-meters',
        excerpt:
          'AI credits drawn this month against your included band, plan ' +
          'plus the AI add-on where you have it.',
      })}
      contentGutterX
      contentGutterY
    >
      {/* An uncapped staff comp (AGL-3049) resolves this band `UNLIMITED`:
          the meter reads "Unlimited" and draws no bar, never "/ Infinity". */}
      <UsageMeter
        label="AI credits (this month)"
        used={credits ? credits.used : null}
        limit={entitlements.assistCreditsPerMonth}
        unlimited={isUnlimitedQuota(entitlements.assistCreditsPerMonth)}
        upgradeHref={billingHref ? `${billingHref}#plans` : '#plans'}
      />
      {aiAddonCredits > 0 ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: -1.5, mb: 2 }}
        >
          {`Includes ${aiAddonCredits.toLocaleString()} credits a month from ` +
            `the ${aiAddonName()} add-on.`}
        </Typography>
      ) : null}
      {/* A plan with a band that sells the add-on and has not bought it:
          the one line on the meters that points at more capacity rather
          than at an upgrade. */}
      {!entitlements.features.aiGenerative && aiAddonSold ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: -1.5, mb: 2 }}
        >
          {`Generate pages, emails, campaigns and more with ${aiAddonName()}, ` +
            `and add ${AI_ADDON_CREDITS_PER_MONTH[plan].toLocaleString()} ` +
            'credits a month to this pool: '}
          <Link href={`${billingHref ?? ''}#addons`} color="primary" underline="hover">
            {`Add ${aiAddonName()}`}
          </Link>
          {' in Billing → Plans.'}
        </Typography>
      ) : null}
    </CardDisplay>
  )
}
