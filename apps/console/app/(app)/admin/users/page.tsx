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
  AppLink,
  CardDisplay,
  Container,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
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
  Tooltip,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import StaffOnly from '../../../../components/staff-only.component'
import {
  SuperStaffOnlyNotice,
  useSuperStaffGate,
} from '../../../../components/staff-super-only.component'
import { useIsStaff } from '../../../../hooks/use-is-staff'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'

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
  /**
   * GCIP tenant id when the account lives in an enterprise SSO pool, else
   * null for the project-level pool (AGL-1122). Worth showing: a tenant user
   * is a different kind of account — its custom claims are per-pool, so staff
   * actions on it are not the same operation as on a project user.
   */
  tenantId?: string | null
  /**
   * Other pools holding this same uid (AGL-1962). A uid is unique only
   * WITHIN a pool, so this is never normal — it means a custom token was
   * minted for one pool's uid against another, and `signInWithCustomToken`
   * created an empty shadow account instead of refusing.
   *
   * Those rows arrive merged (AGL-2005), so on a row this names the pools
   * folded into it — the record shown is the identified one. Kept visible
   * because a merge that says nothing is indistinguishable from a duplicate
   * being quietly dropped.
   */
  uidAlsoInPools?: (string | null)[] | null
}

/** How a pool reads in a sentence — the project pool has no tenant id. */
const poolLabel = (tenantId: string | null) =>
  tenantId ? `SSO tenant ${tenantId}` : 'the project pool'

/**
 * Staff users admin (AGL-204): account listing with staff-claim and
 * disable toggles — staff grants no longer require the CLI script. All
 * actions go through the audited /api/admin/users/manage endpoint, which
 * also blocks self-lockout.
 */
const AdminUsers: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const isStaff = useIsStaff()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [truncatedTenants, setTruncatedTenants] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  // AGL-2131. Every write on this page — grant/revoke staff, set the role,
  // enable/disable the account — is super-only at
  // /api/admin/users/manage:93. The lookup and the listing are not.
  const { blocked: notSuper } = useSuperStaffGate()

  const loadPage = useCallback(
    async (pageToken?: string | null, email?: string) => {
      const idToken = await (user as any)?.getIdToken?.()
      // Exact-email lookup (AGL-270) replaces the page with the match.
      const params = email
        ? `?email=${encodeURIComponent(email)}`
        : pageToken
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
      // A tenant pool bigger than one page is reported, never dropped
      // silently (AGL-1122) — invisible users are the bug this fixed.
      setTruncatedTenants(payload.tenantTruncated ?? [])
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
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        { children: 'Users', href: buildRoute(Route.ADMIN_USERS) },
      ]}
      help="staffConsole"
      header={{
        children: 'User Management',
        icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <SuperStaffOnlyNotice what="Granting staff, setting a role and disabling an account" />
          <CardDisplay
            header={'Accounts'}
            help={docsHelp('staffConsole', {
              anchor: '#whats-there',
              excerpt:
                'Grant or revoke staff roles and disable accounts — audited, with an exact-email lookup for accounts beyond the loaded pages.',
            })}
            contentGutterX
            contentGutterY
          >
            <Stack spacing={2}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center' }}
              >
                <TextField
                  size="small"
                  label="Search (email, name, uid)"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  sx={{ maxWidth: 360, flexGrow: 1 }}
                />
                {/* Exact-email lookup (AGL-270): reaches accounts beyond
                    the loaded pages. */}
                <Button
                  size="small"
                  disabled={!search.includes('@')}
                  onClick={() =>
                    void loadPage(null, search.trim()).catch(() =>
                      enqueueSnackbar('Lookup failed', { variant: 'error' }),
                    )
                  }
                >
                  {'Find exact email'}
                </Button>
                <Button size="small" onClick={() => void loadPage()}>
                  {'Reset'}
                </Button>
              </Stack>
              {/* Staff is granted to an existing account, not invited
                  (AGL-853): custom claims attach to a real uid, so the
                  person must have signed in at least once before they turn
                  up here. */}
              <Typography variant="caption" color="text.secondary">
                {'Staff access is granted to an existing account. If someone ' +
                  "isn't found, have them sign in to Aglyn once, then search " +
                  'their email here.'}
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{'User'}</TableCell>
                    <TableCell>{'Status'}</TableCell>
                    <TableCell>{'Created'}</TableCell>
                    <TableCell>{'Last sign-in'}</TableCell>
                    <TableCell align="right">{'Actions'}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visible.map((record) => (
                    <TableRow key={record.uid} hover>
                      <TableCell>
                        {/* Detail page (AGL-244); ids stay off the email
                            line — copy them from the chip (AGL-360). */}
                        <AppLink
                          variant="body2"
                          color="inherit"
                          underline="hover"
                          href={buildRoute(Route.ADMIN_USER_DETAIL, {
                            uid: record.uid,
                          })}
                        >
                          {/* An account with neither address nor name used to
                              fall back to the bare uid, which reads as an
                              ordinary row and is what made a shadow account
                              look like a duplicate listing (AGL-1962). Say
                              that the address is missing instead — the uid is
                              still on the chip beside it. */}
                          {record.email ??
                            record.displayName ??
                            'No email on this account'}
                        </AppLink>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`${record.uid.slice(0, 8)}…`}
                          sx={{ ml: 1, fontFamily: 'monospace' }}
                          onClick={() =>
                            void navigator.clipboard
                              ?.writeText(record.uid)
                              .catch(() => undefined)
                          }
                        />
                        {/* An SSO account lives in its org's GCIP tenant pool
                            (AGL-1122). Say so: a uid is only unique WITHIN a
                            pool, and claims set on the project pool do not
                            reach it — so "which pool" is not cosmetic. */}
                        {record.tenantId ? (
                          <Chip
                            size="small"
                            color="primary"
                            variant="outlined"
                            label={`SSO · ${record.tenantId}`}
                            sx={{ ml: 1 }}
                          />
                        ) : null}
                        {/* One uid, more than one pool. The rows are merged
                            now (AGL-2005) — Zach asked to see one user, not
                            two — but merged is not the same as hidden, so the
                            surviving row says what was folded into it and
                            which pools those records are in. Without this the
                            fix would be a cover-up: a genuine duplicate would
                            vanish from the console with nothing to notice. */}
                        {record.uidAlsoInPools?.length ? (
                          <Tooltip
                            title={
                              `This uid also exists in ${record.uidAlsoInPools
                                .map(poolLabel)
                                .join(', ')}. A uid is unique only WITHIN a ` +
                              'pool, so a second copy is not a second person — ' +
                              'it is an account minted by a cross-pool custom ' +
                              'token. The row shown is the record that ' +
                              'identifies the person, and it is the one every ' +
                              'action here targets.'
                            }
                          >
                            <Chip
                              size="small"
                              color="warning"
                              label={`merged · also in ${record.uidAlsoInPools
                                .map(poolLabel)
                                .join(', ')}`}
                              sx={{ ml: 1 }}
                            />
                          </Tooltip>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {record.staff ? (
                          <TextField
                            select
                            size="small"
                            variant="standard"
                            // A role-less account is `support` everywhere
                            // that enforces (AGL-495/AGL-2131). Showing it as
                            // `super` here made the console the last place
                            // still asserting the old fail-open — and it is
                            // the screen an operator uses to decide whether
                            // an account needs fixing.
                            value={record.staffRole ?? 'support'}
                            disabled={busy || notSuper}
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
                          {record.createdAt
                            ? new Date(record.createdAt).toLocaleDateString()
                            : '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {record.lastSignInAt
                            ? new Date(record.lastSignInAt).toLocaleDateString()
                            : '—'}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <AppLink
                          componentVariant="button"
                          size="small"
                          variant="outlined"
                          href={buildRoute(Route.ADMIN_USER_DETAIL, {
                            uid: record.uid,
                          })}
                          sx={{ mr: 0.5 }}
                        >
                          {'View'}
                        </AppLink>
                        <Button
                          size="small"
                          disabled={busy || notSuper}
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
                          disabled={busy || notSuper}
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
              {/* Never let a pool go quietly missing again (AGL-1122). */}
              {truncatedTenants.length ? (
                <Alert severity="warning">
                  {`Only the first users are shown for SSO ${
                    truncatedTenants.length === 1 ? 'tenant' : 'tenants'
                  } ${truncatedTenants.join(', ')} — search by exact email to ` +
                    'reach an account that is not listed.'}
                </Alert>
              ) : null}
            </Stack>
          </CardDisplay>
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}
AdminUsers.displayName = 'Page:AdminUsers'

export default AdminUsers
