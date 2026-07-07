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
  type TenantPlan,
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

export const PLAN_ORDER: TenantPlan[] = ['free', 'starter', 'pro', 'business']

export const PLAN_LABELS: Record<TenantPlan, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
}

const PLAN_TAGLINES: Record<TenantPlan, string> = {
  free: 'Try Aglyn and publish your first site.',
  starter: 'Everything a single production site needs.',
  pro: 'For growing teams shipping several sites.',
  business: 'Scale, scheduling, and priority limits.',
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
]

export interface BillingPlanCardsProps {
  /** The tenant's current plan; undefined when no plan is assigned yet. */
  plan: TenantPlan | undefined
  onSelect: (plan: TenantPlan) => void
}

/**
 * Pricing-page plan picker (AGL-71): quota summary + feature checklist per
 * tier, driven entirely from PLAN_ENTITLEMENTS/PLAN_PRICING. The current
 * plan is outlined and the next tier up is emphasized as the recommended
 * upgrade; lower tiers get a Downgrade CTA.
 */
export function BillingPlanCardsComponent(props: BillingPlanCardsProps) {
  const { plan, onSelect } = props
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
                    {`$${pricing.basePriceMonthlyUsd}`}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {'/month'}
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
                    {`${entitlements.bandwidthGb} GB bandwidth · ` +
                      `${entitlements.membersPerHost} member${
                        entitlements.membersPerHost === 1 ? '' : 's'
                      }`}
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
