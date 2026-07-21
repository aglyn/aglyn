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
  resolveOrgEntitlements,
  UNLIMITED,
} from '@aglyn/aglyn'
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container, GridItems } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import {
  Alert,
  Button,
  Chip,
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
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import PluginWidgetSlot from '../../../../../components/plugin-widget-slot.component'
import MainLayout from '../../../../../components/layouts/main.layout'
import adminNavTabItems from '../../../../../constants/admin-nav-tabs'
import { docsHelp } from '../../../../../constants/docs-links'
import MediaUrlField from '../../../../../components/media-url-field.component'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import useFirestoreCollection from '../../../../../hooks/use-firestore-collection'
import useFirestoreDoc from '../../../../../hooks/use-firestore-doc'

/**
 * Read-only organization detail for staff (AGL-207/238). Support surface
 * WITHOUT session impersonation: staff read privileges render the org's
 * sites, member roster, effective entitlements, and the audit slice for
 * this org — no minted tokens, no write surface, so there is nothing to
 * lock down. Mutations stay on the audited Organizations list page.
 */
const AdminOrgDetail: NextPageWithLayout<Record<string, never>> = () => {
  const params = useParams<{ orgId?: string }>()
  const orgId = params?.orgId ?? ''
  const { data: user } = useUser()
  const firestore = useFirestore()
  const auth = useAuth()
  const { enqueueSnackbar } = useSnackbar()
  const [isStaff, setIsStaff] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    void (user as any)
      ?.getIdTokenResult?.()
      .then((result: any) => {
        if (active) setIsStaff(Boolean(result?.claims?.staff))
      })
      .catch(() => {
        if (active) setIsStaff(false)
      })
    return () => {
      active = false
    }
  }, [user])

  const { data: org } = useFirestoreDoc<any>(
    () => doc(firestore, 'orgs', orgId || 'missing'),
    [firestore, orgId],
    { idField: '$id' },
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
      brand: string | null
      last4: string | null
      expMonth: number | null
      expYear: number | null
    } | null
    delinquent?: boolean
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
    contactAddress: '',
  })
  const [orgEditBusy, setOrgEditBusy] = useState(false)
  useEffect(() => {
    if (!org) return
    setOrgEdit({
      name: String(org.name ?? ''),
      logoUrl: String(org.logoUrl ?? ''),
      contactEmail: String(org.contact?.email ?? ''),
      contactPhone: String(org.contact?.phone ?? ''),
      contactWebsite: String(org.contact?.website ?? ''),
      contactAddress: String(org.contact?.address ?? ''),
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
          contactAddress: orgEdit.contactAddress,
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

  const resolved = org ? resolveOrgEntitlements(org) : null
  const planDefaults = org?.plan
    ? PLAN_ENTITLEMENTS[org.plan as keyof typeof PLAN_ENTITLEMENTS]
    : null
  const formatLimit = (value: number) =>
    value === UNLIMITED ? '∞' : value.toLocaleString()

  return (
    <>
      <NextPageTitle screen={'Organization – Staff'} />
      <DashboardLayout
        navTabItems={adminNavTabItems()}
        activeTab={buildRoute(Route.ADMIN_ORGS)}
        breadcrumbItems={[
          { children: 'Staff', href: buildRoute(Route.ADMIN_ORGS) },
          { children: 'Organizations', href: buildRoute(Route.ADMIN_ORGS) },
          { children: org?.name ?? orgId },
        ]}
        header={{
          children: 'Organization Detail',
          icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {isStaff === null ? null : !isStaff ? (
            <Alert severity="error">
              {'This area requires the staff role.'}
            </Alert>
          ) : (
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
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontFamily: 'monospace' }}
                          >
                            {`Owner: ${org?.ownerUid ?? '—'}`}
                          </Typography>
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
                            label="Address"
                            multiline
                            minRows={2}
                            value={orgEdit.contactAddress}
                            onChange={(event) =>
                              setOrgEdit((prev) => ({
                                ...prev,
                                contactAddress: event.target.value,
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
                                <MuiLink
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
                                </MuiLink>
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
                                <Typography variant="body2" noWrap>
                                  {member.email ??
                                    member.displayName ??
                                    member.$id}
                                </Typography>
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
                                  label={`${billing.paymentMethod.brand ?? 'card'} •••• ${
                                    billing.paymentMethod.last4 ?? '----'
                                  } exp ${billing.paymentMethod.expMonth ?? '--'}/${
                                    billing.paymentMethod.expYear ?? '--'
                                  }`}
                                />
                              ) : (
                                <Chip size="small" label="No payment method" />
                              )}
                              {billing.delinquent ? (
                                <Chip
                                  size="small"
                                  color="error"
                                  label="Delinquent"
                                />
                              ) : null}
                            </Stack>
                            {billing.invoices.length === 0 ? (
                              <Typography
                                variant="body2"
                                color="text.secondary"
                              >
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
          )}
          {/* Plugin zone (AGL-433): staff adminOrgDetail widgets. */}
          <PluginWidgetSlot slot="adminOrgDetail" orgId={orgId} />
        </Container>
      </DashboardLayout>
    </>
  )
}
AdminOrgDetail.displayName = 'Page:AdminOrgDetail'

export default AdminOrgDetail
