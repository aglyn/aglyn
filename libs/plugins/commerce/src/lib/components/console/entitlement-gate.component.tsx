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

import { checkEntitlement, planLabelGrantingFeature } from '@aglyn/aglyn'
import type { OrgFeatureFlags } from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Alert, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useConsoleHostRoute, useOrgPlan } from '@aglyn/tenant-feature-instance'

export interface CommerceEntitlementState {
  /** The plan doc has settled. NEVER refuse before this is true. */
  ready: boolean
  entitled: boolean
  /** Console billing route, or undefined before the org slug resolves. */
  upgradeHref: string | undefined
  /** Cheapest plan carrying the feature — "Business". */
  planLabel: string | undefined
}

/**
 * The three-state entitlement read every commerce console surface needs
 * (AGL-2080), factored out of the copy-pasted pair that
 * `CommerceAnalyticsCard` and `CommerceGlanceCard` grew in AGL-2056.
 *
 * Three states, not two. `checkEntitlement(undefined)` resolves the FREE
 * tier rather than "unknown", so a surface that refuses on `!entitled`
 * alone shows a paying customer an upgrade prompt for the render or two
 * their org doc is in flight. `ready` is the difference, and it is why this
 * returns a struct rather than a boolean — a boolean is the API that caused
 * the bug.
 *
 * `planLabel` comes from `planGrantingFeature`, derived from
 * `PLAN_ENTITLEMENTS` on every call, so the upsell can never name a tier
 * that no longer carries the feature.
 */
export function useCommerceEntitlement(
  hostId: string | undefined,
  feature: keyof OrgFeatureFlags,
): CommerceEntitlementState {
  const consoleRoute = useConsoleHostRoute(hostId)
  const { org, ready } = useOrgPlan(hostId)
  return {
    ready,
    entitled: checkEntitlement(org as never, feature),
    upgradeHref: consoleRoute.orgSlug
      ? `/${consoleRoute.orgSlug}/billing`
      : undefined,
    planLabel: planLabelGrantingFeature(feature),
  }
}

export interface EntitlementUpsellProps {
  /** What the feature is and what it does, in the operator's terms. */
  children: ReactNode
  planLabel: string | undefined
  upgradeHref: string | undefined
}

/**
 * The locked-state notice: what the feature is, which plan carries it, and
 * one click to the plan grid.
 *
 * The plan name is not decoration. "This is a paid feature" is a dead end;
 * "this is on Business" plus an Upgrade button is the upgrade path AGL-1859
 * asks to keep prominent and one-click. Always `AppLink` — a MUI `href`
 * bypasses the client router and full-reloads the console.
 */
export function EntitlementUpsell(props: EntitlementUpsellProps) {
  const { children, planLabel, upgradeHref } = props
  return (
    <Alert
      severity="info"
      action={
        upgradeHref ? (
          <AppLink
            componentVariant="button"
            color="inherit"
            size="small"
            href={upgradeHref}
          >
            {'Upgrade'}
          </AppLink>
        ) : undefined
      }
    >
      {children}
      {planLabel ? ` Included from ${planLabel}.` : null}
    </Alert>
  )
}

export interface EntitlementGatedCardProps {
  hostId: string
  feature: keyof OrgFeatureFlags
  header: string
  /** Locked-state copy: what this does, so the upsell sells something. */
  upsell: ReactNode
  children: ReactNode
}

/**
 * A whole console card behind an entitlement (AGL-2080).
 *
 * The refusal happens BEFORE the operator can configure anything, which is
 * the entire point: five commerce features were fully configurable by an
 * unentitled org and only failed at checkout — a refusal delivered to the
 * buyer instead of the operator. A warning after configuration would be the
 * same defect with better manners.
 */
export function EntitlementGatedCard(props: EntitlementGatedCardProps) {
  const { hostId, feature, header, upsell, children } = props
  const { ready, entitled, upgradeHref, planLabel } = useCommerceEntitlement(
    hostId,
    feature,
  )

  if (!ready) {
    return (
      <CardDisplay header={header} contentGutterX contentGutterY>
        <Typography variant="body2" color="text.secondary">
          {'Checking your plan…'}
        </Typography>
      </CardDisplay>
    )
  }

  if (!entitled) {
    return (
      <CardDisplay header={header} contentGutterX contentGutterY>
        <EntitlementUpsell planLabel={planLabel} upgradeHref={upgradeHref}>
          {upsell}
        </EntitlementUpsell>
      </CardDisplay>
    )
  }

  return <>{children}</>
}

export default EntitlementGatedCard
