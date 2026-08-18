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
  buildBeginCheckoutParams,
  readGaClientId,
  trackEvent,
} from '@aglyn/aglyn/app-utils/analytics-events'
import {
  ENTERPRISE_PLAN_LABEL,
  isEnterpriseOrg,
  isLiveSubscriptionStatus,
  ORG_BILLING_DOC_ID,
  ORG_BILLING_SUBCOLLECTION,
  parseLockdownRefusal,
  parseOnboardingPlanIntent,
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  resolveOrgEntitlements,
  UNLIMITED,
  type AglynOrgBilling,
  type LockdownRefusalNotice,
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
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
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
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import fetchSeatCounts from '../../../../utils/fetch-seat-counts'
import BillingAddonsCardComponent, {
  ADDON_LABELS,
} from '../../../../components/billing/billing-addons-card.component'
import BillingPlanCardsComponent, {
  PLAN_LABELS,
} from '../../../../components/billing/billing-plan-cards.component'
import BillingMeteredEstimateComponent from '../../../../components/billing/billing-metered-estimate.component'
import BillingUsageComponent from '../../../../components/billing/billing-usage.component'
import EmbeddedCheckoutDialogComponent from '../../../../components/embedded-checkout-dialog.component'
import LockdownNotice from '../../../../components/lockdown-notice.component'
import { useReleaseFlag } from '../../../../hooks/use-release-flags'
import { docsHelp } from '../../../../constants/docs-links'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { buildRoute, Route } from '../../../../constants/route-links'
import { useOrgSlug } from '../../../../hooks/use-org-scope'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useOrgHosts } from '../../../../hooks/use-org-hosts'
import useCurrentOrg from '../../../../hooks/use-current-org'
import useConfirmedDoc from '../../../../hooks/use-confirmed-doc'
import useOrgPermissions from '../../../../hooks/use-org-permissions'


const BillingContent: NextPageWithLayout<Record<string, never>> = () => {
  const orgSlug = useOrgSlug()
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { org: orgDoc, orgId, ready: orgReady } = useCurrentOrg()
  // `stripeCustomerId` and `subscription` moved to `orgs/{orgId}/billing/stripe`
  // behind `canManageOrg()` (AGL-1028). This page is billing.manage-gated, so
  // its reader can see that doc; merging it over the org doc keeps every
  // `org.subscription…` reference below working unchanged, and the org doc
  // still supplies `plan`, `entitlements` and `seatAddons`.
  const { data: orgBilling } = useConfirmedDoc<Partial<AglynOrgBilling>>(
    firestore,
    orgId ? ['orgs', orgId, ORG_BILLING_SUBCOLLECTION, ORG_BILLING_DOC_ID] : null,
  )
  const org = useMemo(
    () => ({ ...(orgDoc ?? {}), ...(orgBilling ?? {}) }),
    [orgDoc, orgBilling],
  )
  const { permissions, can, loaded: permissionsLoaded } =
    useOrgPermissions()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { confirm } = useConfirmationContext()
  // Annual billing (AGL-269): checkout maps to the *_YEARLY price ids.
  const [interval, setInterval] = useState<'month' | 'year'>('month')
  // Non-null while an in-page checkout is open (AGL-1132). Null is both the
  // closed state and the state on every deploy where the route chose the
  // redirect instead, so nothing here has to know which mode is live.
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<
    string | null
  >(null)
  // A checkout feature lockdown, held as the PARSED notice rather than a
  // flattened string (AGL-1558). This page is the one surface where the toast
  // was the wrong shape: the customer reading it is mid-upgrade and wondering
  // whether they were charged, and the two fields a snackbar cannot carry —
  // the support address and the expected-back line — are exactly the two that
  // answer that. Rendered inline above the plan cards, so it is still there
  // when they look back at the button they just pressed.
  const [checkoutLockdown, setCheckoutLockdown] =
    useState<LockdownRefusalNotice | null>(null)
  // The plan the visitor picked on the marketing site, if they arrived by a
  // pricing CTA (AGL-1117). Read once off the URL: it preselects the toggle
  // and emphasizes the matching card, and nothing here submits on its own.
  const searchParams = useSearchParams()
  const planIntent = useMemo(
    () => parseOnboardingPlanIntent(searchParams),
    [searchParams],
  )
  // `parseOnboardingPlanIntent` defaults a missing interval to 'month', which is
  // the safe reading for checkout but the wrong one for the toggle: some CTAs
  // carry a plan and deliberately no interval (the /pricing scale strip quotes
  // monthly and annual side by side, so it commits to neither). Honoring that
  // default would silently flip an annual org to monthly on arrival, so only an
  // interval the URL actually stated is allowed to move the toggle.
  const intervalStated = Boolean(searchParams?.get('interval'))
  // The toggle starts on the live subscription's interval (AGL-532) so
  // annual orgs see their real prices and switches keep their interval.
  //
  // An incoming deep link outranks it: someone who clicked the annual price
  // on /pricing must see that price here, even on a month-to-month org —
  // otherwise the number they were sold changes between the two pages.
  const subscriptionInterval = (org?.subscription as any)?.interval
  useEffect(() => {
    if (planIntent && intervalStated) return void setInterval(planIntent.interval)
    if (subscriptionInterval === 'year' || subscriptionInterval === 'month') {
      setInterval(subscriptionInterval)
    }
  }, [planIntent, intervalStated, subscriptionInterval])
  // Self-serve add-on purchases (AGL-529), release-gated.
  const addonStore = useReleaseFlag('release_addon_store')

  // Workspace-scoped (AGL-236): meters cover the selected org's sites.
  const { hosts } = useOrgHosts(firestore, user?.uid, orgId)
  const plan = (org?.plan ?? 'free') as OrgPlan
  // Enterprise is a real plan (AGL-1118); orgs provisioned before that still
  // read as Enterprise off a base plan + custom price / comped marker
  // (AGL-1110). Either way it bills the negotiated amount, not a list price.
  const enterprise = isEnterpriseOrg(org)
  const customMonthlyUsd = org?.subscription?.customMonthlyUsd ?? 0
  // Effective entitlements (plan defaults + per-org overrides), so the summary
  // pills match the Usage meters beside them instead of showing base-plan
  // numbers (AGL-1110 polish).
  const resolved = resolveOrgEntitlements(org)
  const fmtLimit = (n: number) =>
    n === UNLIMITED ? 'Unlimited' : n.toLocaleString()
  const subscriptionStatus = org?.subscription?.status
  // One list, in `org-billing-doc.ts` (AGL-1715). This decides whether Upgrade
  // opens a Checkout or a proration preview, and `/api/billing/checkout`
  // decides whether to allow the session — if the two ever disagree in that
  // direction the page sends a subscribed org to checkout and the route lets
  // it through, which is the duplicate subscription AGL-1697 closed.
  const subscriptionActive = isLiveSubscriptionStatus(subscriptionStatus)
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
      // Seats from the server (AGL-1255). Two things were wrong here.
      //
      // The read was an unconstrained `orgs/{orgId}/members` list, denied for
      // any reader the RULES do not call org-wide — and `.catch(() => 0)`
      // turned that denial into "0 team members", which is under every plan's
      // limit, so the warning that this downgrade would strand the org simply
      // did not appear. The reassuring direction is the dangerous one here.
      //
      // It also counted EVERY member against `managersPerOrg`. Site-scoped
      // collaborators meter per host against `membersPerHost` (AGL-1113), so
      // this over-reported the number that decides whether you are warned.
      const [seatCounts, datasetCount] = await Promise.all([
        fetchSeatCounts(user, orgId),
        getCountFromServer(collection(firestore, 'orgs', orgId, 'datasets'))
          .then((snapshot) => snapshot.data().count)
          .catch(() => null),
      ])
      const over: string[] = []
      const siteCount = hosts?.length ?? 0
      if (siteCount > target.hostLimit) {
        over.push(`${siteCount} sites (${targetPlan} includes ${target.hostLimit})`)
      }
      // An unanswerable count is NOT "you are under the limit" — say so
      // rather than omit the row, so the confirmation cannot read as a
      // clean bill of health it never earned.
      if (seatCounts == null) {
        over.push(
          `team seats — could not be checked (${targetPlan} includes ` +
            `${target.managersPerOrg})`,
        )
      } else if (seatCounts.managerSeats > target.managersPerOrg) {
        over.push(
          `${seatCounts.managerSeats} team members (${targetPlan} includes ${target.managersPerOrg})`,
        )
      }
      // Same rule for datasets, now that its failure is `null` too.
      if (datasetCount == null) {
        over.push(
          `datasets — could not be checked (${targetPlan} includes ` +
            `${target.maxDatasetsPerOrg})`,
        )
      } else if (datasetCount > target.maxDatasetsPerOrg) {
        over.push(
          `${datasetCount} datasets (${targetPlan} includes ${target.maxDatasetsPerOrg})`,
        )
      }
      return over
    },
    [firestore, orgId, hosts, user],
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

  /**
   * One idempotency key per (org, plan, interval) checkout attempt
   * (AGL-1697), marketplace-style: a double-click or a re-submit after a lost
   * response presents the SAME key, so the server replays the one session
   * instead of opening a second subscription checkout. A different plan or
   * interval is a different attempt and gets its own entry; a completed
   * checkout navigates away, so the map's lifetime is the attempt's.
   */
  const checkoutAttempts = useRef(new Map<string, string>())

  const handleUpgrade = useCallback(
    (targetPlan: OrgPlan) => async () => {
      const dequeue = queueLoading()
      // A fresh attempt clears the last refusal: a stale "checkout is paused"
      // sitting above the cards after the lock lifted would be its own lie.
      setCheckoutLockdown(null)
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
        const attemptScope = `${orgId}:${targetPlan}:${interval}`
        const attemptKey =
          checkoutAttempts.current.get(attemptScope) ??
          (globalThis.crypto?.randomUUID?.() ??
            `${Date.now()}-${Math.random().toString(36).slice(2)}`)
        checkoutAttempts.current.set(attemptScope, attemptKey)
        const response = await fetch('/api/billing/checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Stable across a retry of THIS attempt (AGL-1697), so a
            // double-click cannot open two subscription checkouts.
            'Idempotency-Key': attemptKey,
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          // The browser's GA client id rides along so the SERVER-side
          // `purchase` from the Stripe webhook can be attributed to the
          // session — and therefore the campaign — that produced it
          // (AGL-1561). Resolves to null within 500ms when gtag is absent,
          // so it can never delay a checkout.
          body: JSON.stringify({
            plan: targetPlan,
            interval,
            orgId,
            gaClientId: await readGaClientId(
              process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
            ),
          }),
        })
        const payload = await response.json()
        // A checkout feature lockdown (AGL-1510/1532). This branch comes
        // first and it is the one that matters most on this page: "Could
        // not start checkout" tells a customer their PAYMENT failed, and a
        // customer who believes that retries, panics, then emails support.
        // The server's body says the opposite in so many words — render it.
        const locked = parseLockdownRefusal(response.status, payload)
        if (locked) {
          // Inline and persistent rather than a toast (AGL-1558): the whole
          // notice — message, expected-back line, and the `mailto:` support
          // contact the one-line flattener drops — rendered above the plan
          // cards and dismissible only by the reader.
          setCheckoutLockdown(locked)
          return
        }
        if (response.status === 501) {
          return enqueueSnackbar(
            'Billing is not configured yet — Stripe keys are pending.',
            { variant: 'info', persist: false },
          )
        }
        // In-page checkout (AGL-1132) when the route returns a client secret;
        // otherwise the unchanged redirect. The route decides — it only picks
        // embedded when the flag is on AND a publishable key is configured —
        // so the two shapes are mutually exclusive and this never has to guess.
        // GA4 checkout funnel (AGL-1561). Fired once here, after the
        // lockdown/501/error branches, so it means "Stripe actually gave us a
        // checkout to show" rather than "somebody clicked Upgrade" — the two
        // differ by exactly the refusals above, which are the interesting
        // failures. Covers both shapes: the embedded client secret and the
        // hosted redirect.
        //
        // Annual is priced per-month-billed-yearly, so the checkout VALUE is
        // twelve of them; `begin_checkout` should carry what the customer is
        // about to be charged, not a monthly rate.
        if (payload?.clientSecret || (response.ok && payload?.url)) {
          const pricing = PLAN_PRICING[targetPlan]
          const value =
            interval === 'year'
              ? (pricing?.basePriceAnnualMonthlyUsd ?? 0) * 12
              : (pricing?.basePriceMonthlyUsd ?? 0)
          // Through the shared constructor since AGL-1591, so this payload and
          // the tenant storefront's cart checkout cannot drift into two shapes
          // under one event name. `value` is derived from the item rather than
          // restated here — same number, one definition.
          trackEvent(
            'begin_checkout',
            buildBeginCheckoutParams({
              billingInterval: interval === 'year' ? 'annual' : 'monthly',
              items: [
                {
                  item_id: targetPlan,
                  item_name: PLAN_LABELS[targetPlan] ?? targetPlan,
                  item_category: 'subscription',
                  price: value,
                  quantity: 1,
                },
              ],
            }),
          )
        }
        if (payload?.clientSecret) {
          setCheckoutClientSecret(String(payload.clientSecret))
          return
        }
        // The server refused because this workspace is already subscribed
        // (AGL-1697) — the state the `subscriptionActive` branch above exists
        // to keep us out of, reached anyway by a stale tab or a second window.
        // Named rather than thrown: the catch-all below says "Could not start
        // checkout", which reads as a payment failure and is the opposite of
        // what happened. Nothing was charged; there is simply already a
        // subscription, and the page reloads onto it.
        if (response.status === 409 && payload?.code === 'subscription_exists') {
          return void enqueueSnackbar(
            payload.error ?? 'This workspace already has a subscription.',
            { variant: 'warning', persist: false },
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

  // Invoice history (AGL-248, AGL-534), billing.view-gated server-side.
  // Cursor-paginated; "Load more" appends older invoices.
  const [invoices, setInvoices] = useState<Array<{
    id: string
    number: string | null
    status: string | null
    amountDueCents: number
    totalCents: number
    currency: string
    created: string | null
    paidAt: string | null
    periodEnd: string | null
    hostedInvoiceUrl: string | null
    invoicePdf: string | null
    receiptUrl: string | null
  }> | null>(null)
  const [invoicesHasMore, setInvoicesHasMore] = useState(false)
  const [invoiceCursor, setInvoiceCursor] = useState<string | null>(null)
  const [invoicesLoading, setInvoicesLoading] = useState(false)
  const fetchInvoices = useCallback(
    async (cursor?: string | null) => {
      if (!orgId || !user) return
      setInvoicesLoading(true)
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch(
          `/api/billing/invoices?orgId=${encodeURIComponent(orgId)}` +
            (cursor ? `&startingAfter=${encodeURIComponent(cursor)}` : ''),
          { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
        )
        if (!response.ok) return
        const payload = await response.json()
        setInvoices((previous) =>
          cursor
            ? [...(previous ?? []), ...(payload.invoices ?? [])]
            : (payload.invoices ?? []),
        )
        setInvoicesHasMore(payload.hasMore === true)
        setInvoiceCursor(payload.nextCursor ?? null)
      } catch {
        // The card keeps its current state on failure.
      } finally {
        setInvoicesLoading(false)
      }
    },
    [orgId, user],
  )
  useEffect(() => {
    if (!orgId || !user || (permissionsLoaded && !can('billing.view'))) return
    void fetchInvoices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, user, permissionsLoaded])

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Billing', href: buildRoute(Route.MANAGE_BILLING, { orgSlug }) },
      ]}
      help="billing"
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
        ) : !orgReady ? (
          // AGL-1422. Of every surface in the console this is the one that
          // must not guess: `plan` below is `org?.plan ?? 'free'` and
          // `resolveOrgEntitlements(undefined)` is the free tier, so the
          // loading window renders a paying workspace its own billing page
          // saying Free, with the upgrade cards emphasized and "no
          // subscription" under Status. Hold — this page has nothing to show
          // that is not an answer about the plan.
          <Box sx={{ p: 2 }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
        <GridItems
          spacing={3}
          items={[
            {
              size: { xs: 12, md: 4 },
              children: (
                <CardDisplay
                  header={'Current plan'}
                  help={docsHelp('billing', {
                    anchor: '#tiers--entitlements',
                    excerpt:
                      'Your subscription tier and its headline limits — ' +
                      'every plan\'s full entitlements are in the docs.',
                  })}
                  contentGutterX
                  contentGutterY
                >
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', mb: 1 }}
                  >
                    <Typography variant="h5">
                      {enterprise ? ENTERPRISE_PLAN_LABEL : PLAN_LABELS[plan]}
                    </Typography>
                    <Chip
                      label={
                        enterprise && customMonthlyUsd === 0
                          ? 'comped'
                          : (org?.subscription?.status ?? 'no subscription')
                      }
                      size="small"
                      color={
                        (enterprise && customMonthlyUsd === 0) ||
                        org?.subscription?.status === 'active'
                          ? 'success'
                          : org?.subscription?.status === 'past_due'
                            ? 'warning'
                            : 'default'
                      }
                      variant="outlined"
                    />
                  </Stack>
                  {/* Plan price + headline entitlements (AGL-367). Enterprise
                      shows its negotiated custom price, not the base list
                      price (AGL-1110). */}
                  {enterprise ? (
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      {customMonthlyUsd > 0
                        ? `$${customMonthlyUsd.toLocaleString()}/mo · custom` +
                          `${org?.subscription?.interval === 'year' ? ' (billed yearly)' : ''}`
                        : 'Comped — internal use, no charge'}
                    </Typography>
                  ) : PLAN_PRICING[plan]?.basePriceMonthlyUsd ? (
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
                      `${fmtLimit(resolved.hostLimit)} sites`,
                      `${fmtLimit(resolved.managersPerOrg)} team seats`,
                      // Campaign sends, and only those (AGL-1438) — the cap
                      // does not apply to transactional mail, so the chip must
                      // not read as though it does.
                      `${fmtLimit(resolved.emailSendsPerMonth)} campaign emails/mo`,
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
                        color="primary"
                        onClick={() => void handleOpenPortal()}
                      >
                        {'Manage payment methods'}
                      </Button>
                      {subscriptionActive ? (
                        // Cancel/downgrade flow (AGL-269).
                        <Button
                          size="small"
                          color={cancelAtPeriodEnd ? 'primary' : 'error'}
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
                      {`Plan add-ons: ${Object.entries(org.seatAddons)
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
                <CardDisplay
                  header={'Usage'}
                  help={docsHelp('billing', {
                    anchor: '#usage-meters',
                    excerpt:
                      'Live meters for sites, storage, bandwidth, and ' +
                      'campaign email sends against your plan\'s quotas. ' +
                      'Transactional mail is counted but never capped.',
                  })}
                  contentGutterX
                  contentGutterY
                >
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
                  help={docsHelp('billing', {
                    anchor: '#usage-meters',
                    excerpt:
                      'A cost estimate for metered overages this period, ' +
                      'based on current usage across your sites.',
                  })}
                  contentGutterX
                  contentGutterY
                >
                  <BillingMeteredEstimateComponent
                    org={org}
                    hosts={hosts ?? []}
                  />
                </CardDisplay>
              ),
            },
            {
              size: { xs: 12, md: 8 },
              children: (
                <CardDisplay
                  header={'Billing history'}
                  help={docsHelp('billing', {
                    anchor: '#payments',
                    excerpt:
                      'Invoices from Stripe with status and amounts, plus ' +
                      'links to the hosted invoice, PDF, and receipt.',
                  })}
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
                    <>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>{'Invoice'}</TableCell>
                            <TableCell>{'Date'}</TableCell>
                            <TableCell>{'Status'}</TableCell>
                            <TableCell>{'Amount'}</TableCell>
                            <TableCell align="right">{'Documents'}</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {invoices.map((invoice) => (
                            <TableRow key={invoice.id}>
                              <TableCell>
                                {invoice.number ?? invoice.id}
                              </TableCell>
                              <TableCell>
                                {invoice.created
                                  ? new Date(
                                      invoice.created,
                                    ).toLocaleDateString()
                                  : '—'}
                              </TableCell>
                              <TableCell>
                                <Chip
                                  label={invoice.status ?? '—'}
                                  size="small"
                                  variant="outlined"
                                  color={
                                    invoice.status === 'paid'
                                      ? 'success'
                                      : invoice.status === 'open'
                                        ? 'warning'
                                        : 'default'
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                {`$${(invoice.totalCents / 100).toFixed(2)} ${invoice.currency.toUpperCase()}`}
                              </TableCell>
                              <TableCell align="right">
                                <Stack
                                  direction="row"
                                  spacing={1.5}
                                  sx={{ justifyContent: 'flex-end' }}
                                >
                                  {invoice.hostedInvoiceUrl ? (
                                    <Link
                                      href={invoice.hostedInvoiceUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      variant="body2"
                                    >
                                      {'View'}
                                    </Link>
                                  ) : null}
                                  {invoice.invoicePdf ? (
                                    <Link
                                      href={invoice.invoicePdf}
                                      variant="body2"
                                    >
                                      {'PDF'}
                                    </Link>
                                  ) : null}
                                  {invoice.receiptUrl ? (
                                    <Link
                                      href={invoice.receiptUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      variant="body2"
                                    >
                                      {'Receipt'}
                                    </Link>
                                  ) : null}
                                </Stack>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {invoicesHasMore ? (
                        <Box sx={{ textAlign: 'center', mt: 1 }}>
                          <Button
                            size="small"
                            color="primary"
                            disabled={invoicesLoading}
                            onClick={() => void fetchInvoices(invoiceCursor)}
                          >
                            {invoicesLoading
                              ? 'Loading…'
                              : 'Load older invoices'}
                          </Button>
                        </Box>
                      ) : null}
                    </>
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
                        header={'Plan add-ons'}
                        help={docsHelp('addOns', {
                          anchor: '#what-you-can-add',
                        })}
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
            // The checkout lockdown notice sits directly above the cards
            // whose buttons produced it (AGL-1558) — the one place a customer
            // who just pressed Upgrade is already looking.
            ...(checkoutLockdown
              ? [{
                  size: { xs: 12 },
                  children: (
                    <LockdownNotice
                      notice={checkoutLockdown}
                      onClose={() => setCheckoutLockdown(null)}
                    />
                  ),
                }]
              : []),
            {
              size: { xs: 12 },
              children: (
                <BillingPlanCardsComponent
                  plan={org?.plan as OrgPlan | undefined}
                  interval={interval}
                  enterprise={enterprise}
                  highlight={planIntent?.plan}
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
        {/* In-page checkout (AGL-1132). Renders nothing unless the route
            handed back a client secret, so on the redirect path — which is
            still the default — this costs a null. */}
        <EmbeddedCheckoutDialogComponent
          clientSecret={checkoutClientSecret}
          onClose={() => setCheckoutClientSecret(null)}
        />
      </Container>
    </DashboardLayout>
  )
}

const Billing: NextPageWithLayout<Record<string, never>> = () => {
  return <BillingContent />
}
Billing.displayName = 'Page:Billing'

export default Billing
