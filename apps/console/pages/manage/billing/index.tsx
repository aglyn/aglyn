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

import { type TenantPlan } from '@aglyn/aglyn'
import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import {
  CardDisplay,
  Container,
  GridItems,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Chip, Stack, Typography } from '@mui/material'
import { useCallback } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import BillingPlanCardsComponent, {
  PLAN_LABELS,
} from '../../../components/billing/billing-plan-cards.component'
import BillingMeteredEstimateComponent from '../../../components/billing/billing-metered-estimate.component'
import BillingUsageComponent from '../../../components/billing/billing-usage.component'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import { buildRoute, Route } from '../../../constants/route-links'
import settingsNavTabItems from '../../../constants/settings-nav-tabs'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'
import { useAdminHosts } from '../../../hooks/use-admin-hosts'
import useCurrentTenant from '../../../hooks/use-current-tenant'
import useTenantPermissions from '../../../hooks/use-tenant-permissions'


const BillingContent: NextPageWithLayout = () => {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { tenant } = useCurrentTenant()
  const { permissions } = useTenantPermissions()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()

  const { hosts } = useAdminHosts(firestore, user?.uid)
  const plan = (tenant?.plan ?? 'free') as TenantPlan

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
        navTabItems={settingsNavTabItems()}
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
                      <Typography variant="h5">{PLAN_LABELS[plan]}</Typography>
                      <Chip
                        label={tenant?.subscription?.status ?? 'no subscription'}
                        size="small"
                        variant="outlined"
                      />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {tenant?.plan
                        ? 'Usage and limits for your plan are shown beside.'
                        : 'No plan assigned yet — limits are not enforced ' +
                          'on this account.'}
                    </Typography>
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12, md: 8 },
                children: (
                  <CardDisplay header={'Usage'} contentGutterX contentGutterY>
                    <BillingUsageComponent
                      tenant={tenant}
                      hosts={hosts ?? []}
                    />
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12, md: 4 },
                children: (
                  <CardDisplay
                    header={'Metered usage estimate'}
                    contentGutterX
                    contentGutterY
                  >
                    <BillingMeteredEstimateComponent hosts={hosts ?? []} />
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12 },
                children: (
                  <BillingPlanCardsComponent
                    plan={tenant?.plan as TenantPlan | undefined}
                    onSelect={(tier) =>
                      permissions.editBilling
                        ? void handleUpgrade(tier)()
                        : void enqueueSnackbar(
                            'Your team role does not allow billing changes',
                            { variant: 'warning', persist: false },
                          )
                    }
                  />
                ),
              },
            ]}
          />
        </Container>
      </DashboardLayout>
    </>
  )
}

const Billing: NextPageWithLayout = () => {
  return <BillingContent />
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
