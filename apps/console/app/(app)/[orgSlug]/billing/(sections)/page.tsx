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
  trackEventBeforeNavigation,
} from '@aglyn/aglyn/app-utils/analytics-events'
import { readInternalTrafficOverride } from '@aglyn/aglyn/app-utils/internal-traffic'
import {
  ENTERPRISE_PLAN_LABEL,
  isEnterpriseOrg,
  isLiveSubscriptionStatus,
  mergeOrgBillingOverOrg,
  ORG_BILLING_DOC_ID,
  ORG_BILLING_SUBCOLLECTION,
  parseLockdownRefusal,
  parseOnboardingPlanIntent,
  PLAN_PRICING,
  resolveOrgEntitlements,
  UNLIMITED,
  type AglynOrgBilling,
  type LockdownRefusalNotice,
  type OrgPlan,
} from '@aglyn/aglyn'
import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import {
  AppLink,
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
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { overLimitSummary as computeOverLimitSummary } from '../../../../../utils/over-limit-summary'
import { stripeOtherModeInvoiceNotice } from '../../../../../utils/stripe-mode-notice'
import BillingAddonsCardComponent, {
  ADDON_LABELS,
} from '../../../../../components/billing/billing-addons-card.component'
import BillingPlanCardsComponent, {
  PLAN_LABELS,
} from '../../../../../components/billing/billing-plan-cards.component'
import BillingRegisterAllocationsCardComponent from '../../../../../components/billing/billing-register-allocations-card.component'
import BillingCollaboratorAllocationsCardComponent from '../../../../../components/billing/billing-collaborator-allocations-card.component'
import BillingStorageOverageCardComponent from '../../../../../components/billing/billing-storage-overage-card.component'
import BillingUsageBudgetCardComponent from '../../../../../components/billing/billing-usage-budget-card.component'
import BillingMeteredEstimateComponent from '../../../../../components/billing/billing-metered-estimate.component'
import BillingUsageHistoryComponent from '../../../../../components/billing/billing-usage-history.component'
import { RetentionFunnelDialog } from '../../../../../components/billing/retention-funnel.dialog'
import BillingUsageComponent from '../../../../../components/billing/billing-usage.component'
import BillingEmailCardComponent from '../../../../../components/billing/billing-email-card.component'
import BillingPaymentMethodsCardComponent from '../../../../../components/billing/billing-payment-methods-card.component'
import BillingAddressCardComponent from '../../../../../components/billing/billing-address-card.component'
import BillingTaxIdCardComponent from '../../../../../components/billing/billing-tax-id-card.component'
import BillingOpenInvoicesCardComponent from '../../../../../components/billing/billing-open-invoices-card.component'
import BillingPlanQuoteComponent from '../../../../../components/billing/billing-plan-quote.component'
import { useBillingProfile } from '../../../../../components/billing/use-billing-profile'
import { getBrowserStripe } from '../../../../../utils/browser-stripe'
import { prorationQuote } from '../../../../../utils/proration-quote'
import { subscriptionPeriodNotice } from '../../../../../utils/subscription-period-notice'
import CardColumns from '../../../../../components/card-columns.component'
import {
  clearSubscribeCheckoutPending,
  markSubscribeCheckoutPending,
  reportPlatformAdConversion,
  subscribeCheckoutPending,
} from '@aglyn/aglyn/app-utils/platform-ad-conversions'
import { platformAdvertisingAllowed } from '@aglyn/aglyn/app-utils/platform-visitor-consent'
import LockdownNotice from '../../../../../components/lockdown-notice.component'
import { useReleaseFlag } from '../../../../../hooks/use-release-flags'
import { docsHelp } from '../../../../../constants/docs-links'
import AuthenticatedLayout from '../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../components/layouts/main.layout'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { useOrgSlug } from '../../../../../hooks/use-org-scope'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import { useOrgHosts } from '../../../../../hooks/use-org-hosts'
import useCurrentOrg from '../../../../../hooks/use-current-org'
import useConfirmedDoc from '../../../../../hooks/use-confirmed-doc'
import useOrgPermissions from '../../../../../hooks/use-org-permissions'


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
  // NOT a plain spread (AGL-1991). `useConfirmedDoc` stamps the document id
  // into its payload, so `orgBilling.$id` is the literal `'stripe'`; spreading
  // it second made the merged `org.$id` `'stripe'` and every child deriving an
  // org id from this object read `orgs/stripe/…` — denied, which is what left
  // the metered estimate card stuck on "Calculating…" on every org.
  const org = useMemo(
    () => mergeOrgBillingOverOrg(orgDoc as Record<string, unknown>, orgBilling),
    [orgDoc, orgBilling],
  )
  const {
    permissions,
    can,
    loaded: permissionsLoaded,
    errored: permissionsErrored,
  } = useOrgPermissions()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { confirm } = useConfirmationContext()
  // ONE read of the org's Stripe billing identity, shared by the four native
  // settings cards below. Held here rather than fetched per card so
  // a save in any of them refreshes all four — and so the four never render
  // four different copies of the same customer.
  //
  // Gated on the same permission the page itself is gated on, and on that
  // permission having actually LOADED: `useOrgPermissions` fails open while in
  // flight, so firing the read on an unloaded `can()` would send a billing
  // request for every visitor before we know whether they may make one.
  const billingProfile = useBillingProfile(
    orgId,
    permissionsLoaded && can('billing.view'),
  )

  /**
   * Why this workspace cannot subscribe yet, or null when it can.
   *
   * The order the customer walks is payment method → billing address → plan,
   * so the plan grid has to say which of the first two is missing rather than
   * offering a button whose only outcome is a 409. Both are cards on this same
   * page, directly above the grid.
   *
   * Deliberately null while the profile is still loading or could not be read:
   * an unknown is not a refusal, and blocking Upgrade on a fetch that has not
   * landed would accuse a fully set-up workspace of being incomplete.
   */
  const subscribeBlockedReason = useMemo(() => {
    if (billingProfile.loadState !== 'loaded') return null
    const profile = billingProfile.state
    if (!profile) return null
    const hasCard = (profile.paymentMethods ?? []).length > 0
    const hasAddress = Boolean(profile.customer?.address?.country)
    if (!hasCard && !hasAddress) {
      return 'Add a payment method and a billing address above first.'
    }
    if (!hasCard) return 'Add a payment method above first.'
    if (!hasAddress) {
      return 'Add a billing address above first — sales tax is calculated from it.'
    }
    return null
  }, [billingProfile.loadState, billingProfile.state])
  // Annual billing (AGL-269): checkout maps to the *_YEARLY price ids.
  const [interval, setInterval] = useState<'month' | 'year'>('month')
  // Non-null while an in-page checkout is open (AGL-1132). Null is both the
  // closed state and the state on every deploy where the route chose the
  // redirect instead, so nothing here has to know which mode is live.
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
  //
  // ASK THE PARSER, do not re-derive it (AGL-1864). This was
  // `Boolean(searchParams?.get('interval'))`, which reads "the param was
  // present" where the intent means "the param said something we understood".
  // `OnboardingPlanIntent.intervalStated` is the model's own answer and its
  // docblock names this page as the reader that honours it — the two disagree
  // on exactly the links that are broken:
  //
  //   - `?interval=yearly` / `?interval=monthly` / `?interval=decade` — junk
  //     the parser refuses (only `month`, `year`, `annual` are known). It
  //     falls back to the safe 'month' AND flags `intervalStated: false` so a
  //     reader can tell that apart from a real statement. The old expression
  //     saw a non-empty string, called it stated, and pushed the toggle to
  //     monthly — so an ANNUAL org following a mis-serialized link had every
  //     card re-quoted at the monthly price and, because `interval` is what
  //     `handleUpgrade` posts, an Upgrade from that page would have moved them
  //     off the annual billing they were already on.
  //   - `?plan=enterprise&interval=year` — a custom-priced plan, for which the
  //     parser returns `interval: 'month', intervalStated: false` because
  //     Enterprise is quoted rather than bought. The old expression flipped an
  //     annual org to monthly off a link that said the word "year".
  //
  // The console half of AGL-1989: whichever interval the visitor was quoted,
  // the console must not be the hop that loses it. No price moved here — this
  // only decides which of the two already-published prices is on screen.
  const intervalStated = planIntent?.intervalStated === true

  /**
   * The plan the quote prices.
   *
   * The one the visitor arrived intending, which is also the one the grid
   * emphasizes — so the total on screen belongs to the card they are looking
   * at. Null when nothing is being considered, and the quote renders nothing
   * rather than pricing a plan nobody asked about: the preview is a Stripe
   * call, and making it on every billing page view would be a read nobody
   * requested.
   */
  const quotedPlan = planIntent?.plan ?? null

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
  /**
   * Report a subscribe conversion whose checkout completed in a tab that is
   * gone (AGL-1152).
   *
   * Stripe's `onComplete` is the only moment in the page that knows a
   * subscription was paid for, and a visitor can close the confirmation on it.
   * The conversion cannot move to the webhook — an Ads website conversion is
   * matched to the ad click through the GCLID the tag holds, which no server
   * has — so the repair is here: the checkout marked itself pending when it
   * opened, and a live subscription on a later visit is the proof it went
   * through.
   *
   * ⚠️ Narrow ON PURPOSE. It fires only for an org that opened checkout IN
   * THIS BROWSER and has since become subscribed. Reporting for any active
   * subscription would attribute a long-standing customer's ordinary visit to
   * whatever ad they happened to click last week.
   *
   * `transaction_id` is the org, so this and `onComplete` both firing counts
   * once — which is what makes a belt-and-braces repair safe at all.
   */
  useEffect(() => {
    if (!orgId || !subscriptionActive) return
    if (!subscribeCheckoutPending(orgId)) return
    reportPlatformAdConversion('subscribe', platformAdvertisingAllowed(), {
      transactionId: orgId,
    })
    clearSubscribeCheckoutPending()
  }, [orgId, subscriptionActive])

  const cancelAtPeriodEnd =
    (org?.subscription as any)?.cancelAtPeriodEnd === true
  /**
   * The one sentence the plan card says about the billing period.
   *
   * Derived rather than composed on the card: the old version rendered a
   * "cancels at period end" chip and a hardcoded "Renews {date}" line
   * independently, so a cancelling subscription claimed both at once.
   */
  const periodNotice = useMemo(
    () =>
      subscriptionPeriodNotice({
        status: (org?.subscription as any)?.status,
        cancelAtPeriodEnd: (org?.subscription as any)?.cancelAtPeriodEnd,
        currentPeriodEnd: (org?.subscription as any)?.currentPeriodEnd,
      }),
    [org?.subscription],
  )
  /**
   * A downgrade waiting for the period end (AGL-1862). The type's doc comment
   * has always claimed this is "the mirror the billing page renders" — it was
   * written by the server and read by nothing, so an org that scheduled a
   * downgrade saw a plan card identical to one that had not. Rendered below,
   * with the undo beside it.
   */
  const pendingDowngrade = (org?.subscription as any)?.pendingDowngrade ?? null
  // The retention funnel owns the leave path now (AGL-1863).
  const [funnelOpen, setFunnelOpen] = useState(false)
  const [funnelImpact, setFunnelImpact] = useState<string[]>([])

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
  // they'll be over before confirming.
  //
  // The computation moved to `utils/over-limit-summary` (AGL-2154) so the
  // retention funnel's downsell and the org-deletion downsell can state the
  // same thing. It already took the target plan as a parameter — the funnel
  // simply never called it. `siteCount` is passed explicitly here because this
  // page already has the host list loaded; the shared helper counts it itself
  // for callers that do not.
  const overLimitSummary = useCallback(
    (targetPlan: OrgPlan): Promise<string[]> =>
      computeOverLimitSummary({
        firestore,
        user: user as never,
        orgId,
        targetPlan,
        siteCount: hosts?.length ?? 0,
      }),
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

  /**
   * Cancel/resume (AGL-269), asymmetric by design (AGL-1859).
   *
   * Canceling opens the retention funnel — survey, downsell, winback, and
   * only then the cancel (AGL-1863). RESUMING stays one click: friction
   * belongs on the way out, never on the way back in.
   *
   * The over-limit impact (AGL-483) is computed here, before the funnel
   * opens, and handed to its final step. The single pre-funnel confirm used
   * to carry that warning, and moving the decision without moving the
   * warning would have dropped it silently.
   */
  const openCancelFunnel = useCallback(async () => {
    setFunnelImpact(await overLimitSummary('free'))
    setFunnelOpen(true)
  }, [overLimitSummary])

  const handleCancelToggle = useCallback(async () => {
    if (!cancelAtPeriodEnd) {
      await openCancelFunnel()
      return
    }
    const dequeue = queueLoading()
    try {
      const payload = await subscriptionRequest({ action: 'resume' })
      if (payload) {
        enqueueSnackbar('Subscription resumed', {
          variant: 'success',
          persist: false,
        })
      }
    } finally {
      dequeue()
    }
  }, [
    cancelAtPeriodEnd,
    openCancelFunnel,
    subscriptionRequest,
    queueLoading,
    enqueueSnackbar,
  ])

  /**
   * The funnel ran to the end. The `funnelId` rides along so the cancel is
   * recorded against the survey that was actually answered instead of as a
   * skip.
   */
  const handleFunnelLeave = useCallback(
    async (funnelId: string | null) => {
      const dequeue = queueLoading()
      try {
        const payload = await subscriptionRequest({
          action: 'cancel',
          ...(funnelId ? { funnelId } : {}),
        })
        if (payload) {
          enqueueSnackbar(
            `Subscription cancels ${
              payload.currentPeriodEnd
                ? new Date(payload.currentPeriodEnd).toLocaleDateString()
                : 'at period end'
            }`,
            { variant: 'success', persist: false },
          )
        }
      } finally {
        dequeue()
      }
    },
    [subscriptionRequest, queueLoading, enqueueSnackbar],
  )

  /**
   * The downsell was accepted — a plan switch DOWN, so the server schedules
   * it for the period end (AGL-1862) rather than re-pricing today. Said in
   * those words, because "switched to Starter" would be a lie about a plan
   * that does not change for another three weeks.
   */
  const handleFunnelDownsell = useCallback(
    async (targetPlan: OrgPlan) => {
      const dequeue = queueLoading()
      try {
        const switched = await subscriptionRequest({
          action: 'switch',
          plan: targetPlan,
          interval,
        })
        if (!switched) return false
        enqueueSnackbar(
          switched.scheduled && switched.effectiveAt
            ? `Moving to ${targetPlan} on ${new Date(
                switched.effectiveAt,
              ).toLocaleDateString()} — you keep your current plan until then.`
            : `Plan switched to ${targetPlan}`,
          { variant: 'success', persist: false },
        )
        return true
      } finally {
        dequeue()
      }
    },
    [subscriptionRequest, interval, queueLoading, enqueueSnackbar],
  )

  /**
   * "Keep my plan" — the undo for a pending downgrade. Switching to the plan
   * you are already on releases the schedule server-side (AGL-1862); without
   * a visible control for it, the only way back was to notice the chip and
   * guess.
   */
  /**
   * Release a scheduled downgrade by restating the plan the org is ALREADY on.
   *
   * ⚠️ The interval is the SUBSCRIPTION's, never the page's toggle.
   *
   * It used to send `interval` — the monthly/annual switch above the grid,
   * which exists so a customer can compare prices. Flipping it to look at
   * annual and then pressing this button fell through to the instant switch
   * and re-priced the plan, the add-ons and the metered item onto the other
   * interval with prorations, while the snackbar said the plan was staying
   * put. A month→year flip is a year's charge from the one control whose
   * entire job is to change nothing.
   *
   * When the mirrored interval is unknown the field is omitted rather than
   * guessed, so the server keeps whatever the subscription already has:
   * defaulting to either value here would be the same bug with better odds.
   */
  const handleKeepCurrentPlan = useCallback(async () => {
    if (!org?.plan) return
    const liveInterval = (org?.subscription as any)?.interval as
      | 'month'
      | 'year'
      | undefined
    const dequeue = queueLoading()
    try {
      const payload = await subscriptionRequest({
        action: 'switch',
        plan: org.plan,
        ...(liveInterval ? { interval: liveInterval } : {}),
      })
      if (payload) {
        enqueueSnackbar('Your current plan is staying put.', {
          variant: 'success',
          persist: false,
        })
      }
    } finally {
      dequeue()
    }
  }, [
    org?.plan,
    org?.subscription,
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
        // Moving to Free is a CANCEL, not a switch (AGL-2156). There is no
        // Free price to check out or switch to — the server says so in as many
        // words now — and for a subscriber it is the cheapest save the
        // retention funnel has, so the grid's Free card lands in the funnel
        // rather than on a disabled button that said "No credit card
        // required" to somebody already paying.
        if (targetPlan === 'free' && subscriptionActive) {
          dequeue()
          if (cancelAtPeriodEnd) {
            // Already on the way out: opening the funnel again would ask them
            // to cancel something that is already canceled.
            enqueueSnackbar(
              'Your subscription already ends at the period end — this ' +
                'organization moves to Free then.',
              { variant: 'info', persist: false },
            )
            return
          }
          await openCancelFunnel()
          return
        }
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
          // A downgrade and an upgrade are not the same sentence (AGL-1862).
          // The server already treats them differently — nothing is charged
          // today and the move lands at the period end — so the confirm has
          // to SAY that, or the customer clicks expecting an immediate
          // change and a refund, and gets neither.
          const effective = preview.periodEnd
            ? new Date(preview.periodEnd).toLocaleDateString()
            : 'the end of your billing period'
          const accepted = await confirm({
            title: preview.downgrade
              ? `Move down to ${targetPlan}?`
              : `Switch to ${targetPlan}?`,
            description:
              (preview.downgrade
                ? `Nothing is charged today, and nothing changes yet. You ` +
                  `keep ${org?.plan} — and everything you've already paid ` +
                  `for — until ${effective}, when this organization moves ` +
                  `to ${targetPlan}. You can keep your current plan any ` +
                  `time before then.`
                : prorationQuote(preview, effective)) +
              // A pending cancel and a pending plan change cannot both stand
              // (AGL-2151). The server clears the cancellation as part of this
              // operation — a customer picking a smaller plan is trying to
              // STAY — so the confirm has to say so before they click, or the
              // cancellation they scheduled disappears without anyone telling
              // them.
              (cancelAtPeriodEnd
                ? ` This also cancels your scheduled cancellation: the ` +
                  `subscription continues on ${targetPlan} instead of ` +
                  `ending. You can cancel again at any time.`
                : '') +
              (over.length
                ? ` Heads up — you'll be over the ${targetPlan} plan on: ` +
                  `${over.join('; ')}. Nothing is deleted and these keep ` +
                  "working, but you can't add more until you're back under " +
                  'the limit.'
                : ''),
            confirmationText: preview.downgrade
              ? 'Schedule the move down'
              : 'Switch plan',
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
            // The plan change, REPORTED (AGL-2235, under AGL-1859 §4).
            //
            // The four retention events all fire from the funnel dialog and
            // from nowhere else, so the identical move made here — Downgrade
            // on the plan card — was invisible, and `downsell_accepted` read
            // as a total while being a fraction. Emitted from the SERVER's
            // answer, never the client's intent: a switch the route refused
            // returns null above and is not counted, and the effective date
            // is the one Stripe actually scheduled.
            //
            // `preview.downgrade` is the classification the same server made
            // a moment ago, rather than a second ladder comparison here that
            // could disagree with it.
            if (preview.downgrade) {
              trackEvent('plan_downgrade_scheduled', {
                from_plan: String(org?.plan ?? ''),
                to_plan: targetPlan,
                interval,
                ...(switched.effectiveAt
                  ? { effective_at: String(switched.effectiveAt) }
                  : {}),
              })
            } else {
              trackEvent('plan_upgraded', {
                from_plan: String(org?.plan ?? ''),
                to_plan: targetPlan,
                interval,
              })
            }
            // A scheduled downgrade has not switched anything yet; saying so
            // is the difference between a customer who understands their
            // bill and one who opens a ticket about it.
            enqueueSnackbar(
              switched.scheduled && switched.effectiveAt
                ? `Moving to ${targetPlan} on ${new Date(
                    switched.effectiveAt,
                  ).toLocaleDateString()} — you keep your current plan until then.`
                : `Plan switched to ${targetPlan}`,
              { variant: 'success', persist: false },
            )
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
            // And whether this browser is one of OURS (AGL-1582). The stamp
            // that keeps our own sessions out of the reports rides
            // `setDefaultEventParameters` and a `gtag('set')` snippet — both
            // browser mechanisms — so the server-side `purchase` the webhook
            // sends from a Stripe event, hours later and in another process,
            // was the one hit the internal-traffic filter could never reach.
            // The last week before launch is a scheduled run of REAL paid
            // transactions, and a data filter is not retroactive.
            //
            // Read synchronously from localStorage, so unlike `gaClientId` it
            // cannot be lost to a slow tag.
            internalTraffic: readInternalTrafficOverride(),
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
        // The workspace is not ready to subscribe yet (AGL-1697's 409 gained
        // two siblings). None of these is a payment failure: they name a card
        // that is missing from the same page, above this grid.
        if (response.status === 409) {
          return void enqueueSnackbar(
            payload?.error ?? 'This workspace cannot subscribe yet.',
            { variant: 'warning', persist: false },
          )
        }
        if (!response.ok) {
          throw new Error(payload?.error ?? 'Subscription failed')
        }
        // GA4 checkout funnel (AGL-1561). Fired after the lockdown/501/refusal
        // branches, so it means "Stripe actually opened the subscription"
        // rather than "somebody clicked Upgrade" — the two differ by exactly
        // the refusals above, which are the interesting failures.
        //
        // Annual is priced per-month-billed-yearly, so the VALUE is twelve of
        // them; `begin_checkout` should carry what the customer is about to be
        // charged, not a monthly rate.
        const pricing = PLAN_PRICING[targetPlan]
        const value =
          interval === 'year'
            ? (pricing?.basePriceAnnualMonthlyUsd ?? 0) * 12
            : (pricing?.basePriceMonthlyUsd ?? 0)
        // Through the shared constructor since AGL-1591, so this payload and
        // the tenant storefront's cart checkout cannot drift into two shapes
        // under one event name.
        void trackEvent(
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
        // Remember the attempt: the Ads conversion can only be reported from
        // this browser, and this is the last moment guaranteed to run.
        // `transaction_id` is the org, so this and any later repair count
        // once — unchanged by dropping Checkout, because the de-duplication
        // was always the id and never the container.
        markSubscribeCheckoutPending(orgId ?? '')

        // A card the issuer wants authenticated. The ONLY Stripe-rendered step
        // left in this flow, and it belongs to the bank: `handleNextAction`
        // shows the challenge and returns.
        //
        // That method, and not `confirmPayment`: checkout confirms the
        // subscription's intent server-side and reports `requiresAction` only
        // when Stripe answers `requires_action`, which is the single status
        // `handleNextAction` is defined for. `confirmPayment` confirms an
        // intent from Payment Element data or an explicit
        // `confirmParams.payment_method`, and this flow has neither — the card
        // is the one already on the customer.
        //
        // Handled here rather than left to the webhook because a subscription
        // stuck at `incomplete` is a customer who believes they subscribed and
        // did not — the webhook mirrors whatever Stripe reports, and what
        // Stripe reports until this runs is "not paid".
        if (payload?.requiresAction && payload?.paymentClientSecret) {
          const stripe = await getBrowserStripe()
          if (!stripe) {
            return void enqueueSnackbar(
              'Your bank needs to confirm this payment, but the payment ' +
                'library could not load. Nothing has been charged.',
              { variant: 'warning', persist: false },
            )
          }
          const outcome = await stripe.handleNextAction({
            clientSecret: String(payload.paymentClientSecret),
          })
          if (outcome.error) {
            return void enqueueSnackbar(
              outcome.error.message ??
                'Your bank did not confirm the payment. Nothing has been charged.',
              { variant: 'warning', persist: false },
            )
          }
        }
        if (payload?.declined) {
          return void enqueueSnackbar(
            'Your saved card was declined. Add another payment method and ' +
              'try again — nothing has been charged.',
            { variant: 'warning', persist: false },
          )
        }
        enqueueSnackbar(
          `You are on ${PLAN_LABELS[targetPlan] ?? targetPlan}. Your ` +
            'workspace updates as soon as Stripe confirms the payment.',
          { variant: 'success', persist: false },
        )
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
      cancelAtPeriodEnd,
      openCancelFunnel,
      org?.plan,
      overLimitSummary,
      subscriptionRequest,
      confirm,
      queueLoading,
      enqueueSnackbar,
    ],
  )


  // The AGL-1422 hold, kept HERE and not only in the layout.
  //
  // The layout holds on `billing.view` and on the org read for every section.
  // This is the section that reads `org.plan`, and `plan` defaults to `free`
  // while that read is in flight — so rendering early shows a paying
  // workspace its own billing page saying Free, with the upgrade cards
  // emphasized and no subscription under Status.
  //
  // Duplicating a HOLD is safe in a way duplicating a grant never is: the
  // worst case is a spinner that was not needed. The layout's copy protects
  // the sections that do not read the plan; this one protects the invariant
  // where it actually lives, so a future refactor of the layout cannot take
  // it away silently.
  if (!orgReady) {
    return (
      <Box sx={{ p: 2 }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  return (
    <>
        <GridItems
          spacing={3}
          // Masonry. These cards have wildly different
          // heights — `Usage` runs three times `Current plan` — and in a rigid
          // twelve-column row that meant a screen of dead space under
          // `Current plan` while `Metered usage estimate`, the card sized to
          // fill it, sat on its own row far below. Masonry lets each card
          // occupy only the height it needs and the next one back-fill.
          masonry
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
                  {/* A scheduled downgrade (AGL-1862) was invisible here
                      until now, so the plan card looked identical whether or
                      not the org was dropping a tier at renewal. */}
                  {pendingDowngrade?.plan ? (
                    <Chip
                      label={`moves to ${pendingDowngrade.plan}${
                        pendingDowngrade.effectiveAt
                          ? ` on ${new Date(
                              pendingDowngrade.effectiveAt,
                            ).toLocaleDateString()}`
                          : ' at period end'
                      }`}
                      size="small"
                      color="warning"
                      sx={{ mt: 1 }}
                    />
                  ) : null}
                  {/* ONE sentence about the billing period (AGL-248).
                      Previously three fragments — a "cancels at period end"
                      chip and a hardcoded "Renews {date}" — which contradicted
                      each other whenever a subscription was set to cancel.
                      The truth table is in `subscriptionPeriodNotice`. */}
                  {periodNotice.sentence ? (
                    <Typography
                      variant="caption"
                      color={
                        periodNotice.kind === 'renewing'
                          ? 'text.secondary'
                          : 'warning.main'
                      }
                      sx={{ display: 'block', mt: 1 }}
                    >
                      {periodNotice.sentence}
                    </Typography>
                  ) : null}
                  {can('billing.manage') ? (
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ mt: 1.5, flexWrap: 'wrap', gap: 1 }}
                    >
                      {/*
                        A button that says "manage payment methods" goes to
                        the surface that manages payment methods. It opened
                        the Stripe Billing Portal — a different product, in a
                        new tab — because the portal used to be the only place
                        a card could be changed. It is not: the Settings
                        section has the cards, in our own design, and the
                        portal stays reachable from Outstanding where dunning
                        recovery actually needs it. One button was doing two
                        jobs; this is the one it is named after.
                      */}
                      <AppLink
                        componentVariant="button"
                        size="small"
                        variant="outlined"
                        color="primary"
                        href={buildRoute(Route.MANAGE_BILLING_SETTINGS, {
                          orgSlug,
                        })}
                      >
                        {'Manage payment methods'}
                      </AppLink>
                      {/* The undo for a scheduled downgrade (AGL-1862):
                          switching to the plan you are already on releases
                          the schedule. Prominent and one click, because it
                          is the RETAINING action. */}
                      {pendingDowngrade?.plan ? (
                        <Button
                          size="small"
                          variant="contained"
                          color="primary"
                          onClick={() => void handleKeepCurrentPlan()}
                        >
                          {'Keep my current plan'}
                        </Button>
                      ) : null}
                      {subscriptionActive ? (
                        // Cancel opens the retention funnel (AGL-1863);
                        // resume stays one click.
                        <Button
                          size="small"
                          color={cancelAtPeriodEnd ? 'primary' : 'error'}
                          variant={cancelAtPeriodEnd ? 'contained' : 'text'}
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
              // `md: 8` beside `Current plan`'s `md: 4`, which is what makes
              // the top band tile. It was inside the full-width `CardColumns`
              // band below, so `Current plan` sat alone in a band of its own
              // with two thirds of the row dead beside it — the exact hole
              // masonry was added to close.
              size: { xs: 12, md: 8 },
              children: (
                      
                            // ALSO on the Invoices section, deliberately. A
                            // customer arriving from a dunning email is signed
                            // out, lands on the org-agnostic entry and is dropped
                            // HERE — making them find a tab before they can pay is
                            // the hunting this split exists to remove. Safe to
                            // duplicate: the route re-reads the invoice from
                            // Stripe and answers `alreadyPaid` if it has been
                            // settled, whichever copy the button was pressed on.
                            <CardDisplay
                              header={'Outstanding'}
                              subheader={
                                'Anything unpaid, and the button that settles it.'
                              }
                              help={docsHelp('billing', {
                                anchor: '#outstanding',
                                excerpt:
                                  'Paying an invoice that failed, including when the subscription has already been cancelled.',
                              })}
                              contentGutterX
                              contentGutterY
                            >
                              <BillingOpenInvoicesCardComponent
                                orgId={orgId}
                                canManage={can('billing.manage')}
                                onOpenPortal={
                                  can('billing.manage')
                                    ? () => void handleOpenPortal()
                                    : undefined
                                }
                              />
                            </CardDisplay>
                      
              ),
            },
            // The quote, in the same band and only when there is a plan to
            // quote. `quotedPlan` is null on an ordinary visit — no `?plan=`
            // — and the card still rendered, so an empty "What you will pay"
            // box sat at full page width under everything. A card with a
            // header and no content reads as a thing that failed to load.
            ...(quotedPlan
              ? [{
                  size: { xs: 12, md: 8 },
                  children: (
                    <CardDisplay
                      header={'What you will pay'}
                      help={docsHelp('billing', {
                        anchor: '#plan-total',
                        excerpt:
                          'How the plan total is quoted with tax, and what a zero tax means.',
                      })}
                      subheader={
                        'The total for the plan you are looking at, tax included, ' +
                        'straight from Stripe.'
                      }
                      contentGutterX
                      contentGutterY
                    >
                      <BillingPlanQuoteComponent
                        orgId={orgId}
                        plan={quotedPlan}
                        interval={interval}
                        canManage={can('billing.manage')}
                      />
                    </CardDisplay>
                  ),
                }]
              : []),
            // BUY, then ASSIGN — as two bands in that order, not as three
            // cards the masonry flow may separate.
            //
            // `Plan add-ons` sells collaborator seats and POS registers as
            // ORG-LEVEL POOLS; the two cards under it put those seats on a
            // site. That is genuinely two acts with different permissions and
            // different consequences, so they stay two cards — but read as
            // unrelated neighbours they look like the same thing listed twice,
            // which is what the owner saw. A full-width purchase card with its
            // two assignment cards directly beneath is the shape that says
            // "these belong together" without merging them.
            ...(addonStore.visible
              ? [
                  {
                    size: { xs: 12 },
                    children: (

                            // Self-serve add-ons (AGL-529); #addons anchors the
                            // point-of-need upsell links (AGL-530).
                            <Box id="addons">
                              <CardDisplay
                                header={'Plan add-ons — buy capacity'}
                                subheader={
                                  'Everything here is bought for the whole ' +
                                  'workspace. Manager seats, datasets and ' +
                                  'extra sites apply straight away; ' +
                                  'collaborator seats and POS registers are ' +
                                  'pools you then assign to a site in the two ' +
                                  'cards below.'
                                }
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
                  },
                  {
                    size: { xs: 12 },
                    children: (
                      <CardColumns
                        spacing={3}
                        items={[
                          {
                            key: 'register-seats',
                            children: (

                            // Where purchased register seats get DEPLOYED (AGL-1947).
                            // Buying the add-on above is only half the transaction:
                            // `posRegisters` is an org-level pool since AGL-1775, and
                            // until this card existed a merchant could pay $89/mo for
                            // a seat with nowhere to put it. Directly beneath the
                            // add-on that sells it, and under the same `#addons`
                            // region the registers card and the route's own 409 both
                            // point at ("Billing → Add-ons").
                            <Box id="register-seats">
                              <CardDisplay
                                header={'POS register seats — assign to a site'}
                                subheader={
                                  'Each purchased seat lets one site run one more ' +
                                  'register. Bought under Plan add-ons above; ' +
                                  'move them between sites here at any time.'
                                }
                                help={docsHelp('addOns', {
                                  anchor: '#assigning-register-seats',
                                })}
                                contentGutterX
                                contentGutterY
                              >
                                <BillingRegisterAllocationsCardComponent
                                  orgId={orgId}
                                  canManage={can('billing.manage')}
                                />
                              </CardDisplay>
                            </Box>
                            ),
                          },
                          {
                            key: 'collaborator-seats',
                            children: (

                            // Where purchased COLLABORATOR seats get deployed
                            // (AGL-2439) — the register card's twin, on the key that
                            // never got the AGL-1775 fix. `seatAddons.members` is an
                            // org-level pool now, so buying the add-on above is again
                            // only half the transaction. Shipped in the SAME pass as
                            // the pool for exactly the reason AGL-1947 exists: a pool
                            // whose seats have nowhere to go is money taken for
                            // capacity the product gives no way to use.
                            <Box id="collaborator-seats">
                              <CardDisplay
                                header={'Site collaborator seats — assign to a site'}
                                subheader={
                                  'Each purchased seat lets one site have one more ' +
                                  'collaborator. Bought under Plan add-ons ' +
                                  'above; move them between sites here at any ' +
                                  'time.'
                                }
                                help={docsHelp('addOns', {
                                  anchor: '#assigning-collaborator-seats',
                                })}
                                contentGutterX
                                contentGutterY
                              >
                                <BillingCollaboratorAllocationsCardComponent
                                  orgId={orgId}
                                  canManage={can('billing.manage')}
                                />
                              </CardDisplay>
                            </Box>
                            ),
                          },
                        ]}
                      />
                    ),
                  },
                ]
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
                  subscribeBlockedReason={subscribeBlockedReason}
                  // The page's own defaulted value (AGL-1422), not the raw
                  // field (AGL-2156): a pre-billing workspace with no `plan`
                  // handed the grid `undefined`, which is `currentIndex = -1` —
                  // no "Current plan" chip, NO tier recommended at all, and
                  // every button reading "Upgrade", while the rest of this
                  // page said they were on Free.
                  plan={plan}
                  interval={interval}
                  enterprise={enterprise}
                  // `enterprise` says the org READS as Enterprise; the doc
                  // says what it actually holds (AGL-2297). Two of the three
                  // ways to read as Enterprise are display overlays on a lower
                  // base plan, so without this the card ticked entitlements the
                  // org does not have.
                  org={org}
                  subscriptionActive={subscriptionActive}
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

        {/* The leave path (AGL-1863): survey, downsell, winback, and only
            then the cancel. */}
        <RetentionFunnelDialog
          open={funnelOpen}
          surface="subscription_cancel"
          orgId={orgId ?? ''}
          subscriptionActive={subscriptionActive}
          impact={funnelImpact}
          // The downsell warns about the TARGET tier the same way the plan
          // grid's confirm does (AGL-2154) — the server names the plan, so the
          // summary has to be computed for it on the spot.
          downsellImpact={overLimitSummary}
          currentPlan={org?.plan as OrgPlan | undefined}
          onClose={() => setFunnelOpen(false)}
          onDownsell={handleFunnelDownsell}
          onLeave={handleFunnelLeave}
        />
    </>
  )
}

const Billing: NextPageWithLayout<Record<string, never>> = () => {
  return <BillingContent />
}
Billing.displayName = 'Page:Billing'

export default Billing
