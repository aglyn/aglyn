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
} from '@aglyn/aglyn'
import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import {
  CardDisplay,
  Container,
  GridItems,
  useLoading,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  Link,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { collection, getCountFromServer } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import BillingAddonsCardComponent, {
  ADDON_LABELS,
} from '../../../../components/billing/billing-addons-card.component'
import BillingPlanCardsComponent, {
  PLAN_LABELS,
} from '../../../../components/billing/billing-plan-cards.component'
import BillingMeteredEstimateComponent from '../../../../components/billing/billing-metered-estimate.component'
import BillingUsageComponent from '../../../../components/billing/billing-usage.component'
import { useReleaseFlag } from '../../../../hooks/use-release-flags'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { buildRoute, Route } from '../../../../constants/route-links'
import useOrgNavTabItems from '../../../../hooks/use-org-nav-tabs'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useOrgHosts } from '../../../../hooks/use-org-hosts'
import useCurrentOrg from '../../../../hooks/use-current-org'
import useOrgPermissions from '../../../../hooks/use-org-permissions'


const BillingContent: NextPageWithLayout<Record<string, never>> = () => {
  const orgNavTabs = useOrgNavTabItems()
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { org, orgId } = useCurrentOrg()
  const { permissions, can, loaded: permissionsLoaded } =
    useOrgPermissions()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { confirm } = useConfirmationContext()
  // Annual billing (AGL-269): checkout maps to the *_YEARLY price ids.
  const [interval, setInterval] = useState<'month' | 'year'>('month')
  // The toggle starts on the live subscription's interval (AGL-532) so
  // annual orgs see their real prices and switches keep their interval.
  const subscriptionInterval = (org?.subscription as any)?.interval
  useEffect(() => {
    if (subscriptionInterval === 'year' || subscriptionInterval === 'month') {
      setInterval(subscriptionInterval)
    }
  }, [subscriptionInterval])
  // Self-serve add-on purchases (AGL-529), release-gated.
  const addonStore = useReleaseFlag('release_addon_store')

  // Workspace-scoped (AGL-236): meters cover the selected org's sites.
  const { hosts } = useOrgHosts(firestore, user?.uid, orgId)
  const plan = (org?.plan ?? 'free') as OrgPlan
  const subscriptionStatus = org?.subscription?.status
  const subscriptionActive = ['active', 'trialing', 'past_due'].includes(
    String(subscriptionStatus ?? ''),
  )
  const cancelAtPeriodEnd =
    (org?.subscription as any)?.cancelAtPeriodEnd === true

  const subscriptionRequest = useCallback(
    async (body: Record<string, unknown>) => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/billing/subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ orgId, ...body }),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.status === 501) {
        enqueueSnackbar('Billing is not configured yet — Stripe keys are pending.', {
          variant: 'info',
          persist: false,
        })
        return null
      }
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Billing request failed', {
          variant: 'warning',
          persist: false,
        })
        return null
      }
      return payload
    },
    [user, orgId, enqueueSnackbar],
  )

  // Pre-downgrade check (AGL-483): resources that would exceed the target
  // plan. Downgrades never delete anything, but the user should know what
  // they'll be over before confirming. Counts sites (already loaded),
  // team members, and datasets (cheap org-scoped counts).
  const overLimitSummary = useCallback(
    async (targetPlan: OrgPlan): Promise<string[]> => {
      const target = PLAN_ENTITLEMENTS[targetPlan]
      if (!target || !orgId) return []
      const [memberCount, datasetCount] = await Promise.all([
        getCountFromServer(collection(firestore, 'orgs', orgId, 'members'))
          .then((snapshot) => snapshot.data().count)
          .catch(() => 0),
        getCountFromServer(collection(firestore, 'orgs', orgId, 'datasets'))
          .then((snapshot) => snapshot.data().count)
          .catch(() => 0),
      ])
      const over: string[] = []
      const siteCount = hosts?.length ?? 0
      if (siteCount > target.hostLimit) {
        over.push(`${siteCount} sites (${targetPlan} includes ${target.hostLimit})`)
      }
      if (memberCount > target.managersPerOrg) {
        over.push(
          `${memberCount} team members (${targetPlan} includes ${target.managersPerOrg})`,
        )
      }
      if (datasetCount > target.maxDatasetsPerOrg) {
        over.push(
          `${datasetCount} datasets (${targetPlan} includes ${target.maxDatasetsPerOrg})`,
        )
      }
      return over
    },
    [firestore, orgId, hosts],
  )

  // Stripe Billing Portal (AGL-275): payment methods, receipts, tax ids.
  const handleOpenPortal = useCallback(async () => {
    const dequeue = queueLoading()
    try {
      const payload = await subscriptionRequest({ action: 'portal' })
      if (payload?.url) window.location.assign(payload.url)
    } finally {
      dequeue()
    }
  }, [subscriptionRequest, queueLoading])

  // Cancel/resume (AGL-269). Canceling gets a data-impact confirm (AGL-483):
  // at period end the org resolves to Free; over-limit resources persist.
  const handleCancelToggle = useCallback(async () => {
    if (!cancelAtPeriodEnd) {
      const over = await overLimitSummary('free')
      const accepted = await confirm({
        title: 'Cancel subscription?',
        description:
          'Your plan runs until the end of the paid period, then this ' +
          'organization moves to the Free plan. Nothing is deleted' +
          (over.length ? ` — but you'll be over Free on: ${over.join('; ')}` : '') +
          '. You can resume any time before it ends.',
        confirmationText: 'Cancel subscription',
      })
        .then(() => true)
        .catch(() => false)
      if (!accepted) return
    }
    const dequeue = queueLoading()
    try {
      const payload = await subscriptionRequest({
        action: cancelAtPeriodEnd ? 'resume' : 'cancel',
      })
      if (payload) {
        enqueueSnackbar(
          payload.cancelAtPeriodEnd
            ? `Subscription cancels ${
                payload.currentPeriodEnd
                  ? new Date(payload.currentPeriodEnd).toLocaleDateString()
                  : 'at period end'
              }`
            : 'Subscription resumed',
          { variant: 'success', persist: false },
        )
      }
    } finally {
      dequeue()
    }
  }, [
    cancelAtPeriodEnd,
    overLimitSummary,
    confirm,
    subscriptionRequest,
    queueLoading,
    enqueueSnackbar,
  ])

  const handleUpgrade = useCallback(
    (targetPlan: OrgPlan) => async () => {
      const dequeue = queueLoading()
      try {
        // Plan switches on a live subscription go through the proration
        // preview + subscription update, never a second Checkout (AGL-269).
        if (subscriptionActive && org?.plan && targetPlan !== 'free') {
          dequeue()
          const preview = await subscriptionRequest({
            action: 'preview',
            plan: targetPlan,
            interval,
          })
          if (!preview) return
          const over = await overLimitSummary(targetPlan)
          const accepted = await confirm({
            title: `Switch to ${targetPlan}?`,
            description:
              `Prorated charge today: $${(preview.amountDueCents / 100).toFixed(2)} ` +
              `${String(preview.currency).toUpperCase()}; renews ${
                preview.periodEnd
                  ? new Date(preview.periodEnd).toLocaleDateString()
                  : 'at period end'
              }.` +
              (over.length
                ? ` Heads up — you'll be over the ${targetPlan} plan on: ` +
                  `${over.join('; ')}. Nothing is deleted and these keep ` +
                  "working, but you can't add more until you're back under " +
                  'the limit.'
                : ''),
            confirmationText: 'Switch plan',
          })
            .then(() => true)
            .catch(() => false)
          if (!accepted) return
          const switched = await subscriptionRequest({
            action: 'switch',
            plan: targetPlan,
            interval,
          })
          if (switched) {
            enqueueSnackbar(`Plan switched to ${targetPlan}`, {
              variant: 'success',
              persist: false,
            })
          }
          return
        }
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/billing/checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ plan: targetPlan, interval, orgId }),
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
    [
      user,
      orgId,
      interval,
      subscriptionActive,
      org?.plan,
      overLimitSummary,
      subscriptionRequest,
      confirm,
      queueLoading,
      enqueueSnackbar,
    ],
  )

  // Invoice history (AGL-248), billing.view-gated server-side.
  const [invoices, setInvoices] = useState<Array<{
    id: string
    number: string | null
    status: string | null
    amountDueCents: number
    currency: string
    periodEnd: string | null
    hostedInvoiceUrl: string | null
  }> | null>(null)
  useEffect(() => {
    if (!orgId || !user || (permissionsLoaded && !can('billing.view'))) return
    let active = true
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch(
          `/api/billing/invoices?orgId=${encodeURIComponent(orgId)}`,
          { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
        )
        if (!response.ok) return
        const payload = await response.json()
        if (active) setInvoices(payload.invoices ?? [])
      } catch {
        // The card keeps its loading state on failure.
      }
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, user, permissionsLoaded])

  return (
    <>
      <NextPageTitle screen={'Billing'} />
      <DashboardLayout
        navTabItems={orgNavTabs}
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
          {/* Permission guard (AGL-243): billing.view gates the page. */}
          {permissionsLoaded && !can('billing.view') ? (
            <Alert severity="warning">
              {'You do not have permission to view billing for this ' +
                'organization — ask an organization admin for access.'}
            </Alert>
          ) : (
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
                      sx={{ alignItems: 'center', mb: 1 }}
                    >
                      <Typography variant="h5">{PLAN_LABELS[plan]}</Typography>
                      <Chip
                        label={org?.subscription?.status ?? 'no subscription'}
                        size="small"
                        color={
                          org?.subscription?.status === 'active'
                            ? 'success'
                            : org?.subscription?.status === 'past_due'
                              ? 'warning'
                              : 'default'
                        }
                        variant="outlined"
                      />
                    </Stack>
                    {/* Plan price + headline entitlements (AGL-367). */}
                    {PLAN_PRICING[plan]?.basePriceMonthlyUsd ? (
                      <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        {`$${PLAN_PRICING[plan].basePriceMonthlyUsd}/mo · ` +
                          `$${PLAN_PRICING[plan].basePriceAnnualMonthlyUsd}/mo billed yearly`}
                      </Typography>
                    ) : null}
                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{ flexWrap: 'wrap', gap: 0.5, mb: 1 }}
                    >
                      {[
                        `${PLAN_ENTITLEMENTS[plan]?.hostLimit ?? '—'} sites`,
                        `${PLAN_ENTITLEMENTS[plan]?.emailSendsPerMonth ?? '—'} emails/mo`,
                      ].map((label) => (
                        <Chip
                          key={label}
                          size="small"
                          variant="outlined"
                          label={label}
                        />
                      ))}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {org?.plan
                        ? 'Usage and limits for your plan are shown beside.'
                        : 'No plan assigned yet — this organization resolves ' +
                          'to the Free limits.'}
                    </Typography>
                    {cancelAtPeriodEnd ? (
                      <Chip
                        label="cancels at period end"
                        size="small"
                        color="warning"
                        sx={{ mt: 1 }}
                      />
                    ) : null}
                    {/* Renewal + addons (AGL-248). */}
                    {(org?.subscription as any)?.currentPeriodEnd ? (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', mt: 1 }}
                      >
                        {`Renews ${new Date(
                          (org?.subscription as any).currentPeriodEnd
                            ?.toDate?.()
                            ?.getTime?.() ??
                            (org?.subscription as any).currentPeriodEnd,
                        ).toLocaleDateString()}`}
                      </Typography>
                    ) : null}
                    {can('billing.manage') ? (
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ mt: 1.5, flexWrap: 'wrap', gap: 1 }}
                      >
                        {/* Stripe Billing Portal (AGL-275). */}
                        <Button
                          size="small"
                          variant="outlined"
                          color="secondary"
                          onClick={() => void handleOpenPortal()}
                        >
                          {'Manage payment methods'}
                        </Button>
                        {subscriptionActive ? (
                          // Cancel/downgrade flow (AGL-269).
                          <Button
                            size="small"
                            color={cancelAtPeriodEnd ? 'secondary' : 'error'}
                            onClick={() => void handleCancelToggle()}
                          >
                            {cancelAtPeriodEnd
                              ? 'Resume subscription'
                              : 'Cancel subscription'}
                          </Button>
                        ) : null}
                      </Stack>
                    ) : null}
                    {org?.seatAddons &&
                    Object.values(org.seatAddons).some(Boolean) ? (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block' }}
                      >
                        {`Add-ons: ${Object.entries(org.seatAddons)
                          .filter(([, count]) => Number(count) > 0)
                          .map(([kind, count]) =>
                            kind === 'eventCalendar'
                              ? ADDON_LABELS[kind]
                              : `${count} ${ADDON_LABELS[kind] ?? kind}`)
                          .join(', ')}`}
                      </Typography>
                    ) : null}
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12, md: 8 },
                children: (
                  <CardDisplay header={'Usage'} contentGutterX contentGutterY>
                    <BillingUsageComponent
                      org={org}
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
                size: { xs: 12, md: 8 },
                children: (
                  <CardDisplay
                    header={'Billing history'}
                    contentGutterX
                    contentGutterY
                  >
                    {invoices === null ? (
                      <Typography variant="body2" color="text.secondary">
                        {'Invoices appear here once billing is configured.'}
                      </Typography>
                    ) : invoices.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        {'No invoices yet.'}
                      </Typography>
                    ) : (
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>{'Invoice'}</TableCell>
                            <TableCell>{'Status'}</TableCell>
                            <TableCell>{'Amount'}</TableCell>
                            <TableCell>{'Period end'}</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {invoices.map((invoice) => (
                            <TableRow key={invoice.id}>
                              <TableCell>
                                {invoice.hostedInvoiceUrl ? (
                                  <a
                                    href={invoice.hostedInvoiceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {invoice.number ?? invoice.id}
                                  </a>
                                ) : (
                                  (invoice.number ?? invoice.id)
                                )}
                              </TableCell>
                              <TableCell>{invoice.status ?? '—'}</TableCell>
                              <TableCell>
                                {`$${(invoice.amountDueCents / 100).toFixed(2)} ${invoice.currency.toUpperCase()}`}
                              </TableCell>
                              <TableCell>
                                {invoice.periodEnd
                                  ? new Date(
                                      invoice.periodEnd,
                                    ).toLocaleDateString()
                                  : '—'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardDisplay>
                ),
              },
              ...(addonStore.visible
                ? [{
                    size: { xs: 12 },
                    children: (
                      // Self-serve add-ons (AGL-529); #addons anchors the
                      // point-of-need upsell links (AGL-530).
                      <Box id="addons">
                        <CardDisplay
                          header={'Add-ons'}
                          contentGutterX
                          contentGutterY
                        >
                          <BillingAddonsCardComponent
                            orgId={orgId}
                            canManage={can('billing.manage')}
                          />
                        </CardDisplay>
                      </Box>
                    ),
                  }]
                : []),
              {
                size: { xs: 12 },
                children: (
                  // Annual billing toggle (AGL-269): two months free.
                  <FormControlLabel
                    control={
                      <Switch
                        checked={interval === 'year'}
                        onChange={(event) =>
                          setInterval(event.target.checked ? 'year' : 'month')
                        }
                      />
                    }
                    label={
                      interval === 'year'
                        ? 'Annual billing — 2 months free'
                        : 'Monthly billing (switch for 2 months free)'
                    }
                  />
                ),
              },
              {
                size: { xs: 12 },
                children: (
                  <BillingPlanCardsComponent
                    plan={org?.plan as OrgPlan | undefined}
                    interval={interval}
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
          )}
        </Container>
      </DashboardLayout>
    </>
  )
}

const Billing: NextPageWithLayout<Record<string, never>> = () => {
  return <BillingContent />
}
Billing.displayName = 'Page:Billing'

export default Billing
