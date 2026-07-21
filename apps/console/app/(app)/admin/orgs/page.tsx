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
  type OrgPlan,
} from '@aglyn/aglyn'
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
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
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import adminNavTabItems from '../../../../constants/admin-nav-tabs'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import useFirestoreCollection from '../../../../hooks/use-firestore-collection'

const PLAN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'No plan (dark launch — everything on)' },
  { value: 'free', label: 'Free' },
  { value: 'starter', label: 'Starter' },
  { value: 'pro', label: 'Pro' },
  { value: 'business', label: 'Business' },
]


/** Every numeric entitlement staff may override (AGL-201). */
const QUOTA_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'hostLimit', label: 'Sites' },
  { key: 'screensPerHost', label: 'Screens / site' },
  { key: 'sharedLayoutsPerHost', label: 'Layouts / site' },
  { key: 'storagePerHostMb', label: 'Storage MB' },
  { key: 'totalSiteSizeMb', label: 'Site size MB' },
  { key: 'membersPerHost', label: 'Members / site' },
  { key: 'managersPerOrg', label: 'Team seats' },
  { key: 'maxManagersPerOrg', label: 'Max team seats' },
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
  { key: 'datasetsPerOrg', label: 'Datasets (org)' },
  { key: 'maxDatasetsPerOrg', label: 'Max datasets (org)' },
  { key: 'recordsPerDataset', label: 'Records / dataset' },
  { key: 'dataStorageMbPerOrg', label: 'Data storage MB (org)' },
]

/** Every boolean feature flag, overridable as inherit / on / off. */
// Every feature key, derived from the plan model so new flags (the
// commerce wave added 9) can never silently drop out of the staff
// override dialog again (AGL-549).
const FLAG_FIELDS: string[] = Object.keys(PLAN_ENTITLEMENTS.free.features)

/** Count of explicit overrides on an org doc, for the row chip. */
const overrideCount = (org: any): number =>
  Object.keys(org?.entitlements ?? {}).filter((key) => key !== 'features')
    .length + Object.keys(org?.entitlements?.features ?? {}).length

/**
 * Staff organization management (AGL-238, grown from the AGL-42 tenant
 * page): list orgs, override plan and entitlements, inspect billing state,
 * suspend, and flag GDPR erasure. Every change writes an adminAudit entry.
 * The page trusts the `staff` custom claim (set via
 * tools/scripts/set-staff-claim.mjs); the org rules admit super-staff
 * writes on the billing/suspension keys and billing-staff writes on plan
 * and entitlements, so the same claims gate server-side.
 */
const AdminOrgs: NextPageWithLayout<Record<string, never>> = () => {
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

  // Pagination (AGL-359): grow the page instead of one hard 200 cap.
  const [pageLimit, setPageLimit] = useState(50)
  const { data: orgDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'orgs'), limit(pageLimit)),
    [firestore, pageLimit],
    { idField: '$id' },
  )
  // Search/sort (AGL-135) over the fetched page.
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'plan' | 'newest'>('name')
  const needle = search.trim().toLowerCase()
  const orgs = [...(orgDocs ?? [])]
    .filter(
      (org) =>
        !needle ||
        [org.$id, org.name, org.slug, org.plan]
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
      return String(a.name ?? a.$id).localeCompare(String(b.name ?? b.$id))
    })

  const [editor, setEditor] = useState<{
    id: string
    plan: string
    quotas: Record<string, string>
    flags: Record<string, '' | 'on' | 'off'>
    before: any
  } | null>(null)

  // Usage drill-down (AGL-205): last 12 monthly org rollups with deltas.
  const [usage, setUsage] = useState<{
    orgId: string
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
    (orgId: string) => async () => {
      setUsageLoading(orgId)
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch(
          `/api/admin/org-usage?orgId=${encodeURIComponent(orgId)}`,
          { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
        )
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error ?? 'Usage failed')
        setUsage({ orgId, months: payload.months ?? [] })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Could not load usage', { variant: 'error' })
      } finally {
        setUsageLoading(null)
      }
    },
    [user, enqueueSnackbar],
  )

  // Suspension (AGL-202): reversible flag; the org's sites 503 within a
  // minute and content writes are blocked by the rules.
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
        doc(firestore, 'orgs', suspender.id),
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
        action: suspending ? 'org.suspend' : 'org.unsuspend',
        target: `orgs/${suspender.id}`,
        before: { suspended: suspender.suspended },
        after: {
          suspended: suspending,
          ...(suspending ? { reason: suspender.reason.trim() } : {}),
        },
        at: Timestamp.now(),
      })
      enqueueSnackbar(
        suspending
          ? 'Organization suspended — its sites go offline within a minute (audited)'
          : 'Organization unsuspended (audited)',
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
    (org: any) => async () => {
      const requesting = !org.erasureRequestedAt
      const confirmed = await confirm({
        title: requesting
          ? 'Request erasure for this organization?'
          : 'Cancel the erasure request?',
        description: requesting
          ? 'Marks the organization for GDPR deletion. Nothing is deleted ' +
            'now: after a 7-day hold, staff run ' +
            'tools/scripts/erase-tenant.mjs to export a final bundle and ' +
            'hard-delete all data. Audited.'
          : 'The organization is no longer marked for deletion. Audited.',
        confirmationText: requesting ? 'Request erasure' : 'Cancel request',
        confirmationButtonProps: { color: requesting ? 'error' : 'primary' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      try {
        await setDoc(
          doc(firestore, 'orgs', org.$id),
          {
            erasureRequestedAt: requesting ? Timestamp.now() : deleteField(),
            updatedAt: Timestamp.now(),
          },
          { merge: true },
        )
        await addDoc(collection(firestore, 'adminAudit'), {
          actorUid: (user as any)?.uid ?? 'unknown',
          action: requesting
            ? 'org.erasureRequested'
            : 'org.erasureCanceled',
          target: `orgs/${org.$id}`,
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
    const plan = editor.plan as OrgPlan | ''
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
        doc(firestore, 'orgs', editor.id),
        {
          plan: plan || deleteField(),
          entitlements: hasOverrides ? entitlements : deleteField(),
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      )
      await addDoc(collection(firestore, 'adminAudit'), {
        actorUid: (user as any)?.uid ?? 'unknown',
        action: 'org.override',
        target: `orgs/${editor.id}`,
        before: editor.before ?? null,
        after,
        at: Timestamp.now(),
      })
      enqueueSnackbar('Organization updated (audited)', {
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
      <NextPageTitle screen={'Organizations – Staff'} />
      <DashboardLayout
        navTabItems={adminNavTabItems()}
        activeTab={buildRoute(Route.ADMIN_ORGS)}
        breadcrumbItems={[
          { children: 'Staff', href: buildRoute(Route.ADMIN_ORGS) },
          { children: 'Organizations', href: buildRoute(Route.ADMIN_ORGS) },
        ]}
        help="staffConsole"
        header={{
          children: 'Organization Management',
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
            // Card-framed header + filters (AGL-385), consistent with the
            // user-management page.
            <CardDisplay
              header={'Organizations'}
              help={docsHelp('billing', {
                anchor: '#tiers--entitlements',
                excerpt:
                  'Audited staff controls per organization — override the plan and entitlements, inspect usage, suspend its sites, or flag GDPR erasure.',
              })}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  {'Overrides write to the org doc and are audited to ' +
                    'adminAudit. Organizations without a plan keep every ' +
                    'feature (dark launch).'}
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
                    <MenuItem value="name">{'Name'}</MenuItem>
                    <MenuItem value="plan">{'Plan'}</MenuItem>
                    <MenuItem value="newest">{'Newest'}</MenuItem>
                  </TextField>
                </Stack>
              {orgs.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {'No organizations yet — they are created at signup or ' +
                    'first site.'}
                </Typography>
              ) : (
                <>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{'Organization'}</TableCell>
                      <TableCell>{'Plan'}</TableCell>
                      <TableCell>{'Subscription'}</TableCell>
                      <TableCell>{'Site limit'}</TableCell>
                      <TableCell>{'Created'}</TableCell>
                      <TableCell align="right">{'Actions'}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {orgs.map((org) => {
                      const resolved = resolveOrgEntitlements(org)
                      return (
                        <TableRow key={org.$id} hover>
                          <TableCell>
                            <Stack>
                              <Typography variant="body2" noWrap>
                                {org.name ?? org.$id}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ fontFamily: 'monospace' }}
                              >
                                {org.slug ?? org.$id}
                              </Typography>
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={org.plan ?? 'no plan'}
                              size="small"
                              color={org.plan ? 'secondary' : 'default'}
                            />
                            {org.suspendedAt ? (
                              <Chip
                                label="suspended"
                                size="small"
                                color="error"
                                sx={{ ml: 1 }}
                              />
                            ) : null}
                            {org.erasureRequestedAt ? (
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
                            {org.subscription?.status ?? '--'}
                          </TableCell>
                          <TableCell>
                            {org.plan ? resolved.hostLimit : '∞ (no plan)'}
                            {overrideCount(org) ? (
                              <Chip
                                label={`${overrideCount(org)} override${
                                  overrideCount(org) === 1 ? '' : 's'
                                }`}
                                size="small"
                                variant="outlined"
                                sx={{ ml: 1 }}
                              />
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {org.createdAt?.seconds
                                ? new Date(
                                    org.createdAt.seconds * 1000,
                                  ).toLocaleDateString()
                                : '—'}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Button
                              size="small"
                              href={buildRoute(Route.ADMIN_ORG_DETAIL, {
                                orgId: org.$id,
                              })}
                            >
                              {'Open'}
                            </Button>
                            <Button
                              size="small"
                              disabled={usageLoading === org.$id}
                              onClick={handleShowUsage(org.$id)}
                            >
                              {usageLoading === org.$id
                                ? 'Loading…'
                                : 'Usage'}
                            </Button>
                            <Button
                              size="small"
                              onClick={() => {
                                const quotas: Record<string, string> = {}
                                for (const field of QUOTA_FIELDS) {
                                  const value =
                                    org.entitlements?.[field.key]
                                  if (typeof value === 'number') {
                                    quotas[field.key] = String(value)
                                  }
                                }
                                const flags: Record<string, '' | 'on' | 'off'> =
                                  {}
                                for (const key of FLAG_FIELDS) {
                                  const value =
                                    org.entitlements?.features?.[key]
                                  if (value === true) flags[key] = 'on'
                                  if (value === false) flags[key] = 'off'
                                }
                                setEditor({
                                  id: org.$id,
                                  plan: org.plan ?? '',
                                  quotas,
                                  flags,
                                  before: {
                                    plan: org.plan ?? null,
                                    entitlements:
                                      org.entitlements ?? null,
                                  },
                                })
                              }}
                            >
                              {'Override'}
                            </Button>
                            <Button
                              size="small"
                              color={org.suspendedAt ? 'success' : 'error'}
                              onClick={() =>
                                setSuspender({
                                  id: org.$id,
                                  suspended: Boolean(org.suspendedAt),
                                  reason: org.suspendedReason ?? '',
                                })
                              }
                            >
                              {org.suspendedAt ? 'Unsuspend' : 'Suspend'}
                            </Button>
                            <Button
                              size="small"
                              color={
                                org.erasureRequestedAt
                                  ? 'primary'
                                  : 'error'
                              }
                              onClick={handleToggleErasure(org)}
                            >
                              {org.erasureRequestedAt
                                ? 'Cancel erasure'
                                : 'Erasure'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
                {(orgDocs?.length ?? 0) >= pageLimit ? (
                  <Button
                    size="small"
                    sx={{ mt: 1 }}
                    onClick={() => setPageLimit((prev) => prev + 50)}
                  >
                    {'Load more'}
                  </Button>
                ) : null}
                </>
              )}
              </Stack>
            </CardDisplay>
          )}
        </Container>
      </DashboardLayout>
      <Dialog
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>{'Override organization'}</DialogTitle>
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
              'per-organization overrides.'}
          </Typography>
          <Stack
            direction="row"
            sx={{ flexWrap: 'wrap', gap: 1 }}
          >
            {QUOTA_FIELDS.map((field) => {
              const plan = editor?.plan as OrgPlan | ''
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
              const plan = editor?.plan as OrgPlan | ''
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
        <DialogTitle>{`Usage — ${usage?.orgId}`}</DialogTitle>
        <DialogContent>
          {usage?.months.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No usage rollups recorded for this organization yet.'}
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
          {suspender?.suspended
            ? 'Unsuspend organization?'
            : 'Suspend organization?'}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {suspender?.suspended
              ? 'Their published sites come back online within a minute.'
              : 'Every published site of this organization returns 503 ' +
                'within a minute and its members see a suspension banner ' +
                'in the console. No data is deleted; this is reversible.'}
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
AdminOrgs.displayName = 'Page:AdminOrgs'

export default AdminOrgs
