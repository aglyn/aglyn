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

import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import {
  CardDisplay,
  Container,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useUser } from 'reactfire'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'

interface AdminUser {
  uid: string
  email: string | null
  displayName: string | null
  disabled: boolean
  staff: boolean
  staffRole: string | null
  createdAt: string | null
  lastSignInAt: string | null
  providers: string[]
}

/**
 * Staff users admin (AGL-204): account listing with staff-claim and
 * disable toggles — staff grants no longer require the CLI script. All
 * actions go through the audited /api/admin/users/manage endpoint, which
 * also blocks self-lockout.
 */
const AdminUsers: NextPageWithLayout = () => {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [isStaff, setIsStaff] = useState<boolean | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  const loadPage = useCallback(
    async (pageToken?: string | null) => {
      const idToken = await (user as any)?.getIdToken?.()
      const params = pageToken
        ? `?nextPageToken=${encodeURIComponent(pageToken)}`
        : ''
      const response = await fetch(`/api/admin/users${params}`, {
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
      })
      if (!response.ok) throw new Error(`Listing failed (${response.status})`)
      const payload = await response.json()
      setUsers((previous) =>
        pageToken ? [...previous, ...payload.users] : payload.users,
      )
      setNextPageToken(payload.nextPageToken ?? null)
    },
    [user],
  )

  useEffect(() => {
    if (isStaff) {
      void loadPage().catch((error) => {
        console.error(error)
        enqueueSnackbar('Could not load users', { variant: 'error' })
      })
    }
  }, [isStaff, loadPage, enqueueSnackbar])

  const [search, setSearch] = useState('')
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return users
    return users.filter((record) =>
      [record.email, record.displayName, record.uid]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term),
    )
  }, [users, search])

  // RBAC (AGL-206): role changes go through the same audited endpoint.
  const handleSetRole = useCallback(
    async (record: AdminUser, role: string) => {
      setBusy(true)
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/admin/users/manage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ action: 'setRole', uid: record.uid, role }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(payload?.error ?? 'Role change failed', {
            variant: 'error',
            allowDuplicate: true,
          })
        }
        enqueueSnackbar(`Role set to ${role} (audited)`, {
          variant: 'success',
          persist: false,
        })
        await loadPage()
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setBusy(false)
      }
    },
    [user, loadPage, enqueueSnackbar],
  )

  const handleAction = useCallback(
    (record: AdminUser, action: string, description: string) => async () => {
      const confirmed = await confirm({
        title: `${description}?`,
        description: `${record.email ?? record.uid} — this is audited.`,
        confirmationText: 'Confirm',
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      setBusy(true)
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/admin/users/manage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ action, uid: record.uid }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(payload?.error ?? 'Action failed', {
            variant: 'error',
            allowDuplicate: true,
          })
        }
        enqueueSnackbar(`${description} (audited)`, {
          variant: 'success',
          persist: false,
        })
        await loadPage()
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setBusy(false)
      }
    },
    [confirm, user, loadPage, enqueueSnackbar],
  )

  return (
    <>
      <NextPageTitle screen={'Users – Staff'} />
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
        activeTab={buildRoute(Route.ADMIN_USERS)}
        breadcrumbItems={[
          { children: 'Staff', href: buildRoute(Route.ADMIN_TENANTS) },
          { children: 'Users', href: buildRoute(Route.ADMIN_USERS) },
        ]}
        header={{
          children: 'User Management',
          icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {isStaff === null ? null : !isStaff ? (
            <Alert severity="error">
              {'This area requires the staff role.'}
            </Alert>
          ) : (
            <CardDisplay header={'Accounts'} contentGutterX contentGutterY>
              <Stack spacing={2}>
                <TextField
                  size="small"
                  label="Search (email, name, uid)"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  sx={{ maxWidth: 360 }}
                />
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{'User'}</TableCell>
                      <TableCell>{'Status'}</TableCell>
                      <TableCell>{'Last sign-in'}</TableCell>
                      <TableCell align="right">{'Actions'}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visible.map((record) => (
                      <TableRow key={record.uid} hover>
                        <TableCell>
                          <Typography variant="body2">
                            {record.email ?? record.displayName ?? record.uid}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontFamily: 'monospace' }}
                          >
                            {record.uid}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {record.staff ? (
                            <TextField
                              select
                              size="small"
                              variant="standard"
                              value={record.staffRole ?? 'super'}
                              onChange={(event) =>
                                void handleSetRole(record, event.target.value)
                              }
                              sx={{ minWidth: 96, mr: 1 }}
                            >
                              <MenuItem value="support">{'support'}</MenuItem>
                              <MenuItem value="billing">{'billing'}</MenuItem>
                              <MenuItem value="super">{'super'}</MenuItem>
                            </TextField>
                          ) : null}
                          {record.disabled ? (
                            <Chip
                              label="disabled"
                              size="small"
                              color="error"
                              sx={{ ml: record.staff ? 1 : 0 }}
                            />
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">
                            {record.lastSignInAt
                              ? new Date(record.lastSignInAt).toLocaleDateString()
                              : '—'}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            disabled={busy}
                            onClick={handleAction(
                              record,
                              record.staff ? 'revokeStaff' : 'grantStaff',
                              record.staff ? 'Revoke staff' : 'Grant staff',
                            )}
                          >
                            {record.staff ? 'Revoke staff' : 'Grant staff'}
                          </Button>
                          <Button
                            size="small"
                            color={record.disabled ? 'success' : 'error'}
                            disabled={busy}
                            onClick={handleAction(
                              record,
                              record.disabled ? 'enable' : 'disable',
                              record.disabled
                                ? 'Enable account'
                                : 'Disable account',
                            )}
                          >
                            {record.disabled ? 'Enable' : 'Disable'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {nextPageToken ? (
                  <Button
                    size="small"
                    sx={{ alignSelf: 'flex-start' }}
                    onClick={() => void loadPage(nextPageToken)}
                  >
                    {'Load more'}
                  </Button>
                ) : null}
              </Stack>
            </CardDisplay>
          )}
        </Container>
      </DashboardLayout>
    </>
  )
}
AdminUsers.displayName = 'Page:AdminUsers'
AdminUsers.layouts = [
  { Component: AuthenticatedLayout },
  { Component: MainLayout, props: { title: 'Users – Staff' } },
]

export default AdminUsers
