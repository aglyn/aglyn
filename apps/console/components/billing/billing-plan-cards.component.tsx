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
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  type OrgPlan,
  UNLIMITED,
} from '@aglyn/aglyn'
import {
  ICON_VARIANT_SYMBOL_CONFIRMED,
  ICON_VARIANT_SYMBOL_MINUS,
} from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  Stack,
  Typography,
} from '@mui/material'

export const PLAN_ORDER: OrgPlan[] = [
  'free',
  'starter',
  'pro',
  'business',
  'advanced',
]

export const PLAN_LABELS: Record<OrgPlan, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
  advanced: 'Advanced',
}

const PLAN_TAGLINES: Record<OrgPlan, string> = {
  free: 'Try Aglyn and publish your first site.',
  starter: 'Everything a single production site needs.',
  pro: 'For growing teams shipping several sites.',
  business: 'Scale, scheduling, and priority limits.',
  advanced: 'High-volume commerce with zero platform fees.',
}

const quotaLabel = (value: number, unit?: string) =>
  value === UNLIMITED ? 'Unlimited' : unit ? `${value} ${unit}` : String(value)

const mbLabel = (mb: number) => (mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`)

/** Feature checklist rows, in display order (AGL-69 flags). */
const FEATURE_ROWS: Array<{
  key: keyof (typeof PLAN_ENTITLEMENTS)['free']['features']
  label: string
}> = [
  { key: 'reusableComponents', label: 'Reusable components' },
  { key: 'versioning', label: 'Screen versioning' },
  { key: 'scheduledPublishing', label: 'Scheduled publishing' },
  { key: 'customDomain', label: 'Custom domain' },
  { key: 'removeBranding', label: 'Remove Aglyn branding' },
  { key: 'marketplaceSelling', label: 'Sell on the marketplace' },
  { key: 'aiAssist', label: 'AI assist' },
  { key: 'workflows', label: 'Workflows & automations' },
  { key: 'dataStore', label: 'Datasets & dynamic data' },
  { key: 'bookings', label: 'Appointment bookings' },
  { key: 'videoMedia', label: 'Video & file uploads' },
  { key: 'actions', label: 'Actions builder' },
  { key: 'siteExport', label: 'Site backup & restore' },
  { key: 'redirects', label: 'URL redirects' },
  { key: 'webhooks', label: 'Webhooks' },
  { key: 'multilingual', label: 'Multilingual sites' },
  { key: 'screenAnalytics', label: 'Per-screen traffic analytics' },
  { key: 'marketingOverlays', label: 'Announcement bar & popups' },
  { key: 'mediaCdn', label: 'CDN delivery & responsive images' },
]

export interface BillingPlanCardsProps {
  /** The tenant's current plan; undefined when no plan is assigned yet. */
  plan: OrgPlan | undefined
  /**
   * Billing interval from the page's monthly/annual toggle (AGL-532):
   * 'year' shows the discounted annual headline price on every card.
   */
  interval?: 'month' | 'year'
  onSelect: (plan: OrgPlan) => void
}

/**
 * Pricing-page plan picker (AGL-71): quota summary + feature checklist per
 * tier, driven entirely from PLAN_ENTITLEMENTS/PLAN_PRICING. The current
 * plan is outlined and the next tier up is emphasized as the recommended
 * upgrade; lower tiers get a Downgrade CTA.
 */
export function BillingPlanCardsComponent(props: BillingPlanCardsProps) {
  const { plan, interval = 'month', onSelect } = props
  const currentIndex = plan ? PLAN_ORDER.indexOf(plan) : -1
  const recommendedIndex =
    currentIndex >= 0 && currentIndex < PLAN_ORDER.length - 1
      ? currentIndex + 1
      : -1

  return (
    <Grid container spacing={2} id="plans">
      {PLAN_ORDER.map((tier, index) => {
        const entitlements = PLAN_ENTITLEMENTS[tier]
        const pricing = PLAN_PRICING[tier]
        const isCurrent = tier === plan
        const isRecommended = index === recommendedIndex
        return (
          <Grid key={tier} size={{ xs: 12, sm: 6, lg: 3 }}>
            <Card
              variant="outlined"
              sx={{
                height: '100%',
                position: 'relative',
                borderColor: isCurrent
                  ? 'success.main'
                  : isRecommended
                    ? 'secondary.main'
                    : 'divider',
                borderWidth: isCurrent || isRecommended ? 2 : 1,
              }}
            >
              <CardContent>
                <Stack
                  direction="row"
                  sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <Typography variant="h6">{PLAN_LABELS[tier]}</Typography>
                  {isCurrent ? (
                    <Chip label="Current plan" color="success" size="small" />
                  ) : isRecommended ? (
                    <Chip label="Recommended" color="secondary" size="small" />
                  ) : null}
                </Stack>
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{ alignItems: 'baseline', my: 1 }}
                >
                  <Typography variant="h4" component="span">
                    {`$${
                      interval === 'year'
                        ? pricing.basePriceAnnualMonthlyUsd
                        : pricing.basePriceMonthlyUsd
                    }`}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {interval === 'year' && tier !== 'free'
                      ? '/month, billed yearly'
                      : '/month'}
                  </Typography>
                </Stack>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1.5, minHeight: 40 }}
                >
                  {PLAN_TAGLINES[tier]}
                </Typography>
                {!isCurrent ? (
                  <Button
                    fullWidth
                    size="small"
                    variant={index > currentIndex ? 'contained' : 'outlined'}
                    color="secondary"
                    // Free has no Stripe price to check out; moving down to
                    // it means canceling the subscription (Stripe portal,
                    // not built yet).
                    disabled={tier === 'free'}
                    onClick={() => onSelect(tier)}
                    sx={{ mb: 1.5 }}
                  >
                    {tier === 'free'
                      ? 'Free forever'
                      : currentIndex < 0 || index > currentIndex
                        ? 'Upgrade'
                        : 'Downgrade'}
                  </Button>
                ) : (
                  <Button fullWidth size="small" disabled sx={{ mb: 1.5 }}>
                    {'Your plan'}
                  </Button>
                )}
                <Divider sx={{ mb: 1.5 }} />
                <Stack spacing={0.5} sx={{ mb: 1.5 }}>
                  <Typography variant="body2">
                    {`${quotaLabel(entitlements.hostLimit)} host${
                      entitlements.hostLimit === 1 ? '' : 's'
                    }`}
                    {pricing.extraHostMonthlyUsd != null
                      ? ` (+$${pricing.extraHostMonthlyUsd}/extra)`
                      : ''}
                  </Typography>
                  <Typography variant="body2">
                    {`${quotaLabel(entitlements.screensPerHost)} screens per host`}
                  </Typography>
                  <Typography variant="body2">
                    {`${quotaLabel(entitlements.sharedLayoutsPerHost)} shared layouts`}
                  </Typography>
                  <Typography variant="body2">
                    {`${mbLabel(entitlements.storagePerHostMb)} storage · ` +
                      `${mbLabel(entitlements.totalSiteSizeMb)} site`}
                  </Typography>
                  <Typography variant="body2">
                    {`${entitlements.bandwidthGb} GB bandwidth`}
                  </Typography>
                  <Typography variant="body2">
                    {`${entitlements.managersPerOrg} team seat${
                      entitlements.managersPerOrg === 1 ? '' : 's'
                    }`}
                    {pricing.extraSeatMonthlyUsd != null
                      ? ` (+$${pricing.extraSeatMonthlyUsd}/extra, ` +
                        `max ${entitlements.maxManagersPerOrg})`
                      : ''}
                  </Typography>
                  <Typography variant="body2">
                    {`${entitlements.membersPerHost} member${
                      entitlements.membersPerHost === 1 ? '' : 's'
                    } per host`}
                    {pricing.extraMemberMonthlyUsd != null
                      ? ` (+$${pricing.extraMemberMonthlyUsd}/extra, ` +
                        `max ${entitlements.maxMembersPerHost})`
                      : ''}
                  </Typography>
                  <Typography variant="body2">
                    {`${quotaLabel(entitlements.variablesPerHost)} variables · ` +
                      `${quotaLabel(entitlements.functionsPerHost)} functions · ` +
                      `${quotaLabel(entitlements.workflowsPerHost)} workflows`}
                  </Typography>
                  <Typography variant="body2">
                    {entitlements.datasetsPerOrg > 0
                      ? `${quotaLabel(entitlements.datasetsPerOrg)} org datasets × ` +
                        `${quotaLabel(entitlements.recordsPerDataset)} records · ` +
                        `${Math.round(entitlements.dataStorageMbPerOrg / 1024)} GB data`
                      : 'No datasets'}
                  </Typography>
                  <Typography variant="body2">
                    {entitlements.apiRequestsPerMonth > 0
                      ? `${entitlements.apiRequestsPerMonth.toLocaleString()} API requests/mo` +
                        (pricing.extraApiRequestsUsdPer1k != null
                          ? ` (+$${pricing.extraApiRequestsUsdPer1k}/1k over)`
                          : '')
                      : 'No API access'}
                  </Typography>
                </Stack>
                <Stack spacing={0.5}>
                  {FEATURE_ROWS.map(({ key, label }) => {
                    const enabled = entitlements.features[key]
                    return (
                      <Stack
                        key={key}
                        direction="row"
                        spacing={0.75}
                        sx={{
                          alignItems: 'center',
                          color: enabled ? 'text.primary' : 'text.disabled',
                        }}
                      >
                        <MdiIcon
                          fontSize="inherit"
                          sx={{
                            color: enabled ? 'success.main' : 'text.disabled',
                          }}
                          path={
                            enabled
                              ? ICON_VARIANT_SYMBOL_CONFIRMED.path
                              : ICON_VARIANT_SYMBOL_MINUS.path
                          }
                        />
                        <Typography variant="body2">{label}</Typography>
                      </Stack>
                    )
                  })}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        )
      })}
    </Grid>
  )
}
BillingPlanCardsComponent.displayName = 'BillingPlanCardsComponent'

export default BillingPlanCardsComponent
