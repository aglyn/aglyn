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
import { Container } from '@aglyn/shared-ui-jsx'
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
import { useFirestore, useFirestoreCollectionData, useUser } from 'reactfire'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'

const PLAN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'No plan (dark launch — everything on)' },
  { value: 'free', label: 'Free' },
  { value: 'starter', label: 'Starter' },
  { value: 'pro', label: 'Pro' },
  { value: 'business', label: 'Business' },
]

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

  const { data: tenantDocs } = useFirestoreCollectionData<any>(
    query(collection(firestore, 'tenants'), limit(200)),
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
    hostLimit: string
    before: any
  } | null>(null)

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

  const handleSave = useCallback(async () => {
    if (!editor) return
    const plan = editor.plan as TenantPlan | ''
    const hostLimit = Number(editor.hostLimit)
    const overrideHostLimit =
      editor.hostLimit.trim() !== '' &&
      Number.isFinite(hostLimit) &&
      plan &&
      hostLimit !== PLAN_ENTITLEMENTS[plan as TenantPlan]?.hostLimit
    const after = {
      plan: plan || null,
      entitlements: overrideHostLimit ? { hostLimit } : null,
    }
    try {
      await setDoc(
        doc(firestore, 'tenants', editor.id),
        {
          plan: plan || deleteField(),
          entitlements: overrideHostLimit
            ? { hostLimit }
            : deleteField(),
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
                          </TableCell>
                          <TableCell>
                            {tenant.subscription?.status ?? '--'}
                          </TableCell>
                          <TableCell>
                            {tenant.plan ? resolved.hostLimit : '∞ (no plan)'}
                            {tenant.entitlements?.hostLimit != null ? (
                              <Chip
                                label="override"
                                size="small"
                                variant="outlined"
                                sx={{ ml: 1 }}
                              />
                            ) : null}
                          </TableCell>
                          <TableCell align="right">
                            <Button
                              size="small"
                              onClick={() =>
                                setEditor({
                                  id: tenant.$id,
                                  plan: tenant.plan ?? '',
                                  hostLimit:
                                    tenant.entitlements?.hostLimit != null
                                      ? String(tenant.entitlements.hostLimit)
                                      : '',
                                  before: {
                                    plan: tenant.plan ?? null,
                                    entitlements:
                                      tenant.entitlements ?? null,
                                  },
                                })
                              }
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
        maxWidth="xs"
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
          <TextField
            size="small"
            label="Host limit override"
            type="number"
            value={editor?.hostLimit ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, hostLimit: event.target.value } : prev,
              )
            }
            helperText="Empty = plan default"
            disabled={!editor?.plan}
          />
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
