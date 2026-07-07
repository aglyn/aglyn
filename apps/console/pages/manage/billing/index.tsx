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
  resolveTenantEntitlements,
  type TenantPlan,
} from '@aglyn/aglyn'
import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { CardDisplay, Container, GridItems, useLoading } from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material'
import { collection, query, where } from 'firebase/firestore'
import { useCallback } from 'react'
import { useFirestore, useFirestoreCollectionData, useUser } from 'reactfire'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'
import useCurrentTenant from '../../../hooks/use-current-tenant'

/** Draft monthly pricing — placeholders until Stripe prices are final. */
const PLAN_PRICING: Record<TenantPlan, { label: string; price: string }> = {
  free: { label: 'Free', price: '$0' },
  starter: { label: 'Starter', price: '$12/mo' },
  pro: { label: 'Pro', price: '$29/mo' },
  business: { label: 'Business', price: '$99/mo' },
}
const PLAN_ORDER: TenantPlan[] = ['free', 'starter', 'pro', 'business']

function UsageMeter(props: { label: string; used: number; limit: number }) {
  const { label, used, limit } = props
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  return (
    <Stack spacing={0.5} sx={{ mb: 2 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
        <Typography variant="body2">{label}</Typography>
        <Typography variant="body2" color="text.secondary">
          {`${used} / ${limit}`}
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={pct}
        color={pct >= 100 ? 'error' : 'secondary'}
      />
    </Stack>
  )
}

const Billing: NextPageWithLayout = () => {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { tenant } = useCurrentTenant()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()

  const { data: hosts } = useFirestoreCollectionData<any>(
    query(
      collection(firestore, 'hosts'),
      where(`admins.${user?.uid ?? '-anonymous-'}`, '==', true),
    ),
    { idField: '$id' },
  )
  const plan = (tenant?.plan ?? 'free') as TenantPlan
  const entitlements = resolveTenantEntitlements(tenant)
  const hostsUsed = hosts?.length ?? 0

  const handleUpgrade = useCallback(
    (targetPlan: TenantPlan) => async () => {
      const dequeue = queueLoading()
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/billing/checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ plan: targetPlan }),
        })
        const payload = await response.json()
        if (response.status === 501) {
          return enqueueSnackbar(
            'Billing is not configured yet — Stripe keys are pending.',
            { variant: 'info', persist: false },
          )
        }
        if (!response.ok || !payload?.url) {
          throw new Error(payload?.error ?? 'Checkout failed')
        }
        window.location.assign(payload.url)
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Could not start checkout', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        dequeue()
      }
    },
    [user, queueLoading, enqueueSnackbar],
  )

  return (
    <>
      <NextPageTitle screen={'Billing'} />
      <DashboardLayout
        navTabItems={[
          {
            id: 'nav-tab-settings-user',
            label: 'User',
            href: buildRoute(Route.MANAGE_USER_SETTINGS),
          },
          {
            id: 'nav-tab-settings-account',
            label: 'Account',
            href: buildRoute(Route.MANAGE_ACCOUNT_SETTINGS),
          },
          {
            id: 'nav-tab-settings-billing',
            label: 'Billing',
            href: buildRoute(Route.MANAGE_BILLING),
          },
        ]}
        activeTab={buildRoute(Route.MANAGE_BILLING)}
        breadcrumbItems={[
          { children: 'Billing', href: buildRoute(Route.MANAGE_BILLING) },
        ]}
        header={{
          children: 'Billing',
          icon: { path: ICON_VARIANT_APP_SETTINGS.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <GridItems
            spacing={3}
            items={[
              {
                size: { xs: 12, md: 4 },
                children: (
                  <CardDisplay header={'Current plan'} contentGutterX contentGutterY>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', mb: 2 }}
                    >
                      <Typography variant="h5">
                        {PLAN_PRICING[plan].label}
                      </Typography>
                      <Chip
                        label={tenant?.subscription?.status ?? 'no subscription'}
                        size="small"
                        variant="outlined"
                      />
                    </Stack>
                    <UsageMeter
                      label="Hosts"
                      used={hostsUsed}
                      limit={entitlements.hostLimit}
                    />
                    <Typography variant="body2" color="text.secondary">
                      {`Screens per host: ${entitlements.screensPerHost} · ` +
                        `Storage: ${entitlements.storagePerHostMb} MB · ` +
                        `Members: ${entitlements.membersPerHost} · ` +
                        `Bandwidth: ${entitlements.bandwidthGb} GB`}
                    </Typography>
                  </CardDisplay>
                ),
              },
              ...PLAN_ORDER.map((tier) => ({
                size: { xs: 12, sm: 6, md: 2 },
                children: (
                  <CardDisplay
                    header={PLAN_PRICING[tier].label}
                    contentGutterX
                    contentGutterY
                  >
                    <Typography variant="h6" sx={{ mb: 1 }}>
                      {PLAN_PRICING[tier].price}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      component="div"
                      sx={{ mb: 1.5 }}
                    >
                      {`${PLAN_ENTITLEMENTS[tier].hostLimit} hosts · ` +
                        `${PLAN_ENTITLEMENTS[tier].screensPerHost} screens/host` +
                        (PLAN_ENTITLEMENTS[tier].features.versioning
                          ? ' · versioning'
                          : '') +
                        (PLAN_ENTITLEMENTS[tier].features.reusableComponents
                          ? ' · components'
                          : '')}
                    </Typography>
                    {tier === plan ? (
                      <Chip label="Current" color="success" size="small" />
                    ) : tier === 'free' ? null : (
                      <Button
                        size="small"
                        variant="contained"
                        color="secondary"
                        onClick={handleUpgrade(tier)}
                      >
                        {'Upgrade'}
                      </Button>
                    )}
                  </CardDisplay>
                ),
              })),
            ]}
          />
        </Container>
      </DashboardLayout>
    </>
  )
}
Billing.displayName = 'Page:Billing'
Billing.layouts = [
  { Component: AuthenticatedLayout },
  {
    Component: MainLayout,
    props: { title: 'Billing', enableAppBarElevation: true },
  },
]

export default Billing
