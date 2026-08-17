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
  ORG_BILLING_DOC_ID,
  ORG_BILLING_SUBCOLLECTION,
  orgCogsPreview,
  netOfProcessorFee,
  orgOverrideReasonSummary,
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
  Tooltip,
  Typography,
} from '@mui/material'
import { signInWithCustomToken } from 'firebase/auth'
import {
  collection,
  getCountFromServer,
  limit,
  query,
} from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import StaffHostFormCountersChips from '../../../../../components/staff-host-form-counters.component'
import StaffOrgActions from '../../../../../components/staff-org-actions.component'
import StaffOrgUsageTable, {
  type StaffOrgUsageMonth,
} from '../../../../../components/staff-org-usage-table.component'
import StaffOrgSummaryCard, {
  staffPersonLabel,
  type StaffPerson,
} from '../../../../../components/staff-org-summary-card.component'
import { useIsStaff } from '../../../../../hooks/use-is-staff'
import useFirestoreCollection from '../../../../../hooks/use-firestore-collection'

/**
 * Organization detail for staff (AGL-207/238): the org's sites, member
 * roster, effective entitlements, metered usage and the audit slice for
 * this org. Since AGL-939 it also carries the audited org actions —
 * plan/entitlement override, suspend/unsuspend and erasure request — via
 * the same shared StaffOrgActions the Organizations list uses, so staff
 * no longer bounce back to the list to act.
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

  /**
   * The org, served by the Admin SDK (AGL-937).
   *
   * This used to be a rule-gated CLIENT read (`isStaff() || isOrgMember()`),
   * which was wrong on a staff surface twice over. A `noDocument` tombstone in
   * the local cache painted every field below as absent — plan, slug, owner,
   * Stripe customer, created date, entitlements and the whole edit form —
   * indistinguishable from a real empty org, and it survived reloads.
   * `useConfirmedDoc` (AGL-928) made that state honest rather than silent, but
   * it could not remove it. And a staff page must not depend on a rule the
   * staff user's own membership can flip.
   *
   * `/api/admin/org-detail` bypasses both the cache and the rule, and merges
   * the billing subcollection server-side, so a 404 here is a real absence.
   */
  const [orgDoc, setOrgDoc] = useState<any>(null)
  const [orgReady, setOrgReady] = useState(false)
  const [orgError, setOrgError] = useState(false)
  const [orgNonce, setOrgNonce] = useState(0)
  /**
   * The audit slice and the uid → person map, joined by the same endpoint
   * (AGL-938). `orgAudit === null` means "the slice could not be read",
   * which the card renders as a failure — never as an empty history.
   */
  const [orgAudit, setOrgAudit] = useState<any[] | null>(null)
  const [people, setPeople] = useState<Record<string, StaffPerson>>({})
  useEffect(() => {
    if (!isStaff || !orgId) return undefined
    let active = true
    setOrgReady(false)
    setOrgError(false)
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        if (!idToken) throw new Error('no token')
        const response = await fetch(
          `/api/admin/org-detail?orgId=${encodeURIComponent(orgId)}`,
          { headers: { Authorization: `Bearer ${idToken}` } },
        )
        if (!active) return
        if (response.status === 404) {
          // A confirmed absence, which is the whole point of reading here.
          setOrgDoc(null)
          return
        }
        if (!response.ok) throw new Error(String(response.status))
        const payload = await response.json()
        if (active) {
          setOrgDoc(payload?.org ?? null)
          setOrgAudit(payload?.audit ?? null)
          setPeople(payload?.people ?? {})
        }
      } catch {
        // Failure is reported as failure, never as an empty org — the alert
        // below tells staff not to act on what they are looking at.
        if (active) {
          setOrgDoc(null)
          setOrgError(true)
        }
      } finally {
        if (active) setOrgReady(true)
      }
    })()
    return () => {
      active = false
    }
  }, [isStaff, orgId, user, orgNonce])
  // Billing is merged server-side now, so there is one source and one shape.
  const orgBilling = null

  const org = useMemo(
    () => (orgDoc ? { ...orgDoc, ...(orgBilling ?? {}) } : orgDoc),
    [orgDoc, orgBilling],
  )
  // Off the client (AGL-929). This was a LIST over `hosts`, whose rule is
  // evaluated PER DOCUMENT (`isStaff() || memberRoles[uid] != null`). When a
  // document drops out of a query target — a rule re-evaluating, or an App
  // Check token failing to mint (AGL-1143, live on this deployment) — the SDK
  // cannot tell "denied" from "deleted", resolves it with a single-doc listen,
  // and on another denial records a DELETION at the path. `remoteDocumentsV14`
  // is keyed by path, so that tombstone is then served to every other reader
  // of `hosts/{hostId}`.
  //
  // AGL-878 moved the staff ORG list off the client for exactly this reason
  // and this list, one page deeper, kept the shape. Reading with the Admin SDK
  // sidesteps rules and App Check, so nothing can be tombstoned.
  //
  // The endpoint projects `$id`, `displayName`, `subdomain`, `orgId` — checked
  // against what this card renders before switching, since a projection that
  // drops a field the UI reads fails silently as a blank.
  const [hostDocs, setHostDocs] = useState<any[] | null>(null)
  useEffect(() => {
    if (!isStaff || !orgId) return undefined
    let active = true
    void (async () => {
      const idToken = await (user as any)?.getIdToken?.()
      if (!idToken) return
      const response = await fetch(
        `/api/admin/hosts?orgId=${encodeURIComponent(orgId)}`,
        { headers: { Authorization: `Bearer ${idToken}` } },
      )
      if (!response.ok) return
      const payload = await response.json()
      if (active) setHostDocs(payload?.hosts ?? [])
    })().catch(() => undefined)
    return () => {
      active = false
    }
  }, [isStaff, orgId, user])
  const { data: memberDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'orgs', orgId || 'missing', 'members'),
        limit(100),
      ),
    [firestore, orgId],
    { idField: '$id' },
  )
  // The audit slice used to be a rule-gated client listener over
  // `adminAudit` here; it now arrives joined onto `/api/admin/org-detail`
  // with each actor uid resolved to a person (AGL-938) — the same move off
  // the client that AGL-929/937 made for hosts and the org itself.

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

  // Metered usage (AGL-939): the last 12 monthly rollups from
  // /api/admin/org-usage — the endpoint the list page's Usage dialog already
  // calls, rendered here so the plan, its limits and actual consumption are
  // visible together. `null` months = the read failed (rendered as a
  // failure, never as "no usage").
  const [usageMonths, setUsageMonths] = useState<StaffOrgUsageMonth[] | null>(
    null,
  )
  const [usageReady, setUsageReady] = useState(false)
  /**
   * The newest rollup and its measured cost, from the same response
   * (AGL-1134) — the cost model's inputs, for the two pricing previews below.
   *
   * Served rather than read from the browser, because the page used to read
   * `orgs/{id}/usage/{CURRENT month}` itself and the metering cron writes
   * `previousMonth()`, the CLOSED month. Checked against production on
   * 2026-08-12: every org's newest rollup was `2026-07` and no org had a
   * `2026-08` document, so that read missed for every org on the platform.
   * This endpoint takes the newest rollup through the same
   * `orgCogsInputFrom` + `orgMonthlyCogsUsd` pair `/api/admin/org-discount`
   * uses, so the previews and the route that applies cannot disagree.
   */
  const [usageLatest, setUsageLatest] = useState<{
    month: string
    measuredCogsUsd: number
    rollup: Record<string, number | null | undefined>
  } | null>(null)
  useEffect(() => {
    if (!isStaff || !orgId || !user) return undefined
    let active = true
    setUsageReady(false)
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch(
          `/api/admin/org-usage?orgId=${encodeURIComponent(orgId)}`,
          { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
        )
        if (!response.ok) throw new Error(String(response.status))
        const payload = await response.json()
        if (active) {
          setUsageMonths(payload.months ?? [])
          setUsageLatest(payload.latest ?? null)
        }
      } catch {
        if (active) {
          setUsageMonths(null)
          setUsageLatest(null)
        }
      } finally {
        if (active) setUsageReady(true)
      }
    })()
    return () => {
      active = false
    }
  }, [isStaff, orgId, user])
  /**
   * Whether the cost previews may answer at all (AGL-1134).
   *
   * `usageReady` alone is not enough: this effect sets it in a `finally`, so
   * it is true after a FAILED read too, and `usageMonths === null` is this
   * page's existing "the read failed" signal. A failed read does not know
   * that an org has no usage — it knows nothing — and pricing on it would
   * present the per-site floor as a measurement, which is the AGL-1380 /
   * AGL-1422 defect with money attached.
   */
  const cogsReady = usageReady && usageMonths !== null

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
      // The org is read once from the server now, not through a live listener
      // (AGL-937), so a successful write has to ask for it again — otherwise
      // the card above keeps showing what staff just changed away from.
      setOrgNonce((nonce) => nonce + 1)
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
      setOrgNonce((nonce) => nonce + 1)
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
  /**
   * What the Apply button will be told, computed here (AGL-1134).
   *
   * This used to call `checkDiscountMargin` with no `measuredCogsUsd` at all,
   * so it rated against the flat $2/site floor while `/api/admin/org-discount`
   * rated the same coupon against the org's measured cost. The badge could
   * read OK next to a button that gets refused — and the refusal is the
   * correct answer, which is what made the disagreement so easy to leave
   * alone. Now both sides price the same rollup with the same function.
   *
   * `null` while the usage read is outstanding: rating a discount on a cost
   * we have not fetched is exactly the "answers a question it has not asked"
   * defect, and here it answers in the direction that approves.
   */
  const discountRating = useMemo(() => {
    if (!org || !selectedCouponObj || !cogsReady) return null
    return checkDiscountMargin(
      org,
      {
        percentOff: selectedCouponObj.percentOff ?? undefined,
        amountOffUsd: selectedCouponObj.amountOffUsd ?? undefined,
      },
      { measuredCogsUsd: usageLatest?.measuredCogsUsd ?? null },
    )
  }, [org, selectedCouponObj, cogsReady, usageLatest])

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
  /**
   * Idempotency key for ONE provisioning attempt (AGL-1714).
   *
   * `entBusy` is React state read out of this handler's closure, so a second
   * click arriving before the re-render sees the pre-click `false` — and on
   * `mode: 'invoice'` that second call creates a second net-30 subscription
   * outright, because there is no Checkout session for anyone to abandon.
   * Nothing client-side survives a reload or a lost response either.
   *
   * Minted lazily and held in a ref, NOT per click: per-click would defeat the
   * point entirely, since two clicks would mint two keys and the server would
   * see two deals. It retires when the QUOTE changes — amount, interval, plan
   * or mode — which is the honest boundary: a retry of the same quote is the
   * same attempt, and a renegotiated figure is a genuinely new one that must
   * not be swallowed. The server's live-subscription check is what covers the
   * staff member who comes back tomorrow.
   */
  const entAttemptKey = useRef('')
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
    // Gated behind `cogsReady` rather than on the rollup being truthy: a
    // read still in flight and an org with no rollup are the same falsy
    // value, and only the second is "no usage recorded yet". Reporting the
    // first as the second put a measurement-shaped sentence under a number
    // that measured nothing.
    const preview = orgCogsPreview(
      cogsReady,
      usageLatest?.rollup,
      orgSiteCount(org),
    )
    if (preview.status === 'pending') {
      return { amount, net, infra: null, marginPct: null, basis: null } as const
    }
    const infra = preview.cogs.cogsUsd
    const marginPct = net > 0 ? (net - infra) / net : -1
    return {
      amount,
      net,
      infra,
      marginPct,
      basis: preview.cogs.basis,
      month: usageLatest?.month ?? null,
    } as const
  }, [entAmount, entInterval, org, cogsReady, usageLatest])

  useEffect(() => {
    // A different quote is a different deal, so it gets a different attempt.
    entAttemptKey.current = ''
  }, [entAmount, entInterval, entPlan, entMode])

  const handleProvisionEnterprise = async () => {
    const amount = Number(entAmount)
    if (!(amount > 0) || entBusy) return
    setEntBusy(true)
    setEntResult(null)
    // Reuse the key across retries of this quote; mint one if this is the first
    // attempt (AGL-1714). `randomUUID` needs a secure context, which the console
    // always is, but fall back rather than throw on a provisioning click.
    if (!entAttemptKey.current) {
      entAttemptKey.current =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/admin/enterprise-billing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': entAttemptKey.current,
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
            {orgReady && !orgDoc ? (
              <Alert severity="warning" sx={{ mb: 3 }}>
                {orgError
                  ? 'Could not read this organization. Everything below is ' +
                    'blank because the read failed, not because the org is ' +
                    'empty — do not act on it.'
                  : `No organization document exists at orgs/${orgId}. ` +
                    'Confirmed against the server, so this is a real absence ' +
                    'rather than a stale local cache (AGL-937).'}
              </Alert>
            ) : null}
            <Alert severity="info" sx={{ mb: 3 }}>
              {'Every action here is audited — overrides, suspension and ' +
                'erasure to adminAudit; profile edits to the org activity ' +
                'log (AGL-358).'}
            </Alert>
            {/* The audited org actions (AGL-939), shared with the
                Organizations list. Status chips make the current state
                visible before staff act on it. */}
            <CardDisplay
              header={'Staff actions'}
              help={docsHelp('billing', {
                anchor: '#tiers--entitlements',
                excerpt:
                  'Audited staff controls for this organization — override the plan and entitlements, suspend its sites, or flag GDPR erasure.',
              })}
              contentGutterX
              contentGutterY
              sx={{ mb: 3 }}
            >
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', flexWrap: 'wrap' }}
              >
                {org?.suspendedAt ? (
                  <Chip label="suspended" size="small" color="error" />
                ) : null}
                {org?.erasureRequestedAt ? (
                  <Chip
                    label="erasure requested"
                    size="small"
                    color="error"
                    variant="outlined"
                  />
                ) : null}
                <StaffOrgActions
                  org={org}
                  onChanged={() => setOrgNonce((nonce) => nonce + 1)}
                />
              </Stack>
            </CardDisplay>
            <GridItems
              spacing={3}
              items={[
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    // Labelled + grouped, owner resolved to a person, org id
                    // copyable (AGL-938).
                    <StaffOrgSummaryCard
                      orgId={orgId}
                      org={org}
                      owner={
                        org?.ownerUid ? (people[org.ownerUid] ?? null) : null
                      }
                      onImpersonateOwner={() => void handleImpersonateOwner()}
                    />
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
                                color="primary"
                                underline="hover"
                                variant="body2"
                                noWrap
                              >
                                {host.displayName ??
                                  host.subdomain ??
                                  host.$id}
                              </AppLink>
                              <Stack
                                direction="row"
                                spacing={1}
                                sx={{ alignItems: 'center' }}
                              >
                                {/* Form-abuse flag (AGL-1681): a refusing
                                    site is visible here, without opening
                                    each host or the Firebase console. */}
                                <StaffHostFormCountersChips
                                  forms={host.forms}
                                />
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{ fontFamily: 'monospace' }}
                                >
                                  {host.subdomain ?? host.$id}
                                </Typography>
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
                    // Metered usage (AGL-939): consumption alongside the
                    // plan and its limits — the thing staff open this page
                    // to see.
                    <CardDisplay
                      header={'Metered usage'}
                      help={docsHelp('billing', {
                        anchor: '#tiers--entitlements',
                        excerpt:
                          "The organization's monthly usage rollups — page views, storage, form submissions and cost — with month-over-month deltas.",
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      {!usageReady ? (
                        <Typography variant="body2" color="text.secondary">
                          {'Loading…'}
                        </Typography>
                      ) : usageMonths == null ? (
                        <Alert severity="warning">
                          {'Could not read the usage rollups — a failed ' +
                            'read, not zero usage.'}
                        </Alert>
                      ) : (
                        <StaffOrgUsageTable months={usageMonths} />
                      )}
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
                        {selectedCouponObj && !discountRating ? (
                          // The usage read has not landed (AGL-1134). Rating
                          // the coupon now would rate it against the flat
                          // floor, which is the disagreement with the apply
                          // route this change exists to remove.
                          <Alert severity="info">
                            {'Checking this org’s measured cost…'}
                          </Alert>
                        ) : null}
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
                                the point. The apply route re-rates this from
                                the same rollup through the same function
                                (AGL-1134), so this badge and that route now
                                reach the same verdict rather than this one
                                approving what the route refuses. */}
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
                          color="primary"
                          disabled={
                            discountBusy ||
                            !selectedCoupon ||
                            // Unrated is not approved (AGL-1134). While the
                            // usage read is outstanding there is no verdict,
                            // and an enabled button with no badge beside it
                            // is the same "act before the answer arrives"
                            // failure one layer up.
                            !discountRating ||
                            (discountRating.rating === 'block' &&
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
                        {entMargin && entMargin.marginPct == null ? (
                          // No margin until the cost is known (AGL-1134).
                          // Showing one built on the floor, then silently
                          // replacing it a moment later, is how a staff
                          // member reads a number that was never true.
                          <Alert severity="info">
                            {'Checking this org’s measured cost…'}
                          </Alert>
                        ) : entMargin && entMargin.marginPct != null ? (
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
                              `less $${(entMargin.infra ?? 0).toFixed(2)} cost ` +
                              `(${
                                entMargin.basis === 'measured'
                                  ? // Name the MONTH. The rollup is the
                                    // closed month, not "this month" — the
                                    // old copy said this month about a
                                    // figure that is never from it.
                                    `measured from ${entMargin.month ?? 'the latest'} usage`
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
                          color="primary"
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
                        {orgAudit == null ? (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                          >
                            {orgReady
                              ? 'Could not read the audit slice — a failed ' +
                                'read, not an empty history.'
                              : 'Loading…'}
                          </Typography>
                        ) : orgAudit.length === 0 ? (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                          >
                            {'No audit entries reference this ' +
                              'organization in the latest 200.'}
                          </Typography>
                        ) : (
                          orgAudit.map((entry: any) => {
                            // The actor as a person (AGL-938); the uid
                            // survives as the tooltip, and an unresolved
                            // actor (`system:cron`, an erased account)
                            // stays legible as its raw id.
                            const actor = staffPersonLabel(
                              entry.actorUid
                                ? people[entry.actorUid]
                                : null,
                            )
                            // WHY the action was taken (AGL-1652). This is
                            // the surface an override is actually looked at
                            // from, so it is the surface the reason has to
                            // reach — an audit field nobody renders is the
                            // same failure as no field.
                            const why = orgOverrideReasonSummary(
                              entry.reason,
                              entry.note,
                            )
                            return (
                              <Stack key={entry.$id} spacing={0.25}>
                                <Stack
                                  direction="row"
                                  spacing={1}
                                  sx={{ justifyContent: 'space-between' }}
                                >
                                  <Chip label={entry.action} size="small" />
                                  <Tooltip
                                    title={
                                      actor ? (entry.actorUid ?? '') : ''
                                    }
                                  >
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                    >
                                      {`${actor ?? entry.actorUid ?? '—'} · ${
                                        entry.at?.seconds
                                          ? new Date(
                                              entry.at.seconds * 1000,
                                            ).toLocaleString()
                                          : '—'
                                      }`}
                                    </Typography>
                                  </Tooltip>
                                </Stack>
                                {why ? (
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                  >
                                    {`Why: ${why}`}
                                  </Typography>
                                ) : entry.action === 'org.override' ? (
                                  <Typography
                                    variant="caption"
                                    color="warning.main"
                                  >
                                    {'Why: not recorded — predates the ' +
                                      'required reason.'}
                                  </Typography>
                                ) : null}
                              </Stack>
                            )
                          })
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
                            color="primary"
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
