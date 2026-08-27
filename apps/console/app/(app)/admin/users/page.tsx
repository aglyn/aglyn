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
  Chip,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { GridColDef } from '@mui/x-data-grid'
import { mdiOpenInNew } from '@aglyn/shared-data-mdi'
import {
  ListRowActions,
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { TABLE_ROW_HEIGHT } from '../../../../constants/shared'
import { useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import StaffOnly from '../../../../components/staff-only.component'
import StaffListPaginationControls from '../../../../components/staff-list-pagination.component'
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
import { useStaffListPagination } from '../../../../hooks/use-staff-list-pagination'
import {
  gridFilterRequest,
  hiddenFilterColumns,
  hiddenFilterVisibility,
  listFilterColumn,
} from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  USER_LIST_FILTER_FIELDS,
  USER_LIST_FILTER_HEADERS,
} from '../../../../utils/list-filters'
import { collapseAdminUserRows } from '../../../../utils/collapse-admin-user-rows'
import { formatStaffTimestamp } from '../../../../utils/staff-timestamps'

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
/**
 * The filterable fields that get a column. The rest of
 * `USER_LIST_FILTER_FIELDS` still reaches the filter panel, as hidden columns.
 */
const USER_FILTER_COLUMNS = ['email', 'staffRole', 'createdAt', 'lastSignInAt']

const AdminUsers: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const isStaff = useIsStaff()
  const [truncatedTenants, setTruncatedTenants] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  // AGL-2131. Every write on this page — grant/revoke staff, set the role,
  // enable/disable the account — is super-only at
  // /api/admin/users/manage:93. The lookup and the listing are not.
  const { blocked: notSuper } = useSuperStaffGate()

  /**
   * The rows of every page visited this session, keyed by page index
   * (AGL-2486).
   *
   * This list used to ACCUMULATE — `[...previous, ...payload.users]` behind a
   * `Load more` button — and the AGL-2005 collapse below depended on that: a
   * uid living in two pools arrives as two rows, and because the route
   * appends the GCIP tenant users only on its LAST page, the emailless
   * project twin and the real SSO record land in different responses. Only a
   * list holding both could merge them.
   *
   * Paging replaces the rows instead, so the merge would have lost its second
   * half and the two-rows-for-one-human bug would be back the moment the
   * project pool needs a second page. Keeping what each page held costs one
   * map and restores it: the collapse is fed this page PLUS the rows of every
   * other page seen, then narrowed back to the uids on this page. A twin is
   * merged as soon as both its pages have been visited, and until then the
   * behaviour is exactly the per-page collapse the route already performs.
   */
  const pageRowsRef = useRef<Map<number, AdminUser[]>>(new Map())

  /** What `/api/admin/users` asks Firebase Auth for. Mirrored so the footer's
   * count line is arithmetic over the real page and not a guess. */
  const AUTH_LIST_PAGE_SIZE = 200

  /*
   * SEARCH AND FILTER RUN ON THE SERVER, or they are not search and filter
   * (AGL-693).
   *
   * Both used to narrow the rows already on screen — 200 accounts, one Auth
   * page — so both answered "no such account" for everyone past it. Firebase
   * Auth has no predicate to push them into, so `/api/admin/users` reads the
   * pools and matches there, routing a complete email to the O(1) lookup
   * first.
   *
   * The query lives in a REF, and `applyQuery` writes it before it asks for a
   * page. The fetcher is a dependency of the pagination hook, so holding the
   * query in state alone would rebuild it on every keystroke and restart the
   * walk — and writing the ref during render instead is a tick too late: the
   * grid's change handler asks for page 0 in the same tick, and the fetch
   * would read the query the panel had BEFORE the reader changed it, which
   * shows as a filter that highlights its column and narrows nothing.
   */
  type ListQuery = { field: string; op: string; value: string } | null
  const queryRef = useRef<{ search: string; filter: ListQuery }>({
    search: '',
    filter: null,
  })
  /** Set when the last response could not read the whole directory. */
  const [scanTruncated, setScanTruncated] = useState<{
    scan: boolean
    match: boolean
    count: number
  } | null>(null)

  const fetchUsersPage = useCallback(
    async (cursor: string | null, index: number) => {
      const idToken = await (user as any)?.getIdToken?.()
      const params = new URLSearchParams()
      const { search: term, filter: item } = queryRef.current
      if (term) params.set('search', term)
      if (item) {
        params.set('filterField', item.field)
        params.set('filterOp', item.op)
        params.set('filterValue', item.value)
      }
      // A narrowed list is not a page of the walk, so it carries no cursor —
      // resuming one would page through the unfiltered directory instead.
      if (cursor && !term && !item) params.set('nextPageToken', cursor)
      const query = params.toString()
      const response = await fetch(
        `/api/admin/users${query ? `?${query}` : ''}`,
        { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
      )
      if (!response.ok) throw new Error(`Listing failed (${response.status})`)
      const payload = await response.json()
      const rows = (payload.users ?? []) as AdminUser[]
      pageRowsRef.current.set(index, rows)
      // A tenant pool bigger than one page is reported, never dropped
      // silently (AGL-1122) — invisible users are the bug this fixed.
      setTruncatedTenants(payload.tenantTruncated ?? [])
      setScanTruncated(
        payload.scanTruncated || payload.matchTruncated
          ? {
              scan: Boolean(payload.scanTruncated),
              match: Boolean(payload.matchTruncated),
              count: Number(payload.matchCount ?? rows.length),
            }
          : null,
      )
      return {
        rows,
        nextCursor: payload.nextPageToken ?? null,
        hasMore: Boolean(payload.nextPageToken),
      }
    },
    [user],
  )
  const reportUsersError = useCallback(() => {
    enqueueSnackbar('Could not load users', { variant: 'error' })
  }, [enqueueSnackbar])
  /*
   * The console's shared footer (AGL-693), with the size menu deliberately
   * off. The page size here is Firebase Auth's, applied by
   * `/api/admin/users`: `listUsersAcrossPools` only appends tenant-pool users
   * once the project-level walk has run out of pages, so a smaller page would
   * push every enterprise SSO account behind several Next clicks. That is the
   * invisible-users bug AGL-1122 fixed, and it is not worth a menu.
   */
  const pagination = useStaffListPagination<AdminUser>({
    fetchPage: fetchUsersPage,
    onError: reportUsersError,
    enabled: Boolean(isStaff),
    pageSize: AUTH_LIST_PAGE_SIZE,
  })
  const router = useRouter()
  const { rows: users, pageIndex, loading, refresh } = pagination

  /**
   * Change the query and re-ask for the first page, in that order.
   *
   * A narrowed list is a different query, not a page of the old one, so it
   * restarts at page 0 — resuming a cursor would page through the unfiltered
   * directory instead.
   */
  const applyQuery = useCallback(
    (search: string, filter: ListQuery) => {
      queryRef.current = { search, filter }
      void pagination.loadPage(0)
    },
    [pagination],
  )


  const visible = useMemo(() => {
    // One row per human across EVERY page visited (AGL-2005). The route
    // collapses the twins, but it can only merge the rows it is handed at
    // once, and it is handed one page: the project pool paginates 200 at a
    // time and the SSO tenant users are appended only on the LAST page. So
    // past the first page the emailless twin and the real record arrive in
    // different responses, and this list showed the two rows again, the
    // twin with no merged chip on it. Re-applied here, where the list is
    // actually assembled.
    //
    // The rows of the OTHER pages are fed in beside this page's so a
    // cross-page twin still merges, then the result is narrowed back to the
    // uids this page holds — the collapse keeps each uid at its first
    // occurrence and this page's rows come first, so what survives is this
    // page, in page order, enriched.
    //
    // No narrowing happens here any more. The search and the filter are the
    // server's, so a row that arrived is a row that matched.
    const elsewhere: AdminUser[] = []
    pageRowsRef.current.forEach((rows, index) => {
      if (index !== pageIndex) elsewhere.push(...rows)
    })
    const onThisPage = new Set(users.map((record) => record.uid))
    return collapseAdminUserRows([...users, ...elsewhere]).filter((record) =>
      onThisPage.has(record.uid),
    )
  }, [users, pageIndex])

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
        refresh()
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
    [user, refresh, enqueueSnackbar],
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
        refresh()
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
    [confirm, user, refresh, enqueueSnackbar],
  )


  /*
   * Only the operators the SERVER can answer reach the panel — derived from
   * `USER_LIST_FILTER_FIELDS`, the same declaration `/api/admin/users` matches
   * against. This list matches in memory rather than through an index, so it
   * offers a mid-string `contains` and a `doesNotContain` that the
   * Firestore-backed lists cannot.
   */
  const filterColumn = useCallback(
    (column: string) => listFilterColumn(USER_LIST_FILTER_FIELDS, column),
    [],
  )

  /*
   * One row grammar, the console's (AGL-693). `valueGetter` on every column
   * the grid must SORT by something other than what it draws — a timestamp
   * rendered as text sorts as text, which puts 12 January before 2 February.
   */
  const userColumns: GridColDef[] = useMemo(
    () => [
      {
        field: 'email',
        headerName: 'User',
        flex: 1.6,
        minWidth: 280,
        ...filterColumn('email'),
        valueGetter: (_value, row: any) =>
          String(row.email ?? row.displayName ?? ''),
        renderCell: ({ row }: any) => (
          <Stack
            direction="row"
            spacing={0.5}
            useFlexGap
            sx={{ flexWrap: 'wrap', alignItems: 'center', height: '100%' }}
          >
            {/* Detail page (AGL-244); ids stay off the email line — copy
                them from the chip (AGL-360). A real anchor, so it can be
                middle-clicked or copied; the row's own click opens the same
                place. */}
            <AppLink
              variant="body2"
              color="inherit"
              underline="hover"
              href={buildRoute(Route.ADMIN_USER_DETAIL, { uid: row.uid })}
              onClick={(event: any) => event.stopPropagation()}
            >
              {/* An account with neither address nor name used to fall back
                  to the bare uid, which reads as an ordinary row and is what
                  made a shadow account look like a duplicate listing
                  (AGL-1962). */}
              {row.email ?? row.displayName ?? 'No email on this account'}
            </AppLink>
            <Chip
              size="small"
              variant="outlined"
              label={`${row.uid.slice(0, 8)}…`}
              sx={{ fontFamily: 'monospace' }}
              onClick={(event: any) => {
                event.stopPropagation()
                void navigator.clipboard
                  ?.writeText(row.uid)
                  .catch(() => undefined)
              }}
            />
            {/* An SSO account lives in its org's GCIP tenant pool (AGL-1122).
                A uid is only unique WITHIN a pool, and claims set on the
                project pool do not reach it — so "which pool" is not
                cosmetic. */}
            {row.tenantId ? (
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                label={`SSO · ${row.tenantId}`}
              />
            ) : null}
            {/* Merged is not hidden (AGL-2005): the surviving row says what
                was folded into it, or the fix would be a cover-up. */}
            {row.uidAlsoInPools?.length ? (
              <Tooltip
                title={
                  `This uid also exists in ${row.uidAlsoInPools
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
                  label={`merged · also in ${row.uidAlsoInPools
                    .map(poolLabel)
                    .join(', ')}`}
                />
              </Tooltip>
            ) : null}
          </Stack>
        ),
      },
      {
        field: 'staffRole',
        headerName: 'Status',
        flex: 0.8,
        minWidth: 150,
        ...filterColumn('staffRole'),
        valueGetter: (_value, row: any) =>
          row.staff ? (row.staffRole ?? 'support') : row.disabled ? 'disabled' : '',
        renderCell: ({ row }: any) => (
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', height: '100%' }}
            // A control, not an action: it must not also open the row.
            onClick={(event) => event.stopPropagation()}
          >
            {row.staff ? (
              <TextField
                select
                size="small"
                variant="standard"
                // A role-less account is `support` everywhere that enforces
                // (AGL-495/AGL-2131). Showing it as `super` here made the
                // console the last place still asserting the old fail-open.
                value={row.staffRole ?? 'support'}
                disabled={busy || notSuper}
                onChange={(event) => void handleSetRole(row, event.target.value)}
                sx={{ minWidth: 96 }}
              >
                <MenuItem value="support">{'support'}</MenuItem>
                <MenuItem value="billing">{'billing'}</MenuItem>
                <MenuItem value="super">{'super'}</MenuItem>
              </TextField>
            ) : null}
            {row.disabled ? (
              <Chip label="disabled" size="small" color="error" />
            ) : null}
          </Stack>
        ),
      },
      {
        field: 'createdAt',
        headerName: 'Created',
        flex: 0.9,
        minWidth: 170,
        // `type: 'date'` is what gives the panel a date PICKER rather than a
        // free-text box for a value the route parses as a day.
        type: 'date',
        ...filterColumn('createdAt'),
        valueGetter: (_value, row: any) =>
          row.createdAt ? new Date(row.createdAt) : null,
        renderCell: ({ row }: any) => (
          <Typography variant="caption" color="text.secondary">
            {formatStaffTimestamp(row.createdAt)}
          </Typography>
        ),
      },
      {
        field: 'lastSignInAt',
        headerName: 'Last sign-in',
        flex: 0.9,
        minWidth: 170,
        // `type: 'date'` is what gives the panel a date PICKER rather than a
        // free-text box for a value the route parses as a day.
        type: 'date',
        ...filterColumn('lastSignInAt'),
        valueGetter: (_value, row: any) =>
          row.lastSignInAt ? new Date(row.lastSignInAt) : null,
        renderCell: ({ row }: any) => (
          <Typography variant="caption" color="text.secondary">
            {formatStaffTimestamp(row.lastSignInAt)}
          </Typography>
        ),
      },
      /*
       * Filterable fields that are not worth a column of their own — the uid,
       * the SSO pool, the sign-in providers, the disabled flag. MUI's panel
       * lists column definitions, hidden ones included, so this is what makes
       * a filterable non-column reachable at all.
       */
      ...hiddenFilterColumns(
        USER_LIST_FILTER_FIELDS,
        USER_FILTER_COLUMNS,
        USER_LIST_FILTER_HEADERS,
      ),
      listActionsColumn((row: any) => (
        <ListRowActions
          label={row.email ?? row.uid}
          quick={{
            icon: mdiOpenInNew.path,
            label: 'View',
            to: buildRoute(Route.ADMIN_USER_DETAIL, { uid: row.uid }),
          }}
          items={[
            {
              key: 'staff',
              label: row.staff ? 'Revoke staff' : 'Grant staff',
              onClick: handleAction(
                row,
                row.staff ? 'revokeStaff' : 'grantStaff',
                row.staff ? 'Revoke staff' : 'Grant staff',
              ),
              disabled: busy || notSuper,
              disabledReason: notSuper
                ? 'Only super staff may change staff access.'
                : undefined,
            },
            {
              key: 'disable',
              label: row.disabled ? 'Enable' : 'Disable',
              destructive: !row.disabled,
              onClick: handleAction(
                row,
                row.disabled ? 'enable' : 'disable',
                row.disabled ? 'Enable account' : 'Disable account',
              ),
              disabled: busy || notSuper,
              disabledReason: notSuper
                ? 'Only super staff may disable an account.'
                : undefined,
            },
          ]}
        />
      )),
    ],
    [busy, notSuper, handleAction, handleSetRole, filterColumn],
  )

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        { children: 'Users', href: buildRoute(Route.ADMIN_USERS) },
      ]}
      help={{ topic: 'staffConsole', anchor: '#users-admin' }}
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
                'Grant or revoke staff roles and disable accounts — audited, with search and column filters that reach every pool, not just the loaded page.',
            })}
            contentGutterX
            contentGutterY
          >
            <Stack spacing={2}>
              {/* Staff is granted to an existing account, not invited
                  (AGL-853): custom claims attach to a real uid, so the
                  person must have signed in at least once before they turn
                  up here. */}
              <Typography variant="caption" color="text.secondary">
                {'Staff access is granted to an existing account. If someone ' +
                  "isn't found, have them sign in to Aglyn once, then search " +
                  'their email here.'}
              </Typography>
              <ListTable
                rows={visible}
                columns={userColumns}
                getRowId={(row: any) => row.uid}
                loading={loading}
                /*
                 * The grid must NOT also filter. The server answers both the
                 * search and the column filter, so a second client-side pass
                 * over the returned rows could only drop rows that already
                 * matched — the route compares an account's stored fields,
                 * and the grid compares whatever a column happens to draw.
                 */
                filterMode="server"
                onFilterModelChange={(model) => {
                  applyQuery(
                    (model.quickFilterValues ?? []).join(' ').trim(),
                    gridFilterRequest(model),
                  )
                }}
                onOpen={(id) =>
                  router.push(buildRoute(Route.ADMIN_USER_DETAIL, { uid: id }))
                }
                // Server-paged through Firebase Auth: the footer below owns
                // the page, so the grid must not also slice these rows.
                hideFooter
                // The console's row height, like every other grid list.
                rowHeight={TABLE_ROW_HEIGHT}
                initialState={{
                  columns: {
                    columnVisibilityModel: hiddenFilterVisibility(
                      USER_LIST_FILTER_FIELDS,
                      USER_FILTER_COLUMNS,
                    ),
                  },
                }}
              />
              {/* Previous/Next instead of an ever-growing table (AGL-2486),
                  the same control the Organizations list carries. The count
                  is the COLLAPSED row count, not the raw page length — this
                  is the screen staff check when they think an account is
                  missing, so it must not claim a row it did not draw. */}
              <StaffListPaginationControls
                sizeMenu={false}
                pagination={pagination}
                shown={visible.length}
              />
              {/* A partial answer never reads as a complete one. A staff
                  list that stopped early and said "no matches" is the whole
                  failure this change is about. */}
              {scanTruncated ? (
                <Alert severity="warning">
                  {scanTruncated.scan
                    ? 'More accounts exist than this search could read. ' +
                      'Narrow it, or search an exact email to reach an ' +
                      'account directly.'
                    : `${scanTruncated.count} accounts matched; the first ` +
                      'are shown. Narrow the search to see the rest.'}
                </Alert>
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
