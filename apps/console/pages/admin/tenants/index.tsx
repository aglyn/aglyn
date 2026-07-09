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
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { Container, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import {
  addDoc,
  collection,
  deleteField,
  doc,
  limit,
  query,
  setDoc,
} from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'
import useFirestoreCollection from '../../../hooks/use-firestore-collection'

const PLAN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'No plan (dark launch — everything on)' },
  { value: 'free', label: 'Free' },
  { value: 'starter', label: 'Starter' },
  { value: 'pro', label: 'Pro' },
  { value: 'business', label: 'Business' },
]


/** Every numeric entitlement staff may override (AGL-201). */
const QUOTA_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'hostLimit', label: 'Hosts' },
  { key: 'screensPerHost', label: 'Screens / host' },
  { key: 'sharedLayoutsPerHost', label: 'Layouts / host' },
  { key: 'storagePerHostMb', label: 'Storage MB' },
  { key: 'totalSiteSizeMb', label: 'Site size MB' },
  { key: 'membersPerHost', label: 'Members / host' },
  { key: 'managersPerTenant', label: 'Manager seats' },
  { key: 'maxManagersPerTenant', label: 'Max manager seats' },
  { key: 'maxMembersPerHost', label: 'Max member seats' },
  { key: 'bandwidthGb', label: 'Bandwidth GB' },
  { key: 'formSubmissionsPerMonth', label: 'Form subs / mo' },
  { key: 'variablesPerHost', label: 'Variables' },
  { key: 'functionsPerHost', label: 'Functions' },
  { key: 'workflowsPerHost', label: 'Workflows' },
  { key: 'workflowRunsPerMonth', label: 'Workflow runs / mo' },
  { key: 'servicesPerHost', label: 'Booking services' },
  { key: 'redirectsPerHost', label: 'Redirects' },
  { key: 'contactsPerHost', label: 'Contacts' },
  { key: 'emailSendsPerMonth', label: 'Email sends / mo' },
  { key: 'actionRunsPerMonth', label: 'Action runs / mo' },
  { key: 'datasetsPerHost', label: 'Datasets' },
  { key: 'maxDatasetsPerHost', label: 'Max datasets' },
  { key: 'recordsPerDataset', label: 'Records / dataset' },
]

/** Every boolean feature flag, overridable as inherit / on / off. */
const FLAG_FIELDS: string[] = [
  'versioning',
  'reusableComponents',
  'customDomain',
  'removeBranding',
  'scheduledPublishing',
  'marketplaceSelling',
  'aiAssist',
  'workflows',
  'dataStore',
  'videoMedia',
  'bookings',
  'actions',
  'webhooks',
  'siteExport',
  'multilingual',
  'eventCalendar',
  'redirects',
  'screenAnalytics',
  'mediaCdn',
  'marketingOverlays',
]

/** Count of explicit overrides on a tenant doc, for the row chip. */
const overrideCount = (tenant: any): number =>
  Object.keys(tenant?.entitlements ?? {}).filter((key) => key !== 'features')
    .length + Object.keys(tenant?.entitlements?.features ?? {}).length

/**
 * Staff-only tenant management (AGL-42 follow-on): list tenants, override
 * plan and host-limit entitlement, and inspect billing state. Every change
 * writes an adminAudit entry. The page trusts the `staff` custom claim
 * (set via tools/scripts/set-staff-claim.mjs) and the Firestore rules
 * enforce the same claim server-side.
 */
const AdminTenants: NextPageWithLayout = () => {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
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

  const { data: tenantDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'tenants'), limit(200)),
    [firestore],
    { idField: '$id' },
  )
  // Search/sort (AGL-135) over the fetched page.
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'id' | 'plan' | 'newest'>('id')
  const needle = search.trim().toLowerCase()
  const tenants = [...(tenantDocs ?? [])]
    .filter(
      (tenant) =>
        !needle ||
        [tenant.$id, tenant.displayName, tenant.plan]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle)),
    )
    .sort((a, b) => {
      if (sortBy === 'plan') {
        return String(a.plan ?? '').localeCompare(String(b.plan ?? ''))
      }
      if (sortBy === 'newest') {
        return (
          (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
        )
      }
      return String(a.$id).localeCompare(String(b.$id))
    })

  const [editor, setEditor] = useState<{
    id: string
    plan: string
    quotas: Record<string, string>
    flags: Record<string, '' | 'on' | 'off'>
    before: any
  } | null>(null)

  // Usage drill-down (AGL-205): last 12 monthly rollups with deltas.
  const [usage, setUsage] = useState<{
    tenantId: string
    months: Array<{
      month: string
      storageGb: number
      pageViews: number
      formSubmissions: number
      costUsd: number
      deltas: { pageViews: number | null; costUsd: number | null } | null
    }>
  } | null>(null)
  const [usageLoading, setUsageLoading] = useState<string | null>(null)
  const handleShowUsage = useCallback(
    (tenantId: string) => async () => {
      setUsageLoading(tenantId)
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch(
          `/api/admin/tenant-usage?tenantId=${encodeURIComponent(tenantId)}`,
          { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
        )
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error ?? 'Usage failed')
        setUsage({ tenantId, months: payload.months ?? [] })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Could not load usage', { variant: 'error' })
      } finally {
        setUsageLoading(null)
      }
    },
    [user, enqueueSnackbar],
  )

  // Suspension (AGL-202): reversible flag; sites 503 within a minute.
  const [suspender, setSuspender] = useState<{
    id: string
    suspended: boolean
    reason: string
  } | null>(null)
  const handleSuspendSave = useCallback(async () => {
    if (!suspender) return
    try {
      const suspending = !suspender.suspended
      await setDoc(
        doc(firestore, 'tenants', suspender.id),
        {
          suspendedAt: suspending ? Timestamp.now() : deleteField(),
          suspendedReason: suspending
            ? suspender.reason.trim().slice(0, 200)
            : deleteField(),
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      )
      await addDoc(collection(firestore, 'adminAudit'), {
        actorUid: (user as any)?.uid ?? 'unknown',
        action: suspending ? 'tenant.suspend' : 'tenant.unsuspend',
        target: `tenants/${suspender.id}`,
        before: { suspended: suspender.suspended },
        after: {
          suspended: suspending,
          ...(suspending ? { reason: suspender.reason.trim() } : {}),
        },
        at: Timestamp.now(),
      })
      enqueueSnackbar(
        suspending
          ? 'Tenant suspended — sites go offline within a minute (audited)'
          : 'Tenant unsuspended (audited)',
        { variant: 'success', persist: false },
      )
      setSuspender(null)
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [suspender, firestore, user, enqueueSnackbar])

  // GDPR erasure request (AGL-206): sets/clears the flag only — the hard
  // delete is a deliberate, separately-run script after a 7-day hold.
  const handleToggleErasure = useCallback(
    (tenant: any) => async () => {
      const requesting = !tenant.erasureRequestedAt
      const confirmed = await confirm({
        title: requesting
          ? 'Request erasure for this tenant?'
          : 'Cancel the erasure request?',
        description: requesting
          ? 'Marks the tenant for GDPR deletion. Nothing is deleted now: ' +
            'after a 7-day hold, staff run tools/scripts/erase-tenant.mjs ' +
            'to export a final bundle and hard-delete all data. Audited.'
          : 'The tenant is no longer marked for deletion. Audited.',
        confirmationText: requesting ? 'Request erasure' : 'Cancel request',
        confirmationButtonProps: { color: requesting ? 'error' : 'primary' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      try {
        await setDoc(
          doc(firestore, 'tenants', tenant.$id),
          {
            erasureRequestedAt: requesting ? Timestamp.now() : deleteField(),
            updatedAt: Timestamp.now(),
          },
          { merge: true },
        )
        await addDoc(collection(firestore, 'adminAudit'), {
          actorUid: (user as any)?.uid ?? 'unknown',
          action: requesting
            ? 'tenant.erasureRequested'
            : 'tenant.erasureCanceled',
          target: `tenants/${tenant.$id}`,
          before: { erasureRequested: !requesting },
          after: { erasureRequested: requesting },
          at: Timestamp.now(),
        })
        enqueueSnackbar(
          requesting
            ? 'Erasure requested — deletable via script after 7 days (audited)'
            : 'Erasure request canceled (audited)',
          { variant: 'success', persist: false },
        )
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
    },
    [confirm, firestore, user, enqueueSnackbar],
  )

  const handleSave = useCallback(async () => {
    if (!editor) return
    const plan = editor.plan as TenantPlan | ''
    // Full override build (AGL-201): only explicit entries persist —
    // empty quota fields and 'inherit' flags fall back to plan defaults.
    const entitlements: Record<string, unknown> = {}
    for (const field of QUOTA_FIELDS) {
      const raw = (editor.quotas[field.key] ?? '').trim()
      if (raw === '') continue
      const value = Number(raw)
      if (Number.isFinite(value) && value >= 0) {
        entitlements[field.key] = value
      }
    }
    const features: Record<string, boolean> = {}
    for (const key of FLAG_FIELDS) {
      const state = editor.flags[key] ?? ''
      if (state === 'on') features[key] = true
      if (state === 'off') features[key] = false
    }
    if (Object.keys(features).length) entitlements['features'] = features
    const hasOverrides = Object.keys(entitlements).length > 0
    const after = {
      plan: plan || null,
      entitlements: hasOverrides ? entitlements : null,
    }
    try {
      await setDoc(
        doc(firestore, 'tenants', editor.id),
        {
          plan: plan || deleteField(),
          entitlements: hasOverrides ? entitlements : deleteField(),
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      )
      await addDoc(collection(firestore, 'adminAudit'), {
        actorUid: (user as any)?.uid ?? 'unknown',
        action: 'tenant.override',
        target: `tenants/${editor.id}`,
        before: editor.before ?? null,
        after,
        at: Timestamp.now(),
      })
      enqueueSnackbar('Tenant updated (audited)', {
        variant: 'success',
        persist: false,
      })
      setEditor(null)
    } catch (error) {
      console.error(error)
      enqueueSnackbar(
        'Write failed — are the scoped Firestore rules deployed and is ' +
          'your account staff?',
        { variant: 'error', allowDuplicate: true },
      )
    }
  }, [editor, firestore, user, enqueueSnackbar])

  return (
    <>
      <NextPageTitle screen={'Tenants – Staff'} />
      <DashboardLayout
        navTabItems={[
          {
            id: 'nav-tab-admin-overview',
            label: 'Overview',
            href: buildRoute(Route.ADMIN_OVERVIEW),
          },
          {
            id: 'nav-tab-admin-tenants',
            label: 'Tenants',
            href: buildRoute(Route.ADMIN_TENANTS),
          },
          {
            id: 'nav-tab-admin-users',
            label: 'Users',
            href: buildRoute(Route.ADMIN_USERS),
          },
          {
            id: 'nav-tab-admin-audit',
            label: 'Audit log',
            href: buildRoute(Route.ADMIN_AUDIT),
          },
        ]}
        activeTab={buildRoute(Route.ADMIN_TENANTS)}
        breadcrumbItems={[
          { children: 'Staff', href: buildRoute(Route.ADMIN_TENANTS) },
          { children: 'Tenants', href: buildRoute(Route.ADMIN_TENANTS) },
        ]}
        header={{
          children: 'Tenant Management',
          icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {isStaff === null ? null : !isStaff ? (
            <Alert severity="warning">
              {'Staff only. Grant access with ' +
                'tools/scripts/set-staff-claim.mjs, then sign out and back ' +
                'in to refresh the claim.'}
            </Alert>
          ) : (
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                {'Overrides write to the tenant doc and are audited to ' +
                  'adminAudit. Tenants without a plan keep every feature ' +
                  '(dark launch).'}
              </Typography>
              <Stack direction="row" spacing={1}>
                <TextField
                  size="small"
                  label="Search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  sx={{ minWidth: 220 }}
                />
                <TextField
                  select
                  size="small"
                  label="Sort"
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as any)}
                  sx={{ minWidth: 120 }}
                >
                  <MenuItem value="id">{'Tenant id'}</MenuItem>
                  <MenuItem value="plan">{'Plan'}</MenuItem>
                  <MenuItem value="newest">{'Newest'}</MenuItem>
                </TextField>
              </Stack>
              {tenants.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {'No tenant docs yet — they appear at first checkout or ' +
                    'staff assignment.'}
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{'Tenant (uid)'}</TableCell>
                      <TableCell>{'Plan'}</TableCell>
                      <TableCell>{'Subscription'}</TableCell>
                      <TableCell>{'Host limit'}</TableCell>
                      <TableCell align="right">{'Actions'}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tenants.map((tenant) => {
                      const resolved = resolveTenantEntitlements(tenant)
                      return (
                        <TableRow key={tenant.$id} hover>
                          <TableCell sx={{ fontFamily: 'monospace' }}>
                            {tenant.$id}
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={tenant.plan ?? 'no plan'}
                              size="small"
                              color={tenant.plan ? 'secondary' : 'default'}
                            />
                            {tenant.suspendedAt ? (
                              <Chip
                                label="suspended"
                                size="small"
                                color="error"
                                sx={{ ml: 1 }}
                              />
                            ) : null}
                            {tenant.erasureRequestedAt ? (
                              <Chip
                                label="erasure requested"
                                size="small"
                                color="error"
                                variant="outlined"
                                sx={{ ml: 1 }}
                              />
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {tenant.subscription?.status ?? '--'}
                          </TableCell>
                          <TableCell>
                            {tenant.plan ? resolved.hostLimit : '∞ (no plan)'}
                            {overrideCount(tenant) ? (
                              <Chip
                                label={`${overrideCount(tenant)} override${
                                  overrideCount(tenant) === 1 ? '' : 's'
                                }`}
                                size="small"
                                variant="outlined"
                                sx={{ ml: 1 }}
                              />
                            ) : null}
                          </TableCell>
                          <TableCell align="right">
                            <Button
                              size="small"
                              href={buildRoute(Route.ADMIN_TENANT_DETAIL, {
                                tenantId: tenant.$id,
                              })}
                            >
                              {'Open'}
                            </Button>
                            <Button
                              size="small"
                              disabled={usageLoading === tenant.$id}
                              onClick={handleShowUsage(tenant.$id)}
                            >
                              {usageLoading === tenant.$id
                                ? 'Loading…'
                                : 'Usage'}
                            </Button>
                            <Button
                              size="small"
                              onClick={() => {
                                const quotas: Record<string, string> = {}
                                for (const field of QUOTA_FIELDS) {
                                  const value =
                                    tenant.entitlements?.[field.key]
                                  if (typeof value === 'number') {
                                    quotas[field.key] = String(value)
                                  }
                                }
                                const flags: Record<string, '' | 'on' | 'off'> =
                                  {}
                                for (const key of FLAG_FIELDS) {
                                  const value =
                                    tenant.entitlements?.features?.[key]
                                  if (value === true) flags[key] = 'on'
                                  if (value === false) flags[key] = 'off'
                                }
                                setEditor({
                                  id: tenant.$id,
                                  plan: tenant.plan ?? '',
                                  quotas,
                                  flags,
                                  before: {
                                    plan: tenant.plan ?? null,
                                    entitlements:
                                      tenant.entitlements ?? null,
                                  },
                                })
                              }}
                            >
                              {'Override'}
                            </Button>
                            <Button
                              size="small"
                              color={tenant.suspendedAt ? 'success' : 'error'}
                              onClick={() =>
                                setSuspender({
                                  id: tenant.$id,
                                  suspended: Boolean(tenant.suspendedAt),
                                  reason: tenant.suspendedReason ?? '',
                                })
                              }
                            >
                              {tenant.suspendedAt ? 'Unsuspend' : 'Suspend'}
                            </Button>
                            <Button
                              size="small"
                              color={
                                tenant.erasureRequestedAt
                                  ? 'primary'
                                  : 'error'
                              }
                              onClick={handleToggleErasure(tenant)}
                            >
                              {tenant.erasureRequestedAt
                                ? 'Cancel erasure'
                                : 'Erasure'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </Stack>
          )}
        </Container>
      </DashboardLayout>
      <Dialog
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>{'Override tenant'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
            {editor?.id}
          </Typography>
          <TextField
            select
            size="small"
            label="Plan"
            value={editor?.plan ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, plan: event.target.value } : prev,
              )
            }
          >
            {PLAN_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="subtitle2">{'Quota overrides'}</Typography>
          <Typography variant="caption" color="text.secondary">
            {'Empty = plan default. Only filled fields persist as ' +
              'per-tenant overrides.'}
          </Typography>
          <Stack
            direction="row"
            sx={{ flexWrap: 'wrap', gap: 1 }}
          >
            {QUOTA_FIELDS.map((field) => {
              const plan = editor?.plan as TenantPlan | ''
              const fallback = plan
                ? (PLAN_ENTITLEMENTS[plan] as any)?.[field.key]
                : undefined
              return (
                <TextField
                  key={field.key}
                  size="small"
                  label={field.label}
                  type="number"
                  value={editor?.quotas[field.key] ?? ''}
                  placeholder={
                    fallback === undefined
                      ? ''
                      : Number.isFinite(fallback)
                        ? String(fallback)
                        : '∞'
                  }
                  onChange={(event) =>
                    setEditor((prev) =>
                      prev
                        ? {
                            ...prev,
                            quotas: {
                              ...prev.quotas,
                              [field.key]: event.target.value,
                            },
                          }
                        : prev,
                    )
                  }
                  sx={{ width: 168 }}
                />
              )
            })}
          </Stack>
          <Typography variant="subtitle2">{'Feature overrides'}</Typography>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            {FLAG_FIELDS.map((key) => {
              const plan = editor?.plan as TenantPlan | ''
              const fallback = plan
                ? Boolean(
                    (PLAN_ENTITLEMENTS[plan]?.features as any)?.[key],
                  )
                : undefined
              return (
                <TextField
                  key={key}
                  select
                  size="small"
                  label={key}
                  value={editor?.flags[key] ?? ''}
                  onChange={(event) =>
                    setEditor((prev) =>
                      prev
                        ? {
                            ...prev,
                            flags: {
                              ...prev.flags,
                              [key]: event.target.value as any,
                            },
                          }
                        : prev,
                    )
                  }
                  sx={{ width: 168 }}
                >
                  <MenuItem value="">
                    {fallback === undefined
                      ? 'Inherit'
                      : `Inherit (${fallback ? 'on' : 'off'})`}
                  </MenuItem>
                  <MenuItem value="on">{'Force on'}</MenuItem>
                  <MenuItem value="off">{'Force off'}</MenuItem>
                </TextField>
              )
            })}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditor(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            onClick={handleSave}
          >
            {'Save (audited)'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(usage)}
        onClose={() => setUsage(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{`Usage — ${usage?.tenantId}`}</DialogTitle>
        <DialogContent>
          {usage?.months.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No usage rollups recorded for this tenant yet.'}
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{'Month'}</TableCell>
                  <TableCell align="right">{'Page views'}</TableCell>
                  <TableCell align="right">{'Storage GB'}</TableCell>
                  <TableCell align="right">{'Forms'}</TableCell>
                  <TableCell align="right">{'Cost'}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {usage?.months.map((row) => (
                  <TableRow key={row.month}>
                    <TableCell>{row.month}</TableCell>
                    <TableCell align="right">
                      {row.pageViews.toLocaleString()}
                      {row.deltas?.pageViews != null ? (
                        <Typography
                          component="span"
                          variant="caption"
                          color={
                            row.deltas.pageViews > 0
                              ? 'success.main'
                              : 'text.secondary'
                          }
                          sx={{ ml: 0.5 }}
                        >
                          {`${row.deltas.pageViews > 0 ? '+' : ''}${Math.round(
                            row.deltas.pageViews * 100,
                          )}%`}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell align="right">
                      {row.storageGb.toFixed(2)}
                    </TableCell>
                    <TableCell align="right">
                      {row.formSubmissions.toLocaleString()}
                    </TableCell>
                    <TableCell align="right">
                      {`$${row.costUsd.toFixed(2)}`}
                      {row.deltas?.costUsd != null ? (
                        <Typography
                          component="span"
                          variant="caption"
                          color={
                            row.deltas.costUsd > 0
                              ? 'warning.main'
                              : 'text.secondary'
                          }
                          sx={{ ml: 0.5 }}
                        >
                          {`${row.deltas.costUsd > 0 ? '+' : ''}${Math.round(
                            row.deltas.costUsd * 100,
                          )}%`}
                        </Typography>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUsage(null)}>{'Close'}</Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(suspender)}
        onClose={() => setSuspender(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {suspender?.suspended ? 'Unsuspend tenant?' : 'Suspend tenant?'}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {suspender?.suspended
              ? 'Their published sites come back online within a minute.'
              : 'Every published site of this tenant returns 503 within a ' +
                'minute and the owner sees a suspension banner in the ' +
                'console. No data is deleted; this is reversible.'}
          </Typography>
          {!suspender?.suspended ? (
            <TextField
              size="small"
              label="Reason (shown to the owner)"
              value={suspender?.reason ?? ''}
              onChange={(event) =>
                setSuspender((previous) =>
                  previous
                    ? { ...previous, reason: event.target.value }
                    : previous,
                )
              }
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSuspender(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color={suspender?.suspended ? 'success' : 'error'}
            onClick={handleSuspendSave}
          >
            {suspender?.suspended ? 'Unsuspend' : 'Suspend'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
AdminTenants.displayName = 'Page:AdminTenants'
AdminTenants.layouts = [
  {
    Component: AuthenticatedLayout,
  },
  {
    Component: MainLayout,
    props: {
      title: 'Staff',
    },
  },
]

export default AdminTenants
