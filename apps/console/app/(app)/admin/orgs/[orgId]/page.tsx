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
  checkDiscountMargin,
  orgMonthlyCogsUsd,
  netOfProcessorFee,
  orgSiteCount,
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  resolveOrgEntitlements,
  UNLIMITED,
} from '@aglyn/aglyn'
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { AppLink, CardDisplay, Container, GridItems } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  Link as MuiLink,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { signInWithCustomToken } from 'firebase/auth'
import {
  collection,
  doc,
  getCountFromServer,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth, useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../../../components/layouts/authenticated.layout'
import StaffOnly from '../../../../../components/staff-only.component'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import PluginWidgetSlot from '../../../../../components/plugin-widget-slot.component'
import MainLayout from '../../../../../components/layouts/main.layout'
import { docsHelp } from '../../../../../constants/docs-links'
import MediaUrlField from '../../../../../components/media-url-field.component'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import { useIsStaff } from '../../../../../hooks/use-is-staff'
import useFirestoreCollection from '../../../../../hooks/use-firestore-collection'
import useFirestoreDoc from '../../../../../hooks/use-firestore-doc'

/**
 * Read-only organization detail for staff (AGL-207/238). Support surface
 * WITHOUT session impersonation: staff read privileges render the org's
 * sites, member roster, effective entitlements, and the audit slice for
 * this org — no minted tokens, no write surface, so there is nothing to
 * lock down. Mutations stay on the audited Organizations list page.
 */
/**
 * A human label for whatever payment method is on file (AGL-940). Checkout
 * offers Link, Amazon Pay, Cash App and Klarna alongside cards, and the
 * wallet methods identify by email rather than a PAN — the card-shaped
 * label rendered "undefined •••• ---- exp --/--" for those.
 */
function describePaymentMethod(pm: {
  type: string | null
  brand: string | null
  last4: string | null
  expMonth: number | null
  expYear: number | null
  email: string | null
}): string {
  if (pm.brand && pm.last4) {
    const exp =
      pm.expMonth && pm.expYear ? ` exp ${pm.expMonth}/${pm.expYear}` : ''
    return `${pm.brand} •••• ${pm.last4}${exp}`
  }
  const label = pm.type ? pm.type.replace(/_/g, ' ') : 'payment method'
  if (pm.last4) return `${label} •••• ${pm.last4}`
  if (pm.email) return `${label} · ${pm.email}`
  return label
}

const AdminOrgDetail: NextPageWithLayout<Record<string, never>> = () => {
  const params = useParams<{ orgId?: string }>()
  const orgId = params?.orgId ?? ''
  const { data: user } = useUser()
  const firestore = useFirestore()
  const auth = useAuth()
  const { enqueueSnackbar } = useSnackbar()
  const isStaff = useIsStaff()

  const { data: org } = useFirestoreDoc<any>(
    () => doc(firestore, 'orgs', orgId || 'missing'),
    [firestore, orgId],
    { idField: '$id' },
  )
  // This month's usage rollup, for the real cost model (AGL-1134). The
  // enterprise pricing preview below used the flat per-site estimate, which
  // is the drift AGL-1134 exists to stop — and it drifts on the one screen
  // where staff decide what to charge an enterprise customer.
  const usageMonth = useMemo(() => new Date().toISOString().slice(0, 7), [])
  const { data: usageRollup } = useFirestoreDoc<any>(
    () => doc(firestore, 'orgs', orgId || 'missing', 'usage', usageMonth),
    [firestore, orgId, usageMonth],
  )
  const { data: hostDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts'),
        where('orgId', '==', orgId || 'missing'),
        limit(50),
      ),
    [firestore, orgId],
    { idField: '$id' },
  )
  const { data: memberDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'orgs', orgId || 'missing', 'members'),
        limit(100),
      ),
    [firestore, orgId],
    { idField: '$id' },
  )
  const { data: auditDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'adminAudit'),
        orderBy('at', 'desc'),
        limit(200),
      ),
    [firestore],
    { idField: '$id' },
  )
  const orgAudit = useMemo(
    () =>
      (auditDocs ?? [])
        .filter((entry: any) => String(entry.target ?? '').includes(orgId))
        .slice(0, 20),
    [auditDocs, orgId],
  )

  // Stripe billing detail (AGL-245): invoices + payment method.
  const [billing, setBilling] = useState<{
    invoices: Array<{
      id: string
      number: string | null
      status: string | null
      amountDueCents: number
      currency: string
      periodEnd: string | null
      hostedInvoiceUrl: string | null
    }>
    paymentMethod: {
      type: string | null
      brand: string | null
      last4: string | null
      expMonth: number | null
      expYear: number | null
      email: string | null
    } | null
    delinquent?: boolean
    /** False when the org never subscribed — distinct from a failed lookup. */
    hasCustomer?: boolean
    /** Set when Stripe itself errored; the lists above are then meaningless. */
    stripeError?: string
  } | null>(null)
  const [billingError, setBillingError] = useState<string | null>(null)
  useEffect(() => {
    if (!isStaff || !orgId || !user) return
    let active = true
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch(
          `/api/admin/org-billing?orgId=${encodeURIComponent(orgId)}`,
          { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
        )
        const payload = await response.json()
        if (!active) return
        if (response.status === 501) {
          setBillingError('Stripe is not configured on this deployment')
          return
        }
        if (!response.ok) {
          setBillingError(payload?.error ?? 'Billing lookup failed')
          return
        }
        setBilling(payload)
      } catch {
        if (active) setBillingError('Billing lookup failed')
      }
    })()
    return () => {
      active = false
    }
  }, [isStaff, orgId, user])

  // Staff notes (wave v5): support context that never reaches workspaces.
  const [notes, setNotes] = useState<
    Array<{
      $id: string
      text: string
      actorEmail: string | null
      createdAt: number | null
    }>
  >([])
  const [noteDraft, setNoteDraft] = useState('')
  const [noteBusy, setNoteBusy] = useState(false)
  const loadNotes = useCallback(async () => {
    const idToken = await (user as any)?.getIdToken?.()
    const response = await fetch(
      `/api/admin/org-notes?orgId=${encodeURIComponent(orgId)}`,
      { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
    )
    if (!response.ok) return
    const payload = await response.json().catch(() => ({}))
    setNotes(payload.notes ?? [])
  }, [user, orgId])
  useEffect(() => {
    if (isStaff && orgId && user) void loadNotes().catch(() => undefined)
  }, [isStaff, orgId, user, loadNotes])
  const handleAddNote = async () => {
    if (!noteDraft.trim() || noteBusy) return
    setNoteBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/admin/org-notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ orgId, text: noteDraft.trim() }),
      })
      if (response.ok) {
        setNoteDraft('')
        await loadNotes()
      }
    } catch (error) {
      console.error(error)
    } finally {
      setNoteBusy(false)
    }
  }

  // Entitlement utilization (AGL-391): actual counts against the caps.
  const [datasetCount, setDatasetCount] = useState<number | null>(null)
  useEffect(() => {
    if (!orgId) return
    let active = true
    void getCountFromServer(collection(firestore, 'orgs', orgId, 'datasets'))
      .then((snap) => {
        if (active) setDatasetCount(snap.data().count)
      })
      .catch(() => {
        if (active) setDatasetCount(null)
      })
    return () => {
      active = false
    }
  }, [firestore, orgId])
  const usageByKey = useMemo<Record<string, number>>(
    () => ({
      hostLimit: (hostDocs ?? []).length,
      managersPerOrg: (memberDocs ?? []).length,
      maxManagersPerOrg: (memberDocs ?? []).length,
      ...(datasetCount != null
        ? { datasetsPerOrg: datasetCount, maxDatasetsPerOrg: datasetCount }
        : {}),
    }),
    [hostDocs, memberDocs, datasetCount],
  )

  // Direct org editing (AGL-358): name/logo/contacts through the same
  // audited settings API org admins use (staff passes its guard).
  const [orgEdit, setOrgEdit] = useState({
    name: '',
    logoUrl: '',
    contactEmail: '',
    contactPhone: '',
    contactWebsite: '',
    // Structured (AGL-1133). Kept in step with the customer-facing Settings
    // page deliberately: both post the same `update-profile` action, so a
    // staff edit that still sent a free-text string would overwrite a
    // structured address with a blob.
    contactAddressLine1: '',
    contactAddressLine2: '',
    contactAddressCity: '',
    contactAddressState: '',
    contactAddressPostalCode: '',
    contactAddressCountry: '',
  })
  const [orgEditBusy, setOrgEditBusy] = useState(false)
  useEffect(() => {
    if (!org) return
    const address = (org.contact?.address ?? {}) as Record<
      string,
      string | undefined
    >
    setOrgEdit({
      name: String(org.name ?? ''),
      logoUrl: String(org.logoUrl ?? ''),
      contactEmail: String(org.contact?.email ?? ''),
      contactPhone: String(org.contact?.phone ?? ''),
      contactWebsite: String(org.contact?.website ?? ''),
      contactAddressLine1: String(address.line1 ?? ''),
      contactAddressLine2: String(address.line2 ?? ''),
      contactAddressCity: String(address.city ?? ''),
      contactAddressState: String(address.state ?? ''),
      contactAddressPostalCode: String(address.postalCode ?? ''),
      contactAddressCountry: String(address.country ?? ''),
    })
  }, [org])
  const handleOrgEditSave = async () => {
    if (orgEditBusy) return
    setOrgEditBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const headers = {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      }
      if (orgEdit.name.trim() && orgEdit.name.trim() !== org?.name) {
        const renamed = await fetch('/api/orgs/settings', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            orgId,
            action: 'rename',
            name: orgEdit.name.trim(),
          }),
        })
        if (!renamed.ok) throw new Error('Rename failed')
      }
      const response = await fetch('/api/orgs/settings', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          orgId,
          action: 'update-profile',
          logoUrl: orgEdit.logoUrl,
          contactEmail: orgEdit.contactEmail,
          contactPhone: orgEdit.contactPhone,
          contactWebsite: orgEdit.contactWebsite,
          contactAddressLine1: orgEdit.contactAddressLine1,
          contactAddressLine2: orgEdit.contactAddressLine2,
          contactAddressCity: orgEdit.contactAddressCity,
          contactAddressState: orgEdit.contactAddressState,
          contactAddressPostalCode: orgEdit.contactAddressPostalCode,
          contactAddressCountry: orgEdit.contactAddressCountry,
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error ?? 'Save failed')
      }
    } catch (error) {
      console.error(error)
    } finally {
      setOrgEditBusy(false)
    }
  }

  // Ownership transfer (AGL-390): staff hands the org to another member
  // via the audited settings API.
  const [transferTarget, setTransferTarget] = useState('')
  const handleTransferOwnership = async () => {
    if (!transferTarget || orgEditBusy) return
    setOrgEditBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/orgs/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          orgId,
          action: 'transfer-ownership',
          targetUid: transferTarget,
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error ?? 'Transfer failed')
      }
      setTransferTarget('')
    } catch (error) {
      console.error(error)
    } finally {
      setOrgEditBusy(false)
    }
  }

  // Org impersonation (AGL-357): staff enters the workspace as its owner
  // through the audited user-impersonation endpoint.
  const handleImpersonateOwner = async () => {
    if (!org?.ownerUid) return
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ uid: org.ownerUid }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.token) {
        return void enqueueSnackbar(payload?.error ?? 'Impersonation failed', {
          variant: 'warning',
          persist: false,
        })
      }
      // Replaces THIS browser session with the owner account; the
      // impersonation banner (claims.impersonatedBy) offers the exit.
      // Use the named-app auth instance (useAuth) — bare getAuth() resolves
      // the '[DEFAULT]' app, which this app never registers.
      await signInWithCustomToken(auth, payload.token)
      window.location.assign('/')
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Impersonation failed', { variant: 'error' })
    }
  }

  // Per-org discount (AGL-1105): staff attaches a Stripe coupon to this org's
  // subscription. Coupons come from the audited /api/admin/coupons list; the
  // net-margin rating runs for THIS org before applying.
  const [coupons, setCoupons] = useState<
    Array<{
      id: string
      name: string | null
      percentOff: number | null
      amountOffUsd: number | null
    }>
  >([])
  const [selectedCoupon, setSelectedCoupon] = useState('')
  const [discountReason, setDiscountReason] = useState('')
  const [confirmBelowFloor, setConfirmBelowFloor] = useState(false)
  const [discountBusy, setDiscountBusy] = useState(false)
  useEffect(() => {
    if (!isStaff || !user) return
    let active = true
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/admin/coupons', {
          headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
        })
        if (!response.ok) return
        const payload = await response.json().catch(() => ({}))
        if (active) setCoupons(payload.coupons ?? [])
      } catch {
        /* non-fatal — the card degrades to "no coupons" */
      }
    })()
    return () => {
      active = false
    }
  }, [isStaff, user])

  const selectedCouponObj = useMemo(
    () => coupons.find((coupon) => coupon.id === selectedCoupon) ?? null,
    [coupons, selectedCoupon],
  )
  const discountRating = useMemo(() => {
    if (!org || !selectedCouponObj) return null
    return checkDiscountMargin(org, {
      percentOff: selectedCouponObj.percentOff ?? undefined,
      amountOffUsd: selectedCouponObj.amountOffUsd ?? undefined,
    })
  }, [org, selectedCouponObj])

  const handleApplyDiscount = async () => {
    if (!selectedCoupon || discountBusy) return
    setDiscountBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/admin/org-discount', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          orgId,
          action: 'apply',
          couponId: selectedCoupon,
          reason: discountReason.trim() || undefined,
          confirmBelowFloor,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Applying the discount failed', {
          variant: 'warning',
        })
      }
      enqueueSnackbar('Discount applied', { variant: 'success' })
      setSelectedCoupon('')
      setDiscountReason('')
      setConfirmBelowFloor(false)
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Applying the discount failed', { variant: 'error' })
    } finally {
      setDiscountBusy(false)
    }
  }

  const handleRemoveDiscount = async () => {
    if (discountBusy) return
    setDiscountBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/admin/org-discount', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ orgId, action: 'remove' }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Removing the discount failed', {
          variant: 'warning',
        })
      }
      enqueueSnackbar('Discount removed', { variant: 'success' })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Removing the discount failed', { variant: 'error' })
    } finally {
      setDiscountBusy(false)
    }
  }

  // Enterprise custom billing (AGL-1110): staff sets a negotiated monthly
  // amount + base plan and provisions a Stripe subscription (net-30 invoice)
  // or a Checkout link — entirely in Aglyn, no Stripe dashboard. The webhook
  // mirrors the price onto `subscription.customMonthlyUsd` so MRR is truthful.
  // `enterprise` leads the list and is the default (AGL-1118): a negotiated
  // deal should land on the real Enterprise plan, not on Agency-plus-a-label.
  // The lower tiers stay selectable for a custom-priced deal that is genuinely
  // scoped to that tier's capability.
  const paidPlans = useMemo(
    () =>
      (
        [
          'enterprise',
          'agency',
          'advanced',
          'scale',
          'business',
          'pro',
          'starter',
        ] as const
      ).filter((plan) => PLAN_PRICING[plan]),
    [],
  )
  const [entAmount, setEntAmount] = useState('')
  const [entInterval, setEntInterval] = useState<'month' | 'year'>('month')
  const [entPlan, setEntPlan] = useState<string>('enterprise')
  const [entMode, setEntMode] = useState<'invoice' | 'checkout'>('invoice')
  const [entBusy, setEntBusy] = useState(false)
  const [entResult, setEntResult] = useState<{
    checkoutUrl?: string | null
    hostedInvoiceUrl?: string | null
    subscriptionId?: string | null
  } | null>(null)
  const entMargin = useMemo(() => {
    const amount = Number(entAmount)
    if (!(amount > 0) || !org) return null
    const net = netOfProcessorFee(amount, entInterval === 'year')
    // Measured cost, not the $2/site placeholder (AGL-1134). The flat figure
    // prices storage, page views and form submissions at nothing, and an
    // enterprise org is exactly the shape where dataset storage, API requests
    // and contacts dominate — so the margin shown here could be comfortably
    // green on a deal that loses money.
    //
    // Falls back to the per-site floor on its own when there is no rollup
    // yet, which is what a brand-new org looks like, so this never renders
    // a margin of 100% for want of data.
    const cogs = orgMonthlyCogsUsd(usageRollup, orgSiteCount(org))
    const infra = cogs.cogsUsd
    const marginPct = net > 0 ? (net - infra) / net : -1
    return { amount, net, infra, marginPct, basis: cogs.basis }
  }, [entAmount, entInterval, org, usageRollup])

  const handleProvisionEnterprise = async () => {
    const amount = Number(entAmount)
    if (!(amount > 0) || entBusy) return
    setEntBusy(true)
    setEntResult(null)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/admin/enterprise-billing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          orgId,
          amountMonthlyUsd: amount,
          interval: entInterval,
          plan: entPlan,
          mode: entMode,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Provisioning failed', {
          variant: 'warning',
        })
      }
      setEntResult(payload)
      enqueueSnackbar(
        entMode === 'checkout'
          ? 'Checkout link ready to send'
          : 'Enterprise subscription provisioned',
        { variant: 'success' },
      )
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Provisioning failed', { variant: 'error' })
    } finally {
      setEntBusy(false)
    }
  }

  const resolved = org ? resolveOrgEntitlements(org) : null
  const planDefaults = org?.plan
    ? PLAN_ENTITLEMENTS[org.plan as keyof typeof PLAN_ENTITLEMENTS]
    : null
  const formatLimit = (value: number) =>
    value === UNLIMITED ? '∞' : value.toLocaleString()

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        { children: 'Organizations', href: buildRoute(Route.ADMIN_ORGS) },
        { children: org?.name ?? orgId },
      ]}
      header={{
        children: 'Organization Detail',
        icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <>
            <Alert severity="info" sx={{ mb: 3 }}>
              {'Plan/entitlement overrides happen on the Organizations ' +
                'page; profile edits below are audited to the org ' +
                'activity log (AGL-358).'}
            </Alert>
            <GridItems
              spacing={3}
              items={[
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    <CardDisplay
                      header={'Summary'}
                      help={docsHelp('staffConsole', {
                        anchor: '#whats-there',
                        excerpt:
                          'Plan, subscription, and suspension state at a glance. Impersonating the owner replaces your session and is audited.',
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      <Stack spacing={1}>
                        <Stack direction="row" spacing={1}>
                          <Chip
                            label={org?.plan ?? 'no plan'}
                            size="small"
                            color={org?.plan ? 'secondary' : 'default'}
                          />
                          {org?.suspendedAt ? (
                            <Chip
                              label={`suspended${
                                org?.suspendedReason
                                  ? `: ${org.suspendedReason}`
                                  : ''
                              }`}
                              size="small"
                              color="error"
                            />
                          ) : null}
                          {org?.subscription?.status ? (
                            <Chip
                              label={org.subscription.status}
                              size="small"
                              variant="outlined"
                            />
                          ) : null}
                        </Stack>
                        <Typography variant="body2">
                          {org?.name ?? '—'}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontFamily: 'monospace' }}
                        >
                          {`${orgId} · ${org?.slug ?? 'no slug'}`}
                        </Typography>
                        {/* The owner uid is the one identifier on this
                            card that has a page of its own (AGL-244). */}
                        {org?.ownerUid ? (
                          <AppLink
                            variant="caption"
                            color="text.secondary"
                            underline="hover"
                            sx={{ fontFamily: 'monospace' }}
                            href={buildRoute(Route.ADMIN_USER_DETAIL, {
                              uid: org.ownerUid,
                            })}
                          >
                            {`Owner: ${org.ownerUid}`}
                          </AppLink>
                        ) : (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontFamily: 'monospace' }}
                          >
                            {'Owner: —'}
                          </Typography>
                        )}
                        <Typography variant="caption" color="text.secondary">
                          {`Stripe: ${org?.stripeCustomerId ?? '—'}`}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {`Created ${
                            org?.createdAt?.seconds
                              ? new Date(
                                  org.createdAt.seconds * 1000,
                                ).toLocaleDateString()
                              : '—'
                          }`}
                        </Typography>
                        {org?.ownerUid ? (
                          // Org impersonation (AGL-357).
                          <Button
                            size="small"
                            color="warning"
                            variant="outlined"
                            sx={{ alignSelf: 'flex-start' }}
                            onClick={() => void handleImpersonateOwner()}
                          >
                            {'Impersonate owner (replaces your session)'}
                          </Button>
                        ) : null}
                      </Stack>
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    // Direct editing (AGL-358).
                    <CardDisplay
                      header={'Edit organization'}
                      help={docsHelp('team', {
                        anchor: '#organizations',
                        excerpt:
                          'Rename the organization, update its logo and contact details, or transfer ownership to another member — audited to the org activity log.',
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      <Stack spacing={1.5}>
                        <TextField
                          size="small"
                          label="Name"
                          value={orgEdit.name}
                          onChange={(event) =>
                            setOrgEdit((prev) => ({
                              ...prev,
                              name: event.target.value,
                            }))
                          }
                        />
                        <MediaUrlField
                          label="Logo URL"
                          orgId={orgId}
                          value={orgEdit.logoUrl}
                          onChange={(logoUrl) =>
                            setOrgEdit((prev) => ({ ...prev, logoUrl }))
                          }
                        />
                        <TextField
                          size="small"
                          label="Contact email"
                          value={orgEdit.contactEmail}
                          onChange={(event) =>
                            setOrgEdit((prev) => ({
                              ...prev,
                              contactEmail: event.target.value,
                            }))
                          }
                        />
                        <TextField
                          size="small"
                          label="Phone"
                          value={orgEdit.contactPhone}
                          onChange={(event) =>
                            setOrgEdit((prev) => ({
                              ...prev,
                              contactPhone: event.target.value,
                            }))
                          }
                        />
                        <TextField
                          size="small"
                          label="Website"
                          value={orgEdit.contactWebsite}
                          onChange={(event) =>
                            setOrgEdit((prev) => ({
                              ...prev,
                              contactWebsite: event.target.value,
                            }))
                          }
                        />
                        <TextField
                          size="small"
                          label="Billing address"
                          value={orgEdit.contactAddressLine1}
                          onChange={(event) =>
                            setOrgEdit((prev) => ({
                              ...prev,
                              contactAddressLine1: event.target.value,
                            }))
                          }
                        />
                        <TextField
                          size="small"
                          label="City"
                          value={orgEdit.contactAddressCity}
                          onChange={(event) =>
                            setOrgEdit((prev) => ({
                              ...prev,
                              contactAddressCity: event.target.value,
                            }))
                          }
                        />
                        <TextField
                          size="small"
                          label="State / Province"
                          value={orgEdit.contactAddressState}
                          onChange={(event) =>
                            setOrgEdit((prev) => ({
                              ...prev,
                              contactAddressState: event.target.value,
                            }))
                          }
                        />
                        <TextField
                          size="small"
                          label="Postal code"
                          value={orgEdit.contactAddressPostalCode}
                          onChange={(event) =>
                            setOrgEdit((prev) => ({
                              ...prev,
                              contactAddressPostalCode: event.target.value,
                            }))
                          }
                        />
                        <TextField
                          size="small"
                          label="Country"
                          helperText="Two-letter code, e.g. US"
                          value={orgEdit.contactAddressCountry}
                          onChange={(event) =>
                            setOrgEdit((prev) => ({
                              ...prev,
                              contactAddressCountry: event.target.value,
                            }))
                          }
                        />
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={orgEditBusy}
                          sx={{ alignSelf: 'flex-start' }}
                          onClick={() => void handleOrgEditSave()}
                        >
                          {orgEditBusy ? 'Saving…' : 'Save organization'}
                        </Button>
                        {/* Ownership transfer (AGL-390): staff can hand
                            the org to another member; audited. */}
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'flex-start', mt: 1 }}
                        >
                          <TextField
                            select
                            size="small"
                            label="Transfer ownership to"
                            value={transferTarget}
                            onChange={(event) =>
                              setTransferTarget(event.target.value)
                            }
                            sx={{ flex: 1 }}
                          >
                            <MenuItem value="">{'Select a member…'}</MenuItem>
                            {(memberDocs ?? [])
                              .filter((m: any) => m.$id !== org?.ownerUid)
                              .map((m: any) => (
                                <MenuItem key={m.$id} value={m.$id}>
                                  {m.displayName ?? m.email ?? m.$id}
                                </MenuItem>
                              ))}
                          </TextField>
                          <Button
                            size="small"
                            color="error"
                            disabled={orgEditBusy || !transferTarget}
                            onClick={() => void handleTransferOwnership()}
                            sx={{ mt: 0.5 }}
                          >
                            {'Transfer'}
                          </Button>
                        </Stack>
                      </Stack>
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    <CardDisplay
                      header={`Sites (${(hostDocs ?? []).length})`}
                      help={docsHelp('architectureMultiTenancy', {
                        anchor: '#data-model',
                        excerpt:
                          'Every site (host) this organization owns — open one for its staff detail page with usage and subdomain controls.',
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      <Stack spacing={1}>
                        {(hostDocs ?? []).length === 0 ? (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                          >
                            {'No sites.'}
                          </Typography>
                        ) : (
                          (hostDocs ?? []).map((host: any) => (
                            <Stack
                              key={host.$id}
                              direction="row"
                              spacing={1}
                              sx={{
                                justifyContent: 'space-between',
                                alignItems: 'center',
                              }}
                            >
                              {/* Host detail page link (AGL-392). */}
                              <AppLink
                                href={buildRoute(
                                  Route.ADMIN_ORG_HOST_DETAIL,
                                  { orgId, hostId: host.$id },
                                )}
                                color="secondary"
                                underline="hover"
                                variant="body2"
                                noWrap
                              >
                                {host.displayName ??
                                  host.subdomain ??
                                  host.$id}
                              </AppLink>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ fontFamily: 'monospace' }}
                              >
                                {host.subdomain ?? host.$id}
                              </Typography>
                            </Stack>
                          ))
                        )}
                      </Stack>
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    <CardDisplay
                      header={`Members (${(memberDocs ?? []).length})`}
                      help={docsHelp('architectureMultiTenancy', {
                        anchor: '#membership-lifecycle',
                        excerpt:
                          "The organization's member roster with each person's role and whether they can reach all sites.",
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      <Stack spacing={1}>
                        {(memberDocs ?? []).length === 0 ? (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                          >
                            {'No members.'}
                          </Typography>
                        ) : (
                          (memberDocs ?? []).map((member: any) => (
                            <Stack
                              key={member.$id}
                              direction="row"
                              spacing={1}
                              sx={{
                                alignItems: 'center',
                                justifyContent: 'space-between',
                              }}
                            >
                              {/* Member docs are keyed by uid, so the
                                  roster links straight to the account. */}
                              <AppLink
                                variant="body2"
                                color="inherit"
                                underline="hover"
                                noWrap
                                href={buildRoute(Route.ADMIN_USER_DETAIL, {
                                  uid: member.$id,
                                })}
                              >
                                {member.email ??
                                  member.displayName ??
                                  member.$id}
                              </AppLink>
                              <Stack direction="row" spacing={1}>
                                <Chip
                                  label={member.role ?? 'viewer'}
                                  size="small"
                                  variant="outlined"
                                />
                                {member.allHosts ? (
                                  <Chip
                                    label="all sites"
                                    size="small"
                                  />
                                ) : null}
                              </Stack>
                            </Stack>
                          ))
                        )}
                      </Stack>
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    <CardDisplay
                      header={'Effective entitlements'}
                      help={docsHelp('billing', {
                        anchor: '#tiers--entitlements',
                        excerpt:
                          'Resolved limits after plan defaults and per-org overrides, with current usage against each cap. Overrides are edited on the Organizations page.',
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      {resolved ? (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>{'Key'}</TableCell>
                              <TableCell align="right">{'Used'}</TableCell>
                              <TableCell align="right">
                                {'Effective'}
                              </TableCell>
                              <TableCell align="right">
                                {'Plan default'}
                              </TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {Object.entries(resolved)
                              .filter(
                                ([key, value]) =>
                                  key !== 'features' &&
                                  typeof value === 'number',
                              )
                              .map(([key, value]) => {
                                const fallback = (planDefaults as any)?.[
                                  key
                                ]
                                const overridden =
                                  org?.entitlements?.[key] != null
                                return (
                                  <TableRow key={key}>
                                    <TableCell>
                                      {key}
                                      {overridden ? (
                                        <Chip
                                          label="override"
                                          size="small"
                                          variant="outlined"
                                          sx={{ ml: 1 }}
                                        />
                                      ) : null}
                                    </TableCell>
                                    <TableCell align="right">
                                      {usageByKey[key] != null
                                        ? usageByKey[key].toLocaleString()
                                        : '—'}
                                    </TableCell>
                                    <TableCell align="right">
                                      {formatLimit(value as number)}
                                    </TableCell>
                                    <TableCell align="right">
                                      {fallback != null
                                        ? formatLimit(fallback)
                                        : '—'}
                                    </TableCell>
                                  </TableRow>
                                )
                              })}
                          </TableBody>
                        </Table>
                      ) : null}
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    <CardDisplay
                      header={'Billing history & payment method'}
                      help={docsHelp('billing', {
                        anchor: '#payments',
                        excerpt:
                          "The organization's Stripe invoice history and default payment method, including delinquency — read-only.",
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      {billingError ? (
                        <Alert severity="info">{billingError}</Alert>
                      ) : !billing ? (
                        <Typography variant="body2" color="text.secondary">
                          {'Loading…'}
                        </Typography>
                      ) : (
                        <Stack spacing={1.5}>
                          <Stack direction="row" spacing={1}>
                            {billing.paymentMethod ? (
                              <Chip
                                size="small"
                                label={describePaymentMethod(
                                  billing.paymentMethod,
                                )}
                              />
                            ) : (
                              <Chip
                                size="small"
                                label={
                                  billing.hasCustomer === false
                                    ? 'Never subscribed'
                                    : 'No payment method'
                                }
                              />
                            )}
                            {billing.delinquent ? (
                              <Chip
                                size="small"
                                color="error"
                                label="Delinquent"
                              />
                            ) : null}
                          </Stack>
                          {billing.stripeError ? (
                            <Alert severity="warning">
                              {`Couldn't reach Stripe — this is not "no invoices". ${billing.stripeError}`}
                            </Alert>
                          ) : billing.invoices.length === 0 ? (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                            >
                              {billing.hasCustomer === false
                                ? 'This organization has never subscribed.'
                                : 'No invoices yet.'}
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
                                {billing.invoices.map((invoice) => (
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
                                    <TableCell>
                                      {invoice.status ?? '—'}
                                    </TableCell>
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
                        </Stack>
                      )}
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    // Per-org discount (AGL-1105).
                    <CardDisplay
                      header={'Subscription discount'}
                      help={docsHelp('billing', {
                        anchor: '#tiers--entitlements',
                        excerpt:
                          "Apply a Stripe coupon to this organization's subscription — the net-margin rating warns before a deal drops below the floor. Audited.",
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      <Stack spacing={1.5}>
                        {org?.discount ? (
                          <Alert
                            severity="success"
                            action={
                              <Button
                                size="small"
                                color="inherit"
                                disabled={discountBusy}
                                onClick={() => void handleRemoveDiscount()}
                              >
                                {'Remove'}
                              </Button>
                            }
                          >
                            <Stack spacing={0.25}>
                              <Typography variant="body2">
                                {org.discount.percentOff != null
                                  ? `${org.discount.percentOff}% off`
                                  : org.discount.amountOffUsd != null
                                    ? `$${org.discount.amountOffUsd} off`
                                    : 'Discount applied'}
                                {org.discount.code
                                  ? ` · ${org.discount.code}`
                                  : ''}
                              </Typography>
                              {org.discount.reason ? (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  {org.discount.reason}
                                </Typography>
                              ) : null}
                            </Stack>
                          </Alert>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            {'No discount on this subscription.'}
                          </Typography>
                        )}
                        <TextField
                          select
                          size="small"
                          label="Coupon"
                          value={selectedCoupon}
                          onChange={(event) =>
                            setSelectedCoupon(event.target.value)
                          }
                        >
                          <MenuItem value="">{'Select a coupon…'}</MenuItem>
                          {coupons.map((coupon) => (
                            <MenuItem key={coupon.id} value={coupon.id}>
                              {`${coupon.name ?? coupon.id} · ${
                                coupon.percentOff != null
                                  ? `${coupon.percentOff}%`
                                  : `$${coupon.amountOffUsd}`
                              }`}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          size="small"
                          label="Reason (e.g. the enterprise deal)"
                          value={discountReason}
                          onChange={(event) =>
                            setDiscountReason(event.target.value)
                          }
                        />
                        {discountRating ? (
                          <Alert
                            severity={
                              discountRating.rating === 'ok'
                                ? 'success'
                                : discountRating.rating === 'warn'
                                  ? 'warning'
                                  : 'error'
                            }
                          >
                            {/* Lead with the test that bound (AGL-1120) —
                                a deep discount used to be reported purely as
                                a healthy net margin, which is true and beside
                                the point. The apply route re-rates this
                                against the org's MEASURED cost, so it can
                                still refuse a discount this preview liked. */}
                            {`Rating ${discountRating.rating.toUpperCase()} — ` +
                              (discountRating.reason === 'depth'
                                ? `${(discountRating.depthPct * 100).toFixed(0)}% off list price. `
                                : discountRating.reason === 'underwater'
                                  ? 'nothing left after fees. '
                                  : `net margin ${(discountRating.marginPct * 100).toFixed(1)}% vs a ` +
                                    `${(discountRating.floorPct * 100).toFixed(0)}% floor. `) +
                              `$${discountRating.grossUsd}/mo list → keeps ` +
                              `$${discountRating.netUsd} net, less ` +
                              `$${discountRating.infraCogsUsd} infra.`}
                          </Alert>
                        ) : null}
                        {discountRating?.rating === 'block' ? (
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={confirmBelowFloor}
                                onChange={(event) =>
                                  setConfirmBelowFloor(event.target.checked)
                                }
                              />
                            }
                            label="Override the margin floor for this org"
                          />
                        ) : null}
                        <Button
                          size="small"
                          variant="contained"
                          color="secondary"
                          disabled={
                            discountBusy ||
                            !selectedCoupon ||
                            (discountRating?.rating === 'block' &&
                              !confirmBelowFloor)
                          }
                          onClick={() => void handleApplyDiscount()}
                          sx={{ alignSelf: 'flex-start' }}
                        >
                          {discountBusy ? 'Applying…' : 'Apply to subscription'}
                        </Button>
                      </Stack>
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    // Enterprise custom billing (AGL-1110).
                    <CardDisplay
                      header={'Enterprise custom billing'}
                      help={docsHelp('billing', {
                        anchor: '#tiers--entitlements',
                        excerpt:
                          'Provision a negotiated custom price for this organization — a Stripe subscription (net-30 invoice) or a Checkout link — without leaving Aglyn. Audited.',
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      <Stack spacing={1.5}>
                        {org?.subscription?.customMonthlyUsd ? (
                          <Alert severity="info">
                            {`Custom price: $${org.subscription.customMonthlyUsd}/mo` +
                              ` · billed ${
                                org.subscription.interval === 'year'
                                  ? 'annually'
                                  : 'monthly'
                              } · plan ${org.plan ?? '—'}`}
                          </Alert>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            {'No custom price — this org bills at plan rates.'}
                          </Typography>
                        )}
                        <TextField
                          size="small"
                          type="number"
                          label="Custom price (USD / month)"
                          value={entAmount}
                          onChange={(event) => setEntAmount(event.target.value)}
                        />
                        <Stack direction="row" spacing={1.5}>
                          <TextField
                            select
                            size="small"
                            label="Billed"
                            value={entInterval}
                            onChange={(event) =>
                              setEntInterval(
                                event.target.value as 'month' | 'year',
                              )
                            }
                            sx={{ flex: 1 }}
                          >
                            <MenuItem value="month">{'Monthly'}</MenuItem>
                            <MenuItem value="year">{'Annually (×12)'}</MenuItem>
                          </TextField>
                          <TextField
                            select
                            size="small"
                            label="Base plan"
                            value={entPlan}
                            onChange={(event) => setEntPlan(event.target.value)}
                            sx={{ flex: 1 }}
                          >
                            {paidPlans.map((plan) => (
                              <MenuItem key={plan} value={plan}>
                                {plan}
                              </MenuItem>
                            ))}
                          </TextField>
                        </Stack>
                        <TextField
                          select
                          size="small"
                          label="Provision via"
                          value={entMode}
                          onChange={(event) =>
                            setEntMode(
                              event.target.value as 'invoice' | 'checkout',
                            )
                          }
                        >
                          <MenuItem value="invoice">
                            {'Invoice now (net-30, no card)'}
                          </MenuItem>
                          <MenuItem value="checkout">
                            {'Send a Checkout link'}
                          </MenuItem>
                        </TextField>
                        {entMargin ? (
                          <Alert
                            severity={
                              entMargin.marginPct >= 0.75
                                ? 'success'
                                : entMargin.marginPct >= 0.65
                                  ? 'warning'
                                  : 'error'
                            }
                          >
                            {`Net margin ${(entMargin.marginPct * 100).toFixed(1)}% — ` +
                              `$${entMargin.amount}/mo` +
                              `${
                                entInterval === 'year'
                                  ? ` ($${entMargin.amount * 12}/yr)`
                                  : ''
                              } keeps $${entMargin.net} net of processor fees, ` +
                              // Name which cost model produced the figure
                              // (AGL-1134). "$2 infra" and "$2 measured
                              // across storage, requests and contacts" are
                              // very different grounds for signing a deal,
                              // and they can print the same number.
                              `less $${entMargin.infra.toFixed(2)} cost ` +
                              `(${
                                entMargin.basis === 'measured'
                                  ? 'measured from this month’s usage'
                                  : 'per-site floor — no usage recorded yet'
                              }).`}
                          </Alert>
                        ) : null}
                        {entResult?.checkoutUrl ? (
                          <Alert severity="success">
                            <MuiLink
                              href={entResult.checkoutUrl}
                              target="_blank"
                              rel="noopener"
                            >
                              {'Checkout link — send to the customer'}
                            </MuiLink>
                          </Alert>
                        ) : null}
                        {entResult?.hostedInvoiceUrl ? (
                          <Alert severity="success">
                            <MuiLink
                              href={entResult.hostedInvoiceUrl}
                              target="_blank"
                              rel="noopener"
                            >
                              {'View the first invoice'}
                            </MuiLink>
                          </Alert>
                        ) : null}
                        <Button
                          size="small"
                          variant="contained"
                          color="secondary"
                          disabled={entBusy || !(Number(entAmount) > 0)}
                          onClick={() => void handleProvisionEnterprise()}
                          sx={{ alignSelf: 'flex-start' }}
                        >
                          {entBusy
                            ? 'Provisioning…'
                            : entMode === 'checkout'
                              ? 'Create Checkout link'
                              : 'Provision subscription'}
                        </Button>
                      </Stack>
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    <CardDisplay
                      header={'Recent admin actions on this organization'}
                      help={docsHelp('staffConsole', {
                        anchor: '#whats-there',
                        excerpt:
                          'The audit-log slice referencing this organization — the full record lives on the Audit log page.',
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      <Stack spacing={1}>
                        {orgAudit.length === 0 ? (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                          >
                            {'No audit entries reference this ' +
                              'organization in the latest 200.'}
                          </Typography>
                        ) : (
                          orgAudit.map((entry: any) => (
                            <Stack
                              key={entry.$id}
                              direction="row"
                              spacing={1}
                              sx={{ justifyContent: 'space-between' }}
                            >
                              <Chip label={entry.action} size="small" />
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {`${entry.actorUid} · ${
                                  entry.at?.seconds
                                    ? new Date(
                                        entry.at.seconds * 1000,
                                      ).toLocaleString()
                                    : '—'
                                }`}
                              </Typography>
                            </Stack>
                          ))
                        )}
                      </Stack>
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    <CardDisplay
                      header={'Staff notes'}
                      help={docsHelp('staffConsole', {
                        anchor: '#whats-there',
                        excerpt:
                          'Support and billing context on this organization, visible to staff only — never written into tenant-readable data. Audited.',
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      <Stack spacing={1.5}>
                        <Typography variant="body2" color="text.secondary">
                          {'Visible to staff only — support and billing ' +
                            'context that stays out of tenant data.'}
                        </Typography>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'flex-start' }}
                        >
                          <TextField
                            size="small"
                            label="Add a note"
                            multiline
                            maxRows={4}
                            value={noteDraft}
                            onChange={(event) =>
                              setNoteDraft(event.target.value)
                            }
                            sx={{ flex: 1 }}
                          />
                          <Button
                            variant="contained"
                            color="secondary"
                            size="small"
                            disabled={noteBusy || !noteDraft.trim()}
                            onClick={() => void handleAddNote()}
                          >
                            {'Save'}
                          </Button>
                        </Stack>
                        {notes.length === 0 ? (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                          >
                            {'No notes yet.'}
                          </Typography>
                        ) : (
                          notes.map((note) => (
                            <Stack key={note.$id} spacing={0.25}>
                              <Typography
                                variant="body2"
                                sx={{ whiteSpace: 'pre-wrap' }}
                              >
                                {note.text}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {`${note.actorEmail ?? 'staff'} · ${
                                  note.createdAt
                                    ? new Date(
                                        note.createdAt,
                                      ).toLocaleString()
                                    : '—'
                                }`}
                              </Typography>
                            </Stack>
                          ))
                        )}
                      </Stack>
                    </CardDisplay>
                  ),
                },
              ]}
            />
          </>
        </StaffOnly>
        {/* Plugin zone (AGL-433): staff adminOrgDetail widgets. */}
        <PluginWidgetSlot slot="adminOrgDetail" orgId={orgId} />
      </Container>
    </DashboardLayout>
  )
}
AdminOrgDetail.displayName = 'Page:AdminOrgDetail'

export default AdminOrgDetail
