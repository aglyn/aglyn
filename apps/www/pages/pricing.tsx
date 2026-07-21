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
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  UNLIMITED,
  type OrgPlan,
} from '@aglyn/aglyn'
import { APP_WWW, BRAND_NAMES } from '@aglyn/shared-data-enums'
import { Container, GridItems } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { mainNavigation } from '../const'
import MainLayout from '../layouts/MainLayout'
import SiteFooterView from '../views/SiteFooterView'

const PLAN_ORDER: OrgPlan[] = [
  'free',
  'starter',
  'pro',
  'business',
  'advanced',
]

const PLAN_LABELS: Record<OrgPlan, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
  advanced: 'Advanced',
}

const PLAN_TAGLINES: Record<OrgPlan, string> = {
  free: 'Build and publish your first site.',
  starter: 'Start selling with one production site.',
  pro: 'Full commerce with POS and 0% physical fees.',
  business: 'Subscriptions, paywalls, and gift cards.',
  advanced: 'High-volume commerce, zero platform fees.',
}

const quota = (value: number, unit: string) =>
  value === UNLIMITED
    ? `Unlimited ${unit}`
    : value === 0
      ? null
      : `${value.toLocaleString()} ${unit}`

/**
 * Pricing page (AGL-321): driven from PLAN_PRICING/PLAN_ENTITLEMENTS so
 * marketing numbers can never drift from what checkout charges. The fee
 * ladder is the upgrade motion — higher plans reduce platform fees to 0%.
 */
function Pricing() {
  const [annual, setAnnual] = useState(true)
  return (
    <MainLayout
      title={`Pricing — ${APP_WWW.TITLE}`}
      centerNavigationItems={mainNavigation}
      productName={BRAND_NAMES.WWW}
    >
      <Container maxWidth={'lg'} gutterY>
        <Stack spacing={1} sx={{ alignItems: 'center', textAlign: 'center', py: 4 }}>
          <Typography variant="h3" component="h1">
            {'Simple pricing that scales with your store'}
          </Typography>
          <Typography variant="h6" color="text.secondary">
            {'Sell on your own Stripe account. Upgrade to cut platform fees to 0%.'}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', pt: 1 }}>
            <Typography variant="body2">{'Monthly'}</Typography>
            <Switch
              checked={annual}
              onChange={(event) => setAnnual(event.target.checked)}
            />
            <Typography variant="body2">
              {'Annual '}
              <Chip label="Save up to 36%" size="small" color="secondary" />
            </Typography>
          </Stack>
        </Stack>
        <GridItems
          spacing={2}
          items={PLAN_ORDER.map((plan) => {
            const pricing = PLAN_PRICING[plan]
            const entitlements = PLAN_ENTITLEMENTS[plan]
            const price = annual
              ? pricing.basePriceAnnualMonthlyUsd
              : pricing.basePriceMonthlyUsd
            const fees =
              plan === 'free'
                ? 'No selling'
                : `${entitlements.transactionFeePhysicalPct}% physical · ` +
                  `${entitlements.transactionFeeDigitalPct}% digital fees`
            const bullets = [
              quota(entitlements.hostLimit, 'sites'),
              quota(entitlements.productsPerHost, 'products'),
              entitlements.features.pos ? 'Point of sale' : null,
              entitlements.features.storefrontSubscriptions
                ? 'Subscriptions & paywalls'
                : null,
              entitlements.features.giftCards ? 'Gift cards' : null,
              entitlements.features.abandonedCart
                ? 'Abandoned-cart recovery'
                : null,
              quota(entitlements.inventoryLocations, 'inventory locations'),
              entitlements.apiRequestsPerMonth > 0
                ? `${entitlements.apiRequestsPerMonth.toLocaleString()} API requests/mo` +
                  (pricing.extraApiRequestsUsdPer1k != null
                    ? ` (+$${pricing.extraApiRequestsUsdPer1k}/1k)`
                    : '')
                : null,
            ].filter(Boolean) as string[]
            return {
              size: { xs: 12, sm: 6, md: 2.4 },
              children: (
                <Card
                  variant="outlined"
                  sx={{
                    height: '100%',
                    ...(plan === 'pro'
                      ? { borderColor: 'secondary.main', borderWidth: 2 }
                      : {}),
                  }}
                >
                  <CardContent>
                    <Stack spacing={1}>
                      <Typography variant="h6">{PLAN_LABELS[plan]}</Typography>
                      <Box>
                        <Typography variant="h4" component="span">
                          {`$${price}`}
                        </Typography>
                        <Typography
                          variant="body2"
                          component="span"
                          color="text.secondary"
                        >
                          {'/mo'}
                        </Typography>
                        {annual && plan !== 'free' ? (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block' }}
                          >
                            {'billed annually'}
                          </Typography>
                        ) : null}
                      </Box>
                      <Typography variant="body2" color="text.secondary">
                        {PLAN_TAGLINES[plan]}
                      </Typography>
                      <Chip
                        label={fees}
                        size="small"
                        variant="outlined"
                        color={
                          entitlements.transactionFeePhysicalPct === 0 &&
                          entitlements.transactionFeeDigitalPct === 0 &&
                          plan !== 'free'
                            ? 'success'
                            : 'default'
                        }
                      />
                      {bullets.map((bullet) => (
                        <Typography key={bullet} variant="body2">
                          {`✓ ${bullet}`}
                        </Typography>
                      ))}
                      <Button
                        variant={plan === 'pro' ? 'contained' : 'outlined'}
                        color="secondary"
                        href="/auth/signup"
                        sx={{ mt: 1 }}
                      >
                        {plan === 'free' ? 'Start free' : 'Get started'}
                      </Button>
                    </Stack>
                  </CardContent>
                </Card>
              ),
            }
          })}
        />
        <Stack spacing={1} sx={{ py: 4, alignItems: 'center', textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {'Platform fees apply to storefront sales on top of Stripe’s ' +
              'processing fees — upgrading removes them. POS Pro registers ' +
              'are an $89/mo add-on per location on Business and above.'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {'Existing subscribers keep their current price until they ' +
              'change plans.'}
          </Typography>
        </Stack>
      </Container>
      <SiteFooterView />
    </MainLayout>
  )
}

export default Pricing
