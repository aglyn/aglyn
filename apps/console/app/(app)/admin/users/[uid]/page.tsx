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
  CONSOLE_USER_TYPE_LABELS,
  consoleUserType,
  orgOverrideReasonSummary,
} from '@aglyn/aglyn'
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import {
  AppLink,
  CardDisplay,
  Container,
  GridItems,
} from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  Link,
  Stack,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useParams } from 'next/navigation'
import type { GridColDef } from '@mui/x-data-grid'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth, useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../../../components/layouts/authenticated.layout'
import CardColumns from '../../../../../components/card-columns.component'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import StaffOnly from '../../../../../components/staff-only.component'
import MainLayout from '../../../../../components/layouts/main.layout'
import PasswordAdminControls from '../../../../../components/password-admin-controls.component'
import StaffUserDeviceSessionsCard, {
  type StaffDeviceRow,
} from '../../../../../components/staff-user-device-sessions-card.component'
import StaffUserEraseCard from '../../../../../components/staff-user-erase-card.component'
import StaffUserEmailHistoryCard, {
  type StaffEmailDeliveryRow,
} from '../../../../../components/staff-user-email-history-card.component'
import { useImpersonationReason } from '../../../../../components/staff-impersonation-dialog.component'
import { docsHelp } from '../../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../../constants/route-links'
import {
  CONTENT_MAX_WIDTH,
  TABLE_PAGE_SIZE_DEFAULT,
} from '../../../../../constants/shared'
import ActivityTable from '../../../../../components/activity-table.component'
import { useDeclareDocumentSubject } from '../../../../../components/document-subject'
import ActorActivityTable from '../../../../../components/actor-activity-table.component'
import { legalAcceptanceDocumentHref } from '../../../../../utils/legal-document-link'
import { formatStaffTimestamp } from '../../../../../utils/staff-timestamps'

interface UserDetail {
  user: {
    uid: string
    email: string | null
    displayName: string | null
    disabled: boolean
    staff: boolean
    staffRole: string | null
    /**
     * Each sign-in provider AND the address it carries.
     *
     * Was `string[]` of provider ids alone, which showed that an account had
     * a Google provider and not which mailbox it was for — while that address
     * receives real mail and, never having entered the uniqueness index, is
     * the one most likely to be quietly shared with another account.
     */
    providers: Array<{ providerId: string; email: string | null }>
    createdAt: string | null
    lastSignInAt: string | null
    /**
     * The phone the profile holds, and whether we are allowed to use it
     * (AGL-1569). `phoneContact` is null when there is no number on file.
     */
    phoneNumber: string | null
    phoneNumberErasedAt: string | null
    phoneContact: {
      suppressed: boolean
      channels: string[]
      source: string | null
      erasePhoneOnFile: boolean
      revokedAt: string | null
      lookupFailed: boolean
    } | null
  }
  memberships: Array<{
    orgId: string
    orgName: string | null
    slug: string | null
    role: string | null
    roleId: string | null
    allHosts: boolean
    hostAccess: Record<string, string>
    joinedAt: string | null
  }>
  audit: Array<{
    id: string
    actorUid: string | null
    action: string | null
    target: string | null
    /** The person the entry is ABOUT, when the writer could resolve one. */
    subjectUid: string | null
    /** WHY, when the row carries one (AGL-1652) — see `org.override`. */
    reason: string | null
    note: string | null
    at: string | null
    /**
     * One act recorded more than once, collapsed onto one row. `1` and a null
     * `lastAt` are the ordinary case; anything higher must be rendered, or
     * the card under-reports an access the writer merged.
     */
    repeatCount: number
    lastAt: string | null
    /** `access` looked; `change` altered something or acted on someone. */
    kind: 'access' | 'change'
  }>
  /**
   * Clickwrap acceptance history and the ToS §18.5 verdicts (AGL-2316).
   *
   * Every verdict is nullable and `lookupFailed` is separate, because the
   * three states here are "accepted", "no record", and "we could not read" —
   * and a dispute is the last place to let the third quietly render as the
   * second.
   */
  legal?: {
    lookupFailed: boolean
    currentVersion: string
    accepted: boolean | null
    acceptedVersions: string[]
    latestAcceptedVersion: string | null
    currentVersionAcceptedAt: string | null
    reacceptanceRequired: boolean | null
    reacceptanceReason: 'none' | 'never-accepted' | 'version-superseded' | null
    arbitration: {
      firstAcceptedAt: string | null
      deadline: string | null
      open: boolean | null
      daysRemaining: number | null
    } | null
    acceptances: Array<{
      version: string
      acceptedAt: string | null
      context: string | null
      method: string | null
      ipAddress: string | null
      userAgent: string | null
      documents: Array<{
        key: string
        url: string
        sha256?: string
        bytes?: number
      }>
    }>
  }
  /**
   * Sign-in history + whether it could be read at all (AGL-1513 part 2).
   * Optional because a console deployed against an older API response must
   * render the page rather than crash on `.rows`.
   */
  devices?: {
    lookupFailed: boolean
    rows: StaffDeviceRow[]
  }
  /**
   * Delivery history for the account's address (what we sent, whether it
   * arrived, whether it was opened or clicked). Optional for the same reason
   * `devices` is: a console deployed against an older API response must
   * render the page rather than crash on `.rows`.
   */
  emails?: {
    lookupFailed: boolean
    rows: StaffEmailDeliveryRow[]
    /** The addresses the history was actually read under. */
    addressesRead?: string[]
    /**
     * Addresses whose delivery records were destroyed under an erasure
     * request. Kept apart from "no mail" for the same reason `lookupFailed`
     * is: all three render as an empty table and mean different things.
     */
    erasures?: Record<string, { at: number; count: number }>
  }
  /**
   * Every address this account holds — primary, provider-supplied, and the
   * ones it has been moved off — with whether another account holds it too.
   */
  addresses?: Array<{
    address: string
    sources: string[]
    shared: boolean
    /** A provider asserted this address but another account already held it. */
    indexConflict: boolean
  }>
  /** A source was unreadable, so `addresses` may be short. */
  addressesIncomplete?: boolean
}

/**
 * Staff user detail (AGL-244): what is this account — identity + auth
 * state, staff role, org memberships with per-site access, and its
 * recent audit trail — plus impersonation (AGL-246).
 */
const AdminUserDetail: NextPageWithLayout<Record<string, never>> = () => {
  const params = useParams<{ uid: string }>()
  const uid = params?.uid
  const { data: user } = useUser()
  const auth = useAuth()
  const { enqueueSnackbar } = useSnackbar()
  const [detail, setDetail] = useState<UserDetail | null>(null)
  /*
   * The audit trail PAGES (AGL-2501). It is the one table on this page whose
   * length is a function of how much the account has DONE rather than of what
   * it is: memberships and legal acceptances are a handful either way, and an
   * audited action is written every time staff act on this user or this user
   * acts anywhere. A long-lived account rendered the whole trail in one wall
   * at the bottom of an already long page.
   *
   * `/api/admin/users/detail` returns the window it already bounds, so the
   * footer takes a real total. Paging deeper than that window is what the
   * Audit log page is for, and the card says so.
   */
  const [auditPage, setAuditPage] = useState(0)
  const [auditPageSize, setAuditPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const [accessPage, setAccessPage] = useState(0)
  const [accessPageSize, setAccessPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const [error, setError] = useState<string | null>(null)
  // Memoized rather than `detail?.audit ?? []` inline: a fresh empty array on
  // every render re-runs the slice below forever.
  const allAuditEntries = useMemo(() => detail?.audit ?? [], [detail])
  /*
   * TWO TABLES, BECAUSE A READ MUST NOT BE ABLE TO BURY AN IMPERSONATION.
   *
   * One list held both, newest first, and a handful of `email.message-viewed`
   * rows pushed `user.impersonate` and `org.override` off the visible page —
   * the entries somebody opens this card to find. Separating them is what
   * makes that structurally impossible rather than a matter of how the
   * ranking happens to fall today: the two categories no longer compete for
   * the same rows, and each pages on its own.
   *
   * Filtering one table would have been less page, but it puts the answer
   * behind a control whose default hides half the record. These are also two
   * different questions — "what was done to this account" and "who looked at
   * this account's data" — and the page already reads as a stack of separately
   * titled logs.
   */
  const auditEntries = useMemo(
    () => allAuditEntries.filter((entry) => entry.kind !== 'access'),
    [allAuditEntries],
  )
  const accessEntries = useMemo(
    () => allAuditEntries.filter((entry) => entry.kind === 'access'),
    [allAuditEntries],
  )
  /**
   * The audit trail's columns, in the console's row grammar (AGL-2501).
   *
   * This card and "Activity by this account" directly above it now render the
   * same table — `ActivityTable` owns the card, the grid, the toolbar, the
   * empty state and the footer — so a staff member reading two audit tables
   * stacked on one page reads them the same way. What stays different is what
   * they are OF: the one above is what this account DID, this one is what was
   * done BY or TO it, and both descriptions say so.
   */
  /**
   * NAME first, then email, then uid.
   *
   * The header and the breadcrumb both printed the email while the Identity
   * card directly beneath them printed the name, so the page led with one
   * identifier and then introduced the account by another. Staff still search
   * by address — the Identity card keeps it above the fold, which is why the
   * header can lead with the name at all.
   *
   * The uid is the last entry rather than a blank: an account genuinely
   * without a name or an address is rare and must still be identifiable, and
   * an empty header would be the one answer that names nothing. Same
   * precedence the staff console already uses for an organization.
   *
   * `null` until the read settles, so both surfaces hold their placeholder
   * rather than painting the email and swapping it a moment later — a title
   * that corrects itself reads as the page having made a mistake.
   */
  const accountLabel = detail
    ? (detail.user.displayName?.trim() ||
      detail.user.email ||
      detail.user.uid)
    : null
  // The browser tab, through the shared subject — which already holds the
  // server's id title until a name arrives, so the tab cannot flicker through
  // the wrong one either.
  useDeclareDocumentSubject(uid, accountLabel ?? undefined)

  const auditColumns: GridColDef[] = useMemo(
    () => [
      { field: 'action', headerName: 'Action', flex: 1.2, minWidth: 180 },
      { field: 'target', headerName: 'Target', flex: 1.2, minWidth: 180 },
      {
        // An `org.override` this account performed shows up here too, so the
        // reason has to reach this table as well (AGL-1652) — the audit page
        // is not the only place the act is read from.
        field: 'reason',
        headerName: 'Why',
        flex: 1,
        minWidth: 160,
        valueGetter: (_value: unknown, row: any) =>
          orgOverrideReasonSummary(row.reason, row.note) ?? '—',
      },
      {
        field: 'actorUid',
        headerName: 'Actor',
        flex: 0.9,
        minWidth: 150,
        /*
         * "this account" is a real answer, not a placeholder: the route reads
         * two halves — entries this account performed, and entries performed
         * against it — so a row is either one or the other. The other half
         * still shows a bare staff uid, which is a name this page does not
         * resolve; that is a separate gap from the one this column had.
         */
        valueGetter: (_value: unknown, row: any) =>
          row.actorUid === detail?.user.uid
            ? 'this account'
            : (row.actorUid ?? '—'),
        renderCell: ({ row }: any) =>
          row.actorUid === detail?.user.uid ? (
            <Chip size="small" variant="outlined" label="this account" />
          ) : (
            (row.actorUid ?? '—')
          ),
      },
      {
        field: 'at',
        headerName: 'When',
        flex: 1,
        minWidth: 180,
        // `type: 'date'` gives the panel a date picker, and sorting happens on
        // the instant rather than on the rendered string — a grid sorting the
        // rendered text orders it alphabetically.
        type: 'date',
        valueGetter: (_value: unknown, row: any) =>
          row.at ? new Date(row.at) : null,
        /*
         * A COLLAPSED ROW SAYS SO.
         *
         * The writer merges an immediate repeat of one act onto the row
         * already there rather than adding a second. Printing only the first
         * instant would hide that, and a row that quietly stands for several
         * accesses is the same lie as a missing row — so the count and the
         * last occurrence are rendered whenever there was more than one.
         */
        renderCell: ({ row }: any) => {
          if (!row.at) return '—'
          const first = new Date(row.at).toLocaleString()
          if (!(row.repeatCount > 1)) return first
          const last = row.lastAt
            ? new Date(row.lastAt).toLocaleTimeString()
            : null
          return `${first} · ${row.repeatCount}x${last ? `, last ${last}` : ''}`
        },
      },
    ],
    [detail?.user.uid],
  )
  const pagedAudit = useMemo(
    () =>
      auditEntries.slice(
        auditPage * auditPageSize,
        auditPage * auditPageSize + auditPageSize,
      ),
    [auditEntries, auditPage, auditPageSize],
  )
  const pagedAccess = useMemo(
    () =>
      accessEntries.slice(
        accessPage * accessPageSize,
        accessPage * accessPageSize + accessPageSize,
      ),
    [accessEntries, accessPage, accessPageSize],
  )
  // A reload that returns a shorter trail can strand a reader past the last
  // page, which renders as an empty table with no way back.
  useEffect(() => {
    const lastPage = Math.max(
      0,
      Math.ceil(auditEntries.length / auditPageSize) - 1,
    )
    if (auditPage > lastPage) setAuditPage(lastPage)
  }, [auditEntries.length, auditPage, auditPageSize])
  useEffect(() => {
    const lastPage = Math.max(
      0,
      Math.ceil(accessEntries.length / accessPageSize) - 1,
    )
    if (accessPage > lastPage) setAccessPage(lastPage)
  }, [accessEntries.length, accessPage, accessPageSize])

  useEffect(() => {
    if (!uid || !user) return
    let active = true
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch(
          `/api/admin/users/detail?uid=${encodeURIComponent(uid)}`,
          { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
        )
        const payload = await response.json()
        if (!active) return
        if (!response.ok) {
          setError(payload?.error ?? 'Lookup failed')
          return
        }
        setDetail(payload)
      } catch {
        if (active) setError('Lookup failed')
      }
    })()
    return () => {
      active = false
    }
  }, [uid, user])

  // Identity editing (AGL-361): names, photo, email through the audited
  // manage endpoint.
  const [edit, setEdit] = useState({
    displayName: '',
    email: '',
    photoUrl: '',
  })
  const [editBusy, setEditBusy] = useState(false)
  useEffect(() => {
    if (!detail) return
    setEdit({
      displayName: detail.user.displayName ?? '',
      email: detail.user.email ?? '',
      photoUrl: (detail.user as any).photoUrl ?? '',
    })
  }, [detail])
  const handleIdentitySave = useCallback(async () => {
    if (!uid || editBusy) return
    setEditBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/admin/users/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ action: 'updateProfile', uid, ...edit }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Update failed', {
          variant: 'warning',
          persist: false,
        })
      }
      enqueueSnackbar('Identity updated', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Update failed', { variant: 'error' })
    } finally {
      setEditBusy(false)
    }
  }, [uid, edit, editBusy, user, enqueueSnackbar])

  // Password help (AGL-912). Throws on failure so PasswordAdminControls
  // surfaces the endpoint's own message — "no email address", "too
  // repetitive", "check email settings" are all things the staffer must see
  // verbatim to know what to do next.
  const callManage = useCallback(
    async (payload: Record<string, unknown>) => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/admin/users/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ uid, ...payload }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        // The failure BODY, not just its message (AGL-1977). `erase` answers
        // `owns-orgs` with a `blockers` list precisely so a caller can name
        // the workspaces that need handing over; flattening the response to
        // `new Error(body.error)` threw that away, leaving the only actionable
        // refusal in the endpoint reading as a generic failure.
        const failure = Object.assign(
          new Error(body?.error ?? 'Request failed'),
          {
            skippedReason: body?.skippedReason,
            blockers: body?.blockers,
            sharedAddresses: body?.sharedAddresses,
            status: response.status,
          },
        )
        throw failure
      }
      return body
    },
    [uid, user],
  )

  // The mint, the reason dialog and the sign-in all live in
  // `useImpersonationReason` (AGL-2125): the route requires a reason and
  // records it on the audit row, so this page must not be able to reach the
  // endpoint around the dialog that collects one.
  const impersonation = useImpersonationReason({ auth, user })

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Users', href: buildRoute(Route.ADMIN_USERS) },
        {
          children: accountLabel ?? 'User',
          href: '#',
        },
      ]}
      header={{
        children: accountLabel ?? 'User',
        icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
      }}
      help={{ topic: 'staffConsole', anchor: '#password-help' }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        {/* The detail fetch is staff-gated server-side, so a non-staff
            visitor otherwise sits on "Loading…" or a bare API error with
            no idea which of the two it is (AGL-760). */}
        <StaffOnly>
        {error ? (
          <Alert severity="warning">{error}</Alert>
        ) : !detail ? (
          <Typography variant="body2" color="text.secondary">
            {'Loading…'}
          </Typography>
        ) : (
          <GridItems
            spacing={3}
            items={[
              {
                /*
                 * Balanced columns, not three rigid rows of two (AGL-2486).
                 * Five cards all declaring `md: 6` are five HALF-WIDTH items
                 * in a flex grid, and every item in a wrapped row is drawn as
                 * tall as the tallest one in it — so `Organizations`, a table
                 * that grows with the account's memberships, stretched
                 * `Password` beside it into a mostly-empty card, and the
                 * bottom row left a half-width hole where the fifth card had
                 * no partner. The same shape, and the same fix, as the staff
                 * org page and the billing page's narrow run.
                 *
                 * NOT `GridItems masonry`, which is the tempting fix and the
                 * wrong one: within a band it buckets items by their `size`,
                 * so five cards sharing one width share ONE column and leave
                 * the other half of the page empty.
                 *
                 * The two wide cards below stay outside — an audit table and
                 * a sign-in history earn the full width.
                 */
                size: { xs: 12 },
                children: (
                  <CardColumns
                    spacing={3}
                    items={[
                      {
                        key: 'identity',
                        children: (
                          <CardDisplay
                            header="Identity"
                            help={docsHelp('staffConsole', {
                              anchor: '#whats-there',
                              excerpt:
                                "The account's auth state and staff role, with audited identity edits. Impersonation replaces your session with this account.",
                            })}
                            contentGutterX
                            contentGutterY
                          >
                            <Stack spacing={1}>
                              <Typography variant="body2">
                                {detail.user.displayName ?? '—'}
                              </Typography>
                              <Typography variant="body2">
                                {detail.user.email ?? 'no email'}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {`uid ${detail.user.uid}`}
                              </Typography>
                              <Stack direction="row" spacing={1}>
                                {detail.user.disabled ? (
                                  <Chip size="small" color="error" label="Disabled" />
                                ) : (
                                  <Chip size="small" color="success" label="Active" />
                                )}
                                {detail.user.staff ? (
                                  <Chip
                                    size="small"
                                    color="primary"
                                    /*
                                      `?? 'support'`, not `?? 'super'` (AGL-2024).
                                      AGL-2131 brought the last two fail-OPEN defaults
                                      down to `support` — /api/admin/org-override and
                                      the Firestore rules — but this label was not a
                                      gate, so the sweep did not reach it. It is the
                                      one surface that TELLS a staff member what a
                                      claim-less account can do, and it said `super`
                                      while every gate in the product resolved that
                                      same token to `support`. Read literally, it
                                      invited exactly the wrong triage: someone
                                      investigating a 403 would see "Staff: super" and
                                      go looking for the bug somewhere other than the
                                      missing claim.
                                    */
                                    label={`Staff: ${detail.user.staffRole ?? 'support'}`}
                                  />
                                ) : (
                                  <Chip size="small" label="Customer account" />
                                )}
                              </Stack>
                              {/* Assignment summary (AGL-378): staff role +
                                  org roles at a glance. */}
                              <Typography variant="caption" color="text.secondary">
                                {[
                                  detail.user.staff
                                    ? // Same default as the chip above (AGL-2024).
                                      `Staff (${detail.user.staffRole ?? 'support'})`
                                    : 'Not staff',
                                  detail.memberships.length
                                    ? detail.memberships
                                        .map(
                                          (m) =>
                                            `${m.role ?? 'member'} in ${
                                              m.orgName ?? m.orgId
                                            }`,
                                        )
                                        .join(' · ')
                                    : 'no organizations',
                                ].join(' · ')}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {`Providers: ${
                                  detail.user.providers
                                    .map((provider) =>
                                      // The address is the point of showing
                                      // this at all; a provider carrying none
                                      // (phone, anonymous) still renders as
                                      // itself rather than as a dangling
                                      // separator.
                                      provider.email
                                        ? `${provider.providerId} (${provider.email})`
                                        : provider.providerId,
                                    )
                                    .join(', ') || '—'
                                }`}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {`Created ${formatStaffTimestamp(
                                  detail.user.createdAt,
                                )} · last sign-in ${formatStaffTimestamp(
                                  detail.user.lastSignInAt,
                                )}`}
                              </Typography>
                              {/* Phone + do-not-contact (AGL-1569). The number is
                                  collected under Privacy Policy v4 §11 for upsell and
                                  dunning outreach, so it never appears without the
                                  answer to "may we contact them?" — a dialable number
                                  shown next to nothing is how a suppressed person gets
                                  called. Read-only: recording or clearing an opt-out
                                  is the audited /admin/contact-suppressions form. */}
                              <Stack
                                direction="row"
                                spacing={1}
                                sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
                              >
                                <Typography variant="caption" color="text.secondary">
                                  {`Phone: ${
                                    detail.user.phoneNumber ??
                                    (detail.user.phoneNumberErasedAt
                                      ? `— erased at their request (${detail.user.phoneNumberErasedAt})`
                                      : '—')
                                  }`}
                                </Typography>
                                {detail.user.phoneContact?.lookupFailed ? (
                                  <Chip
                                    size="small"
                                    color="warning"
                                    label="Do-not-contact list unreadable — treat as opted out"
                                  />
                                ) : detail.user.phoneContact?.suppressed ? (
                                  <Chip
                                    size="small"
                                    color="error"
                                    label={`Do not contact: ${
                                      detail.user.phoneContact.channels.join(', ') ||
                                      'calls, texts'
                                    }`}
                                  />
                                ) : detail.user.phoneContact ? (
                                  <Chip size="small" label="No opt-out recorded" />
                                ) : null}
                              </Stack>
                              {detail.user.phoneContact &&
                              !detail.user.phoneContact.suppressed ? (
                                // No opt-out is not consent. TCPA needs prior express
                                // written consent before a marketing call or text, and
                                // nothing in the product captures it yet (AGL-1564), so
                                // an empty suppression record must not read as a green
                                // light.
                                <Typography variant="caption" color="text.secondary">
                                  {
                                    'No recorded opt-out is not consent to market — check before calling or texting.'
                                  }
                                </Typography>
                              ) : null}
                              {!detail.user.staff ? (
                                <Button
                                  size="small"
                                  color="warning"
                                  variant="outlined"
                                  sx={{ alignSelf: 'flex-start' }}
                                  onClick={() =>
                                    impersonation.request(
                                      uid ?? '',
                                      detail?.user.email ?? undefined,
                                    )
                                  }
                                >
                                  {'Impersonate (replaces your session)'}
                                </Button>
                              ) : null}
                              {/* Identity editing (AGL-361). */}
                              <Stack spacing={1} sx={{ pt: 1 }}>
                                <TextField
                                  size="small"
                                  label="Display name"
                                  value={edit.displayName}
                                  onChange={(event) =>
                                    setEdit((prev) => ({
                                      ...prev,
                                      displayName: event.target.value,
                                    }))
                                  }
                                />
                                <TextField
                                  size="small"
                                  label="Email"
                                  helperText="Changing the email marks it unverified"
                                  value={edit.email}
                                  onChange={(event) =>
                                    setEdit((prev) => ({
                                      ...prev,
                                      email: event.target.value,
                                    }))
                                  }
                                />
                                <TextField
                                  size="small"
                                  label="Photo URL"
                                  placeholder="https://…"
                                  value={edit.photoUrl}
                                  onChange={(event) =>
                                    setEdit((prev) => ({
                                      ...prev,
                                      photoUrl: event.target.value,
                                    }))
                                  }
                                />
                                <Button
                                  size="small"
                                  variant="outlined"
                                  disabled={editBusy}
                                  sx={{ alignSelf: 'flex-start' }}
                                  onClick={() => void handleIdentitySave()}
                                >
                                  {editBusy ? 'Saving…' : 'Save identity'}
                                </Button>
                              </Stack>
                            </Stack>
                          </CardDisplay>
                        ),
                      },
                      {
                        key: 'organizations',
                        children: (
                          <CardDisplay
                            header="Organizations"
                            help={docsHelp('architectureMultiTenancy', {
                              anchor: '#membership-lifecycle',
                              excerpt:
                                'Every organization this account belongs to, with its role and per-site access.',
                            })}
                            contentGutterX
                            contentGutterY
                          >
                            {detail.memberships.length === 0 ? (
                              <Typography variant="body2" color="text.secondary">
                                {'Not a member of any organization.'}
                              </Typography>
                            ) : (
                              <Table size="small">
                                <TableHead>
                                  <TableRow>
                                    <TableCell>{'Organization'}</TableCell>
                                    {/* AGL-1114: which seat this membership consumes.
                                        Per-membership, not per-account — the same
                                        person is routinely a manager in one org and a
                                        collaborator in another, so there is no single
                                        type for a user. */}
                                    <TableCell>{'Type'}</TableCell>
                                    <TableCell>{'Role'}</TableCell>
                                    <TableCell>{'Sites'}</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {detail.memberships.map((membership) => (
                                    <TableRow key={membership.orgId}>
                                      <TableCell>
                                        <AppLink
                                          href={buildRoute(Route.ADMIN_ORG_DETAIL, {
                                            orgId: membership.orgId,
                                          })}
                                          color="primary"
                                          underline="hover"
                                        >
                                          {membership.orgName ?? membership.orgId}
                                        </AppLink>
                                      </TableCell>
                                      <TableCell>
                                        <Chip
                                          size="small"
                                          variant="outlined"
                                          color={
                                            consoleUserType(membership as never) ===
                                            'manager'
                                              ? 'secondary'
                                              : 'default'
                                          }
                                          label={
                                            CONSOLE_USER_TYPE_LABELS[
                                              consoleUserType(membership as never)
                                            ]
                                          }
                                        />
                                      </TableCell>
                                      <TableCell>
                                        {membership.role ?? '—'}
                                        {membership.roleId ? ' (custom)' : ''}
                                      </TableCell>
                                      <TableCell>
                                        {/* Per-host access roles (AGL-378):
                                            show which sites and at what role,
                                            not just a count. */}
                                        {membership.allHosts ? (
                                          <Chip size="small" label="All sites" />
                                        ) : Object.keys(membership.hostAccess)
                                            .length === 0 ? (
                                          <Typography
                                            variant="caption"
                                            color="text.secondary"
                                          >
                                            {'—'}
                                          </Typography>
                                        ) : (
                                          <Stack
                                            direction="row"
                                            spacing={0.5}
                                            sx={{ flexWrap: 'wrap', gap: 0.5 }}
                                          >
                                            {Object.entries(
                                              membership.hostAccess,
                                            ).map(([hostId, role]) => (
                                              <Chip
                                                key={hostId}
                                                size="small"
                                                variant="outlined"
                                                label={`${hostId}: ${role}`}
                                              />
                                            ))}
                                          </Stack>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            )}
                          </CardDisplay>
                        ),
                      },
                      {
                        key: 'password',
                        children: (
                          <CardDisplay
                            header="Password"
                            help={docsHelp('staffConsole', {
                              anchor: '#whats-there',
                              excerpt:
                                'Email this account a reset link, or set a password directly when they cannot receive mail. Both are audited.',
                            })}
                            contentGutterX
                            contentGutterY
                          >
                            <PasswordAdminControls
                              email={detail.user.email}
                              subjectLabel={detail.user.email ?? detail.user.uid}
                              description={
                                'For an account that has locked itself out. ' +
                                'Setting a password revokes this account’s ' +
                                'refresh tokens, so every device signs out.'
                              }
                              onSendReset={async () => {
                                await callManage({ action: 'sendPasswordReset' })
                              }}
                              onSetPassword={async (password) => {
                                await callManage({ action: 'setPassword', password })
                              }}
                            />
                          </CardDisplay>
                        ),
                      },
                      {
                        key: 'device-sessions',
                        children: (
                          /*
                           * AGL-1513 part 2. The registry has recorded every sign-in
                           * since AGL-665 and AGL-1959 gave the OWNER a list and a
                           * sign-out; staff had neither, so "someone stole my laptop"
                           * was answered by disabling the whole account. This is the
                           * same write behind the same audit trail as every other
                           * action on this page.
                           */
                          <StaffUserDeviceSessionsCard
                            subjectLabel={detail.user.email ?? detail.user.uid}
                            rows={detail.devices?.rows ?? []}
                            // A missing `devices` key is a read that did not happen,
                            // which is the same thing to a reader as a read that
                            // failed — and the opposite of "no other devices".
                            lookupFailed={detail.devices?.lookupFailed ?? true}
                            onSignOut={async (deviceId) =>
                              callManage({ action: 'signOutDevice', deviceId })
                            }
                          />
                        ),
                      },
                      {
                        key: 'erase',
                        children: (
                          // AGL-1977. `eraseUser` has existed since AGL-1140 and
                          // nothing in the console called it; a staff member honouring
                          // an erasure request had to hand-craft an authenticated POST.
                          // The card gates itself on `staffRole === 'super'`, which is
                          // what the route demands.
                          <StaffUserEraseCard
                            uid={detail.user.uid}
                            subjectLabel={detail.user.email ?? detail.user.uid}
                            isSelf={(user as any)?.uid === detail.user.uid}
                            onErase={async (reason) => {
                              await callManage({ action: 'erase', reason })
                            }}
                          />
                        ),
                      },
                    ]}
                  />
                ),
              },
              {
                size: { xs: 12 },
                children: (
                  /*
                   * What we sent this person and what they did with it.
                   *
                   * OUTSIDE `CardColumns`, with the audit table and the
                   * sign-in history: it holds a paginated grid, and multicol
                   * cannot span, so inside the columns it was a six-column
                   * table squeezed into half the page with `Clicks` cut off
                   * at the edge. Same reason those two are out here.
                   */
                  <StaffUserEmailHistoryCard
                    address={detail.user.email ?? null}
                    rows={detail.emails?.rows ?? []}
                    // A missing `emails` key is a read that did not happen,
                    // which reads to a human exactly like a read that failed
                    // — and NOT like "we never emailed them".
                    lookupFailed={detail.emails?.lookupFailed ?? true}
                    // Every address the rows were gathered from, so a staffer
                    // can see they are looking at mail sent to an address
                    // that is no longer this account's primary.
                    addresses={detail.addresses ?? []}
                    addressesIncomplete={detail.addressesIncomplete === true}
                    erasures={detail.emails?.erasures ?? {}}
                  />
                ),
              },
              {
                size: { xs: 12 },
                children: (
                  /*
                   * Legal acceptances (AGL-2316). These records were written
                   * from the first day sign-up captured them and read by
                   * nothing, which made both promises they were written for
                   * undeliverable: nobody could answer "which version did
                   * this person accept" in a dispute, and nothing could tell
                   * that the published Terms had moved past what they agreed
                   * to. This card is where a ToS §18.5 opt-out claim is
                   * answered from, so it shows the CONTENT HASHES too — the
                   * URL alone says what the page reads today, not what this
                   * person was shown.
                   *
                   * Read-only, deliberately. An acceptance is evidence about
                   * the account holder; the Firestore rules make the
                   * collection `write: if false` for exactly that reason, and
                   * a staff button that could add or amend one would hand the
                   * other side of a dispute its best argument.
                   */
                  <CardDisplay
                    header="Legal acceptances"
                    help={docsHelp('staffConsole', {
                      anchor: '#whats-there',
                      excerpt:
                        'Which version of the Terms and Privacy Policy this account accepted, when, and whether the 30-day arbitration opt-out window is still open.',
                    })}
                    contentGutterX
                    contentGutterY
                  >
                    {!detail.legal || detail.legal.lookupFailed ? (
                      <Alert severity="warning">
                        {
                          'The acceptance records could not be read. This is NOT the same as "no acceptance on file" — do not answer a dispute from this screen until it loads.'
                        }
                      </Alert>
                    ) : (
                      <Stack spacing={1.5}>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
                        >
                          {detail.legal.accepted ? (
                            <Chip
                              size="small"
                              color="success"
                              label={`Accepted the current version (${detail.legal.currentVersion})`}
                            />
                          ) : detail.legal.reacceptanceReason ===
                            'never-accepted' ? (
                            <Chip
                              size="small"
                              color="error"
                              label="No acceptance on file"
                            />
                          ) : (
                            <Chip
                              size="small"
                              color="warning"
                              label={`Accepted ${
                                detail.legal.latestAcceptedVersion ?? '—'
                              } — current is ${detail.legal.currentVersion}`}
                            />
                          )}
                          {detail.legal.reacceptanceRequired ? (
                            <Chip
                              size="small"
                              variant="outlined"
                              color="warning"
                              label="Re-acceptance prompted in the console"
                            />
                          ) : null}
                        </Stack>
                        {/* ToS §18.5: 30 days from FIRST accepting, which is
                            why the clock is not restarted by the re-acceptance
                            above it. */}
                        <Typography variant="caption" color="text.secondary">
                          {detail.legal.arbitration?.firstAcceptedAt
                            ? `Arbitration opt-out (ToS §18.5): first accepted ${new Date(
                                detail.legal.arbitration.firstAcceptedAt,
                              ).toLocaleString()} · window ${
                                detail.legal.arbitration.open
                                  ? `OPEN, closes ${new Date(
                                      detail.legal.arbitration.deadline ?? '',
                                    ).toLocaleString()} (${
                                      detail.legal.arbitration.daysRemaining
                                    } day(s) left)`
                                  : `CLOSED since ${new Date(
                                      detail.legal.arbitration.deadline ?? '',
                                    ).toLocaleString()}`
                              }`
                            : 'Arbitration opt-out (ToS §18.5): no acceptance on file, so there is no window to measure — not a closed one.'}
                        </Typography>
                        {detail.legal.acceptances.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">
                            {
                              'Nothing recorded. Accounts created before clickwrap capture, and accounts created through SSO, can legitimately have no record.'
                            }
                          </Typography>
                        ) : (
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>{'Version'}</TableCell>
                                <TableCell>{'Accepted'}</TableCell>
                                <TableCell>{'Door'}</TableCell>
                                <TableCell>{'Documents (sha256)'}</TableCell>
                                <TableCell>{'IP'}</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {detail.legal.acceptances.map((record) => (
                                <TableRow key={record.version}>
                                  <TableCell>{record.version}</TableCell>
                                  <TableCell>
                                    {record.acceptedAt
                                      ? new Date(
                                          record.acceptedAt,
                                        ).toLocaleString()
                                      : '—'}
                                  </TableCell>
                                  <TableCell>{record.context ?? '—'}</TableCell>
                                  <TableCell>
                                    {record.documents.length === 0
                                      ? '—'
                                      : record.documents.map((doc, index) => {
                                          const label = `${doc.key}:${(
                                            doc.sha256 ?? ''
                                          ).slice(0, 12)}`
                                          const href =
                                            legalAcceptanceDocumentHref(
                                              doc.url,
                                            )
                                          return (
                                            <span key={doc.key}>
                                              {index > 0 ? ' · ' : null}
                                              {href ? (
                                                <Link
                                                  href={href}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  underline="always"
                                                >
                                                  {label}
                                                </Link>
                                              ) : (
                                                label
                                              )}
                                            </span>
                                          )
                                        })}
                                  </TableCell>
                                  <TableCell>
                                    {record.ipAddress ?? '—'}
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
                size: { xs: 12 },
                children: (
                  /*
                   * What this ACCOUNT did, everywhere.
                   *
                   * The card above is the log of STAFF actions taken against
                   * the account — a different log answering a different
                   * question, and the only one this page had. Whenever this
                   * page is open for a reason, "what did they do" is the
                   * question being asked, and nothing here could answer it.
                   * Every org, every site, newest first.
                   *
                   * The copy says "console actions", not "everything". The
                   * feed is `collectionGroup('activity')`, which spans
                   * `orgs/{orgId}/activity` and `hosts/{hostId}/activity` —
                   * so the SCOPE half of the claim holds. Completeness does
                   * not: an entry exists only where a mutation point calls
                   * the logger, and a flow that forgets to is indistinguishable
                   * here from a person who did nothing. Promising
                   * "everything" turns that gap into a false negative on a
                   * page read as an audit trail, which is the reading that
                   * matters — an empty feed must be understood as "nothing
                   * was logged", never as "nothing was done".
                   */
                  <ActorActivityTable
                    endpoint={`/api/admin/user-activity?uid=${encodeURIComponent(uid)}`}
                    header="Activity by this account"
                    help={docsHelp('staffConsole', {
                      anchor: '#whats-there',
                      excerpt:
                        'Console actions logged for this account, across every organization and site — as distinct from the staff actions taken against it.',
                    })}
                    description={
                      'Console actions logged for this account, across every ' +
                      'organization and site. An empty feed means nothing was ' +
                      'logged, not that nothing was done. Not the same as the ' +
                      'staff actions above, which were done TO it.'
                    }
                  />
                ),
              },

              {
                size: { xs: 12 },
                children: (
                  <ActivityTable
                    header="Recent audit trail"
                    help={docsHelp('staffConsole', {
                      anchor: '#whats-there',
                      excerpt:
                        'Audited staff actions performed by or on this account — the full record lives on the Audit log page.',
                    })}
                    description={
                      'Audited staff actions performed BY or ON this ' +
                      'account. Not the same as the activity above, which ' +
                      'is what the account itself did. Data staff merely ' +
                      'LOOKED at is the card below. The full record lives ' +
                      'on the Audit log page.'
                    }
                    columns={auditColumns}
                    rows={pagedAudit}
                    getRowId={(row: any) => row.id}
                    emptyLabel="No audited actions involve this account."
                    page={auditPage}
                    pageSize={auditPageSize}
                    count={auditEntries.length}
                    onPageChange={setAuditPage}
                    onPageSizeChange={setAuditPageSize}
                  />
                ),
              },

              {
                size: { xs: 12 },
                children: (
                  /*
                   * WHO LOOKED — its own card, so it cannot crowd the one
                   * above.
                   *
                   * Reads are cheap to perform and so arrive far more often
                   * than the acts anybody opens this page to review; sharing
                   * one window with them is how four message views buried an
                   * impersonation. They are separated rather than dropped
                   * because this is the half that answers the question the
                   * audit trail exists for — a customer asking who at Aglyn
                   * read their mail — and that answer must be on the page of
                   * the person whose mail it was.
                   */
                  <ActivityTable
                    header="Data access by staff"
                    help={docsHelp('staffConsole', {
                      anchor: '#whats-there',
                      excerpt:
                        'Audited staff READS of this account’s private data — kept apart from the actions above so a burst of views cannot bury an impersonation.',
                    })}
                    description={
                      'Times a staff member opened this account’s ' +
                      'private data without changing it — reading a sent ' +
                      'message, for example. Repeats of a single opening ' +
                      'collapse onto one row and say how many; two separate ' +
                      'openings are two rows.'
                    }
                    columns={auditColumns}
                    rows={pagedAccess}
                    getRowId={(row: any) => row.id}
                    emptyLabel="No audited staff reads of this account's data."
                    page={accessPage}
                    pageSize={accessPageSize}
                    count={accessEntries.length}
                    onPageChange={setAccessPage}
                    onPageSizeChange={setAccessPageSize}
                  />
                ),
              },
            ]}
          />
        )}
        </StaffOnly>
      </Container>
      {impersonation.dialog}
    </DashboardLayout>
  )
}
AdminUserDetail.displayName = 'Page:AdminUserDetail'

export default AdminUserDetail
