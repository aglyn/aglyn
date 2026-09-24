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
  canManageOrg,
  CONSOLE_USER_TYPE_HINTS,
  CONSOLE_USER_TYPE_LABELS,
  consoleUserType,
  countManagerSeats,
  ORG_PERMISSIONS,
  ORG_ROLES,
  resolveOrgPermissions,
  type AglynOrgCustomRole,
  type AglynOrgMember,
  type HostAccessRole,
  type OrgRole,
} from '@aglyn/aglyn'
import {
  AppLink,
  CardDisplay,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import ListTable from '@aglyn/shared-ui-jsx/components/list-table.component'
import { inMemoryListField } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListRowsFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-rows-filter'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { docsHelp } from '../constants/docs-links'
import { checkOrgSeatQuota } from '../constants/entitlements'
import { buildRoute, Route } from '../constants/route-links'
import useBranding from '../hooks/use-branding'
import useCurrentOrg from '../hooks/use-current-org'
import { useOrgHosts } from '../hooks/use-org-hosts'
import { useOrgScope, useOrgSlug } from '../hooks/use-org-scope'
import MemberAvatar from './member-avatar.component'
import {
  pluginGridColumns,
  useStablePluginColumns,
} from './plugin-grid-columns.component'
import {
  usePluginColumnSort,
  usePluginListColumns,
} from './plugin-list-columns.component'

const ASSIGNABLE_ROLES: OrgRole[] = ['admin', 'editor', 'viewer']
/**
 * Per-site access options, weakest first. `author` (AGL-2334) sits between
 * viewer and editor: it edits every content document on the site and cannot
 * publish any of it — the agency guide's worked example, "a client who may
 * edit content but not publish".
 *
 * A capability is not a feature until it is assignable. The rules enforce
 * this role; this picker and the site-collaborator one are the only two
 * places a human can hand it out, so leaving either unchanged would have
 * shipped a permission nobody could grant.
 */
const HOST_ROLE_OPTIONS: Array<HostAccessRole | 'none'> = [
  'none',
  'viewer',
  'author',
  'editor',
  'admin',
]
/** What each per-site option means, for the picker's helper line. */
const HOST_ROLE_HINTS: Record<HostAccessRole | 'none', string> = {
  none: 'No access to this site',
  viewer: 'Can look, cannot change anything',
  author: 'Can edit content, cannot publish it',
  editor: 'Can edit content and publish it',
  admin: 'Full control of the site, including its people',
}

/*
 * What the roster grid's Filters panel and quick search offer (AGL-3317).
 * The card holds every member (`/api/orgs/members` answers the whole roster,
 * which the seat counts above the grid need anyway), so both are answered
 * over all of them. Role and access are matched on the values the row is
 * READ as (`roleKey`, `accessKey`): a member stored with no role is a
 * viewer, and access is the kind of user their reach makes them.
 */
const MEMBER_FILTER_FIELDS = [
  inMemoryListField('member', 'text', 'name'),
  inMemoryListField('role', 'select', 'roleKey'),
  inMemoryListField('access', 'select', 'accessKey'),
]
const MEMBER_FILTER_HEADERS: Readonly<Record<string, string>> = {
  member: 'Member',
  role: 'Role',
  access: 'Access',
}
const MEMBER_FILTER_OPTIONS = {
  role: ORG_ROLES.map((value) => ({ value, label: value })),
  // An org member is one or the other; a site member is never on this roster.
  access: (['manager', 'collaborator'] as const).map((value) => ({
    value,
    label: CONSOLE_USER_TYPE_LABELS[value],
  })),
}
const MEMBER_SEARCH_FIELDS = ['name', 'email', 'title'] as const

/** A roster row, with the values the Filters panel matches. */
type MemberRow = AglynOrgMember & {
  name: string
  roleKey: string
  accessKey: string
}

/** Keeps a cell's own keystrokes from moving the grid's focus. */
const stopGridKeys = (event: { stopPropagation: () => void }) =>
  event.stopPropagation()

interface AccessDraft {
  uid: string
  label: string
  role: OrgRole
  allHosts: boolean
  hostAccess: Record<string, HostAccessRole>
}

/**
 * Organization membership manager (AGL-234): the permanent org-role model
 * (owner/admin/editor/viewer + all-hosts toggle) over /api/orgs/members
 * and /api/orgs/invites. People without an Aglyn account get a pending
 * invite they accept on first sign-in; per-site access editing lands with
 * the workspace host picker.
 */
export function OrgMembersCard() {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const orgSlug = useOrgSlug()
  const { currentOrg } = useOrgScope()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [members, setMembers] = useState<AglynOrgMember[]>([])
  const [invites, setInvites] = useState<any[]>([])
  // Custom roles (AGL-243): named permission sets assignable per member.
  const [roles, setRoles] = useState<Array<{ $id: string; name?: string }>>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrgRole>('editor')
  const [allHosts, setAllHosts] = useState(true)
  const [busy, setBusy] = useState(false)
  const [accessDraft, setAccessDraft] = useState<AccessDraft | null>(null)
  // Effective-permissions viewer (AGL-270).
  const [permissionsFor, setPermissionsFor] = useState<AglynOrgMember | null>(
    null,
  )
  const orgId = currentOrg?.$id
  const canManage = canManageOrg(currentOrg?.role)
  // Columns a plugin contributes to this table (AGL-2940), drawn between
  // Access and the actions.
  const { columns: pluginColumns } = usePluginListColumns('orgMembersListColumn')
  // Manager-seat quota hint (AGL-530): the roster counts against
  // managersPerOrg; extra seats sell on the Billing add-ons card.
  // Only MANAGERS count (AGL-1113) — this list also shows site-scoped
  // collaborators, whose seats meter per host against membersPerHost. Using
  // `members.length` read "8 of 5 manager seats used" to an org with three
  // managers and five collaborators.
  const { org, ready: orgReady } = useCurrentOrg()
  // Org-scoped chrome reads the org's RESOLVED product name, never a
  // literal (AGL-2319): a white-label org's admins see their own brand.
  const { branding } = useBranding()
  const managerSeatsUsed = useMemo(() => countManagerSeats(members), [members])

  /**
   * The roster in the order a plugin column asked for (AGL-2939), otherwise
   * the order the API hands it. A column that sorts by values only its
   * plugin reads — members' AI credits this month — hands the table a
   * comparator through its header.
   *
   * Paged by the grid's own footer (AGL-2501): `members` is already fully in
   * memory — the seat counts and the manager-seat gate above both count
   * across ALL of them — so paging the query would mean two different
   * populations answering two questions on one card.
   */
  const {
    rows: sortedMembers,
    sortedBy: pluginSortedBy,
    onSort: onPluginSort,
  } = usePluginColumnSort(members)
  const memberRows = useMemo<MemberRow[]>(
    () =>
      sortedMembers.map((member) => ({
        ...member,
        name: member.displayName || member.email || member.$id,
        roleKey: member.role ?? 'viewer',
        accessKey: consoleUserType(member),
      })),
    [sortedMembers],
  )
  const memberFilter = useListRowsFilter({
    rows: memberRows,
    fields: MEMBER_FILTER_FIELDS,
    options: MEMBER_FILTER_OPTIONS,
    headers: MEMBER_FILTER_HEADERS,
    search: MEMBER_SEARCH_FIELDS,
  })
  const seatQuota = checkOrgSeatQuota(org, 'managers', managerSeatsUsed)
  // An org admin sees every org host via the memberRoles projection, so
  // this doubles as the org host directory for the access editor.
  const { hosts } = useOrgHosts(firestore, user?.uid, orgId)
  const orgHosts = useMemo(
    () => hosts.filter((host) => host['orgId'] === orgId),
    [hosts, orgId],
  )
  // Inline email validation (AGL-853): catch a typo before the round-trip,
  // instead of only a server-side "Invalid email" toast.
  const trimmedEmail = email.trim()
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)

  // Low-level fetch that reports status + payload without side effects, so
  // callers that treat an error as an expected branch (e.g. the add/invite
  // probe below) can decide whether to surface it. `request` wraps this and
  // keeps the toast-on-error behaviour every other caller relies on.
  const rawRequest = useCallback(
    async (path: string, method: string, body?: Record<string, unknown>) => {
      const response = await authorizedFetch(user, path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const payload = await response.json().catch(() => ({}))
      return { ok: response.ok, status: response.status, payload }
    },
    [user],
  )

  const request = useCallback(
    async (path: string, method: string, body?: Record<string, unknown>) => {
      const { ok, payload } = await rawRequest(path, method, body)
      if (!ok) {
        enqueueSnackbar(payload?.error ?? 'Organization request failed', {
          variant: 'warning',
          persist: false,
        })
        return null
      }
      return payload
    },
    [rawRequest, enqueueSnackbar],
  )

  const refresh = useCallback(async () => {
    if (!orgId || !user) return
    // Roles are PAGED (AGL-2334). The route used to answer a bare
    // `.limit(50)` with no cursor and no count, so an org's 51st custom role
    // was invisible rather than on a second page — and this card is where
    // roles are assigned, so invisible meant unusable. Following the cursor
    // is what makes the cap gone rather than merely larger; a caller that
    // ignored it would reintroduce the same silent truncation at 100.
    const loadRoles = async () => {
      const all: any[] = []
      let cursor: string | null = null
      // A ceiling on ROUND TRIPS, not on roles — it exists so a server that
      // kept handing back a cursor cannot spin the console forever.
      for (let page = 0; page < 20; page += 1) {
        const payload: any = await request(
          `/api/orgs/roles?orgId=${orgId}` +
            (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''),
          'GET',
        )
        if (!payload?.roles) break
        all.push(...payload.roles)
        cursor = payload.nextCursor ?? null
        if (!cursor) break
      }
      return all
    }
    const [membersPayload, invitesPayload, allRoles] = await Promise.all([
      request(`/api/orgs/members?orgId=${orgId}`, 'GET'),
      canManage
        ? request(`/api/orgs/invites?orgId=${orgId}`, 'GET')
        : Promise.resolve({ invites: [] }),
      loadRoles(),
    ])
    if (membersPayload?.members) setMembers(membersPayload.members)
    if (invitesPayload?.invites) setInvites(invitesPayload.invites)
    setRoles(allRoles)
  }, [orgId, user, canManage, request])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleAdd = useCallback(async () => {
    const target = email.trim().toLowerCase()
    if (!target || !orgId || busy) return
    setBusy(true)
    try {
      // Try a direct add when the account already exists. This is a silent
      // probe: a 404 means "no Aglyn account yet", which is the normal path
      // into an invite — not an error worth a toast. Any OTHER failure (seat
      // quota, owner, permissions) is real and surfaced as-is, and we do NOT
      // fall through to an invite for it.
      const added = await rawRequest('/api/orgs/members', 'POST', {
        orgId,
        action: 'upsert',
        email: target,
        role,
        allHosts,
      })
      if (added.ok) {
        enqueueSnackbar(`Added ${target}`, { variant: 'success' })
        setEmail('')
        await refresh()
        return
      }
      if (added.status !== 404) {
        enqueueSnackbar(added.payload?.error ?? 'Organization request failed', {
          variant: 'warning',
          persist: false,
        })
        return
      }
      // No account yet — create a pending invite instead.
      const invited = await request('/api/orgs/invites', 'POST', {
        orgId,
        action: 'create',
        email: target,
        role,
        allHosts,
      })
      if (!invited) return
      enqueueSnackbar(
        invited.emailed
          ? `Invited ${target} — email sent`
          : `Invited ${target} — they'll see it when they sign in`,
        { variant: 'success' },
      )
      setEmail('')
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [
    email,
    orgId,
    busy,
    role,
    allHosts,
    rawRequest,
    request,
    enqueueSnackbar,
    refresh,
  ])

  /*
    Columns a plugin contributes to this table (AGL-2940), as grid columns.
    Each cell is handed its member beside the zone's props, and a column that
    sorts hands the roster a comparator through its own header (AGL-2939).
  */
  const stablePluginColumns = useStablePluginColumns(pluginColumns)
  const pluginMemberColumns = useMemo(
    () =>
      pluginGridColumns<AglynOrgMember>(stablePluginColumns, {
        slotProps: { orgId, canManage },
        sortedBy: pluginSortedBy,
        onSort: onPluginSort,
        rowProps: (member) => ({ member }),
      }),
    [stablePluginColumns, orgId, canManage, pluginSortedBy, onPluginSort],
  )

  if (!currentOrg) return null

  /*
    The roster's columns. The editors inside a row are its own: the grid only
    draws them, and a row click opens nothing, so a select or a button in a
    cell is never mistaken for the row.
  */
  const memberColumns: GridColDef[] = [
    {
      field: 'member',
      headerName: 'Member',
      flex: 1.2,
      minWidth: 220,
      valueGetter: (_value, row: MemberRow) => row.name,
      renderCell: ({ row: member }: { row: MemberRow }) => (
        <Box sx={{ py: 0.75 }}>
          {/* The roster row had no avatar at all (AGL-1126) — a
              table of people with no faces in it. */}
          <Stack
            direction="row"
            spacing={1.25}
            sx={{ alignItems: 'center' }}
          >
            <MemberAvatar
              photoURL={member.photoURL}
              email={member.email}
              name={member.displayName}
            />
            <Box sx={{ minWidth: 0 }}>
              {/* Member detail page (AGL-364). */}
              <AppLink
                href={buildRoute(Route.MANAGE_TEAM_MEMBER, { orgSlug,
                  uid: member.$id,
                })}
                color="inherit"
                underline="hover"
              >
                {member.displayName || member.email || member.$id}
              </AppLink>
              {member.title ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="div"
                >
                  {member.title}
                </Typography>
              ) : null}
            </Box>
          </Stack>
        </Box>
      ),
    },
    {
      /*
       * One column per QUESTION (AGL-1125). Role and Custom role
       * used to sit side by side as two dropdowns, which reads as
       * "which of these two is in effect?" — they are not
       * alternatives; a custom role LAYERS on the base role
       * (AGL-243). They are one cell now.
       *
       * Type (AGL-1114) is gone as a column because it was never an
       * independent fact: `consoleUserType` is
       * `isOrgWideMember(member) ? manager : collaborator`, derived
       * from exactly the access this next column shows. It moves
       * INTO Access, which is what decides it — and which is what
       * decides the seat it consumes.
       */
      field: 'role',
      headerName: 'Role',
      flex: 1,
      minWidth: 200,
      valueGetter: (_value, row: MemberRow) => row.roleKey,
      /*
       * AGL-2334: this said a custom role "adds permissions on top
       * of the base role — it does not replace it", and that is
       * not what the code does. `resolveOrgPermissions` merges
       * key-by-key and honours an explicit `false` at both the
       * custom-role and member-override layers, so a custom role
       * can take a permission AWAY as readily as grant one.
       *
       * The sentence was not merely inaccurate, it discouraged the
       * exact use `run-an-agency-workspace.md` recommends —
       * "custom roles if you want something narrower than the
       * built-ins". Anyone who believed the tooltip would conclude
       * narrowing was impossible and stop looking.
       */
      renderHeader: () => (
        <Tooltip title="A custom role LAYERS on the base role, key by key — it can grant a permission the role lacks, or take one away.">
          <span>{'Role'}</span>
        </Tooltip>
      ),
      renderCell: ({ row: member }: { row: MemberRow }) => (
        <Box sx={{ py: 0.75 }} onKeyDown={stopGridKeys}>
          <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
            {canManage && member.role !== 'owner' ? (
              <TextField
                size="small"
                select
                value={member.role ?? 'viewer'}
                onChange={(event) =>
                  void request('/api/orgs/members', 'POST', {
                    orgId,
                    action: 'upsert',
                    uid: member.$id,
                    role: event.target.value,
                    allHosts: member.allHosts === true,
                    hostAccess: member.hostAccess ?? {},
                  }).then((ok) => ok && refresh())
                }
                sx={{ width: 110 }}
              >
                {ASSIGNABLE_ROLES.map((value) => (
                  <MenuItem key={value} value={value}>
                    {value}
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <Chip label={member.role ?? 'viewer'} size="small" />
            )}
            {/* Only when the org HAS custom roles, or this member is
                on one. An always-rendered select whose only option
                was "—" is what made an ordinary member look
                misconfigured: a blank box beside a filled one reads
                as unset, not as "nothing extra". */}
            {roles.length || (member as any).roleId
              ? (canManage && member.role !== 'owner' ? (
                  <TextField
                    size="small"
                    select
                    variant="standard"
                    value={(member as any).roleId ?? ''}
                    onChange={(event) =>
                      void request('/api/orgs/members', 'POST', {
                        orgId,
                        action: 'upsert',
                        uid: member.$id,
                        role: member.role ?? 'viewer',
                        allHosts: member.allHosts === true,
                        hostAccess: member.hostAccess ?? {},
                        roleId: event.target.value || null,
                      }).then((ok) => ok && refresh())
                    }
                    // A Typography child inside the value slot
                    // collapses to nothing — the label has to be a
                    // plain string for the Select to render it.
                    sx={{
                      width: 170,
                      '& .MuiSelect-select': {
                        fontSize: 12,
                        color: (member as any).roleId
                          ? 'text.primary'
                          : 'text.secondary',
                      },
                    }}
                    slotProps={{
                      // Without displayEmpty a Select renders NOTHING
                      // for an empty value — no placeholder, no
                      // label, just the arrow. That is half of why
                      // the old custom-role column read as a broken
                      // blank box: its "—" option was there and
                      // simply never drawn.
                      select: { displayEmpty: true },
                      input: { disableUnderline: true },
                      htmlInput: { 'aria-label': 'Extra permissions' },
                    }}
                  >
                    <MenuItem value="">
                      {'No extra permissions'}
                    </MenuItem>
                    {roles.map((customRole) => (
                      <MenuItem key={customRole.$id} value={customRole.$id}>
                        {`+ ${customRole.name ?? customRole.$id}`}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : (member as any).roleId ? (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`+ ${
                      roles.find(
                        (customRole) =>
                          customRole.$id === (member as any).roleId,
                      )?.name ?? 'custom'
                    }`}
                  />
                ) : null)
              : null}
          </Stack>
        </Box>
      ),
    },
    {
      field: 'access',
      headerName: 'Access',
      flex: 0.9,
      minWidth: 160,
      valueGetter: (_value, row: MemberRow) => row.accessKey,
      renderCell: ({ row: member }: { row: MemberRow }) => (
        <Box sx={{ py: 0.75 }} onKeyDown={stopGridKeys}>
          {/* Access, with the kind of user it MAKES them underneath
              (AGL-1114 lives here now, AGL-1125). The seat a member
              consumes follows from their reach, so the two belong in
              one cell: change the access and the type changes with
              it, which two separate columns never showed. */}
          <Stack spacing={0.25} sx={{ alignItems: 'flex-start' }}>
            {member.role === 'owner' || member.role === 'admin' ? (
              <Typography variant="body2">{'All sites'}</Typography>
            ) : canManage ? (
              <Button
                size="small"
                sx={{ minWidth: 0, px: 0.5 }}
                onClick={() =>
                  setAccessDraft({
                    uid: member.$id,
                    label:
                      member.displayName || member.email || member.$id,
                    role: (member.role ?? 'viewer') as OrgRole,
                    allHosts: member.allHosts === true,
                    hostAccess: { ...(member.hostAccess ?? {}) },
                  })
                }
              >
                {member.allHosts
                  ? 'All sites'
                  : `${Object.keys(member.hostAccess ?? {}).length} site(s)`}
              </Button>
            ) : (
              <Typography variant="body2">
                {member.allHosts
                  ? 'All sites'
                  : `${Object.keys(member.hostAccess ?? {}).length} site(s)`}
              </Typography>
            )}
            {(() => {
              const kind = consoleUserType(member)
              return (
                <Tooltip title={CONSOLE_USER_TYPE_HINTS[kind]}>
                  <Typography
                    variant="caption"
                    color={
                      kind === 'manager' ? 'primary.main' : 'text.secondary'
                    }
                  >
                    {CONSOLE_USER_TYPE_LABELS[kind]}
                  </Typography>
                </Tooltip>
              )
            })()}
          </Stack>
        </Box>
      ),
    },
    // Columns a plugin contributes, between Access and the actions (AGL-2940).
    ...pluginMemberColumns,
    {
      field: 'actions',
      headerName: '',
      minWidth: 190,
      align: 'right',
      sortable: false,
      filterable: false,
      hideable: false,
      disableColumnMenu: true,
      renderCell: ({ row: member }: { row: MemberRow }) => (
        <Box onKeyDown={stopGridKeys}>
          <Button
            size="small"
            onClick={() => setPermissionsFor(member)}
          >
            {'Permissions'}
          </Button>
          {canManage && member.role !== 'owner' ? (
            <Button
              size="small"
              color="error"
              onClick={() =>
                void confirm({
                  title: 'Remove member?',
                  description: `${member.email ?? member.$id} loses access to every site in this organization.`,
                })
                  // confirm() resolves on accept and REJECTS on
                  // cancel — the catch is the cancel path.
                  .then(async () => {
                    const ok = await request(
                      '/api/orgs/members',
                      'POST',
                      {
                        orgId,
                        action: 'remove',
                        uid: member.$id,
                      },
                    )
                    if (ok) await refresh()
                  })
                  .catch(() => {
                    // Cancelled — nothing to do.
                  })
              }
            >
              {'Remove'}
            </Button>
          ) : null}
        </Box>
      ),
    },
  ]

  return (
    <CardDisplay
      header={`Organization members — ${currentOrg.orgName ?? currentOrg.$id}`}
      help={docsHelp('inviteTeammates', {
        anchor: '#invite-someone',
        excerpt:
          'Add or invite people by email, set org and custom roles, and ' +
          'limit editors and viewers to specific sites.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Owners and admins manage the whole organization; editors and ' +
            'viewers can be limited to specific sites.'}
        </Typography>
        {/* AGL-1422: `checkOrgSeatQuota(undefined, …)` is the FREE tier, not
            "unknown", so before the billing doc lands this line read
            "4 of 1 manager seats used — upgrade for more" to a workspace that
            had bought the seats. A seat count is a claim about the plan; the
            plan has to have answered before it can be made. */}
        {orgReady && Number.isFinite(seatQuota.limit) ? (
          <Typography variant="caption" color="text.secondary">
            {`${managerSeatsUsed} of ${seatQuota.limit} manager seats used`}
            {members.length > managerSeatsUsed
              ? ` · ${members.length - managerSeatsUsed} site collaborator${
                  members.length - managerSeatsUsed === 1 ? '' : 's'
                } (metered per site)`
              : ''}
            {seatQuota.upgradeRequired ? (
              ' — upgrade for more'
            ) : seatQuota.addonPriceUsd != null ? (
              <>
                {` — extra seats $${seatQuota.addonPriceUsd}/mo in `}
                <AppLink
                  href={`${buildRoute(Route.MANAGE_BILLING, { orgSlug })}#addons`}
                >
                  {'Billing'}
                </AppLink>
              </>
            ) : null}
          </Typography>
        ) : null}
        {canManage ? (
          <Stack spacing={0.75}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ flexWrap: 'wrap', rowGap: 1, alignItems: 'flex-start' }}
            >
              <TextField
                size="small"
                label="Email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                error={Boolean(trimmedEmail) && !emailValid}
                helperText={
                  Boolean(trimmedEmail) && !emailValid
                    ? 'Enter a valid email address'
                    : undefined
                }
                sx={{ minWidth: 240 }}
              />
              <TextField
                size="small"
                select
                label="Role"
                value={role}
                onChange={(event) => setRole(event.target.value as OrgRole)}
                sx={{ width: 120 }}
              >
                {ASSIGNABLE_ROLES.map((value) => (
                  <MenuItem key={value} value={value}>
                    {value}
                  </MenuItem>
                ))}
              </TextField>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={allHosts}
                    onChange={(event) => setAllHosts(event.target.checked)}
                  />
                }
                label="All sites"
                sx={{ mt: 0.5 }}
              />
              <Button
                variant="contained"
                size="small"
                disabled={busy || !emailValid}
                onClick={() => void handleAdd()}
                sx={{ mt: 0.5 }}
              >
                {'Add or invite'}
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {`Already on ${branding.productName}? They join right away. ` +
                `New to ${branding.productName}? We email them an invite they ` +
                'accept when they first sign in.'}
            </Typography>
          </Stack>
        ) : null}
        <ListFilterChips {...memberFilter.chipsProps} />
        <ListTable
          aria-label="Organization members"
          rows={memberFilter.rows}
          columns={memberFilter.filterColumns(memberColumns)}
          // A row holds a role picker over a custom-role picker, so it is as
          // tall as what it holds.
          getRowHeight={() => 'auto'}
          // The rows arrive in the roster's order, or a plugin column's; the
          // grid's own sort would be a second order fighting the first.
          disableColumnSorting
          // The panel and the search are the grid's; the card answers them
          // over the whole roster (AGL-3317).
          {...memberFilter.gridProps}
          noRowsLabel={
            members.length ? 'No members match these filters' : 'No members yet'
          }
        />
        {canManage && invites.length > 0 ? (
          <Stack spacing={1}>
            <Typography variant="subtitle2">{'Pending invites'}</Typography>
            {invites.map((invite) => (
              <Stack
                key={invite.$id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center' }}
              >
                {/* An invite reserves the seat it will become (AGL-1114), so
                    it is labelled with the same vocabulary as the roster —
                    otherwise the only way to tell a pending manager from a
                    pending collaborator was to revoke and re-send it. */}
                <Tooltip
                  title={CONSOLE_USER_TYPE_HINTS[consoleUserType(invite)]}
                >
                  <Chip
                    size="small"
                    variant="outlined"
                    color={
                      consoleUserType(invite) === 'manager'
                        ? 'secondary'
                        : 'default'
                    }
                    label={
                      CONSOLE_USER_TYPE_LABELS[consoleUserType(invite)]
                    }
                  />
                </Tooltip>
                <Chip label={invite.role} size="small" />
                <Typography variant="body2">{invite.email}</Typography>
                <Button
                  size="small"
                  sx={{ ml: 'auto' }}
                  disabled={busy}
                  onClick={() => {
                    setBusy(true)
                    void request('/api/orgs/invites', 'POST', {
                      orgId,
                      action: 'resend',
                      inviteId: invite.$id,
                    })
                      .then((payload) => {
                        if (!payload) return
                        enqueueSnackbar(
                          payload.emailed
                            ? `Invite re-sent to ${invite.email}`
                            : `Couldn't email ${invite.email} — check email settings`,
                          {
                            variant: payload.emailed ? 'success' : 'warning',
                            persist: false,
                          },
                        )
                      })
                      .finally(() => setBusy(false))
                  }}
                >
                  {'Resend'}
                </Button>
                <Button
                  size="small"
                  color="error"
                  onClick={() =>
                    void request('/api/orgs/invites', 'POST', {
                      orgId,
                      action: 'revoke',
                      inviteId: invite.$id,
                    }).then((ok) => ok && refresh())
                  }
                >
                  {'Revoke'}
                </Button>
              </Stack>
            ))}
          </Stack>
        ) : null}
      </Stack>
      <Dialog
        open={Boolean(accessDraft)}
        onClose={() => setAccessDraft(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{`Site access — ${accessDraft?.label ?? ''}`}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
        >
          <FormControlLabel
            control={
              <Checkbox
                checked={accessDraft?.allHosts ?? false}
                onChange={(event) =>
                  setAccessDraft((draft) =>
                    draft ? { ...draft, allHosts: event.target.checked } : draft,
                  )
                }
              />
            }
            label={`All sites (as ${accessDraft?.role ?? 'member'})`}
          />
          {accessDraft?.allHosts
            ? null
            : orgHosts.map((host) => (
                <Stack
                  key={host.$id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <Typography variant="body2" sx={{ flexGrow: 1 }} noWrap>
                    {host['displayName'] ?? host.$id}
                  </Typography>
                  <TextField
                    size="small"
                    select
                    value={accessDraft?.hostAccess[host.$id] ?? 'none'}
                    onChange={(event) =>
                      setAccessDraft((draft) => {
                        if (!draft) return draft
                        const hostAccess = { ...draft.hostAccess }
                        if (event.target.value === 'none') {
                          delete hostAccess[host.$id]
                        } else {
                          hostAccess[host.$id] = event.target
                            .value as HostAccessRole
                        }
                        return { ...draft, hostAccess }
                      })
                    }
                    sx={{ width: 110 }}
                  >
                    {HOST_ROLE_OPTIONS.map((value) => (
                      <MenuItem key={value} value={value}>
                        {value}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ width: 200 }}
                  >
                    {
                      HOST_ROLE_HINTS[
                        (accessDraft?.hostAccess[host.$id] ??
                          'none') as HostAccessRole | 'none'
                      ]
                    }
                  </Typography>
                </Stack>
              ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAccessDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => {
              if (!accessDraft) return
              setBusy(true)
              void request('/api/orgs/members', 'POST', {
                orgId,
                action: 'upsert',
                uid: accessDraft.uid,
                role: accessDraft.role,
                allHosts: accessDraft.allHosts,
                hostAccess: accessDraft.hostAccess,
              })
                .then(async (ok) => {
                  if (ok) {
                    setAccessDraft(null)
                    await refresh()
                  }
                })
                .finally(() => setBusy(false))
            }}
          >
            {busy ? 'Saving…' : 'Save access'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(permissionsFor)}
        onClose={() => setPermissionsFor(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {`Effective permissions — ${
            permissionsFor?.displayName ??
            permissionsFor?.email ??
            permissionsFor?.$id ??
            ''
          }`}
        </DialogTitle>
        <DialogContent>
          {permissionsFor
            ? (() => {
                // Role defaults → custom role → member overrides (AGL-243),
                // resolved with the roles list this card already loads.
                const customRole =
                  ((permissionsFor as any).roleId
                    ? (roles.find(
                        (candidate) =>
                          candidate.$id === (permissionsFor as any).roleId,
                      ) as AglynOrgCustomRole | undefined)
                    : undefined) ?? null
                const granted = resolveOrgPermissions(
                  permissionsFor as any,
                  customRole,
                )
                return (
                  <Stack spacing={0.75} sx={{ pt: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {`Org role: ${permissionsFor.role ?? 'viewer'}` +
                        (customRole?.name
                          ? ` · custom role: ${customRole.name}`
                          : '')}
                    </Typography>
                    {ORG_PERMISSIONS.map((definition) => (
                      <Stack
                        key={definition.key}
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center' }}
                      >
                        <Chip
                          size="small"
                          color={granted[definition.key] ? 'success' : 'default'}
                          variant={granted[definition.key] ? 'filled' : 'outlined'}
                          label={granted[definition.key] ? 'yes' : 'no'}
                          sx={{ width: 48 }}
                        />
                        <Typography variant="body2">
                          {definition.label}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                )
              })()
            : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPermissionsFor(null)}>{'Close'}</Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
OrgMembersCard.displayName = 'OrgMembersCard'
OrgMembersCard.aglyn = true

export default OrgMembersCard
