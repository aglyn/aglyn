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
  AI_TIERS,
  aiAddonName,
  aiTierName,
  isUnlimitedQuota,
  orgCanBuyAiTier,
  resolveAiTier,
  resolveOrgEntitlements,
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
 * Rendered only where a band is sold, which since AGL-3203 is every plan
 * row: Free carries the taste and Starter 750, so both render a meter even
 * though neither carries `aiAssist` — the band is credits, not the guided
 * rung. What still renders nothing is a band of ZERO, which now reaches this
 * component only as a per-org override, and a "0 of 0" meter is not a
 * readout of anything. ONE meter for one pool: the plan's included credits
 * pay for every AI action, generation included (AGL-3965), and an Aglyn AI
 * tier widens `assistCreditsPerMonth` rather than opening a second band, so
 * the limit here is already plan plus tier and the caption under it says
 * how much of that the tier is.
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
  const aiTier = resolveAiTier(org)
  // Sold to THIS workspace, not merely on its plan: a staff comp has no
  // subscription to add the item to, so it sells none (AGL-3034).
  const tiersSold = orgCanBuyAiTier(org)
  return (
    <CardDisplay
      header={'AI credits'}
      help={pluginDocsHelp('aiCredits', {
        anchor: '#see-your-credits',
        excerpt:
          'AI credits drawn this month against one pool: your plan’s included ' +
          'credits plus your AI tier’s, if you have one. Every AI action draws on ' +
          'it. The pool resets on the first of the month.',
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
      {aiTier ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: -1.5, mb: 2 }}
        >
          {`Includes ${AI_TIERS[aiTier].credits.toLocaleString()} credits a month ` +
            `from ${aiTierName(aiTier)}, on top of your plan's.`}
        </Typography>
      ) : null}
      {/* A plan that sells tiers and holds none: the one line on the meters
          that points at more capacity rather than at an upgrade. */}
      {!aiTier && tiersSold ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: -1.5, mb: 2 }}
        >
          {`Need more? An ${aiAddonName()} tier adds ` +
            `${AI_TIERS.spark.credits.toLocaleString()} to ` +
            `${AI_TIERS.studio.credits.toLocaleString()} credits a month to this pool: `}
          <Link href={`${billingHref ?? ''}#addons`} color="primary" underline="hover">
            {'Choose a tier'}
          </Link>
          {' in Billing → Plans.'}
        </Typography>
      ) : null}
    </CardDisplay>
  )
}
